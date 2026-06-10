# Gap Analysis: 0005-pi-native-deep-research.md

**Date**: 2026-06-09 (updated 2026-06-10)
**Subject**: [PRD 0005 — Pi-native Deep Research Extension](./0005-pi-native-deep-research.md)
**Status**: Resolved — 15 of 18 gaps closed
**Resolutions**: [PRD Amendments](./0005-prd-amendments-gap-resolutions.md), [ADR 0003](../adr/0003-agent-research-lifecycle-is-stateless.md), [CONTEXT.md](../../CONTEXT.md)

---

## Resolved Gaps (2026-06-10)

The following gaps were resolved in a grilling session and are captured in the PRD Amendments document (`0005-prd-amendments-gap-resolutions.md`). They are removed from this document to avoid duplication in future PRD work.

### Crucial gap — closed

**Agent ↔ Orchestrator lifecycle loop**: The agent research lifecycle is now defined as stateless: `propose → inform user → check status on a later turn → read_brief when terminal`. No blocking tool call, no completion notification, no auto-injection. `propose` returns additive fields (`summary`, `trigger`, `blockingMode`, `evidenceMix`, `budget`). ADR 0003 records the decision.

### Secondary gaps — closed

| # | Gap | Resolution |
|---|-----|------------|
| 1 | `recommend_resume` orphan-shaped | Kept as advisory tool; returns resumability metadata for the agent to advise the user |
| 2 | `render_view` doesn't fit agent context | Kept as advisory tool; returns file path for the agent to surface to user |
| 3 | Blocking-run synchronization | Blocking pauses the human's decision path, not the agent's tool loop |
| 4 | Run-completion notification | Agent calls `status` proactively; no notification system needed |
| 5 | `read_brief` content integration | Tool result only, no auto-injection |
| 6 | Cross-session continuity | Scoped out of v1; agent starts fresh each session |
| 7 | `add_instruction` timing | Accepted only in `running` or `queued` status |
| 8 | "Stale" for prior brief versions | Defined as structural supersession (continuation attempted after brief was written) |
| 9 | Promotion `--force` overwrites without audit | Appends override note to promoted package |
| 10 | No "weak trigger" criteria | Concept removed; triggers are valid or rejected |
| 11 | `task-triggered` undefined | Collapsed into `agent-triggered`; two modes only |
| 12 | `update_findings` maps to no glossary term | Maps to Source Note creation + `brain_analysis` ledger event; structured claim extraction v2 |
| 13 | Research Trigger has examples, not rubric | Three-criteria rubric: names decision + needs external facts + not local exploration |
| 14 | Brief task implications scope | Include when trigger/proposal context provides enough info, not agent-triggered-only |

---

## Remaining Unresolved Gaps

These gaps were not resolved in the June 10 grilling session and remain open.

### 1. Evidence-grounded synthesis readiness test is undefined

**Original gap #3.** The PRD's testing decisions say the readiness check should validate "evidence-grounded synthesis from supplied fake Source Notes" but there is no contract: what prompt, what expected output, what counts as failure. Tests cannot be written.

**Status**: Open. No test contract defined. The existing readiness probes cover JSON formatting and stop-token behavior but do not test the model's ability to handle realistic source notes and produce a synthesis. This is a testing gap — the code may be testable in theory but the contract isn't specified.

### 2. No retention/cleanup policy

**Original gap #5.** The Workspace Research Store accumulates `.pi/research/runs/*` and `.pi/research/proposals/*` indefinitely. There is no delete, archive, or expire command. Over time, abandoned proposals and failed runs will accumulate.

**Status**: Open. No cleanup mechanism exists. A future version should consider:
- A `/research prune` or `/research clean` command
- Auto-cleanup of `draft` proposals older than N days
- Retention limits on `failed` and `cancelled` runs

### 3. No test for `propose` agent-tool return contract

**Original gap #10.** Testing decisions in the PRD cover most modules (proposal manager, readiness checker, run store, budget, candidate filtering, source notes, ledger, brief renderer, human view, steering, resume, shutdown) but do not specify tests for the `deepresearch` tool's typed return shape.

**Status**: Open. The `propose` return contract is now specified (additive fields documented in PRD Amendments), but tests for those specific return keys on the tool handler are not defined. Should be a testing decision addition or a separate issue.
