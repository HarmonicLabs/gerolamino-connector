/**
 * Prompt-free detection. `detect()` never calls `enable()`; it only reads provider fields and calls
 * `isEnabled()`, which is the contract's non-prompting probe. Only `connect()` may open the approval window.
 *
 * Detection reports `needsReload` as well as `compatible`: the connector accepts the legacy `0.1.0` shape,
 * but an accepted legacy provider still cannot report submit provenance, so the dApp should ask for a
 * reload instead of guessing from the version string.
 */
import type { GerolaminoConnectOptions, GerolaminoDetection, GerolaminoExtension, GerolaminoWindowLike } from "./types";
import {
    currentWindow,
    extensionFromWindow,
    extensionBuild,
    GEROLAMINO_API_VERSION,
    GEROLAMINO_DAPP_API_VERSION,
    isLegacyVersion,
    needsReloadFor,
    DEFAULT_DETECTION_TIMEOUT_MS,
    withTimeout
} from "./util";

export function isCompatibleExtension(ext: GerolaminoExtension, allowLegacyApiVersion = true): boolean {
    const apiVersion = String(ext.apiVersion ?? "");
    if (apiVersion === GEROLAMINO_API_VERSION) return true;
    if (allowLegacyApiVersion && apiVersion === GEROLAMINO_DAPP_API_VERSION) return true;
    return false;
}

export function isLegacyExtension(ext: GerolaminoExtension): boolean {
    return isLegacyVersion(String(ext.apiVersion ?? ""));
}

/**
 * Read the extension without prompting. A refusal or timeout from `isEnabled()` leaves `enabled` null,
 * not false, so callers can distinguish "unknown" from "the user has not allowed this site".
 */
export async function detectGerolamino(options: GerolaminoConnectOptions = {}): Promise<GerolaminoDetection> {
    const win = currentWindow(options.win);
    let ext: GerolaminoExtension | null;
    try {
        ext = extensionFromWindow(win);
    } catch (e) {
        ext = null;
    }

    if (!ext) {
        return {
            status: "absent",
            present: false,
            compatible: false,
            legacyVersion: false,
            enabled: null,
            name: null,
            apiVersion: null,
            dappApiVersion: null,
            needsReload: false,
            build: null,
            detail: "Gerolamino is not installed (window.cardano.gerolamino is missing)"
        };
    }

    const apiVersion = ext.apiVersion == null ? null : String(ext.apiVersion);
    const dappApiVersion = ext.dappApiVersion == null ? null : String(ext.dappApiVersion);
    const name = ext.name == null ? null : String(ext.name);
    const build = extensionBuild(ext);
    const hasShape = typeof ext.enable === "function" && typeof ext.name === "string";
    const compatible = hasShape && isCompatibleExtension(ext, options.allowLegacyApiVersion ?? true);
    const legacyVersion = isLegacyExtension(ext);
    const needsReload = hasShape && needsReloadFor({ compatible, legacyVersion });
    const enabled = compatible && typeof ext.isEnabled === "function"
        ? await readEnabled(ext, options.detectionTimeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS)
        : null;

    if (!compatible) {
        return {
            status: "incompatible",
            present: true,
            compatible: false,
            legacyVersion,
            enabled: null,
            name,
            apiVersion,
            dappApiVersion,
            needsReload,
            build,
            detail: hasShape
                ? `Gerolamino uses apiVersion ${apiVersion ?? "unknown"}; this connector accepts "1"${options.allowLegacyApiVersion === false ? "" : ' or legacy "0.1.0"'}. Reload or update the Gerolamino extension.`
                : "A cardano.gerolamino object exists but does not expose enable() and name"
        };
    }

    const reloadHint = needsReload
        ? " This build advertises the legacy 0.1.0 contract: reload the extension to get apiVersion 1 and submit provenance."
        : "";

    return {
        status: "present",
        present: true,
        compatible: true,
        legacyVersion,
        enabled,
        name,
        apiVersion,
        dappApiVersion,
        needsReload,
        build,
        detail: (enabled === null
            ? "Gerolamino is installed; the enabled state could not be read without prompting"
            : enabled
                ? "Gerolamino is installed and enabled for this site"
                : "Gerolamino is installed; Connect to approve this site") + reloadHint
    };
}

async function readEnabled(ext: GerolaminoExtension, timeoutMs: number): Promise<boolean | null> {
    if (typeof ext.isEnabled !== "function") return null;
    try {
        return !!(await withTimeout(ext.isEnabled(), timeoutMs, "isEnabled"));
    } catch {
        return null;
    }
}

/** Synchronous presence plus version check, for callers that cannot await. */
export function isGerolaminoCompatible(win?: GerolaminoWindowLike, allowLegacyApiVersion = true): boolean {
    const ext = extensionFromWindow(currentWindow(win));
    return !!ext && typeof ext.enable === "function" && isCompatibleExtension(ext, allowLegacyApiVersion);
}
