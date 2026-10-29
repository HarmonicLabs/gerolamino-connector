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
}

/** The provider object injected by the extension at `window.cardano.gerolamino`. */
export interface GerolaminoExtension {
    name: string;
    apiVersion: string;
    dappApiVersion?: string;
    icon?: string;
    isWallet?: boolean;
    supportedExtensions?: string[];
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
}

export interface GerolaminoDisconnectResult {
    mode: "extension" | "local";
    method: string | null;
    message: string;
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

export interface GerolaminoProvider {
    readonly api: GerolaminoApi;
    get(path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): Promise<GerolaminoAnswer>;
    json<T = unknown>(path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): Promise<T>;
    getAllPages<T = unknown>(path: string, opts?: { count?: number; maxPages?: number }): Promise<T[]>;
    submitTx(txCborHex: string): Promise<string>;
}

export interface GerolaminoSession {
    readonly api: GerolaminoApi;
    readonly extension: GerolaminoExtension;
    readonly provider: GerolaminoProvider;
    readonly closed: boolean;
    getNetworkId(opts?: { timeoutMs?: number }): Promise<number>;
    query(path: string, opts?: { timeoutMs?: number }): Promise<GerolaminoAnswer>;
    submitTx(txCborHex: string, opts?: { timeoutMs?: number }): Promise<string>;
    getTip(opts?: { timeoutMs?: number }): Promise<GerolaminoTip>;
    getTrust(opts?: { timeoutMs?: number }): Promise<GerolaminoTrust | null>;
    status(opts?: { timeoutMs?: number }): Promise<GerolaminoNodeStatus | null>;
    close(opts?: { timeoutMs?: number }): Promise<GerolaminoDisconnectResult>;
}

export interface GerolaminoResponse {
    ok: boolean;
    status: number;
    url: string;
    json(): Promise<unknown>;
    text(): Promise<string>;
}
