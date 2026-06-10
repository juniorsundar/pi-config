# Issue 0042: Minimum searches enforced + Brain prompt size capped

### Parent

PRD Amendments: `docs/prd/0005-prd-amendments-gap-resolutions.md` (Amendment #11)

Shortcomings: `docs/prd/deepresearch-shortcomings.md` (Shortcomings #2, #5, #8)

### What to build

Type: AFK.

Two guardrails for the Research Run loop that prevent shallow research and context-overflow failures:

**Minimum search requirement**: The Research Brain must complete at least 3 searches before synthesis is allowed. If the Brain attempts `synthesize_brief` or `stop_early` before 3 searches have executed, the orchestrator rejects the intent and instructs the Brain to search for uncovered Evidence Mix categories. Exception: synthesis is allowed with fewer than 3 searches if all Evidence Mix categories are marked `found` or `weak` and no hard blockers remain (Negative Evidence recorded for missing categories).

This replaces the current gate which only requires 1 Source Note — a threshold that allows synthesis after a single search with 1 URL.

**Brain prompt size cap**: Source notes included in the Brain prompt are capped at a total character budget. When the cap would be exceeded, older or less relevant notes are summarized (title + key claim) rather than included in full. The orchestrator tracks the total prompt size and truncates before sending to the Brain. The Run Summary and Progress Digest are not affected — only the per-round Brain prompt is capped.

### Acceptance criteria

- [ ] `synthesize_brief` or `stop_early` intent rejected when search count < 3 and Evidence Mix has uncovered categories without Negative Evidence
- [ ] `synthesize_brief` allowed with < 3 searches when all Evidence Mix categories are `found`/`weak` or have recorded Negative Evidence
- [ ] `synthesize_brief` allowed normally when search count ≥ 3
- [ ] Source notes in Brain prompt truncated when total character budget exceeded; older notes summarized first
- [ ] Under-cap prompt includes all source notes in full
- [ ] Run Summary and Progress Digest unaffected by prompt cap
- [ ] Budget exhaustion still triggers best-effort synthesis regardless of search count

### Blocked by

None — can start immediately.
