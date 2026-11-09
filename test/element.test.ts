import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The element is a real custom element, so it needs a DOM. happy-dom is a devDependency only: the published
 * package still has no runtime dependency. Imports are dynamic because the class extends HTMLElement at
 * module evaluation time.
 */
let mod: typeof import("../src/ui/element");
let window: Window;

beforeAll(async () => {
    window = new Window({ url: "https://dapp.example/" });
    const g = globalThis as any;
    g.window = window;
    g.document = window.document;
    g.HTMLElement = window.HTMLElement;
    g.customElements = window.customElements;
    g.CustomEvent = window.CustomEvent;
    g.Event = window.Event;
    g.KeyboardEvent = window.KeyboardEvent;
    g.MouseEvent = window.MouseEvent;
    mod = await import("../src/ui/element");
    if (!window.customElements.get("gerolamino-connect-test")) {
        (window.customElements as any).define("gerolamino-connect-test", mod.GerolaminoConnectElement as any);
    }
});

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

/** A present-but-not-approved extension: the panel then has a Connect button plus the close button. */
function stubProvider(state: { enabled: boolean } = { enabled: false }) {
    const api = {
        query: async (path: string) => ({ status: 200, body: { path }, source: "local" }),
        submitTx: async () => "aa",
        getNetworkId: async () => 2,
        getTip: async () => ({ slot: 1, height: 1, hash: "h", network: "preview", state: "at-tip" })
    };
    (window as any).cardano = {
        gerolamino: {
            name: "Gerolamino",
            apiVersion: "1",
            dappApiVersion: "0.1.0",
            isEnabled: async () => state.enabled,
            enable: async () => { state.enabled = true; return api; }
        }
    };
}

function mount(): any {
    const element = window.document.createElement("gerolamino-connect-test") as any;
    window.document.body.appendChild(element);
    return element;
}

describe("element structure and accessibility", () => {
    test("exposes parts for styling", () => {
        const element = mount();
        const trigger = element.shadowRoot.querySelector(".trigger");
        const panel = element.shadowRoot.querySelector(".panel");
        expect(trigger?.getAttribute("part")).toBe("trigger");
        expect(panel?.getAttribute("part")).toBe("panel");
        expect(element.shadowRoot.querySelector(".dot")?.getAttribute("part")).toBe("dot");
        expect(element.shadowRoot.querySelector(".label")?.getAttribute("part")).toBe("label");
    });

    test("wires dialog semantics", () => {
        const element = mount();
        const trigger = element.shadowRoot.querySelector(".trigger")!;
        const panel = element.shadowRoot.querySelector(".panel")!;
        expect(panel.getAttribute("role")).toBe("dialog");
        expect(panel.getAttribute("aria-modal")).toBe("false");
        expect(panel.getAttribute("aria-labelledby")).toBe("gc-title");
        expect(trigger.getAttribute("aria-controls")).toBe("gc-panel");
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(panel.getAttribute("tabindex")).toBe("-1");
    });

    test("has a polite live region", () => {
        const element = mount();
        const live = element.shadowRoot.querySelector('[role="status"]');
        expect(live).not.toBe(null);
        expect(live?.getAttribute("aria-live")).toBe("polite");
    });

    test("publishes theme variables, including the legacy aliases", () => {
        const element = mount();
        const css = element.shadowRoot.querySelector("style")!.textContent!;
        for (const name of ["--gerolamino-accent", "--gerolamino-bg", "--gerolamino-radius", "--gerolamino-font", "--gerolamino-text", "--gerolamino-border"]) {
            // --gerolamino-bg is exposed as --gerolamino-panel
            const actual = name === "--gerolamino-bg" ? "--gerolamino-panel" : name;
            expect(css.includes(actual)).toBe(true);
        }
        expect(css.includes("--gc-accent: var(--gerolamino-accent)")).toBe(true);
        expect(css.includes("border-radius: var(--gc-radius)")).toBe(true);
    });
});

describe("element interaction", () => {
    test("opens and closes with the keyboard, returning focus", () => {
        const element = mount();
        const trigger = element.shadowRoot.querySelector(".trigger") as any;
        const panel = element.shadowRoot.querySelector(".panel") as any;
        expect(panel.hidden).toBe(true);

        trigger.focus();
        trigger.click();
        expect(panel.hidden).toBe(false);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");

        const root = element.shadowRoot.querySelector(".root") as any;
        const escape = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        root.dispatchEvent(escape);
        expect(panel.hidden).toBe(true);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(element.shadowRoot.activeElement).toBe(trigger);
    });

    test("wraps Tab inside the open panel", async () => {
        stubProvider({ enabled: false });
        const element = mount();
        await tick();
        const trigger = element.shadowRoot.querySelector(".trigger") as any;
        trigger.click();
        await tick(10);
        const root = element.shadowRoot.querySelector(".root") as any;
        const panel = element.shadowRoot.querySelector(".panel") as any;
        const buttons = Array.from(panel.querySelectorAll("button")) as any[];
        expect(buttons.length).toBeGreaterThan(1);
        const last = buttons[buttons.length - 1];
        last.focus();
        const tab = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true });
        root.dispatchEvent(tab);
        expect(element.shadowRoot.activeElement).toBe(buttons[0]);
        delete (window as any).cardano;
    });

    test("toggles tab sync off on request", () => {
        const element = mount();
        expect(typeof element.disableTabSync).toBe("function");
        element.disableTabSync();
        expect(element.tabSync ?? null).toBe(null);
    });
});
