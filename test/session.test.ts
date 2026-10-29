import { describe, expect, test } from "bun:test";
import { createGerolaminoSession, GerolaminoError, GerolaminoTimeoutError } from "../src/core/index";
import type { GerolaminoApi, GerolaminoExtension } from "../src/core/types";

function api(overrides: Partial<GerolaminoApi> = {}): GerolaminoApi {
    return {
        query: async () => ({ status: 200, body: [], source: "local" }),
        submitTx: async () => "aa".repeat(32),
        getNetworkId: async () => 0,
        getTip: async () => ({
            slot: 100,
            height: 10,
            hash: "abc",
            network: "preview",
            state: "at-tip",
            peerTip: { slot: 110, height: 11 }
        }),
        getTrust: async () => ({ verdict: "verified", rows: [
            { key: "payload", label: "Payload", value: "ok", tone: "ok" }
        ] }),
        ...overrides
    };
}

function extension(overrides: Partial<GerolaminoExtension> = {}): GerolaminoExtension {
    return {
        name: "Gerolamino",
        apiVersion: "1",
        dappApiVersion: "0.1.0",
        isEnabled: async () => true,
        enable: async () => api(),
        ...overrides
    };
}

describe("session", () => {
    test("status computes sync and keeps trust rows", async () => {
        const session = createGerolaminoSession(api(), extension());
        const status = await session.status();
        expect(status?.network).toBe("preview");
        expect(status?.state).toBe("at-tip");
        expect(status?.tipSlot).toBe(100);
        expect(status?.peerSlot).toBe(110);
        expect(status?.syncPercent).toBe(90.91);
        expect(status?.verdict).toBe("verified");
        expect(status?.trustRows[0]?.label).toBe("Payload");
    });

    test("missing verified tip yields a null status", async () => {
        const session = createGerolaminoSession(api({ getTip: async () => { throw new Error("no verified tip"); } }), extension());
        expect(await session.status()).toBe(null);
    });

    test("getTip timeout is typed", async () => {
        const session = createGerolaminoSession(api({ getTip: async () => { await new Promise((r) => setTimeout(r, 25)); return { slot: 1, height: 1, hash: "", network: "", state: "" }; } }), extension());
        let caught: GerolaminoTimeoutError | null = null;
        try { await session.getTip({ timeoutMs: 5 }); } catch (e) { caught = e as GerolaminoTimeoutError; }
        expect(caught).toBeInstanceOf(GerolaminoTimeoutError);
    });

    test("close is local-only when no extension revoke exists", async () => {
        const session = createGerolaminoSession(api(), extension());
        const result = await session.close();
        expect(result.mode).toBe("local");
        expect(session.closed).toBe(true);
    });

    test("close uses an extension disable() when present", async () => {
        let revoked = false;
        const session = createGerolaminoSession(api(), extension({ disable: async () => { revoked = true; } } as any));
        const result = await session.close();
        expect(result.mode).toBe("extension");
        expect(result.method).toBe("disable");
        expect(revoked).toBe(true);
    });

    test("provider submitTx keeps the connector's hex validation", async () => {
        const session = createGerolaminoSession(api(), extension());
        await expect(session.provider.submitTx("0xzz")).rejects.toThrow(GerolaminoError);
    });
});
