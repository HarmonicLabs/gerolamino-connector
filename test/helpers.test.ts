import { describe, expect, test } from "bun:test";
import {
    assertAddress,
    assertAssetUnit,
    assertScriptHash,
    assertTxHash,
    createGerolaminoProvider,
    createGerolaminoSession,
    GerolaminoError,
    GerolaminoHttpError,
    GerolaminoNotSupportedError,
    type GerolaminoApi,
    type GerolaminoAnswer,
    type GerolaminoExtension
} from "../src/core/index";

const ADDR = "addr_test1qqhj9z7yq70nvk3qywzt6h7l4pgz8nycz08jz5v390a9v2t98c5wl3t7x4cas52rcutz8k7zmzezaw694uggt8nlshyqgmm04m";
const HASH = "ab".repeat(32);
const POLICY = "9e6b36fe0ef21a6d533903ee994b572f224c20e5b62658a978d54308";
const SCRIPT = "cd".repeat(28);

function apiWith(answers: Record<string, GerolaminoAnswer>): { api: GerolaminoApi; calls: string[] } {
    const calls: string[] = [];
    const api: GerolaminoApi = {
        query: async (path: string) => {
            calls.push(path);
            const key = path.split("?")[0];
            return answers[key] ?? { status: 404, body: { error: "Not Found" }, source: "local" };
        },
        submitTx: async () => "aa",
        getNetworkId: async () => 2,
        getTip: async () => ({ slot: 1, height: 1, hash: "h", network: "preview", state: "at-tip" })
    };
    return { api, calls };
}

function extension(): GerolaminoExtension {
    return { name: "Gerolamino", apiVersion: "1", dappApiVersion: "0.1.0", isEnabled: async () => true, enable: async () => undefined as any };
}

describe("read helpers", () => {
    test("validators reject path injection and malformed identifiers", () => {
        expect(assertAddress(ADDR)).toBe(ADDR);
        expect(() => assertAddress("addr_test1/../etc")).toThrow(GerolaminoError);
        expect(() => assertAddress("addr_test1?count=1")).toThrow(GerolaminoError);
        expect(() => assertAddress("")).toThrow(GerolaminoError);

        expect(assertTxHash(HASH.toUpperCase())).toBe(HASH);
        expect(() => assertTxHash("zz")).toThrow(/64 hex/);

        expect(assertAssetUnit("lovelace")).toBe("lovelace");
        expect(assertAssetUnit(POLICY)).toBe(POLICY);
        expect(assertAssetUnit(POLICY + "6e6674")).toBe(POLICY + "6e6674");
        expect(() => assertAssetUnit("policy-not-hex")).toThrow(/56-hex/);

        expect(assertScriptHash(SCRIPT)).toBe(SCRIPT);
        expect(() => assertScriptHash(HASH)).toThrow(/56 hex/);
    });

    test("addressUtxos builds the exact path and returns rows", async () => {
        const { api, calls } = apiWith({ [`/addresses/${ADDR}/utxos`]: { status: 200, body: [{ tx_hash: HASH }], source: "local" } });
        const provider = createGerolaminoProvider(api);
        const session = createGerolaminoSession(api, extension());
        const rows = await session.addressUtxos(ADDR);
        expect(rows[0]).toEqual({ tx_hash: HASH });
        expect(calls[0]).toBe(`/addresses/${ADDR}/utxos`);

        // provider-level path unchanged for anyone using the raw transport
        await provider.get(`/addresses/${ADDR}/utxos`, { count: 5, page: 2 });
        expect(calls[1]).toBe(`/addresses/${ADDR}/utxos?count=5&page=2`);
    });

    test("a fresh address is empty, not an error", async () => {
        const { api } = apiWith({ [`/addresses/${ADDR}/utxos`]: { status: 404, body: { error: "Not Found" }, source: "local" } });
        const session = createGerolaminoSession(api, extension());
        expect(await session.addressUtxos(ADDR)).toEqual([]);
        expect(await session.addressTransactions(ADDR)).toEqual([]);
        expect(await session.asset(POLICY)).toBe(null);
        expect(await session.tx(HASH)).toBe(null);
        expect(await session.scriptCbor(SCRIPT)).toBe(null);
    });

    test("onMissing: throw surfaces the typed HTTP error", async () => {
        const { api } = apiWith({ [`/addresses/${ADDR}/utxos`]: { status: 404, body: { error: "Not Found" }, source: "local" } });
        const session = createGerolaminoSession(api, extension());
        let caught: any = null;
        try {
            await session.addressUtxos(ADDR, { onMissing: "throw" });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(GerolaminoHttpError);
        expect(caught.status).toBe(404);
    });

    test("a 500 is an error, never silently empty", async () => {
        const { api } = apiWith({ [`/addresses/${ADDR}/utxos`]: { status: 500, body: { error: "boom" }, source: "local" } });
        const session = createGerolaminoSession(api, extension());
        let caught: any = null;
        try {
            await session.addressUtxos(ADDR);
        } catch (e) {
            caught = e;
        }
        expect(caught?.kind).toBe("HTTP_ERROR");
        expect(caught?.status).toBe(500);
    });

    test("typed reads cover the Gravity path set", async () => {
        const { api, calls } = apiWith({});
        const session = createGerolaminoSession(api, extension());
        await session.addressTotal(ADDR);
        await session.assetAddresses(POLICY);
        await session.txUtxos(HASH);
        await session.blockLatest();
        await session.protocolParameters();
        await session.genesis();
        expect(calls).toEqual([
            `/addresses/${ADDR}/total`,
            `/assets/${POLICY}/addresses`,
            `/txs/${HASH}/utxos`,
            "/blocks/latest",
            "/epochs/latest/parameters",
            "/genesis"
        ]);
    });

    test("queryAll paginates through getAllPages", async () => {
        const calls: string[] = [];
        const api: GerolaminoApi = {
            query: async (path: string) => {
                calls.push(path);
                const page = Number(new URL(path, "http://x").searchParams.get("page") ?? 1);
                return { status: 200, body: page === 1 ? [1, 2] : [3], source: "local" };
            },
            submitTx: async () => "aa",
            getNetworkId: async () => 2,
            getTip: async () => ({ slot: 1, height: 1, hash: "h", network: "preview", state: "at-tip" })
        };
        const session = createGerolaminoSession(api, extension());
        expect(await session.queryAll<number>("/blocks/latest/txs", { count: 2 })).toEqual([1, 2, 3]);
        expect(calls.length).toBe(2);
    });

    test("evaluateTx is honest about the missing extension method", async () => {
        const { api } = apiWith({});
        const session = createGerolaminoSession(api, extension());
        expect(session.capabilities.canEvaluate).toBe(false);
        let caught: any = null;
        try {
            await session.evaluateTx("abcdef");
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(GerolaminoNotSupportedError);
        expect(caught?.kind).toBe("NOT_SUPPORTED");
        expect(caught?.message).toContain("/utils/txs/evaluate");
    });

    test("evaluateTx uses an evaluate() method when a build exposes one", async () => {
        const { api } = apiWith({});
        (api as any).evaluate = async (hex: string, opts: any) => ({ status: 200, body: { unit: "mem", hex, opts }, source: "local" });
        const session = createGerolaminoSession(api, extension());
        expect(session.capabilities.canEvaluate).toBe(true);
        const answer = await session.evaluateTx("0xabcd", { version: 6 });
        expect(answer.status).toBe(200);
        expect((answer.body as any).hex).toBe("abcd");
        expect((answer.body as any).opts.version).toBe(6);
    });
});
