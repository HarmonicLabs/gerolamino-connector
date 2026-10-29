/**
 * Errors raised by the connector. Refusals keep CIP-30 `code`/`info` when the extension supplies them.
 */

export class GerolaminoError extends Error {
    code: number | null = null;
    info: string;

    constructor(message: string, info = "", code: number | null = null) {
        super(message);
        this.name = "GerolaminoError";
        this.info = info;
        this.code = code;
    }
}

export class GerolaminoNotInstalledError extends GerolaminoError {
    constructor(message = "Gerolamino is not installed (window.cardano.gerolamino is missing)") {
        super(message);
        this.name = "GerolaminoNotInstalledError";
    }
}

export class GerolaminoIncompatibleError extends GerolaminoError {
    constructor(message: string) {
        super(message);
        this.name = "GerolaminoIncompatibleError";
    }
}

export class GerolaminoTimeoutError extends GerolaminoError {
    constructor(label: string, timeoutMs: number) {
        super(`Gerolamino ${label} timed out after ${timeoutMs} ms`);
        this.name = "GerolaminoTimeoutError";
    }
}

export class GerolaminoHttpError extends GerolaminoError {
    status: number;
    body: unknown;

    constructor(path: string, status: number, body: unknown) {
        super(`Gerolamino Blockfrost ${path}: ${status} ${JSON.stringify(body)}`);
        this.name = "GerolaminoHttpError";
        this.status = status;
        this.body = body;
    }
}

/** Convert a CIP-30-style refusal object or a plain error into the connector's error shape. */
export function errorFromUnknown(error: unknown, fallback: string): GerolaminoError {
    if (error instanceof GerolaminoError) return error;
    if (error && typeof error === "object") {
        const code = typeof (error as any).code === "number" ? (error as any).code : null;
        const info = typeof (error as any).info === "string" ? (error as any).info : "";
        const message = typeof (error as any).message === "string" ? (error as any).message : info || fallback;
        return new GerolaminoError(message || fallback, info, code);
    }
    if (typeof error === "string" && error.length > 0) return new GerolaminoError(error);
    return new GerolaminoError(fallback);
}
