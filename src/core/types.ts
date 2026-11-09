/**
 * Public contract types. The connector does not depend on the Gerolamino extension package;
 * these are the objects a page gets through `window.cardano.gerolamino`.
 */

/** A Blockfrost-shaped answer. `source` says whether the node answered locally or a Gerolamo peer answered. */
export interface GerolaminoAnswer {
    status: number;
    body: unknown;
    source: "local" | "relay";
    peer?: string | null;
    proof?: unknown;
    ledger?: unknown;
    /** Correlation id the connector attached to this call. Quote it in support reports. */
    requestId?: string;
}

/** Which path actually carried a submitted transaction. */
export type GerolaminoSubmitSource = "local" | "relay" | "unknown";

/**
 * Submit provenance. `source` says whether the local node accepted the transaction or a Gerolamo peer
 * carried it. `unknown` means the installed extension returned only a bare txid (legacy shape), so the
 * connector cannot claim a path.
 */
export interface GerolaminoSubmitResult {
    txid: string;
    source: GerolaminoSubmitSource;
    /** ISO 8601 timestamp of when the connector received the answer. */
    acceptedAt: string;
    peer?: string | null;
    requestId: string;
    /** True when the extension answered with a bare string instead of an object. */
    legacyShape: boolean;
}

/** What the connected provider can actually do. Computed from the enabled api plus the extension object. */
export interface GerolaminoCapabilities {
    canQuery: boolean;
    canSubmit: boolean;
    canTip: boolean;
    canTrust: boolean;
    canNetworkId: boolean;
    /** True only when the enabled api exposes `evaluate()`; none does today. */
    canEvaluate: boolean;
    supportsRevoke: boolean;
    /** The extension method `close()` will call, or null when revoke is page-inaccessible. */
    revokeMethod: string | null;
    /** True when `submitTx` answers with `{ txid, source, acceptedAt }` rather than a bare string. */
    submitProvenance: boolean;
    connectorVersion: string;
    apiVersion: string | null;
    dappApiVersion: string | null;
    /** The installed provider advertises an older contract than this connector prefers; reload the extension. */
    needsReload: boolean;
    /** Extension build id when the provider exposes `build` / `buildId` / `version`. */
    build: string | null;
}

/**
 * Result of `assertNetwork()`. It reports, it never throws a mismatch.
 *
 * Two different identifiers, deliberately kept apart: CIP-30 `getNetworkId()` is an ID (0 = testnet,
 * 1 = mainnet), while Cardano network magic is a different domain (preprod 1, preview 2, mainnet
 * 764824073). A CIP-30 id is never compared against a magic, and `magic` is only filled when the node
 * reported a network name we can map.
 */
export interface GerolaminoNetworkAssertion {
    ok: boolean;
    expected: { name: string | null; magic: number | null };
    actual: {
        name: string | null;
        /** Derived from a reported network name only, never from a CIP-30 id. */
        magic: number | null;
        /** CIP-30 network id: 0 testnet, 1 mainnet. Not a network magic. */
        networkId: number | null;
        tipNetwork: string | null;
    };
    detail: string;
}

/** Verified tip of the Gerolamino node. */
export interface GerolaminoTip {
    slot: number;
    height: number;
    hash: string;
    network: string;
    state: string;
    peerTip?: { slot?: number; height?: number; hash?: string } | null;
}

/** One row of the extension's Trust card. Values are display strings by contract. */
export interface GerolaminoTrustRow {
    key?: string;
    label?: string;
    value?: string;
    tone?: string;
}

export interface GerolaminoTrust {
    verdict?: string;
    rows?: GerolaminoTrustRow[];
}

/** The API returned by `window.cardano.gerolamino.enable()`. */
export interface GerolaminoApi {
    query(path: string): Promise<GerolaminoAnswer>;
    submitTx(txCborHex: string): Promise<string>;
    getNetworkId(): Promise<number>;
    getTip(): Promise<GerolaminoTip>;
    getTrust?(): Promise<GerolaminoTrust>;
    getUtxos?(address: string): Promise<GerolaminoAnswer>;
    getProtocolParameters?(): Promise<GerolaminoAnswer>;
    getAccount?(stakeAddress: string): Promise<GerolaminoAnswer>;
    getExtensions?(): Promise<unknown[]>;
    isEnabled?(): Promise<boolean>;
    /** Present only if a build exposes an evaluate passthrough (none does today). */
    evaluate?(txCborHex: string, opts?: { version?: 5 | 6; additionalUtxos?: unknown }): Promise<GerolaminoAnswer>;
}

