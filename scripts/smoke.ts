/**
 * A non-browser smoke pass over the connector's contract with a fake Gerolamino provider.
 * It proves detection, explicit approval, Blockfrost transport, status, and a local-only close.
 */
import {
    closeGerolamino,
    connectGerolamino,
    CONNECTOR_VERSION,
    detectGerolamino,
    hasGerolamino,
    type GerolaminoApi,
    type GerolaminoExtension,
    type GerolaminoWindowLike
} from "../src/core/index";

const api: GerolaminoApi = {
    query: async (path: string) => ({ status: 200, body: { path, demo: true }, source: "local" }),
    submitTx: async (hex: string) => `txid-${hex.slice(0, 8)}`,
    getNetworkId: async () => 0,
    getTip: async () => ({ slot: 126_619_300, height: 9_000, hash: "blockhash", network: "preview", state: "at-tip", peerTip: { slot: 126_619_360, height: 9_001 } }),
    getTrust: async () => ({ verdict: "verified", rows: [
        { key: "signature", label: "Block signatures", value: "verified", tone: "ok" },
        { key: "freshness", label: "Freshness", value: "2s", tone: "ok" }
    ] })
};

let enabled = false;
const extension: GerolaminoExtension = {
    name: "Gerolamino",
    apiVersion: "1",
    dappApiVersion: "0.1.0",
    isEnabled: async () => enabled,
    enable: async () => { enabled = true; return api; }
};
const win: GerolaminoWindowLike = { cardano: { gerolamino: extension } };

const detection = await detectGerolamino({ win });
if (detection.status !== "present" || !hasGerolamino(win)) throw new Error("detect failed");
console.log(`gerolamino-connector ${CONNECTOR_VERSION}: detection ${detection.detail}`);

const session = await connectGerolamino({ win });
const answer = await session.provider.get("/blocks/latest");
if (answer.status !== 200 || answer.source !== "local") throw new Error("transport failed");
const tip = await session.getTip();
if (tip.network !== "preview" || tip.state !== "at-tip") throw new Error("tip failed");
const status = await session.status();
if (!status || status.verdict !== "verified" || status.syncPercent !== 100) throw new Error("status failed");
const close = await closeGerolamino(session);
if (close.mode !== "local") throw new Error("close failed");

console.log(JSON.stringify({
    status: "PASS",
    detection: { status: detection.status, enabled: detection.enabled, legacy: detection.legacyVersion },
    answer: { status: answer.status, source: answer.source, body: answer.body },
    tip: { slot: tip.slot, state: tip.state, network: tip.network },
    nodeStatus: { state: status.state, verdict: status.verdict, syncPercent: status.syncPercent, trustRows: status.trustRows.length },
    close
}, null, 2));
