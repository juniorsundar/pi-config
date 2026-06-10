# Issue 0041: Snippet extraction uses content relevance, not position

### Parent

PRD Amendments: `docs/prd/0005-prd-amendments-gap-resolutions.md` (Amendment #12)

Shortcomings: `docs/prd/deepresearch-shortcomings.md` (Shortcoming #1)

### What to build

Type: AFK.

`extractSnippetsFromContent` currently strips HTML, collapses whitespace, splits on double-newlines, and takes the first 10 segments. This is structurally wrong for research: the most valuable content on documentation pages, READMEs, and articles is rarely in the opening paragraphs. Badges, navigation, and install instructions come first; architecture and comparison content is mid-page or later.

Replace position-based extraction with content-relevance extraction. The orchestrator selects which segments become snippets based on relevance to the Research Question, not their position in the document.

Acceptable strategies (pick one or combine):
- Score segments by term overlap with the Research Question and source title; select top-N by score
- Sample segments from strategic intervals across the document (beginning, middle, end) and rank by relevance
- Delegate snippet selection to the Research Brain during `update_findings` — the Brain sees the full extracted text and selects relevant passages, and the orchestrator uses those as Source Note snippets

Position-based extraction (first N paragraphs) is explicitly not acceptable. The new strategy must produce snippets that are verifiably more relevant to the Research Question than the first N paragraphs of the same document.

### Acceptance criteria

- [ ] README with badges/nav at top and architecture description in middle → extracted snippets include architecture content, not just badge noise
- [ ] Short documents (< 10 paragraphs) still produce reasonable snippets
- [ ] Empty or near-empty documents handled gracefully (fall back to empty snippets + recorded as gap)
- [ ] Source Note snippets differ meaningfully from what first-N-paragraphs would have produced on the Hermes vs Pi test case
- [ ] Existing Source Note tests updated to reflect new extraction strategy

### Blocked by

None — can start immediately.
