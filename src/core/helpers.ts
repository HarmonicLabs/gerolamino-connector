/**
 * Typed read helpers. Path-string typos were the number-one integration bug in the first two consumers,
 * so every helper validates its identifier before it becomes a path segment, and none of them accepts a
 * path at all except `queryAll`.
 *
 * Missing data is not an error by default: a fresh address has no UTxOs and an unseen hash has no
 * transaction, so those two return `[]`/`null`. Pass `onMissing: "throw"` when absence is a real fault.
 */
import { GerolaminoError, GerolaminoHttpError } from "./errors";
import type {
    GerolaminoAllPagesOptions,
    GerolaminoPageOptions,
    GerolaminoProvider,
    GerolaminoReadHelpers
} from "./types";

export interface GerolaminoReads extends GerolaminoReadHelpers {
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

const ADDRESS_UNSAFE = /[/?#\s]/;
const TX_HASH = /^[0-9a-f]{64}$/i;
const SCRIPT_HASH = /^[0-9a-f]{56}$/i;
const ASSET_UNIT = /^[0-9a-f]{56}([0-9a-f]{0,64})$/i;
/** Blockfrost also answers `lovelace` as a unit on some routes. */
const LOVELACE = "lovelace";

/** An address must be a single path segment: no separators, no query, no fragments. */
export function assertAddress(address: unknown): string {
    const value = typeof address === "string" ? address.trim() : "";
    if (!value) throw invalid("an address is required");
    if (value.length > 200) throw invalid("an address may be at most 200 characters");
    if (ADDRESS_UNSAFE.test(value)) throw invalid(`an address must be one path segment, got ${JSON.stringify(value)}`);
    return value;
}

export function assertTxHash(hash: unknown): string {
    const value = typeof hash === "string" ? hash.trim() : "";
    if (!TX_HASH.test(value)) throw invalid("a transaction hash is 64 hex characters");
    return value.toLowerCase();
}

export function assertScriptHash(hash: unknown): string {
    const value = typeof hash === "string" ? hash.trim() : "";
    if (!SCRIPT_HASH.test(value)) throw invalid("a script hash is 56 hex characters");
    return value.toLowerCase();
}

/** `policyId` (56 hex) with an optional hex asset name, or `lovelace`. */
export function assertAssetUnit(unit: unknown): string {
    const value = typeof unit === "string" ? unit.trim() : "";
    if (value === LOVELACE) return value;
    if (!ASSET_UNIT.test(value)) throw invalid("an asset unit is a 56-hex policy id plus an optional hex asset name");
    return value.toLowerCase();
}

function invalid(message: string): GerolaminoError {
    return new GerolaminoError(message, { kind: "INVALID_REQUEST" });
}

function pageQuery(opts?: GerolaminoPageOptions): { count?: number; page?: number; order?: "asc" | "desc" } | undefined {
    if (!opts) return undefined;
    const init: { count?: number; page?: number; order?: "asc" | "desc" } = {};
    if (opts.count != null) init.count = opts.count;
    if (opts.page != null) init.page = opts.page;
    if (opts.order != null) init.order = opts.order;
    return Object.keys(init).length ? init : undefined;
}

export function createGerolaminoReads(provider: GerolaminoProvider): GerolaminoReads {
    const expectArray = async (path: string, opts?: GerolaminoPageOptions): Promise<unknown[]> => {
        const answer = await provider.get(path, pageQuery(opts));
        if (answer.status === 404) {
            if (opts?.onMissing === "throw") throw new GerolaminoHttpError(path, answer.status, answer.body, { requestId: answer.requestId ?? null });
            return [];
        }
        if (answer.status !== 200) throw new GerolaminoHttpError(path, answer.status, answer.body, { requestId: answer.requestId ?? null });
        if (!Array.isArray(answer.body)) return [];
        return answer.body;
    };

    const expectValue = async (path: string, onMissing?: "empty" | "throw"): Promise<unknown | null> => {
        const answer = await provider.get(path);
        if (answer.status === 404) {
            if (onMissing === "throw") throw new GerolaminoHttpError(path, answer.status, answer.body, { requestId: answer.requestId ?? null });
            return null;
        }
        if (answer.status !== 200) throw new GerolaminoHttpError(path, answer.status, answer.body, { requestId: answer.requestId ?? null });
        return answer.body ?? null;
    };

    return {
        addressUtxos: async (address, opts) => await expectArray(`/addresses/${assertAddress(address)}/utxos`, opts),
        addressTransactions: async (address, opts) => await expectArray(`/addresses/${assertAddress(address)}/transactions`, opts),
        addressTotal: async (address) => await expectValue(`/addresses/${assertAddress(address)}/total`),
        asset: async (unit) => await expectValue(`/assets/${assertAssetUnit(unit)}`),
        assetAddresses: async (unit, opts) => await expectArray(`/assets/${assertAssetUnit(unit)}/addresses`, opts),
        tx: async (hash) => await expectValue(`/txs/${assertTxHash(hash)}`),
        txUtxos: async (hash) => await expectArray(`/txs/${assertTxHash(hash)}/utxos`),
        scriptCbor: async (scriptHash) => await expectValue(`/scripts/${assertScriptHash(scriptHash)}/cbor`),
        blockLatest: async () => await expectValue("/blocks/latest"),
        protocolParameters: async () => await expectValue("/epochs/latest/parameters"),
        genesis: async () => await expectValue("/genesis"),
        queryAll: async <T = unknown>(path: string, opts?: GerolaminoAllPagesOptions) =>
            await provider.getAllPages<T>(path, opts)
    };
}
