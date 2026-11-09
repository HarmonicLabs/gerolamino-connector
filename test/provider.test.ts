import { describe, expect, test } from "bun:test";
import { createGerolaminoProvider, checkPath, withQuery } from "../src/core/index";
import { GerolaminoGatewaySilentError, GerolaminoHttpError } from "../src/core/errors";
import type { GerolaminoApi, GerolaminoAnswer } from "../src/core/types";

function apiWith(
    responses: (path: string) => GerolaminoAnswer = (path) => ({ status: 200, body: { path }, source: "local" }),
    submit: (hex: string) => unknown = (hex) => `tx:${hex}`
): GerolaminoApi {
    const calls: string[] = [];
    const api: GerolaminoApi = {
        query: async (path: string) => { calls.push(path); return responses(path); },
        submitTx: async (hex: string) => submit(hex) as any,
        getNetworkId: async () => 0,
        getTip: async () => ({ slot: 1, height: 1, hash: "aa", network: "preview", state: "at-tip" })
    };
    (api as any).calls = calls;
    return api;
}

describe("provider transport", () => {
    test("normalizes /api/v0 and adds paging params", async () => {
        expect(checkPath("/api/v0/blocks/latest")).toBe("/blocks/latest");
        expect(checkPath("https://node.example/api/v0/blocks/latest")).toBe("/blocks/latest");
        expect(withQuery("/blocks", { count: 3, page: 2, order: "desc" })).toBe("/blocks?count=3&page=2&order=desc");
        const api = apiWith();
        const provider = createGerolaminoProvider(api);
        const answer = await provider.get("/api/v0/blocks/1000", { page: 2, count: 5 });
        expect(answer.status).toBe(200);
        expect((api as any).calls[0]).toBe("/blocks/1000?count=5&page=2");
        expect(typeof answer.requestId).toBe("string");
    });

    test("json throws a typed HTTP error for a non-200 answer", async () => {
        const api = apiWith(() => ({ status: 404, body: { status_code: 404 }, source: "relay" }));
        const provider = createGerolaminoProvider(api);
        let caught: GerolaminoHttpError | null = null;
        try {
            await provider.json("/blocks/nope");
        } catch (e) {
            caught = e as GerolaminoHttpError;
        }
        expect(caught).toBeInstanceOf(GerolaminoHttpError);
        expect(caught?.status).toBe(404);
        expect(caught?.kind).toBe("HTTP_ERROR");
        expect(caught?.path).toBe("/blocks/nope");
        expect(caught?.blockfrostBody).toEqual({ status_code: 404 });
        expect(typeof caught?.requestId).toBe("string");
        expect(JSON.parse(JSON.stringify(caught))).toMatchObject({ kind: "HTTP_ERROR", status: 404, path: "/blocks/nope" });
    });

    test("a 503 answer is GATEWAY_SILENT, not a generic HTTP error", async () => {
        const api = apiWith(() => ({ status: 503, body: { status_code: 503, message: "no peer" }, source: "local" }));
        const provider = createGerolaminoProvider(api);
        let caught: GerolaminoGatewaySilentError | null = null;
        try {
            await provider.json("/blocks/latest");
        } catch (e) {
            caught = e as GerolaminoGatewaySilentError;
        }
        expect(caught).toBeInstanceOf(GerolaminoGatewaySilentError);
        expect(caught?.kind).toBe("GATEWAY_SILENT");
        expect(caught?.status).toBe(503);
        expect(caught?.requestId).toBeTruthy();
    });

    test("a rejecting query becomes GATEWAY_SILENT with the path", async () => {
        const api = apiWith();
        api.query = async () => { throw new Error("port closed"); };
        const provider = createGerolaminoProvider(api);
        let caught: any = null;
        try {
            await provider.get("/blocks/latest");
        } catch (e) {
            caught = e;
        }
        expect(caught?.kind).toBe("GATEWAY_SILENT");
        expect(caught?.status).toBe(503);
        expect(caught?.path).toBe("/blocks/latest");
        expect(caught?.requestId).toBeTruthy();
    });

    test("getAllPages stops on a short page", async () => {
        const api = apiWith((path) => {
            const parsed = new URL(path, "http://x");
            const page = Number(parsed.searchParams.get("page") ?? 1);
            const body = page === 1 ? [1, 2] : [3];
            return { status: 200, body, source: "local" };
        });
        const provider = createGerolaminoProvider(api);
        expect(await provider.getAllPages("/everything", { count: 2 })).toEqual([1, 2, 3]);
    });

    test("submitTx strips 0x and rejects non-hex", async () => {
        const api = apiWith();
        const provider = createGerolaminoProvider(api);
        const result = await provider.submitTx("0xabcdef");
        expect(result.txid).toBe("tx:abcdef");
        expect(result.source).toBe("unknown");
        expect(result.legacyShape).toBe(true);
        expect(result.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(result.requestId).toMatch(/^grl-/);
        await expect(provider.submitTx("0xzz")).rejects.toThrow("hex CBOR");
        expect(await provider.submitTxId("0xabcdef")).toBe("tx:abcdef");
    });

    test("submitTx reports provenance from an object answer", async () => {
        const api = apiWith(undefined, () => ({ txid: "ab".repeat(32), source: "relay", peer: "203.0.113.7:3004" }));
        const provider = createGerolaminoProvider(api);
        const result = await provider.submitTx("abcdef");
        expect(result.txid).toBe("ab".repeat(32));
        expect(result.source).toBe("relay");
        expect(result.peer).toBe("203.0.113.7:3004");
        expect(result.legacyShape).toBe(false);
    });

    test("submitTx rejects an object without a txid", async () => {
        const api = apiWith(undefined, () => ({ source: "local" }));
        const provider = createGerolaminoProvider(api);
        let caught: any = null;
        try {
            await provider.submitTx("abcdef");
        } catch (e) {
            caught = e;
        }
        expect(caught?.kind).toBe("INVALID_REQUEST");
    });
});
