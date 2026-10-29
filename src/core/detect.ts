/**
 * Prompt-free detection. `detect()` never calls `enable()`; it only reads provider fields and calls
 * `isEnabled()`, which is the contract's non-prompting probe. Only `connect()` may open the approval window.
 */
import type { GerolaminoConnectOptions, GerolaminoDetection, GerolaminoExtension, GerolaminoWindowLike } from "./types";
import {
    currentWindow,
    extensionFromWindow,
    GEROLAMINO_API_VERSION,
    GEROLAMINO_DAPP_API_VERSION,
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
    return String(ext.apiVersion ?? "") === GEROLAMINO_DAPP_API_VERSION;
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
            detail: "Gerolamino is not installed (window.cardano.gerolamino is missing)"
        };
    }

    const apiVersion = ext.apiVersion == null ? null : String(ext.apiVersion);
    const dappApiVersion = ext.dappApiVersion == null ? null : String(ext.dappApiVersion);
    const name = ext.name == null ? null : String(ext.name);
    const hasShape = typeof ext.enable === "function" && typeof ext.name === "string";
    const compatible = hasShape && isCompatibleExtension(ext, options.allowLegacyApiVersion ?? true);
    const enabled = compatible && typeof ext.isEnabled === "function"
        ? await readEnabled(ext, options.detectionTimeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS)
        : null;

    if (!compatible) {
        return {
            status: "incompatible",
            present: true,
            compatible: false,
            legacyVersion: isLegacyExtension(ext),
            enabled: null,
            name,
            apiVersion,
            dappApiVersion,
            detail: hasShape
                ? `Gerolamino uses apiVersion ${apiVersion ?? "unknown"}; this connector accepts "1"${options.allowLegacyApiVersion === false ? "" : ' or legacy "0.1.0"'}`
                : "A cardano.gerolamino object exists but does not expose enable() and name"
        };
    }

    return {
        status: "present",
        present: true,
        compatible: true,
        legacyVersion: isLegacyExtension(ext),
        enabled,
        name,
        apiVersion,
        dappApiVersion,
        detail: enabled === null
            ? "Gerolamino is installed; the enabled state could not be read without prompting"
            : enabled
                ? "Gerolamino is installed and enabled for this site"
                : "Gerolamino is installed; Connect to approve this site"
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
