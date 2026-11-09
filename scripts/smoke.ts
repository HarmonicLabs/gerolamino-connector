/**
 * A non-browser smoke pass over the connector's contract with a fake Gerolamino provider.
 * It proves detection, explicit approval, Blockfrost transport, submit provenance, network assertion,
 * the typed error shape, status identity, and a local-only close.
 */
import {
    closeGerolamino,
    connectGerolamino,
    CONNECTOR_VERSION,
    detectGerolamino,
    GerolaminoGatewaySilentError,
    hasGerolamino,
    type GerolaminoApi,
    type GerolaminoExtension,
    type GerolaminoWindowLike
} from "../src/core/index";

const api: GerolaminoApi = {
    query: async (path: string) => ({ status: 200, body: { path, demo: true }, source: "local" }),
    submitTx: async (hex: string) => ({ txid: `txid-${hex.slice(0, 8)}`, source: "local" }) as any,
    getNetworkId: async () => 2,
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
    build: "smoke-build",
    isEnabled: async () => enabled,
    enable: async () => { enabled = true; return api; }
};
const win: GerolaminoWindowLike = { cardano: { gerolamino: extension } };

const detection = await detectGerolamino({ win });
if (detection.status !== "present" || !hasGerolamino(win)) throw new Error("detect failed");
if (detection.needsReload) throw new Error("current contract must not ask for a reload");
if (detection.build !== "smoke-build") throw new Error("build id not passed through");
console.log(`gerolamino-connector ${CONNECTOR_VERSION}: detection ${detection.detail}`);

const session = await connectGerolamino({ win });
const answer = await session.provider.get("/blocks/latest");
if (answer.status !== 200 || answer.source !== "local") throw new Error("transport failed");
if (!answer.requestId) throw new Error("transport answer has no requestId");
const tip = await session.getTip();
if (tip.network !== "preview" || tip.state !== "at-tip") throw new Error("tip failed");
const status = await session.status();
if (!status || status.verdict !== "verified" || status.syncPercent !== 100) throw new Error("status failed");
if (status.identity.connectorVersion !== CONNECTOR_VERSION || status.identity.networkId !== 2) throw new Error("status identity failed");

// Submit provenance: the connector must say which path carried the transaction.
const submitted = await session.submitTx("abcdef");
if (submitted.txid !== "txid-abcdef" || submitted.source !== "local" || submitted.legacyShape) throw new Error("submit provenance failed");
if (!session.capabilities.submitProvenance) throw new Error("submitProvenance flag not raised");

// Network assertion: preview magic is 2, preprod is 1.
const onPreview = await session.assertNetwork("preview");
if (!onPreview.ok) throw new Error(`assertNetwork(preview) failed: ${onPreview.detail}`);
const onPreprod = await session.assertNetwork("preprod");
if (onPreprod.ok) throw new Error("assertNetwork(preprod) must fail on a preview node");

// Error taxonomy: a silent node is GATEWAY_SILENT with triage fields, not an anonymous 503.
const silent = new GerolaminoGatewaySilentError("port closed", { path: "/blocks/latest", requestId: "grl-smoke" });
const shape = JSON.parse(JSON.stringify(silent));
if (shape.kind !== "GATEWAY_SILENT" || shape.status !== 503 || shape.path !== "/blocks/latest" || shape.requestId !== "grl-smoke") {
    throw new Error(`error shape failed: ${JSON.stringify(shape)}`);
}

const close = await closeGerolamino(session);
if (close.mode !== "local") throw new Error("close failed");

console.log(JSON.stringify({
    status: "PASS",
    detection: { status: detection.status, enabled: detection.enabled, legacy: detection.legacyVersion, needsReload: detection.needsReload, build: detection.build },
    capabilities: session.capabilities,
    answer: { status: answer.status, source: answer.source, requestId: answer.requestId },
    submit: submitted,
    network: { preview: onPreview.ok, preprod: onPreprod.ok, detail: onPreprod.detail },
    nodeStatus: { state: status.state, verdict: status.verdict, syncPercent: status.syncPercent, identity: status.identity },
    errorShape: shape,
    close
}, null, 2));
