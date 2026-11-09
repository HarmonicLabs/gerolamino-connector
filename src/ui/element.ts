/**
 * Framework-neutral connect surface. The custom element never prompts on mount: detection is prompt-free;
 * only the user clicking Connect can call the extension's approval window.
 */
import {
    connectGerolamino,
    createGerolaminoTabSync,
    detectGerolamino,
    disconnectAction,
    type GerolaminoDetection,
    type GerolaminoNodeStatus,
    type GerolaminoSession,
    type GerolaminoTabEvent,
    type GerolaminoTabSync,
    type GerolaminoWindowLike
} from "../core";

export interface GerolaminoConnectElementOptions {
    label?: string;
    /** Detection refresh interval in milliseconds. Default 5000; 0 disables polling. */
    pollMs?: number;
    compact?: boolean;
    hideWhenAbsent?: boolean;
    /** Share detection/approval state with other tabs on the same origin. Default true. */
    tabSync?: boolean;
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
    private tabSync: GerolaminoTabSync | null = null;
    private noTabSync = false;
    private foreignApproval: { tabId: string; until: number } | null = null;
    private detectedAt = 0;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = `
            :host {
                /* Public surface: set these from the page. The --gc-* names are the legacy aliases. */
                --gerolamino-accent: #ff2d55;
                --gerolamino-ok: #00e676;
                --gerolamino-warn: #ffb300;
                --gerolamino-bad: #ff5a5f;
                --gerolamino-panel: #141821;
                --gerolamino-text: #e8eaf0;
                --gerolamino-muted: #8a93a6;
                --gerolamino-border: #232a36;
                --gerolamino-radius: 8px;
                --gerolamino-font: 12px/1.4 system-ui, sans-serif;
                --gc-accent: var(--gerolamino-accent);
                --gc-ok: var(--gerolamino-ok);
                --gc-warn: var(--gerolamino-warn);
                --gc-bad: var(--gerolamino-bad);
                --gc-panel: var(--gerolamino-panel);
                --gc-text: var(--gerolamino-text);
                --gc-dim: var(--gerolamino-muted);
                --gc-border: var(--gerolamino-border);
                --gc-radius: var(--gerolamino-radius);
                display: inline-block;
                position: relative;
                font: var(--gerolamino-font);
                color: var(--gc-text);
            }
            .root { position: relative; }
            .sr {
                position: absolute; width: 1px; height: 1px; overflow: hidden;
                clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
            }
            .trigger {
                display: inline-flex; align-items: center; gap: 7px;
                height: 34px; padding: 0 10px;
                border: 1px solid var(--gc-border); border-radius: var(--gc-radius);
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
                width: 352px; max-width: calc(100vw - 16px); padding: 14px 14px 10px;
                background: var(--gc-panel); color: var(--gc-text);
                border: 1px solid var(--gc-border); border-radius: calc(var(--gc-radius) + 2px);
                box-shadow: 0 12px 40px rgba(0,0,0,.5);
            }
            .panel[hidden] { display: none; }
            .title { font-size: 13px; font-weight: 700; color: var(--gc-text); letter-spacing: .2px; }
            .sub { color: var(--gc-dim); font-size: 11px; margin: 2px 0 10px; }
            .meter { margin-bottom: 10px; }
            .meter-bar {
                height: 6px; border-radius: 999px; overflow: hidden;
                background: color-mix(in srgb, var(--gc-dim) 22%, transparent);
            }
            .meter-fill { height: 100%; border-radius: 999px; background: var(--gc-accent); transition: width .3s ease; }
            .meter-text { color: var(--gc-dim); font-size: 10.5px; margin-top: 5px; font-variant-numeric: tabular-nums; }
            .grid { display: grid; grid-template-columns: 74px 1fr; gap: 3px 10px; margin-bottom: 10px; }
            .k { color: var(--gc-dim); font-size: 11px; }
            .v { color: var(--gc-text); font-size: 11.5px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
            .chips { display: grid; gap: 4px; margin-bottom: 10px; }
            .chip {
                display: flex; align-items: center; gap: 7px;
                padding: 4px 8px; border-radius: 6px;
                border: 1px solid var(--gc-border); color: var(--gc-dim); font-size: 10.5px;
            }
            .chip .dot { width: 6px; height: 6px; box-shadow: none; }
            .chip-key { color: var(--gc-dim); }
            .chip-val { margin-left: auto; color: var(--gc-text); font-variant-numeric: tabular-nums; }
            .chip.ok .chip-val { color: var(--gc-ok); }
            .chip.warn .chip-val { color: var(--gc-warn); }
            .chip.bad .chip-val { color: var(--gc-bad); }
            .chip.ok { color: var(--gc-ok); border-color: color-mix(in srgb, var(--gc-ok) 40%, var(--gc-border)); }
            .chip.warn { color: var(--gc-warn); border-color: color-mix(in srgb, var(--gc-warn) 40%, var(--gc-border)); }
            .chip.bad { color: var(--gc-bad); border-color: color-mix(in srgb, var(--gc-bad) 40%, var(--gc-border)); }
            .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
            .badge { padding: 3px 7px; border-radius: 6px; font-size: 10.5px; border: 1px solid var(--gc-border); }
            .badge.warn { color: var(--gc-warn); border-color: color-mix(in srgb, var(--gc-warn) 45%, var(--gc-border)); }
            .badge.dim { color: var(--gc-dim); }
            .notice { color: var(--gc-dim); font-size: 11px; margin-top: 9px; overflow-wrap: anywhere; }
            .actions { display: flex; gap: 7px; justify-content: flex-end; margin-top: 12px; }
            .actions button {
                border: 1px solid var(--gc-border); border-radius: var(--gc-radius);
                padding: 7px 12px; background: var(--gc-panel); color: var(--gc-text);
                cursor: pointer; font: inherit; font-size: 11.5px;
            }
            .actions button:hover:not([disabled]) { border-color: var(--gc-dim); }
            .actions .connect { border-color: var(--gc-accent); color: var(--gc-accent); }
            .footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--gc-border); }
            .hint { color: var(--gc-dim); font-size: 10.5px; line-height: 1.35; max-width: 270px; }
            .close { border: 0; background: transparent; color: var(--gc-dim); cursor: pointer; font: inherit; font-size: 12px; padding: 2px 4px; }
            .close:hover { color: var(--gc-text); }
            .compact .label { letter-spacing: 0; }
            .compact .panel { width: 320px; }
            @media (prefers-color-scheme: light) {
                :host {
                    --gc-panel: #fff; --gc-text: #181c24; --gc-dim: #68707e;
                    --gc-border: #d9dee7;
                }
            }
        `;
        const root = document.createElement("div");
        root.className = "root";
        root.addEventListener("keydown", (event) => this.handleKeydown(event));

