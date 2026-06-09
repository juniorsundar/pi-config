# Deep Research Pipeline Shortcomings

> Identified 2026-06-09 after postmortem of the Hermes vs Pi research run.
> Status: raw notes for future work.

## 1. Snippet extraction is "first N paragraphs" — loses the best content

`extractSnippetsFromContent` strips HTML, collapses whitespace, splits on `\n\n`, and takes the **first** 10 segments. For GitHub READMEs, that means badges, install buttons, and navigation — not the architecture section 3 screens down. Source [1], [5], and [6] in the brief were all GitHub badge noise. The Hermes architecture diagram (the most valuable content) was in the middle of the page, not the beginning.

This is structural: the most valuable comparison content is almost never in the first paragraphs.

**Fix direction**: Weight segments by relevance to the research question, or extract from the full document at strategic intervals (beginning, middle, end), or use a relevance-scoring pass that ranks segments against the query terms.

## 2. No search diversity — the Brain did one search, then stopped

The Brain ran exactly **one search** ("Hermes agent Nous Research architecture self-evolving coding agent") and then selected URLs it already knew from training data (pi.dev, earendil-works/pi). It never searched for "Pi coding agent architecture", never searched for "Hermes vs Pi comparison", never searched for "self-evolving agent harness comparison".

The comparison query fix only helps preserve results that *already appear* in search results. It doesn't cause the Brain to *search for comparison content*. The Brain's search strategy is opaque and unguided.

**Fix direction**: Add an evidence-mix-aware search suggestion to the prompt — when evidence categories are "not-searched", suggest the Brain search for queries that would cover those categories. Or add a multi-search required minimum before synthesis is allowed.

## 3. No content quality gate — captcha pages become source notes

Source note [4] (`generativeai.pub`) returned "Just a moment..." — a CloudFlare challenge page. The pipeline created a source note with `[Content retrieved]` as the snippet and the model cited it. There's no quality gate that detects empty/useless content and discards it.

**Fix direction**: Add a minimum content-quality heuristic after fetch: reject pages under a character threshold, pages with captcha/bot-detection markers, pages where extracted text is mostly navigation/UI chrome, or pages where the title matches common blocked-page patterns.

## 4. Selected URLs aren't validated against search results

In round 3, the Brain selected `pi.dev` and `github.com/earendil-works/pi` — URLs that weren't in the search results. The Brain can `select_sources` any URL it thinks it knows, including hallucinated ones. There's no check that selected URLs came from actual search results. This works when the model's training data is accurate, but it's an unforced vulnerability — a hallucinated URL wastes fetch budget and produces garbage.

**Fix direction**: Add a validation step that checks `selectedUrls` against the accumulated search results (including deduplicated URLs from all previous rounds). Allow a configurable override for "known URLs" that the Brain explicitly justifies.

## 5. Prompt bloat — source notes can exceed model context

We added up to **8KB per source note** into the Brain prompt. With 12 sources, that's potentially **96KB** just for source notes. After adding the question, run summary, budget, evidence coverage, candidates, brief template, and intent instructions, the model could be operating at the very edge of its context window. At the boundary:
- Response quality degrades
- The model may truncate its JSON output
- Structured output compliance drops
- The model may lose track of the research question

**Fix direction**: Add a hard limit on total prompt size. If source notes exceed a threshold, summarize older notes or only include the most recent/relevant ones. Track token count and warn or truncate.

## 6. Brief normalization is destructive when the model deviates from the template

`normalizeBriefDraft` replaces any section the model leaves blank with boilerplate ("No source-grounded conclusion available", "No sourced evidence identified"). If the model produces a valid brief but structures it differently than the expected `## Bottom Line / ## Evidence / ## Interpretation` pattern, the parser fragments it and fills gaps with placeholders. There's no middle ground: either the model follows the template exactly, or normalization fills in boilerplate.

**Fix direction**: Make section matching more fuzzy (e.g., accept "Key Finding" as "Bottom Line", accept "Analysis" as "Interpretation"). Or use the model's repair capability more aggressively: when normalization degrades the brief, re-submit it to the model for restructuring before accepting the placeholders.

## 7. Comparison heuristic is fragile and English-only

