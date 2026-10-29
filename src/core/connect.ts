/**
 * Explicit connect. Only this function calls the extension's `enable()` (the one approval window
 * per site). Detection stays prompt-free.
 */
import { GerolaminoError, GerolaminoIncompatibleError, GerolaminoNotInstalledError, errorFromUnknown } from "./errors";
import type {
    GerolaminoApi,
    GerolaminoConnectOptions,
    GerolaminoSession,
    GerolaminoSessionOptions
} from "./types";
import { detectGerolamino } from "./detect";
import { extensionFromWindow, isGerolaminoApi, DEFAULT_APPROVAL_TIMEOUT_MS, withTimeout } from "./util";
import { createGerolaminoSession } from "./session";

export async function connectGerolamino(options: GerolaminoConnectOptions & GerolaminoSessionOptions = {}): Promise<GerolaminoSession> {
    const detection = await detectGerolamino(options);
    if (detection.status === "absent") throw new GerolaminoNotInstalledError(detection.detail);
    if (detection.status === "incompatible") throw new GerolaminoIncompatibleError(detection.detail);

    const extension = extensionFromWindow(options.win);
    if (!extension || typeof extension.enable !== "function") throw new GerolaminoNotInstalledError();

    let api: GerolaminoApi;
    try {
        api = await withTimeout(extension.enable(), options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS, "enable") as GerolaminoApi;
    } catch (e) {
        throw errorFromUnknown(e, "Gerolamino enable() failed");
    }
    if (!isGerolaminoApi(api)) throw new GerolaminoIncompatibleError("Gerolamino enable() did not return an api with query() and submitTx()");
    return createGerolaminoSession(api, extension, options);
}

/** Low-level compatibility helper for callers that already checked presence. */
export async function enableGerolamino(
    options: GerolaminoConnectOptions & GerolaminoSessionOptions = {}
): Promise<GerolaminoApi> {
    return (await connectGerolamino(options)).api;
}
