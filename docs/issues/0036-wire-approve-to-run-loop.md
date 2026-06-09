# Issue 0036: Wire /research approve to the Research Run loop

### Parent

PRD: `docs/prd/0005-pi-native-deep-research.md`

ADR: `docs/adr/0002-pi-native-research-orchestrator.md`

### What to build

Type: AFK.

The Research Run loop (`executeResearchRun` in `run-loop/run-loop.ts`) was built and tested in isolation (Issue 0026), and the `/research approve` command was built (Issue 0025). However, the two were never connected: `/research approve` transitions the run to `running` status, copies the proposal into the run directory, and returns — but never invokes `executeResearchRun`. The run sits forever in `running` with no artifacts produced.

Additionally, `RunLoopOptions` was designed as an injection seam (`source-access.ts` stubs return empty arrays and placeholder content), but no issue specified building real search/fetch adapters that connect to Pi's web-search and fetch capabilities, despite PRD story #54 ("I want to use Pi-style web search and fetch behavior in v1"). The integration tests in `run-loop.test.ts` pass with mock options, but the production path has no implementation.

This issue closes both gaps:

1. Wire `/research approve` (for blocking mode) to invoke `executeResearchRun` after successful activation.
2. Build real `RunLoopOptions` adapters that use `pi.exec` to invoke the web-search extension's Python scripts.

User stories covered: 41, 54.

### Acceptance criteria

- [ ] After `/research approve` activates a blocking-mode run, `executeResearchRun` starts as a background promise
- [ ] The command handler returns before the run loop finishes (non-blocking to the TUI)
- [x] `pi.sendMessage` delivers a completion notification (brief path, source note count, round count) when the run finishes
- [x] `pi.sendMessage` delivers an error notification and the run is marked `interrupted` if the loop throws
- [x] `RunLoopOptions` is built from real `pi.exec` calls that invoke the web-search extension's Python scripts
- [x] Type mapping is correct: web-search `{href, body}` → source-access `{url, snippet}`, `FetchResponse` → `FetchedSource`
- [x] `executeResearchRun` receives the correct `Budget` built from the proposal's budget limits with sensible defaults
- [x] The shared `BrainFactory` type and `defaultBrainFactory` are extracted from `command.ts` and `tool.ts` to a common module
- [x] All existing tests continue to pass

### Blocked by

- Issue 0025 — needs approved Research Runs.
- Issue 0026 — needs the run loop implementation.
