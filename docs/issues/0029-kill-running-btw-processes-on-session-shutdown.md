# Issue 0029: Kill running BTW Processes on session shutdown

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Ensure BTW Processes do not outlive the pi session that spawned them. When the session shuts down, all running BTW Processes are terminated and recorded consistently so no orphan side-question processes linger after exit.

### Acceptance criteria

- [ ] The BTW extension registers a session-shutdown lifecycle handler when supported by the extension API
- [ ] Session shutdown requests termination of all running BTW Processes
- [ ] Shutdown termination uses the registry kill-all behavior
- [ ] Terminated BTW Processes do not remain in the running state
- [ ] Repeated shutdown handling is safe and idempotent
- [ ] Shutdown handling does not terminate already-completed BTW results
- [ ] Tests cover shutdown with no running processes, one running process, multiple running processes, repeated shutdown, and completed-result preservation

### Blocked by

- Issue 0023 — needs BTW registry kill-all behavior
