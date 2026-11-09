/**
 * Cross-tab coordination. Every tab used to poll `isEnabled()` on its own schedule and could open its own
 * approval window for the same origin. This module broadcasts detection results, approval locks, and
 * connect/disconnect transitions over a BroadcastChannel, so one approval covers the origin and the other
 * tabs stop guessing.
 *
 * It is optional and defensive: without `BroadcastChannel` (or with a hostile/echoing same-origin page) the
 * helper degrades to a no-op and the caller keeps its own detection path.
 */

export interface GerolaminoTabChannel {
    postMessage(message: unknown): void;
    close(): void;
    onmessage: ((event: { data: unknown }) => void) | null;
}

export interface GerolaminoTabSyncOptions {
    /** Channel name. Defaults to `gerolamino-connector`; the platform scopes it per origin. */
    name?: string;
    /** Inject a channel (tests, workers). `null` forces the unsupported path. */
    channel?: GerolaminoTabChannel | null;
    /** An approval started in another tab blocks ours for this long. Default 60 s. */
    approvalTtlMs?: number;
    /** How long a broadcast detection stays authoritative. Default 120 s. */
    detectionTtlMs?: number;
}

/** A detection snapshot, reduced to the fields that are worth sharing (all JSON-safe). */
export interface GerolaminoTabDetection {
    status: "absent" | "incompatible" | "present";
    present: boolean;
    compatible: boolean;
    legacyVersion: boolean;
    enabled: boolean | null;
    name: string | null;
    apiVersion: string | null;
    dappApiVersion: string | null;
    needsReload: boolean;
    build: string | null;
    detail: string;
}

export type GerolaminoTabEvent =
    | { type: "detection"; at: number; tabId: string; detection: GerolaminoTabDetection }
    | { type: "approval-start"; at: number; tabId: string }
    | { type: "approval-end"; at: number; tabId: string; ok: boolean }
    | { type: "connected"; at: number; tabId: string; apiVersion: string | null }
    | { type: "disconnected"; at: number; tabId: string; revoked: boolean };

export interface GerolaminoTabState {
    detection: { at: number; tabId: string; detection: GerolaminoTabDetection } | null;
    approval: { tabId: string; since: number } | null;
    connected: { at: number; apiVersion: string | null } | null;
    disconnected: { at: number; revoked: boolean } | null;
}

export interface GerolaminoTabSync {
    readonly supported: boolean;
    readonly tabId: string;
    readonly name: string;
    state(): GerolaminoTabState;
    publishDetection(detection: GerolaminoTabDetection): void;
    beginApproval(): void;
    endApproval(ok: boolean): void;
    publishConnected(apiVersion: string | null): void;
    publishDisconnected(revoked: boolean): void;
    onUpdate(listener: (event: GerolaminoTabEvent) => void): () => void;
    close(): void;
}

export const DEFAULT_TAB_CHANNEL = "gerolamino-connector";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type TabEventInput = DistributiveOmit<GerolaminoTabEvent, "at" | "tabId"> & { at?: number };

let tabCounter = 0;

