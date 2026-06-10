# PRD 0005 Amendments: Gap Analysis Resolutions

**Date**: 2026-06-10  
**Subject**: Resolutions from grilling the gaps identified in `0005-pi-native-deep-research-gap-analysis.md` and `deepresearch-shortcomings.md`  
**Status**: Final

This document records design decisions that amend or clarify PRD 0005. Each entry references the gap it resolves.

---

## 1. `propose` return contract (Gap: undefined `propose` return shape)

The `deepresearch` tool's `propose` action returns additive fields beyond the current `{status, proposal: {id, path}}`:

```
+ summary: string          // 1-2 sentence human-readable summary
+ trigger: string           // the validated trigger text
+ blockingMode: boolean    // whether the run will block on approval
+ evidenceMix: string[]    // proposed evidence categories
+ budget: { maxSearches, maxFetchAttempts, maxSourceVisits, maxSynthesisRounds, maxModelCalls, maxRetryAttempts, maxElapsedSeconds }
```

Existing fields remain unchanged. The agent uses these to inform the user what was proposed without reading `proposal.md`.

**Amends**: PRD 0005 Implementation Decisions (tool surface section — previously did not specify return shapes).

---

## 2. Run-initiation modes: two, not three (Gap: `task-triggered` undefined)

The term "task-triggered" is collapsed into "agent-triggered." When a skill like `grill-with-docs` triggers research, it goes through the same `propose` path as any other agent-triggered research. The only two run-initiation modes are:

- **human-initiated**: user calls `/research propose`
- **agent-triggered**: agent calls `deepresearch` tool with `propose` action

User story 34 and the Research Brief glossary entry are updated to reference "agent-triggered" instead of "agent-triggered or task-triggered." The `triggerSource` type in `domain/types.ts` should be updated from `"human" | "agent" | "task"` to `"human" | "agent"`.

**Amends**: PRD 0005 User Story 34, CONTEXT.md Research Brief and Research Trigger definitions.

---

## 3. Briefs include task implications when context is available (Gap: undefined task implication scope)

Research Briefs include task implications (implications for Pi or the current task) when the Research Trigger or proposal context provides enough information to generate them — typically agent-triggered runs and decision-relevant human-initiated runs. The previous rule ("only when agent-triggered or task-triggered") is replaced with this context-availability rule. A human running `/research propose "What's the history of Rust?"` would not get task implications; a human running `/research propose "Is library X suitable for our auth layer?"` would.

**Amends**: PRD 0005 User Story 34, CONTEXT.md Research Brief definition.

---

## 4. Agent research lifecycle is stateless (Gap: missing agent ↔ orchestrator lifecycle)

ADR 0003 records this decision. The agent's lifecycle is: `propose → inform user → check status on a later turn → read_brief when terminal`. There is no blocking tool call, no completion notification, and no auto-injection of brief content. The tool description embeds this lifecycle rubric. The current tool surface is sufficient.

Key sub-resolutions:
- **Blocking runs** pause the human's decision path, not the agent's tool loop.
- **Completion notification**: the agent calls `status` proactively; no event system needed.
- **`read_brief` integration**: tool result only, no auto-injection.
- **`render_view` and `recommend_resume`**: both stay on the agent tool surface as advisory tools. `render_view` returns a file path for the agent to surface to the user; `recommend_resume` returns resumability metadata for the agent to advise the user.
- **Cross-session continuity**: out of scope for v1. The agent starts fresh each session. Research artifacts persist on disk for manual resume.

**Amends**: PRD 0005 Implementation Decisions (tool surface and blocking/background run sections). See ADR 0003.

---

## 5. Research Trigger rubric (Gap: trigger validation has no positive test)

A valid Research Trigger must satisfy all three:

1. **Names a specific decision** — e.g., "choosing between X and Y for auth"
2. **Requires facts beyond training data** — current pricing, recent API changes, benchmarks on current versions
3. **Cannot be resolved by local exploration** — the answer depends on external sources

This rubric is added to the `deepresearch` tool description and the CONTEXT.md Research Trigger definition. The regex validator in `validateTrigger()` remains as a safety net for obvious rejections; the agent's own judgment is the primary filter.

The "weak trigger" concept is removed. A trigger is either valid or rejected. Human-initiated proposals bypass trigger validation entirely.

**Amends**: CONTEXT.md Research Trigger definition, `deepresearch` tool description.

---

## 6. `update findings` intent mapping (Gap: `update_findings` maps to no glossary term)

In v1, the `update_findings` Brain intent is where the Brain provides evidence extraction analysis. The orchestrator:
- Creates Source Notes from fetched content (existing behavior)
- Records the Brain's `reasoning` field as a `brain_analysis` Claim/Evidence Ledger event
- Does not extract structured claim/contradiction/gap from Brain output — that's handled during synthesis