`isComparisonQuery()` checks for regex patterns like `\bvs\b`, `\bdiffer/i`, `\bcompare/i`. This fails on:
- Queries like "What capabilities does Hermes have for self-evolution?" (comparative intent without comparison markers)
- Queries in other languages
- Queries where the comparison is implicit ("Is Pi good enough as-is?")
- False positives on unrelated uses ("How does the vs code extension work?")

**Fix direction**: Replace keyword regex with semantic matching — either embed the query and check similarity to comparison intents, or have the Brain classify its own query type as part of its first intent. Alternatively, expand the regex set based on common multi-word patterns and add a whitelist of known comparison conjunctions.

## 8. No exploration depth incentive — Brain synthesizes after 1 search

The run completed in **7 rounds with 1 search**. With a budget of 10 searches, the Brain could have done multiple focused searches. Instead it grabbed 6 URLs and immediately synthesized. The `stop_early` gate requires minimum 1 source note. By round 3 the Brain had 6 notes — well above the threshold. There's no mechanism encouraging deeper exploration before synthesis.

**Fix direction**: Add a `minimumSearches` budget parameter (e.g., minimum 3 searches before synthesis is allowed). Or add a coverage-gate: the Brain cannot `synthesize_brief` until at least N evidence-mix categories are "found" or "weak". Or add a "depth bonus" that rewards the Brain for covering more evidence categories.

## 9. Single-model dependency — no quality floor

The entire pipeline depends on the model being correct. There's no second model to validate or challenge the synthesis. If the model hallucinates a detail (e.g., "Pi's system prompt is under 1,000 tokens" — which Source [8] states but may not be current), that claim goes straight into the brief with no cross-check.

**Fix direction**: Add an optional "adversarial review" step where a second model (or the same model with a different prompt) challenges key claims in the brief. Or add a post-synthesis fact-check step that re-fetches source URLs and verifies specific claims against the fetched content.

## 10. EvidenceMix categories are invisible to the Brain

The proposal defines 5 evidence categories, and the EvidenceMix tracks their status (found/missing/not-searched). But the Brain prompt only shows a status summary like "Community comparison articles and hands-on reviews: not-searched". It doesn't translate this into actionable guidance like "You should search for 'Hermes vs Pi comparison' to cover this category". The model has to infer what to search for.

**Fix direction**: Enhance the coverage section in the prompt to include suggested search queries for "not-searched" categories. E.g., "Category 'Community comparison articles' is not searched. Consider searching for: 'Hermes agent vs Pi coding agent comparison'."

## 11. Readiness probes don't test research capability

The probes verify the model can return valid JSON, produce stop_early, and cite sources in a trivial context. They don't test whether the model can handle a long prompt with budget tracking, source notes, evidence coverage, and produce a coherent research strategy. The previous run passed readiness with tongyi-deepresearch:30b (all probes passed) but still failed catastrophically on the actual research task.

**Fix direction**: Add a "research simulation" probe: send the model a realistic prompt with source notes, budget, and evidence coverage, and verify it produces a valid search/select_sources/update_findings intent. This tests the model's ability to handle the actual research loop, not just isolated formatting tasks.

---

## Priority Matrix

| Priority | # | Shortcoming | Impact |
|----------|---|-------------|--------|
| P0 | 1 | Snippet extraction destroys valuable content | Architecture and comparison content is usually mid-page, never in first paragraphs |
| P0 | 3 | No content quality gate | Captcha pages, 404s, and empty responses become source notes |
| P1 | 4 | Selected URLs not validated against search results | Hallucinated URLs waste budget |
| P1 | 8 | No exploration depth incentive | Brain synthesizes after 1 search, produces shallow briefs |
| P2 | 5 | Prompt bloat with source notes | Long contexts degrade model quality |
| P2 | 9 | Single-model dependency | No validation against hallucination |
| P2 | 6 | Destructive brief normalization | Model deviations from template get replaced with boilerplate |
| P2 | 7 | Comparison heuristic fragile/English-only | Misses implicit comparisons, false positives on unrelated uses |
| P2 | 10 | EvidenceMix invisible to Brain | Brain doesn't get actionable search guidance from uncovered categories |
| P3 | 2 | No search diversity enforcement | Brain stops searching too early |
| P3 | 11 | Readiness probes don't test research capability | Model can pass probes but fail on real tasks |