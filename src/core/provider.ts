/**
 * Blockfrost-shaped transport over the Gerolamino dApp API. It returns the same status/body shape a
 * Blockfrost SDK expects, plus the extension's provenance fields (source, peer, proof, ledger).
 * No keys, no signing: submitTx forwards a wallet-signed CBOR transaction.
 *
 * Every call gets a `requestId`. Failures carry `{kind, status, path, blockfrostBody, requestId}` so a
 * dApp can log one object and support can triage from it.
 */
import {
    GerolaminoError,
    GerolaminoGatewaySilentError,
    GerolaminoHttpError,
    errorFromUnknown
} from "./errors";
import type {
    GerolaminoAnswer,
    GerolaminoApi,
    GerolaminoProvider,
    GerolaminoProviderOptions,
    GerolaminoResponse,
    GerolaminoSubmitResult,
    GerolaminoSubmitSource
} from "./types";
import { checkPath, isHex, nextRequestId, nowIso, providerOptions, withQuery, withTimeout } from "./util";

export function createGerolaminoProvider(api: GerolaminoApi, options: GerolaminoProviderOptions = {}): GerolaminoProvider {
    if (!api || typeof api.query !== "function") throw new GerolaminoError("createGerolaminoProvider: an enabled Gerolamino api is required");
    const { requestTimeoutMs, submitTimeoutMs } = providerOptions(options);

    const get = async (path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): Promise<GerolaminoAnswer> => {
        const clean = checkPath(path);
        if (!clean) throw new GerolaminoError("a Blockfrost path is required");
        const requestId = nextRequestId();
        let answer: GerolaminoAnswer;
        try {
            answer = await withTimeout(api.query(withQuery(clean, init)), requestTimeoutMs, `query ${clean}`);
        } catch (e) {
            // A query that rejects for a non-refusal reason means the approved node answered nothing.
            const wrapped = errorFromUnknown(e, `Gerolamino query ${clean} failed`, { path: clean, requestId });
            if (wrapped.kind === "UNKNOWN") wrapped.kind = "GATEWAY_SILENT";
            if (wrapped.status == null && wrapped.kind === "GATEWAY_SILENT") wrapped.status = 503;
            throw wrapped;
        }
        if (!answer || typeof answer !== "object") {
            throw new GerolaminoGatewaySilentError(`Gerolamino query ${clean} returned no answer`, { path: clean, requestId });
        }
        return { ...answer, requestId: answer.requestId ?? requestId };
    };

    const submitTx = async (txCborHex: string): Promise<GerolaminoSubmitResult> => {
        const hex = normalizeTxHex(txCborHex);
        const requestId = nextRequestId();
        let raw: unknown;
        try {
            raw = await withTimeout(api.submitTx(hex), submitTimeoutMs, "submitTx");
        } catch (e) {
            throw errorFromUnknown(e, "Gerolamino submitTx failed", { requestId });
        }
        return normalizeSubmitResult(raw, requestId);
    };

    return {
        api,
        get,
        json: async <T = unknown>(path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): Promise<T> => {
            const answer = await get(path, init);
            if (answer.status !== 200) throw answerError(path, answer);
            return answer.body as T;
        },
        getAllPages: async <T = unknown>(path: string, opts?: { count?: number; maxPages?: number }): Promise<T[]> => {
            const count = Math.min(Math.max(opts?.count ?? 100, 1), 100);
            const maxPages = Math.min(Math.max(opts?.maxPages ?? 50, 1), 500);
            const out: T[] = [];
            for (let page = 1; page <= maxPages; page++) {
                const answer = await get(path, { count, page });
                if (answer.status !== 200) throw answerError(path, answer);
                if (!Array.isArray(answer.body)) throw new GerolaminoError(`Gerolamino Blockfrost ${path} page ${page}: response body is not an array`, {
                    kind: "INVALID_REQUEST",
                    path,
                    requestId: answer.requestId ?? null,
                    status: answer.status
                });
                out.push(...(answer.body as T[]));
                if (answer.body.length < count) break;
            }
            return out;
        },
        submitTx,
        submitTxId: async (txCborHex: string): Promise<string> => (await submitTx(txCborHex)).txid
    };
}

/** Build the typed failure for a non-200 answer. A literal 503 is the official GATEWAY_SILENT case. */
export function answerError(path: string, answer: GerolaminoAnswer): GerolaminoHttpError | GerolaminoGatewaySilentError {
    const requestId = answer.requestId ?? null;
    if (answer.status === 503) {
        return new GerolaminoGatewaySilentError(
            `Gerolamino Blockfrost ${path}: 503, the connected node did not answer`,
            { path, blockfrostBody: answer.body, requestId }
        );
    }
    return new GerolaminoHttpError(path, answer.status, answer.body, { requestId });
}

