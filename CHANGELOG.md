# Changelog

## 0.4.1

Bug fix reported by Gravity against 0.3.0: `assertNetwork()` compared a CIP-30 **network id** against a
Cardano **network magic**, so `assertNetwork("preprod")` (magic 1) failed against a correct preprod node that
answers `getNetworkId() === 0`.

### Fixed

- `assertNetwork()` now keeps the two identifier domains apart:
  - the node's reported network name (`getTip().network`) is authoritative and compared by name;
  - `magic` is only derived from that name, never from a CIP-30 id;
  - a CIP-30 id alone is enough to prove **mainnet** (`1`), and is reported as unverified for a testnet
    request (`0` cannot split preprod from preview) instead of returning a wrong `ok: false` reason;
  - a contradiction between the name and the id returns `ok: false` with "refusing to guess…".
- Regression tests model the real extension (`getNetworkId()` 0/1) instead of a magic; the previous tests
  encoded the wrong assumption and are replaced.

## 0.4.0

Item 4 (styleable element) from the Mandala review: the element no longer forces its aesthetics, and it is
usable by keyboard and screen reader. No core API change.

### Added

- Theme custom properties: `--gerolamino-accent`, `-panel`, `-text`, `-muted`, `-border`, `-ok`, `-warn`,
  `-bad`, `-radius`, `-font`. The `--gc-*` names remain as aliases that default to them, so existing
  overrides still apply.
- `::part()` hooks: `trigger`, `dot`, `label`, `caret`, `panel`, `title`, `row-key`, `row-value`, `trust`,
  `notice`, `button`, `connect`, `disconnect`, `close`, `footer`, `live`.
- Dialog semantics: `role="dialog"`, `aria-modal="false"`, `aria-labelledby` -> panel title, trigger
  `aria-haspopup`/`aria-expanded`/`aria-controls`, panel `tabindex="-1"`.
- Keyboard: opening focuses the first action, `Tab`/`Shift+Tab` wrap inside the panel, `Escape` closes and
  restores focus to the trigger.
- `role="status"` `aria-live="polite"` region announcing the current label and detail.

### Testing

- `happy-dom` as a **devDependency only** (the published package still has no runtime dependency); 7 new
  element tests cover parts, dialog wiring, the live region, the theme block, open/close focus return and
  the Tab wrap.

## 0.3.0

Item 6 (typed helpers) from the Mandala review, plus the evaluate question Gravity raised. No breaking change
to 0.2.x APIs; helper identifiers are validated, so a typo becomes `INVALID_REQUEST` instead of a bad path.

### Added

- `GerolaminoReadHelpers` on the session: `addressUtxos`, `addressTransactions`, `addressTotal`, `asset`,
  `assetAddresses`, `tx`, `txUtxos`, `scriptCbor`, `blockLatest`, `protocolParameters`, `genesis`, `queryAll`.
  Same 404 discipline as `provider.get()`: missing data is `[]`/`null` by default, `{ onMissing: "throw" }`
  raises the typed HTTP error, and any other non-200 (500 included) always throws.
- Validators exported and used by every helper: `assertAddress` (one path segment, no `/ ? #`),
  `assertTxHash` (64 hex), `assertScriptHash` (56 hex), `assertAssetUnit` (56-hex policy + optional hex
  name, or `lovelace`).
- `session.evaluateTx(cbor, { version: 5 | 6, additionalUtxos? })` and `capabilities.canEvaluate`. The
  Gerolamino extension exposes no `evaluate` dApp method today, so this throws
  `GerolaminoNotSupportedError` (`kind: "NOT_SUPPORTED"`) with the reason; it uses the method automatically
  when a build starts exposing one.
- `GerolaminoNotSupportedError` and the `NOT_SUPPORTED` error kind.

### Notes

- `queryAll` is `provider.getAllPages` with the same count<=100 / short-page / `maxPages` rules.
- `evaluateTx` is a page-reachable wrapper only. The Gerolamo node already serves
  `POST /utils/txs/evaluate`; the missing piece is the extension method, not the node route.

## 0.2.1

