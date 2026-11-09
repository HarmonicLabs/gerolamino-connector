# Changelog

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
