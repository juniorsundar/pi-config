# Future Work

## pi-subagents: complete the spawn handshake (load-order safety)

**Repo:** `git/github.com/juniorsundar/pi-subagents` (external)
**File:** `src/index.ts`
**Status:** Not yet addressed

### Context

`deep-research` (consumer) and `pi-subagents` (provider) coordinate the
`spawnSubagent` function over the shared `pi.events` event bus. The
handshake is currently half-implemented:

- `deep-research` (`extensions/deep-research/index.ts`) emits
  `"subagents:spawn:request"` at init and listens for
  `"subagents:spawn:provide"`. ✅
- `pi-subagents` (`src/index.ts`) emits `"subagents:spawn:provide"` at
  init (with a graceful-degrade guard around `pi.events.emit`). ✅
- `pi-subagents` does **not** listen for `"subagents:spawn:request"`. ❌

As a result, the load-order-safety scenario is not actually covered
end-to-end: when `pi-subagents` loads *after* `deep-research`, the
consumer's request goes unhandled and no spawner is provided. The
`deep-research` test only asserts the request is emitted, not that the
provider responds.

### Fix

Add a `"subagents:spawn:request"` listener in
`git/github.com/juniorsundar/pi-subagents/src/index.ts`, immediately
after the existing `provide` emit (~line 432), that re-emits
`"subagents:spawn:provide"` with the same `spawnSubagent`. Use the
same graceful-degrade pattern already used for `emit`:

```ts
// Respond to late-loading consumers: if a consumer (e.g. deep-research)
// emits a request after we already published, re-publish the provider.
const on = (pi as ExtensionAPI & {
  events?: { on?: (event: string, handler: (data: unknown) => void) => void };
}).events?.on;
if (typeof on === "function") {
  on("subagents:spawn:request", () => {
    if (typeof emit === "function") emit("subagents:spawn:provide", spawnSubagent);
  });
}
```

- ~6-8 lines, no new dependencies, no signature changes, idempotent.
- Run the `pi-subagents` test suite after the edit to confirm no
  regressions.

### Related

- `extensions/deep-research/index.ts` — emits
  `"subagents:spawn:request"` with `{ requester: "deep-research" }` at
  init (added alongside the test fix that unblocked the suite).
- `extensions/deep-research/index.test.ts` — "succeeds when pi-subagents
  loads after deep-research (request triggers provide)" asserts the
  request is emitted; a follow-up assertion could verify the provider
  re-emits `provide` once the listener exists.