/** The provider object injected by the extension at `window.cardano.gerolamino`. */
export interface GerolaminoExtension {
    name: string;
    apiVersion: string;
    dappApiVersion?: string;
    icon?: string;
    isWallet?: boolean;
    supportedExtensions?: string[];
    /** Optional build identity some extension builds expose, for support triage. */
    build?: string;
    buildId?: string;
    version?: string;
    isEnabled?(): Promise<boolean>;
    enable(): Promise<GerolaminoApi>;
    /** Optional future extension methods; the connector uses them only when present. */
    revoke?(): Promise<unknown>;
    disable?(): Promise<unknown>;
    disconnect?(): Promise<unknown>;
    disableExtension?(): Promise<unknown>;
}

export interface GerolaminoWindowLike {
    cardano?: {
        gerolamino?: GerolaminoExtension;
        [key: string]: unknown;
    };
}

export type GerolaminoDetectionStatus = "absent" | "incompatible" | "present";

export interface GerolaminoDetection {
    status: GerolaminoDetectionStatus;
    present: boolean;
    compatible: boolean;
    legacyVersion: boolean;
    enabled: boolean | null;
    name: string | null;
    apiVersion: string | null;
    dappApiVersion: string | null;
    /**
     * True when the installed provider advertises a contract older than the connector's preferred one
     * (legacy `0.1.0`, no version, or an unknown version). A reload/update of the extension is the fix;
     * do not treat the version string itself as the health signal.
     */
    needsReload: boolean;
    /** Extension build id when exposed. */
    build: string | null;
    detail: string;
}

export interface GerolaminoNodeStatus {
    network: string | null;
    state: string | null;
    tipSlot: number | null;
    tipHeight: number | null;
    tipHash: string | null;
    peerSlot: number | null;
    peerHeight: number | null;
    /** `tip.slot / peerTip.slot`, as a percentage. Null when the peer tip is unavailable. */
    syncPercent: number | null;
    verdict: string | null;
    trustRows: GerolaminoTrustRow[];
    tip: GerolaminoTip | null;
    /** Support triage from a screenshot: who answered, with which contract, on which network. */
    identity: {
        connectorVersion: string;
        apiVersion: string | null;
        dappApiVersion: string | null;
        build: string | null;
        networkId: number | null;
    };
}

export interface GerolaminoDisconnectResult {
    mode: "extension" | "local";
    /** True only when the approval was revoked through the extension. A local close is NOT a revoke. */
    revoked: boolean;
    /** False when the extension method resolved without saying it revoked (a silent no-op is not proof). */
    verified: boolean;
    /** What the extension answered, when it answered with something meaningful. */
    api?: string;
    method: string | null;
    message: string;
}

/** How to label the disconnect control before it is pressed. Never "Disconnect" when it cannot revoke. */
export interface GerolaminoDisconnectAction {
    mode: "extension" | "local";
    /** `"Revoke approval"` when a page-callable revoke exists, else `"Stop using Gerolamino on this site"`. */
    label: string;
    revokeMethod: string | null;
}

export interface GerolaminoConnectOptions {
    win?: GerolaminoWindowLike;
    /** Timeout for `isEnabled()` while detecting. Default 5 s. */
    detectionTimeoutMs?: number;
    /** Timeout for the approval `enable()` call. Default 15 s. */
    approvalTimeoutMs?: number;
    /** Use the older `apiVersion: "0.1.0"` shape too. Default true. */
    allowLegacyApiVersion?: boolean;
}

export interface GerolaminoSessionOptions {
    requestTimeoutMs?: number;
    submitTimeoutMs?: number;
}

export interface GerolaminoProviderOptions extends GerolaminoSessionOptions {}