Items 5 (tab safety) and 8 (disconnect honesty) from the Mandala review. `close()` gained fields, so this is a
minor bump rather than a patch to 0.2.0.

### Added

- `createGerolaminoTabSync()` (`src/core/tabs.ts`): origin-scoped `BroadcastChannel` sharing of detection,
  an approval lock (`beginApproval`/`endApproval`), and connect/disconnect transitions.
  `parseTabEvent()` validates every inbound payload; self-messages are ignored; approval locks expire after
  60 s and detection snapshots after 120 s; no `BroadcastChannel` means a silent no-op.
- `disconnectAction(capabilities)` → `{ mode, label, revokeMethod }`: `"Revoke approval"` vs
  `"Stop using Gerolamino on this site"`. `REVOKE_SETTINGS_HINT` is the shared "where the revoke actually
  lives" sentence.
- `interpretRevokeAnswer(answer)`: treats `undefined`/`null` as unconfirmed, not as a successful revoke.
- Element: jittered polling (±25%), no polling while the tab is hidden, immediate refresh + jittered resume
  on `visibilitychange`, a disabled Connect button while another tab holds the approval window, and the
  disconnect label from `disconnectAction()`. `tabSync: false` / `disableTabSync()` opts out.

### Changed

- `GerolaminoDisconnectResult` is now `{ mode, revoked, verified, api?, method, message }`. A local close is
  `revoked: false, verified: true` and its message says nothing was revoked; a revoke method that resolved
  without confirming is `revoked: true, verified: false`; `{ revoked: false }` from the extension is
  reported as not revoked.

## 0.2.0

Breaking, deliberately small, and driven by the Mandala integration review.

### Added

- `submitTx()` now returns provenance: `{ txid, source: "local" | "relay" | "unknown", acceptedAt, peer?, requestId, legacyShape }`.
  `submitTxId()` returns just the txid for callers that do not care. The provider normalizes both the
  legacy bare-string answer and an object answer (`txid` / `txId` / `id` / `hash`).
- Capability flags on the session: `session.capabilities` / `getCapabilities()` with
  `canQuery`, `canSubmit`, `canTip`, `canTrust`, `canNetworkId`, `supportsRevoke`, `revokeMethod`,
  `submitProvenance`, `connectorVersion`, `apiVersion`, `dappApiVersion`, `needsReload`, `build`.
  Branch on these instead of string-comparing `apiVersion`.
- `detection.needsReload` and `detection.build`. `needsReload` is true for an accepted legacy `0.1.0`
  provider and for an incompatible one: the fix is a reload/update, not a code workaround.
- `session.assertNetwork("preview" | "preprod" | "mainnet" | magic)` returning
  `{ ok, expected, actual, detail }`. Compares network magic, never a display string.
- `status().identity`: connector version, `apiVersion`, `dappApiVersion`, extension build id, network id.
  Support can triage a screenshot.
- Error taxonomy: `kind` on every error, `toJSON()` with `{ kind, code, status, path, blockfrostBody,
  requestId, cause }`, plus `GerolaminoGatewaySilentError` and `GerolaminoNetworkMismatchError`.
  `GATEWAY_SILENT` is the official "connected but the node is answering nothing" code. See `docs/ERRORS.md`.
- `requestId` on every transport answer and every failure.

### Changed

- `submitTx()` and `provider.submitTx()` return an object, not a string. Use `submitTxId()` for the old
  behaviour.
- A rejecting `query()` is reported as `GATEWAY_SILENT` (status 503) with the path and `requestId`
  instead of a bare re-thrown error.
- `createGerolaminoFetch()` failure bodies carry `kind` and `request_id`.

### Unchanged on purpose

- Gateway alias names (`hasGerolamino`, `enableGerolamino`, `gerolaminoProvider`), `detectGerolamino()`,
  `connectGerolamino()`, `query()`, `checkPath()`, the `gerolamino:*` element events. Deprecate, never rename.

## 0.1.0

First bootstrap: prompt-free detection, one approval window per origin, Blockfrost-shaped transport,
status/trust reads, local-only close.
