import { GerolaminoError, GerolaminoTimeoutError } from "./errors";
import type { GerolaminoApi, GerolaminoExtension, GerolaminoProviderOptions, GerolaminoWindowLike } from "./types";

export const CONNECTOR_VERSION = "0.4.2";
export const GEROLAMINO_API_VERSION = "1";
export const GEROLAMINO_DAPP_API_VERSION = "0.1.0";
export const DEFAULT_DETECTION_TIMEOUT_MS = 5_000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 15_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_SUBMIT_TIMEOUT_MS = 90_000;

/** Cardano network magic values. Compare these, never the display string alone. */
export const CARDANO_NETWORK_MAGIC = {
    mainnet: 764824073,
    preprod: 1,
    preview: 2
} as const;

export type GerolaminoNetworkName = keyof typeof CARDANO_NETWORK_MAGIC;

const NETWORK_ALIASES: Record<string, GerolaminoNetworkName> = {
    main: "mainnet",
    mainnet: "mainnet",
    preprod: "preprod",
    preproduction: "preprod",
    testnet: "preprod",
    preview: "preview"
};

/** Map a network name, alias or raw magic to `{ name, magic }`. Unknown input yields nulls, never a guess. */
export function normalizeNetwork(expected: string | number | null | undefined): { name: string | null; magic: number | null } {
    if (expected == null) return { name: null, magic: null };
    if (typeof expected === "number") {
        for (const [name, magic] of Object.entries(CARDANO_NETWORK_MAGIC)) {
            if (magic === expected) return { name, magic };
        }
        return { name: null, magic: Number.isFinite(expected) ? expected : null };
    }
    const key = String(expected).trim().toLowerCase().replace(/[\s_-]+/g, "");
    const named = NETWORK_ALIASES[key] ?? NETWORK_ALIASES[String(expected).trim().toLowerCase()];
    if (named) return { name: named, magic: CARDANO_NETWORK_MAGIC[named] };
    const asNumber = Number(key);
    if (Number.isFinite(asNumber) && key !== "") return normalizeNetwork(asNumber);
    return { name: null, magic: null };
}

let requestCounter = 0;

/** Short correlation id attached to every transport call and error. Not a server-side trace id. */
export function nextRequestId(prefix = "grl"): string {
    requestCounter = (requestCounter + 1) % 0x100000;
    return `${prefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

export function nowIso(): string {
    return new Date().toISOString();
}

/** An `apiVersion` equal to the pre-1.0 dapp API version. Accepted, but the extension should be reloaded. */
export function isLegacyVersion(apiVersion: string): boolean {
    return apiVersion === GEROLAMINO_DAPP_API_VERSION;
}

/** Reload/update is the fix when the provider is unusable, or usable but on the legacy contract. */
export function needsReloadFor(state: { compatible: boolean; legacyVersion: boolean }): boolean {
    return !state.compatible || state.legacyVersion;
}

/** First build identity an extension build chose to expose. */
export function extensionBuild(ext: GerolaminoExtension | null | undefined): string | null {
    if (!ext) return null;
    for (const key of ["build", "buildId", "version"] as const) {
        const value = (ext as any)[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
    !!value && typeof (value as any).then === "function";

/** Race a promise or a sync value against a timeout. */
export function withTimeout<T>(value: PromiseLike<T> | T, timeoutMs: number, label: string): Promise<T> {
    if (timeoutMs <= 0 || timeoutMs === Infinity) return Promise.resolve(value);
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new GerolaminoTimeoutError(label, timeoutMs));
        }, timeoutMs);
        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn();
        };
        if (isPromiseLike(value)) {
            Promise.resolve(value).then(
                (v) => settle(() => resolve(v)),
                (e) => settle(() => reject(e))
            );
        } else {
            settle(() => resolve(value as T));
        }
    });
}

/** Pick the page window unless an explicit test window is supplied. */
export function currentWindow(win?: GerolaminoWindowLike): GerolaminoWindowLike | undefined {
    if (win) return win;
    const maybeWindow = (globalThis as any).window;
    return maybeWindow && typeof maybeWindow === "object" ? (maybeWindow as GerolaminoWindowLike) : undefined;
}

export function extensionFromWindow(win?: GerolaminoWindowLike): GerolaminoExtension | null {
    const root = currentWindow(win);
    try {
        const ext = root?.cardano?.gerolamino;
        return ext && typeof ext === "object" ? ext : null;
    } catch {
        return null;
    }
}

/** True when a Gerolamino-shaped provider is present. This is presence only, not version compatibility. */
export function hasGerolamino(win?: GerolaminoWindowLike): boolean {
    const ext = extensionFromWindow(win);
    return !!ext && typeof ext.enable === "function" && typeof ext.name === "string";
}

export function isGerolaminoApi(value: unknown): value is GerolaminoApi {
    if (!value || typeof value !== "object") return false;
    const api = value as any;
    return typeof api.query === "function" && typeof api.submitTx === "function" && typeof api.getTip === "function";
}

/** Strip an origin and `/api/v0` from a Blockfrost path and ensure one leading slash. */
export function normalizePath(path: string): string {
    let out = String(path ?? "").trim();
    if (!out) return "";
    if (/^https?:\/\//i.test(out)) {
        const url = new URL(out);
        out = url.pathname + url.search;
    }
    out = out.replace(/^\/api\/v0(?=\/|$)/, "");
    if (!out.startsWith("/")) out = "/" + out;
    return out;
}

export function withQuery(path: string, init?: { count?: number; page?: number; order?: "asc" | "desc" }): string {
    if (!init) return path;
    const q = new URLSearchParams();
    if (init.count != null) q.set("count", String(init.count));
    if (init.page != null) q.set("page", String(init.page));
    if (init.order != null) q.set("order", init.order);
    const query = q.toString();
    if (!query) return path;
    return path + (path.includes("?") ? "&" : "?") + query;
}

export function checkPath(path: string): string {
    const out = normalizePath(path);
    if (!out.startsWith("/")) throw new GerolaminoError(`a Blockfrost path must start with "/": ${path}`);
    if (out.length > 1024) throw new GerolaminoError("a Blockfrost path may be at most 1024 characters");
    if (out.includes("..")) throw new GerolaminoError("a Blockfrost path may not contain ..");
    return out;
}

export function providerOptions(options?: GerolaminoProviderOptions) {
    return {
        requestTimeoutMs: options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        submitTimeoutMs: options?.submitTimeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS
    };
}

export function isHex(value: string): boolean {
    return /^(?:[0-9a-fA-F]{2})+$/.test(value);
}
