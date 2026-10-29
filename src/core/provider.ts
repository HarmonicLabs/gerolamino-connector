/**
 * Blockfrost-shaped transport over the Gerolamino dApp API. It returns the same status/body shape a
 * Blockfrost SDK expects, plus the extension's provenance fields (source, peer, proof, ledger).
 * No keys, no signing: submitTx forwards a wallet-signed CBOR transaction.
 */
import { GerolaminoError, GerolaminoHttpError } from "./errors";
import type { GerolaminoProvider, GerolaminoProviderOptions, GerolaminoResponse } from "./types";
import type { GerolaminoApi, GerolaminoAnswer } from "./types";
import { checkPath, isHex, providerOptions, withQuery, withTimeout } from "./util";

export function createGerolaminoProvider(api: GerolaminoApi, options: GerolaminoProviderOptions = {}): GerolaminoProvider {
    if (!api || typeof api.query !== "function") throw new GerolaminoError("createGerolaminoProvider: an enabled Gerolamino api is required");
    const { requestTimeoutMs, submitTimeoutMs } = providerOptions(options);

    const get = async (path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): Promise<GerolaminoAnswer> => {
        const clean = checkPath(path);
        if (!clean) throw new GerolaminoError("a Blockfrost path is required");
        return await withTimeout(api.query(withQuery(clean, init)), requestTimeoutMs, `query ${clean}`);
    };

    return {
        api,
        get,
        json: async <T = unknown>(path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): Promise<T> => {
            const answer = await get(path, init);
            if (answer.status !== 200) throw new GerolaminoHttpError(path, answer.status, answer.body);
            return answer.body as T;
        },
        getAllPages: async <T = unknown>(path: string, opts?: { count?: number; maxPages?: number }): Promise<T[]> => {
            const count = Math.min(Math.max(opts?.count ?? 100, 1), 100);
            const maxPages = Math.min(Math.max(opts?.maxPages ?? 50, 1), 500);
            const out: T[] = [];
            for (let page = 1; page <= maxPages; page++) {
                const answer = await get(path, { count, page });
                if (answer.status !== 200) throw new GerolaminoHttpError(path, answer.status, answer.body);
                if (!Array.isArray(answer.body)) throw new GerolaminoError(`Gerolamino Blockfrost ${path} page ${page}: response body is not an array`);
                out.push(...(answer.body as T[]));
                if (answer.body.length < count) break;
            }
            return out;
        },
        submitTx: async (txCborHex: string): Promise<string> => {
            const hex = String(txCborHex ?? "").replace(/^0x/i, "");
            if (!isHex(hex)) throw new GerolaminoError("submitTx(cbor): a signed transaction as hex CBOR");
            return await withTimeout(api.submitTx(hex), submitTimeoutMs, "submitTx");
        }
    };
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
 * produces a 503, so callers know there is no silent port fallback.
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
                return jsonResponse(503, { status_code: 503, error: "Service Unavailable", message: (e as Error)?.message ?? String(e) }, url);
            }
        }
        if (method === "POST" && /(^|\/)tx\/submit(\?|$)/.test(path)) {
            const hex = bodyToHex(init?.body);
            if (!hex) return jsonResponse(400, { status_code: 400, error: "Bad Request", message: "tx/submit body is not hex CBOR" }, url);
            try {
                const txid = await provider.submitTx(hex);
                return jsonResponse(200, txid, url);
            } catch (e) {
                return jsonResponse(502, { status_code: 502, error: "Bad Gateway", message: (e as Error)?.message ?? String(e) }, url);
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