export function createGerolaminoTabSync(options: GerolaminoTabSyncOptions = {}): GerolaminoTabSync {
    const name = options.name ?? DEFAULT_TAB_CHANNEL;
    const approvalTtlMs = options.approvalTtlMs ?? 60_000;
    const detectionTtlMs = options.detectionTtlMs ?? 120_000;
    const tabId = `tab-${Date.now().toString(36)}-${(tabCounter++).toString(36)}`;
    const listeners = new Set<(event: GerolaminoTabEvent) => void>();

    let channel: GerolaminoTabChannel | null = null;
    let supported = false;
    if (options.channel !== undefined) {
        channel = options.channel;
        supported = channel != null;
    } else {
        try {
            const Ctor = (globalThis as any).BroadcastChannel;
            if (typeof Ctor === "function") {
                channel = new Ctor(name) as GerolaminoTabChannel;
                supported = true;
            }
        } catch {
            channel = null;
            supported = false;
        }
    }

    const state: GerolaminoTabState = { detection: null, approval: null, connected: null, disconnected: null };

    const prune = () => {
        const now = Date.now();
        if (state.approval && now - state.approval.since > approvalTtlMs) state.approval = null;
        if (state.detection && now - state.detection.at > detectionTtlMs) state.detection = null;
    };

    const receive = (event: GerolaminoTabEvent) => {
        if (event.tabId === tabId) return;
        prune();
        switch (event.type) {
            case "detection":
                state.detection = { at: event.at, tabId: event.tabId, detection: event.detection };
                break;
            case "approval-start":
                state.approval = { tabId: event.tabId, since: event.at };
                break;
            case "approval-end":
                if (state.approval?.tabId === event.tabId) state.approval = null;
                break;
            case "connected":
                state.approval = null;
                state.disconnected = null;
                state.connected = { at: event.at, apiVersion: event.apiVersion };
                break;
            case "disconnected":
                state.connected = null;
                state.disconnected = { at: event.at, revoked: event.revoked };
                break;
        }
        for (const listener of listeners) {
            try {
                listener(event);
            } catch {
                /* a listener must not break the channel */
            }
        }
    };

    if (channel) {
        channel.onmessage = (message) => {
            const parsed = parseTabEvent(message?.data);
            if (parsed) receive(parsed);
        };
    }

    const post = (event: TabEventInput) => {
        if (!channel) return;
        const payload = { ...event, at: event.at ?? Date.now(), tabId } as GerolaminoTabEvent;
        try {
            channel.postMessage(payload);
        } catch {
            /* a closed or blocked channel is not an error for the caller */
        }
    };

    return {
        supported,
        tabId,
        name,
        state: () => {
            prune();
            return { ...state };
        },
        publishDetection: (detection) => post({ type: "detection", detection: toTabDetection(detection) }),
        beginApproval: () => post({ type: "approval-start" }),
        endApproval: (ok) => post({ type: "approval-end", ok }),
        publishConnected: (apiVersion) => post({ type: "connected", apiVersion }),
        publishDisconnected: (revoked) => post({ type: "disconnected", revoked }),
        onUpdate: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        close: () => {
            listeners.clear();
            if (channel) {
                try {
                    channel.close();
                } catch {
                    /* ignore */
                }
            }
            channel = null;
            supported = false;
        }
    };
}

export function toTabDetection(detection: GerolaminoTabDetection): GerolaminoTabDetection {
    return {
        status: detection.status,
        present: detection.present,
        compatible: detection.compatible,
        legacyVersion: detection.legacyVersion,
        enabled: detection.enabled,
        name: detection.name,
        apiVersion: detection.apiVersion,
        dappApiVersion: detection.dappApiVersion,
        needsReload: detection.needsReload,
        build: detection.build,
        detail: detection.detail
    };
}

/** Same-origin pages can post anything to a BroadcastChannel; never trust the payload shape. */
export function parseTabEvent(data: unknown): GerolaminoTabEvent | null {
    if (!data || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    const type = value.type;
    const at = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : Date.now();
    const tabId = typeof value.tabId === "string" ? value.tabId : "";
    if (typeof type !== "string" || !tabId) return null;
    switch (type) {
        case "detection": {
            const detection = value.detection as Record<string, unknown> | null;
            if (!detection || typeof detection !== "object") return null;
            if (detection.status !== "absent" && detection.status !== "incompatible" && detection.status !== "present") return null;
            return { type: "detection", at, tabId, detection: {
                status: detection.status,
                present: !!detection.present,
                compatible: !!detection.compatible,
                legacyVersion: !!detection.legacyVersion,
                enabled: typeof detection.enabled === "boolean" ? detection.enabled : null,
                name: typeof detection.name === "string" ? detection.name : null,
                apiVersion: typeof detection.apiVersion === "string" ? detection.apiVersion : null,
                dappApiVersion: typeof detection.dappApiVersion === "string" ? detection.dappApiVersion : null,
                needsReload: !!detection.needsReload,
                build: typeof detection.build === "string" ? detection.build : null,
                detail: typeof detection.detail === "string" ? detection.detail : ""
            } };
        }
        case "approval-start":
            return { type, at, tabId };
        case "approval-end":
            return { type, at, tabId, ok: !!value.ok };
        case "connected":
            return { type, at, tabId, apiVersion: typeof value.apiVersion === "string" ? value.apiVersion : null };
        case "disconnected":
            return { type, at, tabId, revoked: !!value.revoked };
        default:
            return null;
    }
}
