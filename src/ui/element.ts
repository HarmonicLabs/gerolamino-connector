/**
 * Framework-neutral connect surface. The custom element never prompts on mount: detection is prompt-free;
 * only the user clicking Connect can call the extension's approval window.
 */
import {
    connectGerolamino,
    detectGerolamino,
    type GerolaminoDetection,
    type GerolaminoNodeStatus,
    type GerolaminoSession,
    type GerolaminoWindowLike
} from "../core";

export interface GerolaminoConnectElementOptions {
    label?: string;
    /** Detection refresh interval in milliseconds. Default 5000; 0 disables polling. */
    pollMs?: number;
    compact?: boolean;
    hideWhenAbsent?: boolean;
}

export class GerolaminoConnectElement extends HTMLElement {
    static tagName = "gerolamino-connect";
    static observedAttributes = ["label", "poll", "compact", "hide-when-absent"];

    private root: HTMLElement | null = null;
    private trigger: HTMLButtonElement | null = null;
    private panel: HTMLElement | null = null;
    private busy = false;
    private open = false;
    private localOff = false;
    private session: GerolaminoSession | null = null;
    private detection: GerolaminoDetection | null = null;
    private status: GerolaminoNodeStatus | null = null;
    private notice = "";
    private timer: number | null = null;
    private generation = 0;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = `
            :host {
                --gc-accent: #ff2d55;
                --gc-ok: #00e676;
                --gc-warn: #ffb300;
                --gc-bad: #ff5a5f;
                --gc-panel: #141821;
                --gc-text: #e8eaf0;
                --gc-dim: #8a93a6;
                --gc-border: #232a36;
                display: inline-block;
                position: relative;
                font: 12px/1.4 system-ui, sans-serif;
                color: var(--gc-text);
            }
            .root { position: relative; }
            .trigger {
                display: inline-flex; align-items: center; gap: 7px;
                height: 34px; padding: 0 10px;
                border: 1px solid var(--gc-border); border-radius: 8px;
                background: var(--gc-panel); color: var(--gc-text);
                cursor: pointer; user-select: none; font: inherit;
            }
            .trigger[aria-expanded="true"] { border-color: var(--gc-accent); }
            .dot {
                width: 8px; height: 8px; border-radius: 50%;
                background: currentColor; box-shadow: 0 0 6px currentColor;
                flex: none;
            }
            .label { color: var(--gc-text); font-size: 11px; font-weight: 700; letter-spacing: .4px; }
            .caret { color: var(--gc-dim); font-size: 10px; }
            .panel {
                position: absolute; right: 0; top: 40px; z-index: 2147483000;
                width: 330px; padding: 12px;
                background: var(--gc-panel); color: var(--gc-text);
                border: 1px solid var(--gc-border); border-radius: 10px;
                box-shadow: 0 12px 40px rgba(0,0,0,.5);
            }
            .panel[hidden] { display: none; }
            .title { font-weight: 700; color: var(--gc-warn); margin-bottom: 7px; }
            .grid { display: grid; grid-template-columns: 108px 1fr; gap: 4px 8px; margin-bottom: 9px; }
            .k { color: var(--gc-dim); }
            .v { color: var(--gc-text); overflow-wrap: anywhere; }
            .notice { color: var(--gc-dim); margin-top: 8px; overflow-wrap: anywhere; }
            .actions { display: flex; gap: 7px; margin-top: 9px; }
            .actions button {
                border: 1px solid var(--gc-border); border-radius: 6px;
                padding: 6px 10px; background: var(--gc-panel); color: var(--gc-text);
                cursor: pointer; font: inherit;
            }
            .actions .connect { border-color: var(--gc-accent); color: var(--gc-accent); }
            .trust { color: var(--gc-dim); font-size: 11px; line-height: 1.4; margin-top: 6px; overflow-wrap: anywhere; }
            .footer { text-align: right; margin-top: 5px; }
            .footer button { border: 0; background: transparent; color: var(--gc-dim); cursor: pointer; font: inherit; }
            .compact .label { letter-spacing: 0; }
            .compact .panel { width: 290px; }
            @media (prefers-color-scheme: light) {
                :host {
                    --gc-panel: #fff; --gc-text: #181c24; --gc-dim: #68707e;
                    --gc-border: #d9dee7;
                }
            }
        `;
        const root = document.createElement("div");
        root.className = "root";
        const trigger = document.createElement("button");
        trigger.className = "trigger";
        trigger.type = "button";
        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-label", "Gerolamino");
        const dot = document.createElement("span");
        dot.className = "dot";
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = "Gerolamino";
        const caret = document.createElement("span");
        caret.className = "caret";
        caret.textContent = "▾";
        trigger.append(dot, label, caret);
        trigger.addEventListener("click", () => {
            this.open = !this.open;
            if (this.open) void this.refresh();
            this.render();
        });
        const panel = document.createElement("div");
        panel.className = "panel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Gerolamino status");
        panel.hidden = true;
        root.append(trigger, panel);
        shadow.append(style, root);
        this.root = root;
        this.trigger = trigger;
        this.panel = panel;
        this.labelNode = label;
        this.bindCore();
    }

    private labelNode: HTMLElement | null = null;

    get label(): string {
        return this.getAttribute("label") || "Gerolamino";
    }

    set label(value: string) {
        this.setAttribute("label", value);
    }

    get pollMs(): number {
        const raw = Number(this.getAttribute("poll") ?? "5");
        const seconds = Number.isFinite(raw) && raw >= 0 ? raw : 5;
        return seconds * 1000;
    }

    set pollMs(value: number) {
        this.setAttribute("poll", String(Math.max(0, Math.floor(value / 1000))));
    }

    get compact(): boolean {
        return this.hasAttribute("compact");
    }

    set compact(value: boolean) {
        if (value) this.setAttribute("compact", "");
        else this.removeAttribute("compact");
    }

    get hideWhenAbsent(): boolean {
        return this.hasAttribute("hide-when-absent");
    }

    set hideWhenAbsent(value: boolean) {
        if (value) this.setAttribute("hide-when-absent", "");
        else this.removeAttribute("hide-when-absent");
    }

    connectedCallback(): void {
        this.schedulePoll();
        void this.refresh();
        document.addEventListener("visibilitychange", this.onVisibility);
    }

    disconnectedCallback(): void {
        if (this.timer != null) window.clearInterval(this.timer);
        this.timer = null;
        document.removeEventListener("visibilitychange", this.onVisibility);
    }

    attributeChangedCallback(): void {
        if (this.labelNode) this.labelNode.textContent = this.label;
        if (this.isConnected) this.schedulePoll();
    }

    /** Explicit user action: request approval and keep the session. */
    async connect(): Promise<GerolaminoSession | null> {
        if (this.busy) return this.session;
        this.busy = true;
        this.notice = "";
        this.localOff = false;
        try {
            const session = await connectGerolamino({ win: window as unknown as GerolaminoWindowLike });
            this.session = session;
            if (this.detection) {
                this.detection = { ...this.detection, enabled: true, detail: "Gerolamino is installed and enabled for this site" };
            }
            await this.refreshStatus();
            this.open = true;
            this.dispatch("gerolamino:connected", { session });
            return session;
        } catch (e) {
            this.notice = (e as Error)?.message ?? String(e);
            this.dispatch("gerolamino:error", { error: e });
            return null;
        } finally {
            this.busy = false;
            this.render();
        }
    }

    /** Close the connector session. Revokes through the extension when that API exists; otherwise local only. */
    async disconnect(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        try {
            if (this.session) {
                const result = await this.session.close();
                this.notice = result.message;
                this.session = null;
                this.status = null;
                this.localOff = true;
                this.dispatch("gerolamino:disconnected", { result });
            } else {
                this.localOff = true;
                this.notice = "Gerolamino is not connected on this page";
            }
        } catch (e) {
            this.notice = (e as Error)?.message ?? String(e);
        } finally {
            this.busy = false;
            this.render();
        }
    }

    async refresh(): Promise<void> {
        if (this.busy) return;
        const generation = ++this.generation;
        const detection = await detectGerolamino({ win: window as unknown as GerolaminoWindowLike, detectionTimeoutMs: 2_000 });
        if (generation !== this.generation) return;
        this.detection = detection;
        if (detection.status === "absent" || detection.status === "incompatible") {
            this.session = null;
            this.status = null;
            this.render();
            return;
        }
        if (detection.enabled === false) {
            this.session = null;
            this.status = null;
            this.localOff = false;
            this.render();
            return;
        }
        if (detection.enabled === true && !this.session && !this.localOff) {
            try {
                this.session = await connectGerolamino({ win: window as unknown as GerolaminoWindowLike, detectionTimeoutMs: 2_000 });
            } catch {
                this.session = null;
            }
        }
        if (this.session && this.session.closed === false) await this.refreshStatus();
        this.render();
    }

    private async refreshStatus(): Promise<void> {
        if (!this.session) {
            this.status = null;
            return;
        }
        try {
            this.status = await this.session.status();
            if (this.status) this.dispatch("gerolamino:status", { status: this.status });
        } catch {
            this.status = null;
        }
    }

    private schedulePoll(): void {
        if (this.timer != null) window.clearInterval(this.timer);
        this.timer = null;
        const ms = this.pollMs;
        if (ms > 0 && this.isConnected) this.timer = window.setInterval(() => void this.refresh(), ms);
    }

    private onVisibility = () => {
        if (document.visibilityState === "visible") void this.refresh();
    };

    private dispatch(name: string, detail: unknown): void {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }

    private render(): void {
        if (!this.trigger || !this.panel || !this.root) return;
        const tone = this.tone();
        const label = this.labelText();
        const labelEl = this.labelNode;
        if (labelEl) labelEl.textContent = label;
        this.trigger.title = this.detail() || "Gerolamino";
        this.trigger.style.color = tone;
        this.trigger.style.borderColor = tone === "dim" ? "var(--gc-border)" : "var(--gc-border)";
        this.trigger.setAttribute("aria-expanded", String(this.open));
        if (this.hideWhenAbsent && this.detection?.status === "absent") {
            this.root.style.display = "none";
        } else {
            this.root.style.display = "";
        }
        this.renderPanel();
        if (this.open) this.panel.hidden = false;
        else this.panel.hidden = true;
        if (this.compact) this.root.classList.add("compact");
        else this.root.classList.remove("compact");
    }

    private renderPanel(): void {
        if (!this.panel) return;
        const header = document.createElement("div");
        header.className = "title";
        header.textContent = this.detection?.status === "absent"
            ? "Gerolamino is not installed"
            : this.detection?.status === "incompatible"
                ? "Gerolamino version mismatch"
                : `Gerolamino · ${this.detection?.name ?? "Gerolamino"}`;

        const body = document.createElement("div");
        const text = this.detection?.status === "absent"
            ? "Install the Gerolamino browser extension, then reload this page and connect."
            : this.detection?.status === "incompatible"
                ? this.detection?.detail ?? "This page cannot use the installed Gerolamino API."
                : "";

        if (text) {
            const p = document.createElement("div");
            p.className = "v";
            p.textContent = text;
            body.append(p);
        }

        if (this.detection?.status === "present") {
            const grid = document.createElement("div");
            grid.className = "grid";
            const row = (key: string, value: string) => {
                const k = document.createElement("span");
                k.className = "k";
                k.textContent = key;
                const v = document.createElement("span");
                v.className = "v";
                v.textContent = value;
                grid.append(k, v);
            };
            row("installed", "yes");
            row("enabled", this.session ? "yes" : this.detection.enabled === null ? "unknown" : this.detection.enabled ? "yes" : "no");
            if (this.detection.apiVersion) row("api", this.detection.apiVersion);
            if (this.detection.dappApiVersion) row("dapp api", this.detection.dappApiVersion);
            row("network", this.status?.network ?? (this.detection.enabled ? "awaiting status" : "awaiting enable"));
            row("state", this.status?.state ?? (this.session ? "awaiting status" : "not connected"));
            row("tip", this.status?.tipSlot != null ? String(this.status.tipSlot) : "—");
            if (this.status?.peerSlot != null) row("peer", String(this.status.peerSlot));
            if (this.status?.syncPercent != null) row("sync", `${this.status.syncPercent.toFixed(1)}%`);
            if (this.status?.verdict) row("trust", this.status.verdict);
            if (this.localOff) row("local", "off");
            body.append(grid);
            if (this.status?.trustRows?.length) {
                const trust = document.createElement("div");
                trust.className = "trust";
                trust.textContent = this.status.trustRows.map((r) => `${r.label ?? r.key ?? ""}=${r.value ?? ""}${r.tone ? ` (${r.tone})` : ""}`).join(" · ");
                body.append(trust);
            }
        }

        const actions = document.createElement("div");
        actions.className = "actions";
        if (this.detection?.status === "present" && !this.session) {
            const connect = document.createElement("button");
            connect.type = "button";
            connect.className = "connect";
            connect.textContent = this.busy ? "connecting..." : "Connect Gerolamino";
            connect.disabled = this.busy;
            connect.addEventListener("click", () => void this.connect());
            actions.append(connect);
        }
        if (this.session) {
            const disconnect = document.createElement("button");
            disconnect.type = "button";
            disconnect.textContent = this.busy ? "..." : "Disconnect";
            disconnect.disabled = this.busy;
            disconnect.addEventListener("click", () => void this.disconnect());
            actions.append(disconnect);
        }
        body.append(actions);

        if (this.notice || this.detail()) {
            const note = document.createElement("div");
            note.className = "notice";
            note.textContent = this.notice || this.detail() || "";
            body.append(note);
        }

        const footer = document.createElement("div");
        footer.className = "footer";
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "close ✕";
        close.addEventListener("click", () => {
            this.open = false;
            this.render();
        });
        footer.append(close);

        this.panel.replaceChildren(header, body, footer);
    }

    private tone(): string {
        if (!this.detection || this.detection.status === "absent") return "var(--gc-dim)";
        if (this.detection.status === "incompatible") return "var(--gc-warn)";
        if (this.localOff) return "var(--gc-dim)";
        const enabled = !!this.session || this.detection.enabled === true;
        if (!enabled) return "var(--gc-warn)";
        const state = this.status?.state?.toLowerCase();
        const verdict = (this.status?.verdict ?? "").toLowerCase();
        if (state === "error" || state === "stopped" || verdict.includes("fail") || verdict.includes("red")) return "var(--gc-bad)";
        if (verdict.includes("warn") || verdict.includes("amber")) return "var(--gc-warn)";
        if (state === "at-tip") return "var(--gc-ok)";
        if (state === "idle" || state === "connecting" || state === "handshake" || state === "anchoring") return "var(--gc-warn)";
        if (this.detection.enabled === true) return "var(--gc-accent)";
        return "var(--gc-dim)";
    }

    private labelText(): string {
        if (!this.detection) return this.label;
        if (this.detection.status === "absent") return this.label;
        if (this.localOff) return `${this.label} · OFF`;
        if (this.detection.status === "incompatible") return `${this.label} · MIXED`;
        const enabled = !!this.session || this.detection.enabled === true;
        if (!enabled) return `${this.label} · ENABLE`;
        const state = this.status?.state?.toLowerCase();
        if (state === "at-tip") return `${this.label} · LIVE`;
        if (state === "syncing") return `${this.label} · SYNC`;
        if (state === "stopped" || state === "error") return `${this.label} · DOWN`;
        if (state === "idle" || state === "connecting" || state === "handshake" || state === "anchoring") return `${this.label} · STARTING`;
        return `${this.label} · CONNECTED`;
    }

    private detail(): string {
        if (!this.detection) return "Checking Gerolamino...";
        return this.detection.detail;
    }

    private bindCore(): void {
        // Keep direct methods available on the element for framework wrappers.
        (this as any).connectGerolamino = () => this.connect();
    }
}

export function createGerolaminoConnect(options: GerolaminoConnectElementOptions = {}): GerolaminoConnectElement {
    const element = new GerolaminoConnectElement();
    if (options.label != null) element.label = options.label;
    if (options.pollMs != null) element.pollMs = options.pollMs;
    if (options.compact != null) element.compact = options.compact;
    if (options.hideWhenAbsent != null) element.hideWhenAbsent = options.hideWhenAbsent;
    return element;
}

export function registerGerolaminoConnect(tagName = GerolaminoConnectElement.tagName): void {
    if (typeof customElements === "undefined" || customElements.get(tagName)) return;
    customElements.define(tagName, GerolaminoConnectElement);
}
