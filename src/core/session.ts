/**
 * A connected session wraps the enabled api, the provider transport, and status reads. It never holds keys
 * and never signs. `close()` uses a future extension revoke/disable method when present; otherwise it is
 * honest about a local-only close and points the user at Gerolamino Settings -> Connected sites.
 */
import { GerolaminoError } from "./errors";
import type {
    GerolaminoApi,
    GerolaminoDisconnectResult,
    GerolaminoExtension,
    GerolaminoNodeStatus,
    GerolaminoSession,
    GerolaminoSessionOptions,
    GerolaminoTip,
    GerolaminoTrust,
    GerolaminoTrustRow,
    GerolaminoWindowLike
} from "./types";
import { createGerolaminoProvider } from "./provider";
import { checkPath, isHex, DEFAULT_APPROVAL_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_SUBMIT_TIMEOUT_MS, withTimeout } from "./util";

export function createGerolaminoSession(
    api: GerolaminoApi,
    extension: GerolaminoExtension,
    options: GerolaminoSessionOptions = {}
): GerolaminoSession {
    const requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const submitTimeout = options.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    const provider = createGerolaminoProvider(api, options);
    let closed = false;

    const session: GerolaminoSession = {
        api,
        extension,
        provider,
        get closed() {
            return closed;
        },
        getNetworkId: async (opts?: { timeoutMs?: number }) => await withTimeout(api.getNetworkId(), opts?.timeoutMs ?? 5_000, "getNetworkId"),
        query: async (path: string, opts?: { timeoutMs?: number }) => await withTimeout(api.query(checkPath(path)), opts?.timeoutMs ?? requestTimeout, `query ${path}`),
        submitTx: async (txCborHex: string, opts?: { timeoutMs?: number }) => {
            const hex = String(txCborHex ?? "").replace(/^0x/i, "");
            if (!isHex(hex)) throw new GerolaminoError("submitTx(cbor): a signed transaction as hex CBOR");
            return await withTimeout(api.submitTx(hex), opts?.timeoutMs ?? submitTimeout, "submitTx");
        },
        getTip: async (opts?: { timeoutMs?: number }): Promise<GerolaminoTip> => {
            const tip = await withTimeout(api.getTip(), opts?.timeoutMs ?? 8_000, "getTip");
            if (!tip || typeof tip !== "object" || typeof (tip as GerolaminoTip).slot !== "number") {
                throw new GerolaminoError("Gerolamino getTip did not return a verified tip");
            }
            return tip as GerolaminoTip;
        },
        getTrust: async (opts?: { timeoutMs?: number }): Promise<GerolaminoTrust | null> => {
            if (typeof api.getTrust !== "function") return null;
            return await withTimeout(api.getTrust(), opts?.timeoutMs ?? 8_000, "getTrust");
        },
        status: async (opts?: { timeoutMs?: number }): Promise<GerolaminoNodeStatus | null> => {
            let tip: GerolaminoTip;
            try {
                tip = await session.getTip(opts);
            } catch (e) {
                if (e instanceof GerolaminoError) return null;
                return null;
            }
            let verdict: string | null = null;
            let trustRows: GerolaminoTrustRow[] = [];
            try {
                const trust = await session.getTrust(opts);
                verdict = typeof trust?.verdict === "string" ? trust.verdict : null;
                trustRows = Array.isArray(trust?.rows) ? trust.rows as GerolaminoTrustRow[] : [];
            } catch {
                /* trust is optional */
            }
            const tipSlot = normalizeNumber(tip.slot);
            const tipHeight = normalizeNumber(tip.height);
            const peerSlot = normalizeNumber(tip.peerTip?.slot);
            const peerHeight = normalizeNumber(tip.peerTip?.height);
            return {
                network: typeof tip.network === "string" ? tip.network : null,
                state: typeof tip.state === "string" ? tip.state : null,
                tipSlot,
                tipHeight,
                tipHash: typeof tip.hash === "string" ? tip.hash : null,
                peerSlot,
                peerHeight,
                syncPercent: tipSlot != null && peerSlot != null && peerSlot > 0 ? Math.min(100, Math.round((tipSlot / peerSlot) * 10_000) / 100) : null,
                verdict,
                trustRows: trustRows,
                tip
            };
        },
        close: async (opts?: { timeoutMs?: number }): Promise<GerolaminoDisconnectResult> => {
            const timeoutMs = opts?.timeoutMs ?? 8_000;
            const methods = ["revoke", "disable", "disconnect", "disableExtension"] as const;
            for (const method of methods) {
                const fn = (extension as any)[method];
                if (typeof fn !== "function") continue;
                try {
                    await withTimeout(fn.call(extension), timeoutMs, method);
                    closed = true;
                    return { mode: "extension", method, message: `approval revoked through ${method}()` };
                } catch (e) {
                    throw new GerolaminoError(`Gerolamino ${method}() failed: ${(e as Error)?.message ?? String(e)}`);
                }
            }
            closed = true;
            return {
                mode: "local",
                method: null,
                message: "this Gerolamino build exposes no page-callable revoke; close is local, revoke the site in Gerolamino Settings"
            };
        }
    };
    return session;
}

function normalizeNumber(value: unknown): number | null {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
}

export const sessionDefaults = {
    approvalTimeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    submitTimeoutMs: DEFAULT_SUBMIT_TIMEOUT_MS
} as const;
