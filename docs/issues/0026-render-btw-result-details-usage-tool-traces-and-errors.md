# Issue 0026: Render BTW result details, usage, tool traces, and errors

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Make expanded BTW Review entries informative and auditable. Successful results show the answer, usage, and collapsed evidence trace. Failed results appear in the same review flow with clear error information and whatever partial trace is available.

### Acceptance criteria

- [ ] Expanded successful BTW results show the question and final assistant answer
- [ ] Expanded successful BTW results show usage stats when available
- [ ] Expanded successful BTW results show model and stop reason when available
- [ ] Successful BTW results include a collapsed tool trace section when tool activity exists
- [ ] Expanded error BTW results show the question and clear error message
- [ ] Error BTW results show exit or stderr details when available
- [ ] Error BTW results include partial tool trace information when available
- [ ] Collapsed entries still distinguish success from error status
- [ ] Tests cover success rendering, error rendering, missing optional usage fields, collapsed tool traces, and partial traces on failure

### Blocked by

- Issue 0020 — needs BTW result data from child-process events
- Issue 0025 — needs the BTW Review rendering surface
