# Gerolamino connector

Framework-neutral connector for the Gerolamino browser extension. It detects the extension without
prompting, opens one approval window per site when asked to connect, exposes the node's verified tip and
Trust card, and gives a Blockfrost-shaped transport over `window.cardano.gerolamino`.

Gerolamino is not a wallet. The connector holds no keys and does not sign; `submitTx` forwards a transaction
a wallet already signed. It works without a framework: the browser entry supplies a vanilla custom element,
and the headless core is plain TypeScript.

## Current contract

The connector targets the Gerolamino extension's CIP-30-shaped initial API:

| Field or method | Meaning |
|---|---|
| `name` | `"Gerolamino"` |
| `apiVersion` | `"1"` for the current extension; legacy `"0.1.0"` is accepted by default |
| `dappApiVersion` | `"0.1.0"` (displays the extension's own API version) |
| `isWallet` | `false` |
| `isEnabled()` | non-prompting approval probe |
| `enable()` | one approval window per site; returns the api |
| `query(path)` | Blockfrost GET with `{ status, body, source, peer, proof, ledger }` |
| `submitTx(hex)` | forwards a signed transaction; answers `{ txid, source, acceptedAt, peer?, requestId, legacyShape }` |
| `getTip()` | newest verified block (`slot, height, hash, network, state, peerTip`) |
| `getTrust()` | Trust card verdict and rows |

The connector does not require wallet methods and never calls `enable()` during detection. A Gerolamino
extension build may report `apiVersion: "0.1.0"` as the older shipped shape; pass `allowLegacyApiVersion:
false` to require `"1"` only.

## Install

```bash
npm install @harmoniclabs/gerolamino-connector
```

The package is built as ESM; use it from a bundler or modern browser page.

## Headless use

```ts
import { connectGerolamino, detectGerolamino } from "@harmoniclabs/gerolamino-connector";

const found = await detectGerolamino();          // never prompts
if (found.status === "absent") throw new Error("install Gerolamino first");
if (found.status === "incompatible") throw new Error(found.detail);

const session = await connectGerolamino();        // one approval window per site
const tip = await session.getTip();
const trust = await session.status();
const answer = await session.provider.get("/blocks/latest");
if (answer.status === 200) console.log(answer.body, answer.source);
```

`GerolaminoSession` exposes:

- `api`: the enabled extension api.
- `provider`: Blockfrost transport (`get`, `json`, `getAllPages`, `submitTx`).
- `getNetworkId()`, `getTip()`, `getTrust()`, `status()`, `query()`, `submitTx()`, `submitTxId()`.
- `capabilities` / `getCapabilities()`: what the enabled api can actually do, plus `needsReload` and
  `submitProvenance`. Branch on these instead of comparing `apiVersion` strings.
- `assertNetwork("preview")`: `{ ok, expected, actual, detail }`. It compares the node's **reported network
  name** first and only derives a magic from that name; a CIP-30 `networkId` (0 testnet / 1 mainnet) is a
  different identifier and is never compared against a magic. With a name it is exact; with only a CIP-30 id
  it answers `ok: false` and says preprod/preview cannot be split rather than guessing. Contradictions
  (name says preview, id says mainnet) are reported, not resolved. It never throws.
- `close()`: uses a future extension revoke/disable method when present; otherwise reports a local-only
  close. The current extension exposes no page-callable revoke. The user can revoke this site in
  Gerolamino Settings -> Connected sites.

The connector keeps response provenance fields out of the body, exactly as `query()` returns them:
`source: "local" | "relay"`, `peer`, `proof`, and `ledger`. `status().identity` carries the connector
version, the extension's `apiVersion`/build id, and the network id, so a screenshot is enough to triage.

## Submit provenance

`submitTx()` says which path carried the transaction instead of leaving you to infer it:

```ts
const submitted = await session.submitTx(signedCborHex);
// { txid, source: "local" | "relay" | "unknown", acceptedAt, peer, requestId, legacyShape }
if (submitted.legacyShape) console.warn("extension returned a bare txid: reload to get provenance");
```

`source: "unknown"` is honest: the installed extension answered with a bare string. `submitTxId()` is the
same call without provenance.

## Errors

Every failure is a `GerolaminoError` with `kind`, `status`, `path`, `blockfrostBody`, and `requestId`, and
`JSON.stringify(error)` yields the whole shape. Switch on `kind`:

```ts
catch (e) {
    const err = e as GerolaminoError;
    if (err.kind === "GATEWAY_SILENT") backOff();   // approved, node answering nothing
    console.error(JSON.stringify(err));
}
```

`GATEWAY_SILENT` is the official code for "connected but the node is not answering"; do not invent a
private 503 semantic. The full table is in [`docs/ERRORS.md`](./docs/ERRORS.md).

## Typed reads

Path-string typos were the first consumers' most common integration bug, so the session ships typed reads
that validate their identifier before it becomes a path segment:

```ts
const utxos = await session.addressUtxos(address);        // [] when the address has never been on chain
const params = await session.protocolParameters();        // /epochs/latest/parameters
const asset = await session.asset(unit);                  // null on 404
const tx = await session.tx(hash);                        // 64-hex hash enforced
const rows = await session.queryAll<Item>("/assets/{unit}/addresses");
```

Full set: `addressUtxos`, `addressTransactions`, `addressTotal`, `asset`, `assetAddresses`, `tx`, `txUtxos`,
`scriptCbor`, `blockLatest`, `protocolParameters`, `genesis`, `queryAll`. Missing data is `[]`/`null` by
default (a fresh address is not an error); pass `{ onMissing: "throw" }` when absence is a fault. Any other
non-200, including 500, always throws. Validators are exported: `assertAddress`, `assertTxHash`,
`assertScriptHash`, `assertAssetUnit`.

### History window (relay snapshots)

A relay bootstrapped from a Mithril snapshot answers from the snapshot's ledger state, and its transaction
index may not cover pre-snapshot history yet. So `tx(hash)` -> `null` can mean "not in this relay's index",
not only "never happened". For recent activity and chained-withdraw polling this is fine; for historical
lookups treat `null` as unproven and fall back to an explorer index. `provider.get()` gives you
`status` + `requestId` when you need to log which case it was.

## Ex-units note

`session.evaluateTx(cbor, { version, additionalUtxos })` exists, but it throws `NOT_SUPPORTED` on every
current build: the Gerolamino extension exposes no `evaluate` dApp method, so a page cannot reach the node's
`POST /utils/txs/evaluate`. `capabilities.canEvaluate` is the feature flag to branch on. Keep a Blockfrost
side channel for evaluation until the extension adds the method.

## Disconnect is honest

Gerolamino exposes no page-callable revoke today, so "Disconnect" would be a lie. The session reports
what actually happened instead of a boolean you have to guess:

```ts
const result = await session.close();
// { mode: "extension" | "local", revoked: boolean, verified: boolean, api?: string, method, message }
```

- `revoked: true` only when a revoke actually ran: the enabled api's `revoke()` (Gerolamino 0.3.0+), else an
  extension revoke/disable method.
- `verified: false` when that method resolved without confirming (the silent no-op case): the message says
  the site may still be approved.
- `mode: "local"` means nothing was revoked: the connector is off for this page only, the site stays
  approved. The message points at Gerolamino Settings -> Connected sites.

`disconnectAction(session.capabilities)` gives the control its label: `"Revoke approval"` when a revoke
exists, `"Stop using Gerolamino on this site"` when it does not. The element uses it.

## Cross-tab behaviour

Several tabs of the same origin used to poll independently and could each open their own approval window.
`createGerolaminoTabSync()` broadcasts over a `BroadcastChannel` scoped by the browser to the origin:

- detection snapshots are shared, so a tab reuses a fresh one (`< 5 s`) instead of probing again;
- `beginApproval()` / `endApproval()` gives one approval window per origin: other tabs disable their
  Connect button and say "approval open in another tab";
- `connected` / `disconnected` transitions propagate, so the other tabs re-read instead of guessing.

Payloads are validated before use (`parseTabEvent`), the sender never receives its own message, stale
locks expire (approval 60 s, detection 120 s), and a missing `BroadcastChannel` degrades to a no-op.
The element enables it by default and pauses polling while the tab is hidden, resuming with a jittered
delay: `createGerolaminoConnect({ tabSync: false })` or `element.disableTabSync()` opts out.

## Browser element

Include the standalone build once, then use the element in any framework or plain HTML:

```html
<script src="/dist/ui/standalone.global.js"></script>
<gerolamino-connect poll="5"></gerolamino-connect>
```

`poll` is the detection refresh interval in seconds; `poll="0"` disables polling. `label`, `compact`, and
`hide-when-absent` are optional presentation attributes. The element dispatches `gerolamino:connected`,
`gerolamino:status`, `gerolamino:disconnected`, and `gerolamino:error` custom events.

### Theming

The element no longer forces its own look. Set these custom properties on the element (or any ancestor):

| Property | Purpose |
|---|---|
| `--gerolamino-accent` | accent/primary colour |
| `--gerolamino-panel` | panel background |
| `--gerolamino-text` | foreground text |
| `--gerolamino-muted` | secondary text, caret, notices |
| `--gerolamino-border` | borders |
| `--gerolamino-ok` / `-warn` / `-bad` | status tones |
| `--gerolamino-radius` | corner radius (px value, e.g. `12px`) |
| `--gerolamino-font` | `font` shorthand for the whole element |

The legacy `--gc-*` names still work and now default to the `--gerolamino-*` values, so existing overrides
keep applying. For structural changes the element exposes `::part()` hooks:

`trigger`, `dot`, `label`, `caret`, `panel`, `title`, `subtitle`, `meter`, `facts`, `row-key`, `row-value`,
`trust`, `chip`, `chip-dot`, `badges`, `badge`, `notice`, `actions`, `button`, `connect`, `disconnect`,
`close`, `footer`, `hint`, `live`.

```css
gerolamino-connect::part(panel) { width: 380px; }
gerolamino-connect::part(button) { font-weight: 600; }
```

### What the panel shows

One line of identity (`Gerolamino` plus the network and state), one sync meter with the two tip numbers, a
four-row fact grid (block, hash, api + dapp version, build), the trust rows as a labelled list with a tone
per row, then the action. Warnings (`legacy contract`, `off for this page`) are badges, not buried sentences.
The panel is clamped to the viewport: it opens right-aligned and flips to left-aligned when the widget sits
near the left edge.

### Accessibility

The panel is a `role="dialog"` labelled by its title: opening it focuses the first action, `Tab` wraps
inside the panel, `Escape` closes it and returns focus to the trigger, and a polite `role="status"` live
region announces status changes. The trigger carries `aria-haspopup`, `aria-expanded`, and
`aria-controls`. There is no focus-trap escape hatch by design: a second click on the trigger always closes.

For framework wrappers, use the ESM UI entry:

```ts
import { createGerolaminoConnect, registerGerolaminoConnect } from "@harmoniclabs/gerolamino-connector/ui";

registerGerolaminoConnect();
const element = createGerolaminoConnect({ label: "Connect node", pollMs: 5_000 });
document.querySelector("#app-bar")?.append(element);
```

## Blockfrost SDK shape

```ts
import { createGerolaminoProvider } from "@harmoniclabs/gerolamino-connector";

const provider = createGerolaminoProvider(session.api);
const utxos = await provider.json("/addresses/addr_test1.../utxos");
```

The provider normalizes `/api/v0` prefixes and accepts paging (`count`, `page`, `order`). `getAllPages`
stops at the first short page and caps `count` at 100 (Blockfrost's maximum). It has no runtime dependency
on a Gerolamo node package.

## Build and verify

```bash
bun install
bun run typecheck
bun test
bun run build
bun run smoke
```

`bun run build` produces ESM core/UI bundles, an auto-registering IIFE, and TypeScript declarations under
`dist/`. Runtime bundles must stay free of Node built-ins and third-party runtime dependencies.

The demo is `examples/connect-demo.html`. Open it with `?stub` to exercise the UI against a fake provider.

## Contract notes

- Detection is prompt-free: presence, `needsReload`, and `isEnabled()` only.
- Approval happens only through the explicit `connect()`/Connect button.
- The extension takes the site origin from the browser, never from the page.
- The current extension rate limit is 60 calls per 10 seconds per site.
- `apiVersion` drift is reported, not hidden: current `"1"`, legacy `"0.1.0"` is accepted and flags
  `needsReload`; incompatible versions are `status: "incompatible"` with `needsReload: true`.
- The connector's own version is `CONNECTOR_VERSION`; the package version is the release contract.
- `getTrust()` is optional; `status()` returns null when the node has no verified tip.
- No wallet methods, no CIP-8 signing, no keys.

## License

MIT.
