# Cancellation UX with Escape and State Preservation

### Parent

PRD `0007-deep-research` — Deep Research multi-turn research workflow

### What to build

Improve the Escape-key cancellation experience for deep research. The `ctx.signal` (AbortSignal) is already passed to `spawnSubagent()`, so pressing Escape kills the current subagent. But the command handler doesn't explicitly handle abort: no cleanup message, no state preservation, and no user-facing feedback. When the user presses Escape mid-research, the handler should catch the abort signal, update `state.md` with a "## Status\ninterrupted" note including the iteration number and last-completed step, send a cancellation message via `ctx.ui.notify()`, and exit cleanly — leaving the research directory intact so the user can inspect partial results.

### Acceptance criteria

- [ ] When the user presses Escape during a running deep-research session, the current subagent is aborted (already works via `ctx.signal`), and the command handler catches the abort
- [ ] On abort, `state.md` is updated with "## Status\ninterrupted" and a note about which iteration and step was interrupted
- [ ] On abort, the user sees a clear notification: "Deep research interrupted at iteration N. Partial results saved to .pi/deep-research/<slug>/"
- [ ] The research directory (state.md + steps/) is preserved for manual inspection after cancellation
- [ ] No unhandled promise rejections or dangling processes after cancellation
- [ ] All existing and new tests pass

### Blocked by

- 0003-error-recovery-and-resilience-in-the-loop (needs error-recovery patterns in place for consistent abort handling)
