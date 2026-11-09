/**
 * A connected session wraps the enabled api, the provider transport, and status reads. It never holds keys
 * and never signs. `close()` uses a future extension revoke/disable method when present; otherwise it is
 * honest about a local-only close and points the user at Gerolamino Settings -> Connected sites.
 */
import { GerolaminoError, GerolaminoGatewaySilentError, errorFromUnknown } from "./errors";
import type {
    GerolaminoApi,
    GerolaminoCapabilities,
    GerolaminoDisconnectResult,
    GerolaminoExtension,
    GerolaminoNetworkAssertion,
    GerolaminoNetworkExpectation,
    GerolaminoNodeStatus,
    GerolaminoSession,
    GerolaminoSessionOptions,
    GerolaminoSubmitResult,
    GerolaminoTip,
    GerolaminoTrust,
    GerolaminoTrustRow,
    GerolaminoDetection
} from "./types";
import { createGerolaminoProvider } from "./provider";
import { markSubmitProvenance, readCapabilities } from "./capabilities";
import {
    CARDANO_NETWORK_MAGIC,
    CONNECTOR_VERSION,
    checkPath,
    extensionBuild,
    isHex,
    normalizeNetwork,
    DEFAULT_APPROVAL_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_SUBMIT_TIMEOUT_MS,
    withTimeout
} from "./util";

export function createGerolaminoSession(
    api: GerolaminoApi,
    extension: GerolaminoExtension,
    options: GerolaminoSessionOptions = {},
    detection?: GerolaminoDetection | null
): GerolaminoSession {
    const requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const submitTimeout = options.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
    const provider = createGerolaminoProvider(api, options);
    let capabilities: GerolaminoCapabilities = readCapabilities(api, extension, detection);
    let closed = false;

    const networkId = async (opts?: { timeoutMs?: number }): Promise<number> => {
        if (typeof api.getNetworkId !== "function") {
            throw new GerolaminoError("this Gerolamino build exposes no getNetworkId()", { kind: "INCOMPATIBLE" });
        }
        return await withTimeout(api.getNetworkId(), opts?.timeoutMs ?? 5_000, "getNetworkId");
    };

    const session: GerolaminoSession = {
        api,
        extension,
        provider,
        get closed() {
            return closed;
        },
        get capabilities() {
            return capabilities;
        },
        getCapabilities: () => capabilities,
        getNetworkId: networkId,
        query: async (path: string, opts?: { timeoutMs?: number }) => {
            const clean = checkPath(path);
            try {
                return await withTimeout(api.query(clean), opts?.timeoutMs ?? requestTimeout, `query ${clean}`);
            } catch (e) {
                const wrapped = errorFromUnknown(e, `Gerolamino query ${clean} failed`, { path: clean });
                if (wrapped.kind === "UNKNOWN") {
                    throw new GerolaminoGatewaySilentError(`Gerolamino query ${clean} failed: ${wrapped.message}`, {
                        path: clean,
                        cause: e
                    });
                }
                throw wrapped;
            }
        },
        submitTx: async (txCborHex: string, opts?: { timeoutMs?: number }): Promise<GerolaminoSubmitResult> => {
            const hex = String(txCborHex ?? "").replace(/^0x/i, "");
            if (!isHex(hex)) throw new GerolaminoError("submitTx(cbor): a signed transaction as hex CBOR", { kind: "INVALID_REQUEST" });
            const result = await provider.submitTx(hex);
            if (!result.legacyShape) capabilities = markSubmitProvenance(capabilities, true);
            return { ...result, acceptedAt: result.acceptedAt };
        },
        submitTxId: async (txCborHex: string, opts?: { timeoutMs?: number }): Promise<string> => (await session.submitTx(txCborHex, opts)).txid,
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
            } catch {
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
            let networkIdValue: number | null = null;
            try {
                networkIdValue = await networkId(opts);
            } catch {
                /* network id is optional for status */
            }
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
                trustRows,
                tip,
                identity: {
                    connectorVersion: CONNECTOR_VERSION,
                    apiVersion: extension.apiVersion == null ? null : String(extension.apiVersion),
                    dappApiVersion: extension.dappApiVersion == null ? null : String(extension.dappApiVersion),
                    build: extensionBuild(extension),
                    networkId: networkIdValue
                }
            };
        },
        assertNetwork: async (expected: GerolaminoNetworkExpectation, opts?: { timeoutMs?: number }): Promise<GerolaminoNetworkAssertion> => {
            const want = normalizeNetwork(expected);
            let actualNetworkId: number | null = null;
            try {
                actualNetworkId = await networkId(opts);
            } catch {
                /* report what we have */
            }
            let tipNetwork: string | null = null;
            try {
                const tip = await session.getTip(opts);
                tipNetwork = tip?.network == null ? null : normalizeNetwork(String(tip.network)).name ?? String(tip.network);
            } catch {
                /* report what we have */
            }
            const actualFromMagic = actualNetworkId == null ? { name: null, magic: null } : normalizeNetwork(actualNetworkId);
            const actualName = tipNetwork ?? (actualFromMagic.name as string | null);
            const actualMagic = actualFromMagic.magic;
            let ok = false;
            if (want.magic != null && actualMagic != null) ok = want.magic === actualMagic;
            else if (want.name != null && actualName != null) ok = want.name === actualName;
            const detail = want.name == null && want.magic == null
                ? `unknown expected network: ${String(expected)}`
                : actualName == null && actualMagic == null
                    ? "the Gerolamino node did not report a network"
                    : ok
                        ? `Gerolamino answers for ${actualName ?? actualMagic}`
                        : `Gerolamino answers for ${actualName ?? actualMagic} (magic ${actualMagic ?? "?"}), the dApp expects ${want.name ?? want.magic}`;
            return {
                ok,
                expected: want,
                actual: { name: actualName, magic: actualMagic, networkId: actualNetworkId, tipNetwork },
                detail
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
                    capabilities = readCapabilities(api, extension, detection);
                    return { mode: "extension", method, message: `approval revoked through ${method}()` };
                } catch (e) {
                    throw new GerolaminoError(`Gerolamino ${method}() failed: ${(e as Error)?.message ?? String(e)}`, {
                        kind: "REVOKE_FAILED",
                        cause: e
                    });
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

export { CARDANO_NETWORK_MAGIC };
