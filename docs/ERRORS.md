# Error taxonomy

Every connector failure is a `GerolaminoError` (or a subclass). Switch on `error.kind`, not on message
text and not on `apiVersion`. `error.code` stays the CIP-30 numeric code and is only set when the
extension or a wallet refusal supplied one.

## Shape

```ts
interface GerolaminoErrorShape {
    name: string;                      // class name, e.g. "GerolaminoHttpError"
    kind: GerolaminoErrorKind;         // stable taxonomy, switch on this
    message: string;
    info: string;                      // CIP-30 info string when present
    code: number | null;               // CIP-30 numeric code when present
    status: number | null;             // HTTP status when the failure came from an answer
    path: string | null;               // Blockfrost path that failed
    blockfrostBody: unknown;           // the body the node/peer returned, untouched
    requestId: string | null;          // connector correlation id; quote it in support reports
    cause?: string;                    // original error message, when wrapped
}
```

`JSON.stringify(error)` returns exactly this (`toJSON` is implemented), so one log line is enough.

```ts
try {
    await session.provider.json("/addresses/" + address);
} catch (e) {
    const shape = e as GerolaminoErrorShape;
    if (shape.kind === "GATEWAY_SILENT") showBackoff();
    console.error(JSON.stringify(shape));   // kind, status, path, requestId
}
```

## Kinds

| kind | Class | Meaning | Typical fix |
|---|---|---|---|
| `NOT_INSTALLED` | `GerolaminoNotInstalledError` | `window.cardano.gerolamino` is missing | install the extension |
| `INCOMPATIBLE` | `GerolaminoIncompatibleError` | provider exists but the shape/version is unusable | reload or update the extension |
| `REFUSED` | `GerolaminoError` (`code` set) | user refused approval, CIP-30 code attached | ask again after a user action |
| `TIMEOUT` | `GerolaminoTimeoutError` | a call did not answer in time (`label`, `timeoutMs`) | retry, then treat as silent |
| `GATEWAY_SILENT` | `GerolaminoGatewaySilentError` | approved, but the node answered nothing (rejected call or literal 503) | retry with backoff; do not fall back silently |
| `HTTP_ERROR` | `GerolaminoHttpError` | the node answered a non-200 Blockfrost status | read `status` + `blockfrostBody` |
| `INVALID_REQUEST` | `GerolaminoError` | connector rejected local input (bad hex, bad path, bad submit answer) | fix the caller |
| `NETWORK_MISMATCH` | `GerolaminoNetworkMismatchError` | reserved for callers that throw on `assertNetwork()` mismatch | call `assertNetwork()` and branch on `ok` |
| `REVOKE_FAILED` | `GerolaminoError` | a page-callable revoke existed but failed | point the user at Gerolamino Settings |
| `UNKNOWN` | `GerolaminoError` | unclassified | log `requestId` and report |

`GATEWAY_SILENT` is the official code for "connected but the node is not answering". Do not invent your
own 503 semantic: a literal 503 answer from the node maps to `GATEWAY_SILENT` with `status: 503`.

## Notes

- `assertNetwork()` reports, it does not throw. Branch on `{ ok, expected, actual, detail }`.
- `createGerolaminoFetch()` keeps a fetch shape: failures become 503/502/400/405 responses whose JSON body
  carries `kind` and `request_id`, so a Blockfrost SDK can surface them without the connector leaking
  classes.
