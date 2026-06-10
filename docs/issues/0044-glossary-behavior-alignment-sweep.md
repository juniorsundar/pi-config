# Issue 0044: Glossary and behavior alignment sweep

### Parent

PRD Amendments: `docs/prd/0005-prd-amendments-gap-resolutions.md` (Amendments #2, #3, #6, #8, #9)

ADR: `docs/adr/0003-agent-research-lifecycle-is-stateless.md`

### What to build

Type: AFK.

Four behavior and glossary alignment changes that bring the implementation in line with the resolved domain model:

**1. Brief task implications from context availability, not trigger source**
Currently the Research Brief includes "implications for Pi or the current task" only when the run was agent-triggered (or the now-collapsed task-triggered). Change to: include task implications when the Research Trigger or proposal context provides enough information to generate them. This covers agent-triggered runs (agent always has task context) and decision-relevant human-initiated runs (e.g., "Is library X suitable for our auth layer?" gets implications; "What's the history of Rust?" does not).

**2. `update_findings` records Brain reasoning in the Claim/Evidence Ledger**
When the Research Brain returns an `update_findings` intent, the orchestrator already creates Source Notes from fetched content. Additionally, record the Brain's `reasoning` field as a `brain_analysis` Claim/Evidence Ledger event. Structured claim/contradiction/gap extraction from Brain output is deferred to v2 — v1 just captures the reasoning verbatim in the ledger.

**3. Stale Brief enforcement in `read_brief`**
A Stale Brief is a prior Research Brief version whose Research Run has since been continued with a new synthesis attempt that `failed`. `read_brief` already refuses `failed` runs with a `previousBriefAvailable` flag. Extend this: ensure `completed` and `budget_exhausted` runs' briefs are never treated as stale within their own run. The `status` action and `recommend_resume` action should flag when a `failed` run has a stale previous brief available for human inspection.

**4. Promotion `--force` appends override note**
When promotion with `--force` overwrites an existing file, append a note to the promoted package: `> Promoted with --force, overwriting existing file at <path> on <timestamp>`. This is lightweight — no formal version tracking, just an audit trail in the output.

### Acceptance criteria

- [ ] Brief with decision-relevant human trigger includes task implications
- [ ] Brief with decision-irrelevant human trigger (curiosity, history question) omits task implications
- [ ] Agent-triggered briefs continue to include task implications
- [ ] `update_findings` round appends a `brain_analysis` ledger entry with the Brain's reasoning text
- [ ] `read_brief` refuses `failed` runs with `previousBriefAvailable` — error message mentions stale brief and directs to `status`/human inspection
- [ ] `read_brief` serves `completed` and `budget_exhausted` briefs normally (never stale)
- [ ] `status` and `recommend_resume` surface the stale-brief flag when a `failed` run has `previousBriefAvailable`
- [ ] Promotion `--force` output includes override note with path and timestamp

### Blocked by

None — can start immediately.