export interface GerolaminoPageOptions {
    count?: number;
    page?: number;
    order?: "asc" | "desc";
    /** `"empty"` (default) returns []/null on 404; `"throw"` raises the typed HTTP error. */
    onMissing?: "empty" | "throw";
}

export interface GerolaminoAllPagesOptions {
    count?: number;
    maxPages?: number;
}

/** Typed reads. Identifiers are validated before they become a path segment. */
export interface GerolaminoReadHelpers {
    addressUtxos(address: string, opts?: GerolaminoPageOptions): Promise<unknown[]>;
    addressTransactions(address: string, opts?: GerolaminoPageOptions): Promise<unknown[]>;
    addressTotal(address: string): Promise<unknown | null>;
    asset(unit: string): Promise<unknown | null>;
    assetAddresses(unit: string, opts?: GerolaminoPageOptions): Promise<unknown[]>;
    tx(hash: string): Promise<unknown | null>;
    txUtxos(hash: string): Promise<unknown[]>;
    scriptCbor(scriptHash: string): Promise<unknown | null>;
    blockLatest(): Promise<unknown | null>;
    protocolParameters(): Promise<unknown | null>;
    genesis(): Promise<unknown | null>;
    queryAll<T = unknown>(path: string, opts?: GerolaminoAllPagesOptions): Promise<T[]>;
}

export interface GerolaminoEvaluateOptions {
    version?: 5 | 6;
    additionalUtxos?: unknown;
    timeoutMs?: number;
}

export interface GerolaminoProvider {
    readonly api: GerolaminoApi;
    get(path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): Promise<GerolaminoAnswer>;
    json<T = unknown>(path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): Promise<T>;
    getAllPages<T = unknown>(path: string, opts?: { count?: number; maxPages?: number }): Promise<T[]>;
    /** Forwards a signed transaction and reports which path carried it. */
    submitTx(txCborHex: string): Promise<GerolaminoSubmitResult>;
    /** Convenience: just the txid, for callers that do not need provenance. */
    submitTxId(txCborHex: string): Promise<string>;
}

export interface GerolaminoSession extends GerolaminoReadHelpers {
    readonly api: GerolaminoApi;
    readonly extension: GerolaminoExtension;
    readonly provider: GerolaminoProvider;
    readonly closed: boolean;
    /** What the enabled api can actually do; read once at session creation. */
    readonly capabilities: GerolaminoCapabilities;
    getCapabilities(): GerolaminoCapabilities;
    getNetworkId(opts?: { timeoutMs?: number }): Promise<number>;
    query(path: string, opts?: { timeoutMs?: number }): Promise<GerolaminoAnswer>;
    submitTx(txCborHex: string, opts?: { timeoutMs?: number }): Promise<GerolaminoSubmitResult>;
    submitTxId(txCborHex: string, opts?: { timeoutMs?: number }): Promise<string>;
    getTip(opts?: { timeoutMs?: number }): Promise<GerolaminoTip>;
    getTrust(opts?: { timeoutMs?: number }): Promise<GerolaminoTrust | null>;
    status(opts?: { timeoutMs?: number }): Promise<GerolaminoNodeStatus | null>;
    /** Compare the node's network with what the dApp expects. Reports, never throws. */
    assertNetwork(expected: GerolaminoNetworkExpectation, opts?: { timeoutMs?: number }): Promise<GerolaminoNetworkAssertion>;
    /**
     * Phase-2 evaluation passthrough. Throws `NOT_SUPPORTED` today: the Gerolamino extension exposes no
     * `evaluate` dApp method, so a connector call cannot reach the node's POST /utils/txs/evaluate.
     */
    evaluateTx(txCborHex: string, opts?: GerolaminoEvaluateOptions): Promise<GerolaminoAnswer>;
    close(opts?: { timeoutMs?: number }): Promise<GerolaminoDisconnectResult>;
}

/** `"preview" | "preprod" | "mainnet"` (case-insensitive) or a raw network magic. */
export type GerolaminoNetworkExpectation = string | number;

export interface GerolaminoResponse {
    ok: boolean;
    status: number;
    url: string;
    json(): Promise<unknown>;
    text(): Promise<string>;
}
