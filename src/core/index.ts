/**
 * Headless Gerolamino connector: prompt-free detection, explicit connect (one approval window),
 * node status, and a Blockfrost-shaped transport. It is not a wallet and holds no keys.
 */
export type {
    GerolaminoAnswer,
    GerolaminoApi,
    GerolaminoConnectOptions,
    GerolaminoDetection,
    GerolaminoDetectionStatus,
    GerolaminoDisconnectResult,
    GerolaminoExtension,
    GerolaminoNodeStatus,
    GerolaminoProvider,
    GerolaminoProviderOptions,
    GerolaminoResponse,
    GerolaminoSession,
    GerolaminoSessionOptions,
    GerolaminoTip,
    GerolaminoTrust,
    GerolaminoTrustRow,
    GerolaminoWindowLike
} from "./types";

export {
    CONNECTOR_VERSION,
    GEROLAMINO_API_VERSION,
    GEROLAMINO_DAPP_API_VERSION,
    DEFAULT_DETECTION_TIMEOUT_MS,
    DEFAULT_APPROVAL_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_SUBMIT_TIMEOUT_MS,
    currentWindow,
    extensionFromWindow,
    hasGerolamino,
    isGerolaminoApi,
    checkPath,
    withQuery
} from "./util";

export {
    detectGerolamino,
    isCompatibleExtension,
    isLegacyExtension,
    isGerolaminoCompatible
} from "./detect";

export { connectGerolamino, enableGerolamino } from "./connect";
export { createGerolaminoSession } from "./session";
export { createGerolaminoProvider, gerolaminoProvider, createGerolaminoFetch } from "./provider";

export { GerolaminoError, GerolaminoNotInstalledError, GerolaminoIncompatibleError, GerolaminoTimeoutError, GerolaminoHttpError } from "./errors";

import type { GerolaminoSession } from "./types";
import type { GerolaminoNodeStatus } from "./types";

/** Convenience wrapper around `session.status()`; returns null while the node has no verified tip. */
export async function getGerolaminoNodeStatus(session: GerolaminoSession): Promise<GerolaminoNodeStatus | null> {
    return session.status();
}

/** Convenience wrapper around `session.close()`. */
export async function closeGerolamino(session: GerolaminoSession) {
    return session.close();
}
