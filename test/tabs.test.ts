import { describe, expect, test } from "bun:test";
import {
    createGerolaminoTabSync,
    disconnectAction,
    parseTabEvent,
    type GerolaminoTabDetection
} from "../src/core/index";
import type { GerolaminoTabEvent } from "../src/core/tabs";

function detection(enabled: boolean | null, apiVersion = "1"): GerolaminoTabDetection {
    return {
        status: "present",
        present: true,
        compatible: true,
        legacyVersion: false,
        enabled,
        name: "Gerolamino",
        apiVersion,
        dappApiVersion: "0.1.0",
        needsReload: false,
        build: null,
        detail: "Gerolamino is installed"
    };
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const channelName = () => `gc-test-${Math.random().toString(36).slice(2)}`;

describe("tab sync", () => {
    test("shares detection between tabs on the same origin", async () => {
        const name = channelName();
        const a = createGerolaminoTabSync({ name });
        const b = createGerolaminoTabSync({ name });
        const events: GerolaminoTabEvent[] = [];
        b.onUpdate((event) => events.push(event));

        a.publishDetection(detection(true));
        await tick();

        const shared = b.state().detection;
        expect(shared?.detection.enabled).toBe(true);
        expect(shared?.detection.apiVersion).toBe("1");
        expect(events.map((e) => e.type)).toEqual(["detection"]);
        expect(events[0]?.tabId).toBe(a.tabId);
        a.close();
        b.close();
    });

    test("a tab never receives its own broadcast", async () => {
        const name = channelName();
        const tab = createGerolaminoTabSync({ name });
        let fired = 0;
        tab.onUpdate(() => fired++);
        tab.publishDetection(detection(false));
        await tick();
        expect(fired).toBe(0);
        tab.close();
    });

    test("an approval started in one tab blocks the others and clears on approval-end", async () => {
        const name = channelName();
        const owner = createGerolaminoTabSync({ name });
        const other = createGerolaminoTabSync({ name });

        owner.beginApproval();
        await tick();
        expect(other.state().approval?.tabId).toBe(owner.tabId);

        owner.endApproval(true);
        await tick();
        expect(other.state().approval).toBe(null);
        owner.close();
        other.close();
    });

    test("a stale approval lock expires", async () => {
        const name = channelName();
        const owner = createGerolaminoTabSync({ name, approvalTtlMs: 1 });
        const other = createGerolaminoTabSync({ name, approvalTtlMs: 1 });
        owner.beginApproval();
        await tick(20);
        expect(other.state().approval).toBe(null);
        owner.close();
        other.close();
    });

    test("connected and disconnected transitions propagate", async () => {
        const name = channelName();
        const a = createGerolaminoTabSync({ name });
        const b = createGerolaminoTabSync({ name });

        a.publishConnected("1");
        await tick();
        expect(b.state().connected?.apiVersion).toBe("1");

        a.publishDisconnected(false);
        await tick();
        expect(b.state().connected).toBe(null);
        expect(b.state().disconnected?.revoked).toBe(false);
        a.close();
        b.close();
    });

    test("unsupported channel degrades to a no-op instead of throwing", async () => {
        const tab = createGerolaminoTabSync({ channel: null });
        expect(tab.supported).toBe(false);
        tab.publishDetection(detection(true));
        tab.beginApproval();
        expect(tab.state().detection).toBe(null);
        expect(tab.state().approval).toBe(null);
        tab.close();
    });

    test("hostile payloads are rejected by the parser", async () => {
        expect(parseTabEvent(null)).toBe(null);
        expect(parseTabEvent({ type: "detection" })).toBe(null);          // no tabId
        expect(parseTabEvent({ type: "nope", tabId: "x", at: 1 })).toBe(null);
        expect(parseTabEvent({ type: "detection", tabId: "x", at: 1, detection: { status: "weird" } })).toBe(null);
        const ok = parseTabEvent({ type: "connected", tabId: "x", at: 5, apiVersion: "1" });
        expect(ok).toEqual({ type: "connected", tabId: "x", at: 5, apiVersion: "1" });
    });
});

describe("disconnect honesty", () => {
    test("labels the control by what it can actually do", () => {
        const local = disconnectAction({
            canQuery: true, canSubmit: true, canTip: true, canTrust: true, canNetworkId: true, canEvaluate: false,
            supportsRevoke: false, revokeMethod: null, submitProvenance: false,
            connectorVersion: "0.3.0", apiVersion: "1", dappApiVersion: "0.1.0",
            needsReload: false, build: null
        });
        expect(local.label).toBe("Stop using Gerolamino on this site");
        expect(local.mode).toBe("local");

        const revocable = disconnectAction({
            canQuery: true, canSubmit: true, canTip: true, canTrust: true, canNetworkId: true, canEvaluate: false,
            supportsRevoke: true, revokeMethod: "revoke", submitProvenance: false,
            connectorVersion: "0.3.0", apiVersion: "1", dappApiVersion: "0.1.0",
            needsReload: false, build: null
        });
        expect(revocable.label).toBe("Revoke approval");
        expect(revocable.mode).toBe("extension");
        expect(revocable.revokeMethod).toBe("revoke");
    });
});
