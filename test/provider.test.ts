import { describe, expect, test } from "bun:test";
import { createGerolaminoProvider, checkPath, withQuery } from "../src/core/index";
import { GerolaminoHttpError } from "../src/core/errors";
import type { GerolaminoApi, GerolaminoAnswer } from "../src/core/types";

function apiWith(responses: (path: string) => GerolaminoAnswer = (path) => ({ status: 200, body: { path }, source: "local" })): GerolaminoApi {
    const calls: string[] = [];
    const api: GerolaminoApi = {
        query: async (path: string) => { calls.push(path); return responses(path); },
        submitTx: async (hex: string) => `tx:${hex}`,
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
        expect(await provider.submitTx("0xabcdef")).toBe("tx:abcdef");
        await expect(provider.submitTx("0xzz")).rejects.toThrow("hex CBOR");
    });
});
