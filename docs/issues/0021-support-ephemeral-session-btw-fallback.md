# Issue 0021: Support ephemeral-session BTW fallback

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Let BTW work in ephemeral sessions where no session file can be forked. A user can still ask a side-question; the BTW Process runs without conversation history, preserves the same safety restrictions, and returns a normal BTW result or error result.

### Acceptance criteria

- [ ] BTW detects when there is no session file to fork
- [ ] In ephemeral sessions, the BTW Process starts without attempting to fork a session
- [ ] Ephemeral BTW Processes still run in JSON mode
- [ ] Ephemeral BTW Processes still exclude edit and write tools
- [ ] Ephemeral BTW Processes still receive the BTW Child Guard environment flag
- [ ] Ephemeral BTW results use the same success and error result shape as forked BTW results
- [ ] Tests cover the ephemeral invocation path and verify it does not include a forked session

### Blocked by

- Issue 0020 — needs the core BTW Process spawning and result parsing path
