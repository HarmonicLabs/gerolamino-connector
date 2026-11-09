/**
 * Headless Gerolamino connector: prompt-free detection, explicit connect (one approval window),
 * node status, and a Blockfrost-shaped transport. It is not a wallet and holds no keys.
 */
export type {
    GerolaminoAnswer,
    GerolaminoApi,
    GerolaminoCapabilities,
    GerolaminoConnectOptions,
    GerolaminoDetection,
    GerolaminoDetectionStatus,
    GerolaminoDisconnectResult,
    GerolaminoExtension,
    GerolaminoNetworkAssertion,
    GerolaminoNetworkExpectation,
    GerolaminoNodeStatus,
    GerolaminoProvider,
    GerolaminoProviderOptions,
    GerolaminoResponse,
    GerolaminoSession,
    GerolaminoSessionOptions,
    GerolaminoSubmitResult,
    GerolaminoSubmitSource,
    GerolaminoTip,
    GerolaminoTrust,
    GerolaminoTrustRow,
    GerolaminoWindowLike
} from "./types";

export type { GerolaminoErrorKind, GerolaminoErrorShape, GerolaminoErrorInit } from "./errors";

export {
    CONNECTOR_VERSION,
    CARDANO_NETWORK_MAGIC,
    GEROLAMINO_API_VERSION,
    GEROLAMINO_DAPP_API_VERSION,
    DEFAULT_DETECTION_TIMEOUT_MS,
    DEFAULT_APPROVAL_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_SUBMIT_TIMEOUT_MS,
    currentWindow,
    extensionFromWindow,
    extensionBuild,
    hasGerolamino,
    isGerolaminoApi,
    checkPath,
    withQuery,
    normalizeNetwork,
    nextRequestId
} from "./util";

export {
    detectGerolamino,
    isCompatibleExtension,
    isLegacyExtension,
    isGerolaminoCompatible
} from "./detect";

export { connectGerolamino, enableGerolamino } from "./connect";
export { createGerolaminoSession } from "./session";
export { createGerolaminoProvider, gerolaminoProvider, createGerolaminoFetch, answerError, normalizeSubmitResult } from "./provider";
export { readCapabilities, needsReloadOf, revokeMethodOf, markSubmitProvenance, REVOKE_METHODS } from "./capabilities";

export {
    GerolaminoError,
    GerolaminoNotInstalledError,
    GerolaminoIncompatibleError,
    GerolaminoTimeoutError,
    GerolaminoHttpError,
    GerolaminoGatewaySilentError,
    GerolaminoNetworkMismatchError,
    errorFromUnknown
} from "./errors";

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