/** Accept `{ txid | txId | id, source, peer, acceptedAt }` and the legacy bare-string answer. */
export function normalizeSubmitResult(raw: unknown, requestId: string): GerolaminoSubmitResult {
    if (typeof raw === "string") {
        const txid = raw.trim();
        if (!txid) throw new GerolaminoError("Gerolamino submitTx returned an empty transaction id", { kind: "INVALID_REQUEST", requestId });
        return { txid, source: "unknown", acceptedAt: nowIso(), requestId, legacyShape: true };
    }
    if (raw && typeof raw === "object") {
        const value = raw as Record<string, unknown>;
        const candidate = value.txid ?? value.txId ?? value.id ?? value.hash;
        if (typeof candidate !== "string" || !candidate.trim()) {
            throw new GerolaminoError("Gerolamino submitTx returned no transaction id", { kind: "INVALID_REQUEST", requestId, blockfrostBody: raw });
        }
        return {
            txid: candidate.trim(),
            source: submitSource(value.source),
            acceptedAt: typeof value.acceptedAt === "string" ? value.acceptedAt : nowIso(),
            peer: typeof value.peer === "string" ? value.peer : null,
            requestId,
            legacyShape: false
        };
    }
    throw new GerolaminoError("Gerolamino submitTx returned neither a txid string nor an object", { kind: "INVALID_REQUEST", requestId });
}

function submitSource(value: unknown): GerolaminoSubmitSource {
    const source = typeof value === "string" ? value.trim().toLowerCase() : "";
    return source === "local" || source === "relay" ? source : "unknown";
}

function normalizeTxHex(txCborHex: string): string {
    const hex = String(txCborHex ?? "").replace(/^0x/i, "");
    if (!isHex(hex)) throw new GerolaminoError("submitTx(cbor): a signed transaction as hex CBOR", { kind: "INVALID_REQUEST" });
    return hex;
}

/** A fetch-shaped response that keeps provenance fields out of the body, just like a Blockfrost HTTP response. */
function jsonResponse(status: number, body: unknown, url: string): GerolaminoResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        url,
        json: async () => body,
        text: async () => typeof body === "string" ? body : JSON.stringify(body)
    };
}

function bodyToHex(body: unknown): string | null {
    if (typeof body === "string") return body.replace(/^0x/i, "");
    if (body instanceof Uint8Array) return Array.from(body, (b) => b.toString(16).padStart(2, "0")).join("");
    if (body instanceof ArrayBuffer) return Array.from(new Uint8Array(body), (b) => b.toString(16).padStart(2, "0")).join("");
    return null;
}

/**
 * Return a fetch-shaped function: GETs and `tx/submit` POSTs under a Gerolamino-backed base URL go through
 * the connector; everything else uses `globalThis.fetch` unchanged. A connected node that answers nothing
 * produces a 503 with `kind: "GATEWAY_SILENT"`, so callers know there is no silent port fallback.
 */
export function createGerolaminoFetch(provider: GerolaminoProvider, baseUrl = "") {
    const base = String(baseUrl ?? "").replace(/\/+$/, "");
    return async (input: string | { url: string }, init?: RequestInit): Promise<GerolaminoResponse> => {
        const url = typeof input === "string" ? input : input?.url ?? "";
        const method = String(init?.method ?? (typeof input === "string" ? "GET" : "GET")).toUpperCase();
        const rawPath = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
        const path = checkPath(rawPath);
        const underBase = !base || url === base || url.startsWith(base + "/") || url.startsWith("/api/v0") || url.startsWith(base.replace(/^.*\/\/[^/]+/, ""));
        if (!underBase) return await fetchResponse(input, init);
        if (method === "GET") {
            try {
                const answer = await provider.get(path);
                return jsonResponse(answer.status, answer.body, url);
            } catch (e) {
                return jsonResponse(503, {
                    status_code: 503,
                    error: "Service Unavailable",
                    kind: (e as GerolaminoError)?.kind ?? "GATEWAY_SILENT",
                    message: (e as Error)?.message ?? String(e),
                    request_id: (e as GerolaminoError)?.requestId ?? null
                }, url);
            }
        }
        if (method === "POST" && /(^|\/)tx\/submit(\?|$)/.test(path)) {
            const hex = bodyToHex(init?.body);
            if (!hex) return jsonResponse(400, { status_code: 400, error: "Bad Request", kind: "INVALID_REQUEST", message: "tx/submit body is not hex CBOR" }, url);
            try {
                const result = await provider.submitTx(hex);
                return jsonResponse(200, result.txid, url);
            } catch (e) {
                return jsonResponse(502, {
                    status_code: 502,
                    error: "Bad Gateway",
                    kind: (e as GerolaminoError)?.kind ?? "UNKNOWN",
                    message: (e as Error)?.message ?? String(e),
                    request_id: (e as GerolaminoError)?.requestId ?? null
                }, url);
            }
        }
        return jsonResponse(405, { status_code: 405, error: "Method Not Allowed", message: `${method} ${path} is not a Gerolamino transport path` }, url);
    };
}

async function fetchResponse(input: string | { url: string }, init?: RequestInit): Promise<GerolaminoResponse> {
    const url = typeof input === "string" ? input : input.url;
    const response = await globalThis.fetch(typeof input === "string" ? input : input.url, init);
    return {
        ok: response.ok,
        status: response.status,
        url: response.url || url,
        json: () => response.json(),
        text: () => response.text()
    };
}

/** Alias preserving the names used by the current `dist/gerolamino-blockfrost.js` adapter. */
export const gerolaminoProvider = createGerolaminoProvider;
