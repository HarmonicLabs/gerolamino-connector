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
        expect(result.revoked).toBe(false);
        expect(result.verified).toBe(true);
        expect(result.method).toBe(null);
        expect(result.message).toContain("nothing was revoked");
        expect(result.message).toContain("Gerolamino Settings");
        expect(session.closed).toBe(true);
    });

    test("close uses an extension disable() when present", async () => {
        let revoked = false;
        const session = createGerolaminoSession(api(), extension({ disable: async () => { revoked = true; } } as any));
        const result = await session.close();
        expect(result.mode).toBe("extension");
        expect(result.method).toBe("disable");
        expect(result.revoked).toBe(true);
        expect(result.verified).toBe(false);   // resolved without confirming
        expect(result.message).toContain("without confirming");
        expect(revoked).toBe(true);
    });

    test("close reports a confirmed revoke when the extension says so", async () => {
        const session = createGerolaminoSession(api(), extension({ revoke: async () => ({ revoked: true }) } as any));
        const result = await session.close();
        expect(result.method).toBe("revoke");
        expect(result.revoked).toBe(true);
        expect(result.verified).toBe(true);
        expect(result.api).toBe("object.revoked=true");
    });

    test("close does not claim a revoke the extension denied", async () => {
        const session = createGerolaminoSession(api(), extension({ revoke: async () => ({ revoked: false }) } as any));
        const result = await session.close();
        expect(result.revoked).toBe(false);
        expect(result.verified).toBe(true);
        expect(result.message).toContain("did not revoke");
    });

    test("provider submitTx keeps the connector's hex validation", async () => {
        const session = createGerolaminoSession(api(), extension());
        await expect(session.provider.submitTx("0xzz")).rejects.toThrow(GerolaminoError);
    });

    test("capabilities report what the enabled api actually exposes", async () => {
        const session = createGerolaminoSession(api(), extension());
        const caps = session.capabilities;
        expect(caps.canQuery).toBe(true);
        expect(caps.canSubmit).toBe(true);
        expect(caps.canTrust).toBe(true);
        expect(caps.canNetworkId).toBe(true);
        expect(caps.supportsRevoke).toBe(false);
        expect(caps.revokeMethod).toBe(null);
        expect(caps.connectorVersion).toBe("0.2.1");
        expect(caps.apiVersion).toBe("1");
        expect(caps.needsReload).toBe(false);
        expect(session.getCapabilities()).toEqual(caps);

        const bare = createGerolaminoSession({
            query: async () => ({ status: 200, body: [], source: "local" }),
            submitTx: async () => "aa",
            getTip: async () => ({ slot: 1, height: 1, hash: "h", network: "preview", state: "at-tip" })
        } as any, extension());
        expect(bare.capabilities.canTrust).toBe(false);
        expect(bare.capabilities.canNetworkId).toBe(false);
    });

    test("submitTx returns provenance and flips the capability flag", async () => {
        const session = createGerolaminoSession(api({ submitTx: async () => ({ txid: "cd".repeat(32), source: "local" }) as any }), extension());
        expect(session.capabilities.submitProvenance).toBe(false);
        const result = await session.submitTx("abcdef");
        expect(result.txid).toBe("cd".repeat(32));
        expect(result.source).toBe("local");
        expect(result.legacyShape).toBe(false);
        expect(session.capabilities.submitProvenance).toBe(true);
        expect(await session.submitTxId("abcdef")).toBe("cd".repeat(32));
    });

    test("legacy string submits stay unproven and uncontracted", async () => {
        const session = createGerolaminoSession(api(), extension());
        const result = await session.submitTx("abcdef");
        expect(result.legacyShape).toBe(true);
        expect(result.source).toBe("unknown");
        expect(session.capabilities.submitProvenance).toBe(false);
    });

    test("status carries the identity block", async () => {
        const session = createGerolaminoSession(api(), extension({ build: "2026.11.9-abc" }));
        const status = await session.status();
        expect(status?.identity.connectorVersion).toBe("0.2.1");
        expect(status?.identity.apiVersion).toBe("1");
        expect(status?.identity.dappApiVersion).toBe("0.1.0");
        expect(status?.identity.build).toBe("2026.11.9-abc");
        expect(status?.identity.networkId).toBe(0);
    });

    test("assertNetwork compares magic and reports the mismatch", async () => {
        const preview = createGerolaminoSession(api({ getNetworkId: async () => 2 }), extension());
        const ok = await preview.assertNetwork("preview");
        expect(ok.ok).toBe(true);
        expect(ok.expected).toEqual({ name: "preview", magic: 2 });
        expect(ok.actual.magic).toBe(2);

        const wrong = await preview.assertNetwork("preprod");
        expect(wrong.ok).toBe(false);
        expect(wrong.detail).toContain("expects preprod");

        const byMagic = await preview.assertNetwork(2);
        expect(byMagic.ok).toBe(true);
    });

    test("assertNetwork refuses to guess an unknown expectation", async () => {
        const session = createGerolaminoSession(api({ getNetworkId: async () => 2 }), extension());
        const unknown = await session.assertNetwork("testnet-42x");
        expect(unknown.ok).toBe(false);
        expect(unknown.detail).toContain("unknown expected network");
    });
});