Structured claim/contradiction/gap extraction from `update_findings` is deferred to v2.

**Amends**: CONTEXT.md Research Brain definition (added intent mapping).

---

## 7. `add_instruction` accepted only in `running` or `queued` status (Gap: undefined timing)

Steering instructions via `add_instruction` are accepted only when the run status is `running` or `queued`. They are rejected in `synthesizing`, `completed`, `budget_exhausted`, `cancelled`, `interrupted`, `failed`, and `readiness_failed` states.

**Amends**: PRD 0005 Implementation Decisions (steering section).

---

## 8. Stale brief definition (Gap: "stale" undefined)

A Stale Brief is a prior Research Brief version whose Research Run has since been continued with a new synthesis attempt. Staleness is structural (supersession by continuation), not time-based. A `failed` run with `previousBriefAvailable` always has a stale previous brief. `completed` and `budget_exhausted` briefs are never stale within their own run. `read_brief` refuses stale briefs by default and directs the caller to `status` or human inspection.

**Amends**: PRD 0005 Implementation Decisions (prior brief versions section). CONTEXT.md new term.

---

## 9. Promotion `--force` audit (Gap: `--force` overwrites without audit)

When `--force` overwrites an existing file during promotion, the promoted package appends a line noting the override: `> Promoted with --force, overwriting existing file at <path> on <timestamp>`. No formal version tracking system is needed beyond this.

**Amends**: PRD 0005 Implementation Decisions (promotion section).

---

## 10. Proposal template pre-population (Gap: budget validation fails on bad keys)

The `proposal.md` Budget section is pre-populated with all 7 valid keys and their defaults, with inline comments explaining each field. This prevents approval failures from misspelled or missing budget keys. Evidence Mix stays free-form with no default categories.

Valid budget keys: `maxSearches`, `maxFetchAttempts`, `maxSourceVisits`, `maxSynthesisRounds`, `maxModelCalls`, `maxRetryAttempts`, `maxElapsedSeconds`.

**Amends**: PRD 0005 Implementation Decisions (proposal section).

---

## 11. Pipeline quality requirements from shortcomings (P0–P1 design gaps)

The following design requirements from the pipeline postmortem are added to the PRD:

- **Content Quality Gate**: After fetch, pages below a minimum content-quality threshold (captcha detection, empty/near-empty content, navigation-only pages, bot-detection patterns) are recorded as Negative Evidence instead of becoming Source Notes. Added to CONTEXT.md as a new term.

- **Minimum search requirement**: The Research Brain must complete at least 3 searches before synthesis is allowed, unless early evidence is sufficient and minimum evidence requirements are met. This prevents the "1 search then synthesize" failure mode and ensures search diversity.

- **Brain prompt size limit**: Source notes in the Research Brain prompt are capped at a total character budget. When the cap is exceeded, older or less relevant notes are summarized or truncated. The orchestrator tracks prompt token count and warns or truncates.

**Amends**: PRD 0005 Implementation Decisions (source access, budget, and Brain prompt sections).

---

## 12. Source Note snippet extraction must be content-relevant (Shortcoming #1)

`extractSnippetsFromContent` currently takes the first N paragraphs after stripping HTML. This is structurally wrong for research: the most valuable content on documentation pages, READMEs, and articles is rarely in the opening paragraphs (badges, nav, install instructions come first).

The PRD should require that snippet extraction select content by relevance to the research question, not by position. Acceptable approaches:

- Weight segments by term overlap with the research question and source title
- Extract from strategic intervals across the document (beginning, middle, end)
- Use the Research Brain to rank extracted segments by relevance when the orchestrator calls `update_findings`

Position-based extraction (first N paragraphs) is explicitly not acceptable as a v1 strategy.

**Amends**: PRD 0005 Implementation Decisions (Source Note extraction section).

---

## Implementation bugs tracked separately

The following shortcomings are implementation bugs, not design changes. They are tracked as issues:

- Selected URLs not validated against search results (Brain can hallucinate URLs)
- Destructive brief normalization replaces model deviations with boilerplate
- Comparison heuristic is fragile and English-only
- EvidenceMix categories are not visible enough in the Brain prompt
- Readiness probes don't test research capability (only JSON formatting)
- `deny` command listed but not implemented
- `resume` command is summary-only (doesn't call `resumeResearchRun`/`continueResearchRun`)
- `settings.json` lookup not checking `~/.pi/agent/settings.json` global config path
- `triggerSource` type includes `"task"` but should be `"human" | "agent"` only
