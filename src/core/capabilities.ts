/**
 * Capability flags. dApps should branch on these instead of sniffing `apiVersion`: a string comparison
 * cannot tell "legacy but fine" from "stale extension, reload needed".
 */
import type { GerolaminoApi, GerolaminoCapabilities, GerolaminoDetection, GerolaminoDisconnectAction, GerolaminoExtension } from "./types";
import { CONNECTOR_VERSION, extensionBuild, isLegacyVersion } from "./util";

/** Revoke-capable extension methods, in priority order. The first present one is the one `close()` calls. */
export const REVOKE_METHODS = ["revoke", "disable", "disconnect", "disableExtension"] as const;

export function revokeMethodOf(extension: GerolaminoExtension | null | undefined): string | null {
    if (!extension) return null;
    for (const method of REVOKE_METHODS) {
        if (typeof (extension as any)[method] === "function") return method;
    }
    return null;
}

/** A provider that advertises an older contract than we prefer needs a reload/update, not a code workaround. */
export function needsReloadOf(extension: GerolaminoExtension | null | undefined, compatible = true): boolean {
    if (!extension) return false;
    if (!compatible) return true;
    return isLegacyVersion(String(extension.apiVersion ?? ""));
}

export function readCapabilities(
    api: GerolaminoApi,
    extension: GerolaminoExtension,
    detection?: GerolaminoDetection | null
): GerolaminoCapabilities {
    const revokeMethod = revokeMethodOf(extension);
    const apiVersion = detection ? detection.apiVersion : extension.apiVersion == null ? null : String(extension.apiVersion);
    const dappApiVersion = detection ? detection.dappApiVersion : extension.dappApiVersion == null ? null : String(extension.dappApiVersion);
    const has = (key: keyof GerolaminoApi) => typeof (api as any)?.[key] === "function";
    return {
        canQuery: has("query"),
        canSubmit: has("submitTx"),
        canTip: has("getTip"),
        canTrust: has("getTrust"),
        canNetworkId: has("getNetworkId"),
        canEvaluate: has("evaluate"),
        supportsRevoke: revokeMethod !== null,
        revokeMethod,
        // The 0.2 contract answers submitTx with an object. The provider normalizes either shape, but only
        // an object answer can name the path that carried the transaction.
        submitProvenance: false,
        connectorVersion: CONNECTOR_VERSION,
        apiVersion,
        dappApiVersion,
        needsReload: detection ? detection.needsReload : needsReloadOf(extension),
        build: detection ? detection.build : extensionBuild(extension)
    };
}

/** Mark provenance availability after the first submit answer, so the flag reflects what actually happened. */
export function markSubmitProvenance(capabilities: GerolaminoCapabilities, proven: boolean): GerolaminoCapabilities {
    return { ...capabilities, submitProvenance: proven };
}

/**
 * What the disconnect control may honestly say. Gerolamino has no page-callable revoke today, so the
 * button must not promise a revoke it cannot perform: it turns the connector off for this page only and
 * the site stays approved in the extension.
 */
export function disconnectAction(capabilities: GerolaminoCapabilities): GerolaminoDisconnectAction {
    if (capabilities.supportsRevoke) {
        return { mode: "extension", label: "Revoke approval", revokeMethod: capabilities.revokeMethod };
    }
    return { mode: "local", label: "Stop using Gerolamino on this site", revokeMethod: null };
}

/** Point the user at the only place a revoke exists when the page cannot call one. */
export const REVOKE_SETTINGS_HINT = "Revoke this site in Gerolamino Settings -> Connected sites.";
