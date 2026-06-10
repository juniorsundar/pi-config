# Progress Indicator for Deep-Research Iterations

### Parent

PRD `0007-deep-research` — Deep Research multi-turn research workflow

### What to build

Add a visible progress indicator to the deep-research command so the user knows which iteration and which subagent type is currently running. The iteration loop in `index.ts` currently uses `ctx.ui.notify()` for start and completion messages but shows nothing during each subagent's execution. Build on the existing subagent progress callback (`onProgress` in `spawnSubagent`) and the iteration counter to surface a clear, updating indicator: which iteration number (out of max), which r-* agent type is running, and elapsed time. Display via the existing `onUpdate` mechanism in the `spawn_research_subagent` tool's `execute()` handler, and also surface iteration-level progress via `ctx.ui.notify()` at each loop boundary.

### Acceptance criteria

- [ ] Before each iteration, the user sees a notification like "Deep research: iteration 3/10 — spawning r-search" via `ctx.ui.notify()`
- [ ] During subagent execution, the existing `onProgress` callback surfaces the r-* agent's activity to the TUI (already wired in `spawn_research_subagent`; verify it covers the subagent type)
- [ ] After each iteration completes, a brief summary notification is shown (e.g. "Iteration 3 complete: r-search archived")
- [ ] The progress indicator works end-to-end when running `/deep-research` — no dead UI during long subagent runs
- [ ] Existing tests continue to pass

### Blocked by

None — can start immediately