        const trigger = document.createElement("button");
        trigger.className = "trigger";
        trigger.type = "button";
        trigger.id = "gc-trigger";
        trigger.setAttribute("part", "trigger");
        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-controls", "gc-panel");
        trigger.setAttribute("aria-label", "Gerolamino");
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.setAttribute("part", "dot");
        const label = document.createElement("span");
        label.className = "label";
        label.setAttribute("part", "label");
        label.textContent = "Gerolamino";
        const caret = document.createElement("span");
        caret.className = "caret";
        caret.setAttribute("part", "caret");
        caret.textContent = "▾";
        trigger.append(dot, label, caret);
        trigger.addEventListener("click", () => {
            if (this.open) this.closePanel();
            else this.openPanel();
        });

        const panel = document.createElement("div");
        panel.className = "panel";
        panel.id = "gc-panel";
        panel.setAttribute("part", "panel");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "false");
        panel.setAttribute("aria-labelledby", "gc-title");
        panel.tabIndex = -1;
        panel.hidden = true;

        const live = document.createElement("div");
        live.className = "sr";
        live.setAttribute("part", "live");
        live.setAttribute("role", "status");
        live.setAttribute("aria-live", "polite");

        root.append(trigger, panel, live);
        shadow.append(style, root);
        this.root = root;
        this.trigger = trigger;
        this.panel = panel;
        this.live = live;
        this.labelNode = label;
        this.bindCore();
    }

    private labelNode: HTMLElement | null = null;
    private live: HTMLElement | null = null;
    private previouslyFocused: HTMLElement | null = null;

    /** Open the panel as a dialog: remember focus, focus the first action, and let Escape return it. */
    private openPanel(): void {
        if (this.open) return;
        this.previouslyFocused = (this.shadowRoot?.activeElement as HTMLElement | null) ?? null;
        this.open = true;
        if (this.panel) this.panel.hidden = false;
        void this.refresh();
        this.render();
        queueMicrotask(() => {
            const first = this.panel?.querySelector<HTMLElement>("button:not([disabled])");
            (first ?? this.panel)?.focus();
        });
    }

    private closePanel(): void {
        if (!this.open) return;
        this.open = false;
        this.render();
        const target = this.previouslyFocused ?? this.trigger;
        target?.focus();
        this.previouslyFocused = null;
    }

    /** Escape closes and returns focus; Tab wraps inside the panel. */
    private handleKeydown(event: KeyboardEvent): void {
        if (!this.open) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.closePanel();
            return;
        }
        if (event.key !== "Tab" || !this.panel) return;
        const focusables = Array.from(this.panel.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = (this.shadowRoot?.activeElement as HTMLElement | null) ?? null;
        if (event.shiftKey && (active === first || active === this.panel || active === null)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || active === null)) {
            event.preventDefault();
            first.focus();
        }
    }

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
        if (!this.tabSync && !this.noTabSync) {
            this.tabSync = createGerolaminoTabSync();
            this.tabSync.onUpdate(this.onTabEvent);
        }
        this.schedulePoll();
        void this.refresh();
        document.addEventListener("visibilitychange", this.onVisibility);
    }

    disconnectedCallback(): void {
        if (this.timer != null) window.clearTimeout(this.timer);
        this.timer = null;
        this.tabSync?.close();
        this.tabSync = null;
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
        this.tabSync?.beginApproval();
        try {
            const session = await connectGerolamino({ win: window as unknown as GerolaminoWindowLike });
            this.session = session;
            this.tabSync?.endApproval(true);
            this.tabSync?.publishConnected(session.capabilities.apiVersion);
            if (this.detection) {
                this.detection = { ...this.detection, enabled: true, detail: "Gerolamino is installed and enabled for this site" };
            }
            await this.refreshStatus();
            this.open = true;
            this.dispatch("gerolamino:connected", { session });
            return session;
        } catch (e) {
            this.tabSync?.endApproval(false);
            this.notice = (e as Error)?.message ?? String(e);
            this.dispatch("gerolamino:error", { error: e });
            return null;
        } finally {
            this.busy = false;
            this.render();
        }
    }

    /**
     * Stop using Gerolamino on this page. When the extension exposes no page-callable revoke this is a local
     * close only: the site stays approved, and the notice says so instead of implying a revoke.
     */
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
                this.tabSync?.publishDisconnected(result.revoked);
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
        const shared = this.tabSync?.state().detection ?? null;
        const sharedFresh = shared != null && Date.now() - shared.at < 5_000;
        if (sharedFresh && generation === this.generation) {
            this.detection = { ...shared!.detection };
            this.detectedAt = shared!.at;
            if (this.detection.status !== "present") {
                this.session = null;
                this.status = null;
                this.render();
                return;
            }
            if (this.detection.enabled === true && !this.session && !this.localOff) {
                try {
                    this.session = await connectGerolamino({ win: window as unknown as GerolaminoWindowLike, detectionTimeoutMs: 2_000 });
                } catch {
                    this.session = null;
                }
                if (generation !== this.generation) return;
            }
            if (this.session && this.session.closed === false) await this.refreshStatus();
            this.render();
            return;
        }
        const detection = await detectGerolamino({ win: window as unknown as GerolaminoWindowLike, detectionTimeoutMs: 2_000 });
        if (generation !== this.generation) return;
        this.detection = detection;
        this.detectedAt = Date.now();
        this.tabSync?.publishDetection(detection);
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

    private schedulePoll(delayMs?: number): void {
        if (this.timer != null) window.clearTimeout(this.timer);
        this.timer = null;
        const ms = this.pollMs;
        if (ms <= 0 || !this.isConnected) return;
        // A hidden tab does not poll at all; visibilitychange resumes with a fresh read and a jittered delay.
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        const delay = delayMs ?? ms * (0.75 + Math.random() * 0.5);
        this.timer = window.setTimeout(() => {
            void this.refresh().finally(() => this.schedulePoll());
        }, delay);
    }

    private onVisibility = () => {
        if (typeof document === "undefined") return;
        if (document.visibilityState === "hidden") {
            if (this.timer != null) window.clearTimeout(this.timer);
            this.timer = null;
            return;
        }
        void this.refresh();
        this.schedulePoll();
    };

    /** Another tab published state. Adopt detection, block a duplicate approval window, follow connect/disconnect. */
    private onTabEvent = (event: GerolaminoTabEvent) => {
        switch (event.type) {
            case "detection":
                if (event.at < this.detectedAt) return;
                this.detection = { ...event.detection };
                this.detectedAt = event.at;
                break;
            case "approval-start":
                this.foreignApproval = { tabId: event.tabId, until: event.at + 60_000 };
                break;
            case "approval-end":
                if (this.foreignApproval?.tabId === event.tabId) this.foreignApproval = null;
                break;
            case "connected":
                void this.refresh();
                return;
            case "disconnected":
                this.notice = "another tab stopped using Gerolamino on this site";
                void this.refresh();
                return;
        }
        this.render();
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
        if (this.open) this.placePanel();
        if (this.compact) this.root.classList.add("compact");
        else this.root.classList.remove("compact");
        if (this.live) this.live.textContent = `${label}. ${this.detail() || ""}`.trim();
    }

    private renderPanel(): void {
        if (!this.panel) return;
        const detection = this.detection;
        const status = this.status;
        const mk = (tag: string, cls: string, text?: string, part?: string): HTMLElement => {
            const node = document.createElement(tag);
            node.className = cls;
            if (part) node.setAttribute("part", part);
            if (text != null) node.textContent = text;
            return node;
        };
        const fmt = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString("en-US"));
        // "preview" alone is ambiguous to a reader; these are testnets.
        const networkLabel = (network: string | null | undefined): string | null =>
            !network ? null : network === "preview" || network === "preprod" ? `${network} testnet` : network;

        const parts: HTMLElement[] = [];

        // Title: never repeat the name, and say what is wrong instead of showing a version number.
        const name = detection?.name && detection.name.trim().toLowerCase() !== "gerolamino" ? ` · ${detection.name.trim()}` : "";
        const header = mk("div", "title", detection?.status === "absent"
            ? "Gerolamino is not installed"
            : detection?.status === "incompatible"
                ? "Gerolamino version mismatch"
                : `Gerolamino${name}`, "title");
        header.id = "gc-title";
        parts.push(header);

        const enabled = !!this.session || detection?.enabled === true;
        const subtitle = mk("div", "sub", detection?.status === "absent"
            ? "Install the extension, then reload this page."
            : detection?.status === "incompatible"
                ? detection.detail
                : [networkLabel(status?.network), enabled ? status?.state ?? (this.session ? "connected" : "awaiting status") : "not approved on this site"]
                    .filter(Boolean).join(" · "), "subtitle");
        parts.push(subtitle);

        if (detection?.status === "present") {
            // One number that matters, as a meter rather than a wrapped sentence.
            if (status?.syncPercent != null) {
                const meter = mk("div", "meter", undefined, "meter");
                const bar = mk("div", "meter-bar");
                const fill = mk("div", "meter-fill");
                fill.style.width = `${Math.min(100, Math.max(0, status.syncPercent))}%`;
                const stateName = (status.state ?? "").toLowerCase();
                const pct = status.syncPercent;
                fill.style.background = stateName === "error" || stateName === "stopped"
                    ? "var(--gc-bad)"
                    : stateName === "at-tip" || pct >= 99.5
                        ? "var(--gc-ok)"
                        : "var(--gc-warn)";
                bar.append(fill);
                const label = mk("div", "meter-text", `${status.syncPercent.toFixed(1)}% synced · tip ${fmt(status.tipSlot)} / peer ${fmt(status.peerSlot)}`);
                meter.append(bar, label);
                parts.push(meter);
            }

            const grid = mk("div", "grid", undefined, "facts");
            const row = (key: string, value: string) => {
                grid.append(mk("span", "k", key, "row-key"), mk("span", "v", value, "row-value"));
            };
            if (status?.tipHeight != null) row("block", fmt(status.tipHeight));
            if (status?.tipHash) row("hash", `${status.tipHash.slice(0, 10)}…`);
            const version = detection.apiVersion ? `v${detection.apiVersion}` : "—";
            const dappApi = detection.dappApiVersion ? ` · dapp ${detection.dappApiVersion}` : "";
            row("api", `${version}${dappApi}`);
            if (detection.build) row("build", detection.build);
            if (!status && enabled) row("status", "waiting for the first verified block");
            if (grid.childElementCount) parts.push(grid);

            // Trust rows as chips: each one is a datum with a tone, not a paragraph.
            if (status?.trustRows?.length) {
                const chips = mk("div", "chips", undefined, "trust");
                for (const r of status.trustRows) {
                    const tone = (r.tone ?? "").toLowerCase();
                    const chip = mk("span", `chip${tone === "ok" || tone === "warn" || tone === "bad" ? ` ${tone}` : ""}`, undefined, "chip");
                    chip.append(mk("span", "dot", undefined, "chip-dot"));
                    chip.append(mk("span", "chip-key", r.label ?? r.key ?? ""));
                    chip.append(mk("span", "chip-val", r.value ?? ""));
                    chips.append(chip);
                }
                parts.push(chips);
            }

            const badges = mk("div", "badges", undefined, "badges");
            if (detection.needsReload) badges.append(mk("span", "badge warn", "legacy contract · reload the extension", "badge"));
            if (this.localOff) badges.append(mk("span", "badge dim", "off for this page · site still approved", "badge"));
            if (badges.childElementCount) parts.push(badges);
        }

        const actions = mk("div", "actions", undefined, "actions");
        const foreign = this.foreignApproval != null && Date.now() < this.foreignApproval.until;
        if (detection?.status === "present" && !this.session) {
            const connect = mk("button", "connect", foreign ? "approval open in another tab" : this.busy ? "connecting..." : "Connect Gerolamino", "button connect") as HTMLButtonElement;
            connect.type = "button";
            connect.disabled = this.busy || foreign;
            connect.title = foreign
                ? "Another tab is showing the Gerolamino approval window for this site"
                : "Open one Gerolamino approval window for this site";
            connect.addEventListener("click", () => void this.connect());
            actions.append(connect);
        }
        if (this.session) {
            const action = disconnectAction(this.session.capabilities);
            const disconnect = mk("button", "disconnect", this.busy ? "..." : action.label, "button disconnect") as HTMLButtonElement;
            disconnect.type = "button";
            disconnect.title = action.mode === "local"
                ? "This build exposes no page-callable revoke: the connector stops here, the site stays approved"
                : `Revoke this site's Gerolamino approval through ${action.revokeMethod}()`;
            disconnect.disabled = this.busy;
            disconnect.addEventListener("click", () => void this.disconnect());
            actions.append(disconnect);
        }
        if (actions.childElementCount) parts.push(actions);

        const note = this.notice || this.detail();
        if (note) parts.push(mk("div", "notice", note, "notice"));

        const footer = mk("div", "footer", undefined, "footer");
        footer.append(mk("span", "hint", "Reads and submits go through this extension, not a localhost port.", "hint"));
        const close = mk("button", "close", "✕", "button close") as HTMLButtonElement;
        close.type = "button";
        close.setAttribute("aria-label", "Close Gerolamino panel");
        close.addEventListener("click", () => this.closePanel());
        footer.append(close);
        parts.push(footer);

        this.panel.replaceChildren(...parts);
    }

    /**
     * Keep the panel inside the viewport. It is anchored to the trigger's right edge by default; when that
     * would push it off the left of the screen (widget near the page edge), anchor it to the left instead.
     */
    private placePanel(): void {
        const panel = this.panel;
        if (!panel) return;
        panel.style.left = "";
        panel.style.right = "0px";
        const rect = panel.getBoundingClientRect();
        if (rect.width > 0 && rect.left < 8) {
            panel.style.right = "auto";
            panel.style.left = "0px";
        }
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
        if (state === "idle" || state === "connecting" || state === "handshake" || state === "anchoring" || state === "syncing") return "var(--gc-warn)";
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

    /** Opt out of cross-tab sharing: no BroadcastChannel is opened, polling/logic stay tab-local. */
    disableTabSync(): void {
        this.noTabSync = true;
        this.tabSync?.close();
        this.tabSync = null;
        this.foreignApproval = null;
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
    if (options.tabSync === false) element.disableTabSync();
    return element;
}

export function registerGerolaminoConnect(tagName = GerolaminoConnectElement.tagName): void {
    if (typeof customElements === "undefined" || customElements.get(tagName)) return;
    customElements.define(tagName, GerolaminoConnectElement);
}
