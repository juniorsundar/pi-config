# Issue 0038: `deepresearch.propose` returns richer response

### Parent

PRD Amendments: `docs/prd/0005-prd-amendments-gap-resolutions.md` (Amendment #1)

ADR: `docs/adr/0003-agent-research-lifecycle-is-stateless.md`

### What to build

Type: AFK.

When the agent calls the `deepresearch` tool with `action: "propose"`, the return shape currently includes `{status, proposal: {id, path}}`. Extend it with additive fields so the agent can tell the user what was proposed without reading `proposal.md` from disk:

```
+ summary: string          // 1-2 sentence human-readable summary of the proposed research
+ trigger: string           // the validated Research Trigger text
+ blockingMode: boolean    // whether the run will block the human's decision path on approval
+ evidenceMix: string[]    // proposed evidence categories
+ budget: {                 // proposed Research Budget limits
    maxSearches, maxFetchAttempts, maxSourceVisits,
    maxSynthesisRounds, maxModelCalls, maxRetryAttempts,
    maxElapsedSeconds
  }
```

Additionally, update the tool description to embed:
- **Research Trigger rubric**: a request qualifies as a valid Research Trigger if it (a) names a specific decision, (b) requires facts beyond the agent's training data, and (c) cannot be resolved by local codebase exploration. The regex validator in `validateTrigger()` stays as a safety net for obvious rejections.
- **Agent research lifecycle**: the lifecycle is stateless — propose → inform user → check `status` on a later turn → `read_brief` when terminal. The tool cannot approve, deny, start, resume, cancel, force synthesis, or steer runs.
- **No "weak trigger" concept**: a trigger is either valid or rejected. Human-initiated proposals bypass trigger validation entirely.

### Acceptance criteria

- [ ] `propose` returns `summary`, `trigger`, `blockingMode`, `evidenceMix`, and `budget` fields alongside existing `status` and `proposal` fields
- [ ] Existing callers (agent path, command path) continue to work — no breaking changes to the return shape
- [ ] Tool description includes the three-criteria Research Trigger rubric
- [ ] Tool description includes the stateless agent lifecycle
- [ ] "Weak trigger" references removed from tool description and related user-facing text
- [ ] Tests: `propose` handler returns all new fields; trigger validation passes for rubric-satisfying triggers, rejects local exploration/routine/curiosity triggers

### Blocked by

None — can start immediately.
