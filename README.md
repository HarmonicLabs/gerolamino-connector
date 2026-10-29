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
| `submitTx(hex)` | forwards a signed transaction and returns its id |
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
- `getNetworkId()`, `getTip()`, `getTrust()`, `status()`, `query()`, `submitTx()`.
- `close()`: uses a future extension revoke/disable method when present; otherwise reports a local-only
  close. The current extension exposes no page-callable revoke. The user can revoke this site in
  Gerolamino Settings -> Connected sites.

The connector keeps response provenance fields out of the body, exactly as `query()` returns them:
`source: "local" | "relay"`, `peer`, `proof`, and `ledger`.

## Browser element

Include the standalone build once, then use the element in any framework or plain HTML:

```html
<script src="/dist/ui/standalone.global.js"></script>
<gerolamino-connect poll="5"></gerolamino-connect>
```

`poll` is the detection refresh interval in seconds; `poll="0"` disables polling. `label`, `compact`, and
`hide-when-absent` are optional presentation attributes. The element dispatches `gerolamino:connected`,
`gerolamino:status`, `gerolamino:disconnected`, and `gerolamino:error` custom events. It uses a shadow DOM
and accepts `--gc-accent`, `--gc-ok`, `--gc-warn`, `--gc-bad`, `--gc-panel`, `--gc-text`, `--gc-dim`, and
`--gc-border` style variables.

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

- Detection is prompt-free: presence plus `isEnabled()` only.
- Approval happens only through the explicit `connect()`/Connect button.
- The extension takes the site origin from the browser, never from the page.
- The current extension rate limit is 60 calls per 10 seconds per site.
- `apiVersion` drift: current `"1"`, legacy `"0.1.0"`; the connector accepts both by default.
- `getTrust()` is optional; `status()` returns null when the node has no verified tip.
- No wallet methods, no CIP-8 signing, no keys.

## License

MIT.
