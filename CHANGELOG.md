# Changelog

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
