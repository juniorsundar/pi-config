# Issue 0022: Handle BTW timeout and cancellation lifecycle

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Make the BTW Process lifecycle bounded and cancel-safe. Hung side-questions are terminated after the configured timeout, explicit aborts terminate only the targeted BTW Process, and main-session interruption does not accidentally kill running BTW Processes.

### Acceptance criteria

- [ ] A BTW Process is terminated when it exceeds the configured timeout
- [ ] Timeout termination first requests graceful exit, then force-kills if the process does not exit within the grace period
- [ ] Timeout results appear as BTW error results with a clear message
- [ ] An explicit abort signal terminates the BTW Process and returns an error result
- [ ] Cancelling or interrupting the main-session turn does not terminate unrelated running BTW Processes
- [ ] Process listeners and timers are cleaned up after success, failure, timeout, and abort
- [ ] Tests cover timeout, force-kill fallback, abort, successful cleanup, and failure cleanup

### Blocked by

- Issue 0020 — needs the core BTW Process spawning and result parsing path
