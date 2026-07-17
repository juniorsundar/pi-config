# Future Work

## my-pi-mono: drop the spawn event-bus handshake (direct import)

**Status:** ✅ Done — resolved by wayfinder ticket
[#0007 — Drop the spawn event-bus handshake](.wayfinder/issues/0007-drop-spawn-handshake.md).

`deep-research` now imports `spawnSubagent` (and `SpawnSubagentResult`)
directly from the `extensions/subagents/index.ts` barrel. The
`subagents:spawn:provide` / `subagents:spawn:request` event-bus
handshake, deep-research's structural `SpawnSubagentFunction` mirror
type, the mutable `let spawnSubagent` provider slot, and the
`resetSpawnSubagentForTest` helper are all removed; the
`subagents:spawn:provide` emit on the subagents side is removed too.
ES-module dependency resolution establishes the imported binding
before either extension initializer runs, so load order no longer
matters. `npm run typecheck` exit 0; full suite (706 tests) passes;
`pi --print` starts clean.