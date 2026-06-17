# Issue 0020: Spawn BTW Process with forked session

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`
ADR: `docs/adr/0006-btw-child-fork-process.md`

### What to build

Make BTW capable of launching an isolated BTW Process for a side-question when a session file is available. The process inherits the current conversation through a forked session, runs in JSON mode, cannot mutate files through edit/write tools, and streams enough information back for the parent extension to build a completed BTW result.

### Acceptance criteria

- [ ] A BTW Process is spawned with the current session forked rather than modifying the original session
- [ ] The child process runs in JSON mode
- [ ] The child process receives the side-question as its prompt
- [ ] The child process has edit and write tools excluded
- [ ] The child process receives the BTW Child Guard environment flag
- [ ] The BTW result captures the final assistant answer text
- [ ] The BTW result captures tool trace data from child-process events
- [ ] The BTW result captures usage stats, model, and stop reason when available
- [ ] Non-zero child exit or malformed output produces an error result instead of crashing the parent session
- [ ] Tests cover command construction, environment construction, assistant output parsing, tool trace parsing, usage parsing, and error-result creation

### Blocked by

- Issue 0018 — needs the BTW extension skeleton and command surface
- Issue 0019 — needs the BTW timeout configuration to pass into spawning
