/**
 * Errors raised by the connector.
 *
 * Two identifiers, on purpose:
 * - `kind`: the connector's stable string taxonomy (see docs/ERRORS.md). Switch on this.
 * - `code`: the CIP-30 numeric code, kept when the extension or a wallet refusal supplies one.
 *
 * Every failure can also carry `status`, `path`, `blockfrostBody` and `requestId`, so a dApp can log a
 * single object and a screenshot of it is enough for support triage.
 */

export type GerolaminoErrorKind =
    | "NOT_INSTALLED"
    | "INCOMPATIBLE"
    | "REFUSED"
    | "TIMEOUT"
    | "GATEWAY_SILENT"
    | "HTTP_ERROR"
    | "INVALID_REQUEST"
    | "NETWORK_MISMATCH"
    | "REVOKE_FAILED"
    | "UNKNOWN";

export interface GerolaminoErrorInit {
    /** CIP-30 numeric code, when the extension supplied one. */
    code?: number | null;
    info?: string;
    kind?: GerolaminoErrorKind;
    status?: number | null;
    path?: string | null;
    blockfrostBody?: unknown;
    requestId?: string | null;
    cause?: unknown;
}

/** The stable JSON shape returned by `Error.prototype.toJSON` on connector errors. */
export interface GerolaminoErrorShape {
    name: string;
    kind: GerolaminoErrorKind;
    message: string;
    info: string;
    code: number | null;
    status: number | null;
    path: string | null;
    blockfrostBody: unknown;
    requestId: string | null;
    cause?: string;
}

export class GerolaminoError extends Error {
    kind: GerolaminoErrorKind = "UNKNOWN";
    code: number | null = null;
    info = "";
    status: number | null = null;
    path: string | null = null;
    blockfrostBody: unknown = null;
    requestId: string | null = null;
    declare cause?: unknown;

    constructor(message: string, infoOrInit: string | GerolaminoErrorInit = "", code: number | null = null) {
        super(message);
        this.name = "GerolaminoError";
        if (typeof infoOrInit === "string") {
            // Legacy positional shape: (message, info, code).
            this.info = infoOrInit;
            this.code = code;
            return;
        }
        if (infoOrInit && typeof infoOrInit === "object") {
            if (infoOrInit.info != null) this.info = infoOrInit.info;
            if (infoOrInit.code !== undefined) this.code = infoOrInit.code ?? null;
            if (infoOrInit.kind) this.kind = infoOrInit.kind;
            if (infoOrInit.status !== undefined) this.status = infoOrInit.status ?? null;
            if (infoOrInit.path !== undefined) this.path = infoOrInit.path ?? null;
            if (infoOrInit.blockfrostBody !== undefined) this.blockfrostBody = infoOrInit.blockfrostBody;
            if (infoOrInit.requestId !== undefined) this.requestId = infoOrInit.requestId ?? null;
            if (infoOrInit.cause !== undefined) this.cause = infoOrInit.cause;
        }
    }

    /** Log `JSON.stringify(error)`, not `error.message`: the shape carries the triage fields. */
    toJSON(): GerolaminoErrorShape {
        const shape: GerolaminoErrorShape = {
            name: this.name,
            kind: this.kind,
            message: this.message,
            info: this.info,
            code: this.code,
            status: this.status,
            path: this.path,
            blockfrostBody: this.blockfrostBody,
            requestId: this.requestId
        };
        const cause = causeMessage(this.cause);
        if (cause) shape.cause = cause;
        return shape;
    }
}

export class GerolaminoNotInstalledError extends GerolaminoError {
    constructor(message = "Gerolamino is not installed (window.cardano.gerolamino is missing)") {
        super(message, { kind: "NOT_INSTALLED" });
        this.name = "GerolaminoNotInstalledError";
    }
}

export class GerolaminoIncompatibleError extends GerolaminoError {
    constructor(message: string, init: GerolaminoErrorInit = {}) {
        super(message, { ...init, kind: "INCOMPATIBLE" });
        this.name = "GerolaminoIncompatibleError";
    }
}

export class GerolaminoTimeoutError extends GerolaminoError {
    readonly label: string;
    readonly timeoutMs: number;

    constructor(label: string, timeoutMs: number, init: GerolaminoErrorInit = {}) {
        super(`Gerolamino ${label} timed out after ${timeoutMs} ms`, { ...init, kind: "TIMEOUT" });
        this.name = "GerolaminoTimeoutError";
        this.label = label;
        this.timeoutMs = timeoutMs;
    }
}

/**
 * The connected extension answered for nothing: no body, a thrown transport failure, or a literal 503.
 * This is the official code for "Gerolamino is approved but its node is not answering", so dApps stop
 * inventing their own 503 semantic.
 */
export class GerolaminoGatewaySilentError extends GerolaminoError {
    constructor(message = "Gerolamino is connected but its node did not answer", init: GerolaminoErrorInit = {}) {
        super(message, { status: 503, ...init, kind: "GATEWAY_SILENT" });
        this.name = "GerolaminoGatewaySilentError";
    }
}

export class GerolaminoHttpError extends GerolaminoError {
    status: number;
    body: unknown;

    constructor(path: string, status: number, body: unknown, init: GerolaminoErrorInit = {}) {
        super(
            `Gerolamino Blockfrost ${path}: ${status} ${JSON.stringify(body)}`,
            {
                ...init,
                kind: init.kind ?? (status === 503 ? "GATEWAY_SILENT" : "HTTP_ERROR"),
                status,
                path,
                blockfrostBody: body
            }
        );
        this.name = "GerolaminoHttpError";
        this.status = status;
        this.body = body;
    }
}

export class GerolaminoNetworkMismatchError extends GerolaminoError {
    constructor(message: string, init: GerolaminoErrorInit = {}) {
        super(message, { ...init, kind: "NETWORK_MISMATCH" });
        this.name = "GerolaminoNetworkMismatchError";
    }
}

/** Convert a CIP-30-style refusal object or a plain error into the connector's error shape. */
export function errorFromUnknown(error: unknown, fallback: string, init: GerolaminoErrorInit = {}): GerolaminoError {
    if (error instanceof GerolaminoError) {
        if (init.requestId != null && error.requestId == null) error.requestId = init.requestId;
        if (init.path != null && error.path == null) error.path = init.path;
        return error;
    }
    if (error && typeof error === "object") {
        const code = typeof (error as any).code === "number" ? (error as any).code : null;
        const info = typeof (error as any).info === "string" ? (error as any).info : "";
        const message = typeof (error as any).message === "string" ? (error as any).message : info || fallback;
        return new GerolaminoError(message || fallback, {
            ...init,
            info: info || init.info,
            code: code ?? init.code ?? null,
            kind: init.kind ?? (code != null ? "REFUSED" : "UNKNOWN"),
            cause: error
        });
    }
    if (typeof error === "string" && error.length > 0) return new GerolaminoError(error, { ...init, cause: error });
    return new GerolaminoError(fallback, { ...init, cause: error });
}

function causeMessage(cause: unknown): string | null {
    if (cause == null) return null;
    if (cause instanceof Error) return cause.message;
    if (typeof cause === "string") return cause;
    if (typeof cause === "object") {
        const message = (cause as any).message ?? (cause as any).info;
        if (typeof message === "string") return message;
        try {
            return JSON.stringify(cause);
        } catch {
            return String(cause);
        }
    }
    return String(cause);
}
