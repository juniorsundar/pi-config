# Deep Research Pipeline Shortcomings

> Identified 2026-06-09 after postmortem of the Hermes vs Pi research run.
> Updated 2026-06-10: design-level gaps resolved; this document now tracks remaining implementation bugs.
> Resolutions: [PRD Amendments](./0005-prd-amendments-gap-resolutions.md)

---

## Resolved Design Gaps (2026-06-10)

The following design-level gaps were resolved and are documented in the PRD Amendments (`0005-prd-amendments-gap-resolutions.md`). They are removed from the body of this document.

| # | Shortcoming | Resolution |
|---|-------------|------------|
| 1 | Snippet extraction is "first N paragraphs" | **Content-relevance extraction** required: snippets must be selected by relevance to the research question, not position. Position-based extraction (first N) is explicitly not acceptable. Amendment #12. |
| 3 | No content quality gate | **Content Quality Gate** added as a PRD requirement: reject pages below content-quality threshold, record as Negative Evidence. New CONTEXT.md term. |
| 8 | No exploration depth incentive | **Minimum 3 searches** before synthesis allowed (unless early evidence meets minimum requirements). Added as PRD requirement. |
| 5 | Prompt bloat — source notes exceed model context | **Brain prompt size cap** added as a PRD requirement: cap total source-note characters, summarize/truncate older notes. |
| 2 | No search diversity enforcement | Partially resolved by minimum 3 searches (#8 above). Implementation bug #10 (EvidenceMix visibility) covers the prompt-side fix. |

---

## Remaining Implementation Bugs

### P1 — High

#### 4. Selected URLs aren't validated against search results

In round 3, the Brain selected `pi.dev` and `github.com/earendil-works/pi` — URLs that weren't in the search results. The Brain can `select_sources` any URL it thinks it knows, including hallucinated ones. There's no check that selected URLs came from actual search results. This works when the model's training data is accurate, but it's an unforced vulnerability — a hallucinated URL wastes fetch budget and produces garbage.

**Fix direction**: Add a validation step that checks `selectedUrls` against the accumulated search results (including deduplicated URLs from all previous rounds). Allow a configurable override for "known URLs" that the Brain explicitly justifies.

---

### P2 — Medium

#### 6. Brief normalization is destructive when the model deviates from the template

`normalizeBriefDraft` replaces any section the model leaves blank with boilerplate ("No source-grounded conclusion available", "No sourced evidence identified"). If the model produces a valid brief but structures it differently than the expected `## Bottom Line / ## Evidence / ## Interpretation` pattern, the parser fragments it and fills gaps with placeholders. There's no middle ground: either the model follows the template exactly, or normalization fills in boilerplate.

**Fix direction**: Make section matching more fuzzy (e.g., accept "Key Finding" as "Bottom Line", accept "Analysis" as "Interpretation"). Or use the model's repair capability more aggressively: when normalization degrades the brief, re-submit it to the model for restructuring before accepting the placeholders.

#### 7. Comparison heuristic is fragile and English-only

`isComparisonQuery()` checks for regex patterns like `\bvs\b`, `\bdiffer/i`, `\bcompare/i`. This fails on:
- Queries like "What capabilities does Hermes have for self-evolution?" (comparative intent without comparison markers)
- Queries in other languages
- Queries where the comparison is implicit ("Is Pi good enough as-is?")
- False positives on unrelated uses ("How does the vs code extension work?")

**Fix direction**: Replace keyword regex with semantic matching — either embed the query and check similarity to comparison intents, or have the Brain classify its own query type as part of its first intent. Alternatively, expand the regex set based on common multi-word patterns and add a whitelist of known comparison conjunctions.

#### 10. EvidenceMix categories are invisible to the Brain

The proposal defines 5 evidence categories, and the EvidenceMix tracks their status (found/missing/not-searched). But the Brain prompt only shows a status summary like "Community comparison articles and hands-on reviews: not-searched". It doesn't translate this into actionable guidance like "You should search for 'Hermes vs Pi comparison' to cover this category". The model has to infer what to search for.

**Fix direction**: Enhance the coverage section in the prompt to include suggested search queries for "not-searched" categories. E.g., "Category 'Community comparison articles' is not searched. Consider searching for: 'Hermes agent vs Pi coding agent comparison'."

---

### P3 — Low

#### 11. Readiness probes don't test research capability

The probes verify the model can return valid JSON, produce stop_early, and cite sources in a trivial context. They don't test whether the model can handle a long prompt with budget tracking, source notes, evidence coverage, and produce a coherent research strategy. The previous run passed readiness with tongyi-deepresearch:30b (all probes passed) but still failed catastrophically on the actual research task.

**Fix direction**: Add a "research simulation" probe: send the model a realistic prompt with source notes, budget, and evidence coverage, and verify it produces a valid search/select_sources/update_findings intent. This tests the model's ability to handle the actual research loop, not just isolated formatting tasks.

---

## Deferred to v2

#### 9. Single-model dependency — no quality floor

The entire pipeline depends on the model being correct. There's no second model to validate or challenge the synthesis. If the model hallucinates a detail (e.g., "Pi's system prompt is under 1,000 tokens" — which Source [8] states but may not be current), that claim goes straight into the brief with no cross-check.

**Status**: Deferred to v2. An adversarial review step or post-synthesis fact-check would require a second model and adds cost/complexity not justified in v1.

---

## Additional Implementation Bugs (from scout)

The following were found during implementation reconnaissance on 2026-06-10:

- **`deny` command not implemented**: Listed in `/research` command description but no code branch exists. Falls through to catch-all error.
- **`resume` command is summary-only**: `/research resume` prints status and source-note/ledger counts but does not call `resumeResearchRun`/`continueResearchRun`. The "to proceed, approve a revised Research Budget" text is a stub.
- **`settings.json` lookup path**: The deep-research extension looks for config in the current working directory's `settings.json` instead of the global Pi config at `~/.pi/agent/settings.json`.
- **`triggerSource` type cleanup**: `domain/types.ts` defines `"human" | "agent" | "task"` but `"task"` should be removed (collapsed into `"agent"`).
