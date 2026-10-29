import { describe, expect, test } from "bun:test";
import {
    connectGerolamino,
    detectGerolamino,
    GerolaminoError,
    GerolaminoIncompatibleError,
    hasGerolamino,
    isGerolaminoCompatible
} from "../src/core/index";
import type { GerolaminoApi, GerolaminoExtension, GerolaminoWindowLike } from "../src/core/types";

function fakeApi(): GerolaminoApi {
    return {
        query: async (path: string) => ({ status: 200, body: { path }, source: "local" }),
        submitTx: async (hex: string) => hex.slice(0, 64),
        getNetworkId: async () => 0,
        getTip: async () => ({ slot: 42, height: 10, hash: "abc", network: "preview", state: "at-tip", peerTip: { slot: 45 } }),
        getTrust: async () => ({ verdict: "trusted", rows: [] })
    };
}

function fakeExtension(overrides: Partial<GerolaminoExtension> = {}): GerolaminoExtension {
    let enabled = true;
    const extension: GerolaminoExtension = {
        name: "Gerolamino",
        apiVersion: "1",
        dappApiVersion: "0.1.0",
        isEnabled: async () => enabled,
        enable: async () => fakeApi(),
        ...overrides
    };
    (extension as any).__setEnabled = (value: boolean) => { enabled = value; };
    return extension;
}

function win(extension?: GerolaminoExtension | null, extra: Record<string, unknown> = {}): GerolaminoWindowLike {
    return { cardano: extension ? { gerolamino: extension, ...extra } : { ...extra } };
}

describe("detection", () => {
    test("absent page and no provider", async () => {
        const detection = await detectGerolamino({ win: win(null) });
        expect(detection.status).toBe("absent");
        expect(detection.present).toBe(false);
        expect(hasGerolamino(win(null))).toBe(false);
    });

    test("present is version-compatible and never prompts", async () => {
        let prompted = false;
        const extension = fakeExtension({ enable: async () => { prompted = true; return fakeApi(); } });
        const detection = await detectGerolamino({ win: win(extension) });
        expect(detection.status).toBe("present");
        expect(detection.compatible).toBe(true);
        expect(detection.enabled).toBe(true);
        expect(prompted).toBe(false);
    });

    test("unknown enabled state stays null, not false", async () => {
        const extension = fakeExtension({ isEnabled: async () => { throw new Error("no bridge"); } });
        const detection = await detectGerolamino({ win: win(extension) });
        expect(detection.status).toBe("present");
        expect(detection.enabled).toBe(null);
    });

    test("isEnabled timeout leaves enabled null", async () => {
        const extension = fakeExtension({ isEnabled: async () => { await new Promise((r) => setTimeout(r, 25)); return true; } });
        const detection = await detectGerolamino({ win: win(extension), detectionTimeoutMs: 5 });
        expect(detection.enabled).toBe(null);
    });

    test("incompatible apiVersion is reported, not treated as absent", async () => {
        const extension = fakeExtension({ apiVersion: "2" });
        const detection = await detectGerolamino({ win: win(extension) });
        expect(detection.status).toBe("incompatible");
        expect(detection.compatible).toBe(false);
        expect(detection.apiVersion).toBe("2");
    });

    test("legacy apiVersion can be accepted or refused", async () => {
        const extension = fakeExtension({ apiVersion: "0.1.0" });
        const legacy = await detectGerolamino({ win: win(extension), allowLegacyApiVersion: true });
        expect(legacy.status).toBe("present");
        expect(legacy.legacyVersion).toBe(true);
        const strict = await detectGerolamino({ win: win(extension), allowLegacyApiVersion: false });
        expect(strict.status).toBe("incompatible");
    });

    test("sync compatibility helper reads presence only", () => {
        expect(isGerolaminoCompatible(win(fakeExtension()))).toBe(true);
        expect(isGerolaminoCompatible(win(fakeExtension({ apiVersion: "9" })))).toBe(false);
        expect(hasGerolamino(win(null))).toBe(false);
    });
});

describe("connect", () => {
    test("connects after explicit approval and exposes the api", async () => {
        let enabled = false;
        const extension = fakeExtension({ isEnabled: async () => enabled, enable: async () => { enabled = true; return fakeApi(); } });
        const session = await connectGerolamino({ win: win(extension) });
        expect(session.api).toBeDefined();
        expect(session.closed).toBe(false);
        expect(session.provider.api).toBe(session.api);
    });

    test("refusal keeps CIP-30 code and info", async () => {
        const extension = fakeExtension({
            isEnabled: async () => false,
            enable: async () => { throw { code: -3, info: "the user did not allow this site" }; }
        });
        let caught: GerolaminoError | null = null;
        try {
            await connectGerolamino({ win: win(extension) });
        } catch (e) {
            caught = e as GerolaminoError;
        }
        expect(caught).toBeInstanceOf(GerolaminoError);
        expect(caught?.code).toBe(-3);
        expect(caught?.info).toBe("the user did not allow this site");
    });

    test("incompatible versions refuse to connect", async () => {
        let caught: GerolaminoIncompatibleError | null = null;
        try {
            await connectGerolamino({ win: win(fakeExtension({ apiVersion: "4" })) });
        } catch (e) {
            caught = e as GerolaminoIncompatibleError;
        }
        expect(caught).toBeInstanceOf(GerolaminoIncompatibleError);
    });
});
