# Issue 0040: Content quality gate rejects garbage pages after fetch

### Parent

PRD Amendments: `docs/prd/0005-prd-amendments-gap-resolutions.md` (Amendment #11)

Shortcomings: `docs/prd/deepresearch-shortcomings.md` (Shortcoming #3)

### What to build

Type: AFK.

After the Research Orchestrator fetches a source and before creating a Source Note, apply a content quality gate. Pages below a minimum content-quality threshold are rejected — they are recorded as Negative Evidence instead of becoming Source Notes and entering the research pipeline.

The gate checks for:
- **Captcha/bot-detection pages**: text matching common challenge patterns ("Just a moment...", "Verify you are human", CloudFlare challenge markers)
- **Near-empty content**: fetched text below a minimum character threshold after stripping HTML
- **Navigation/UI-chrome-only pages**: extracted text that is predominantly nav links, button labels, and UI boilerplate with minimal substantive content
- **Common blocked-page patterns**: title or content matching known bot-detection or access-denied page patterns

Rejected pages are recorded in the Claim/Evidence Ledger as a `content_quality_rejected` event with URL, rejection reason, and timestamp. They are reflected in the Research Brief's gaps or Negative Evidence coverage section.

The gate does not consume Source Visit budget for rejected content (only Fetch Attempt budget was already consumed).

### Acceptance criteria

- [ ] CloudFlare challenge page ("Just a moment...") → rejected, recorded as Negative Evidence, no Source Note created
- [ ] Page with < 100 characters of substantive text after HTML strip → rejected
- [ ] Page that is mostly navigation/boilerplate → rejected
- [ ] Normal substantive page → passes gate, Source Note created normally
- [ ] Rejected pages appear in ledger as `content_quality_rejected` events
- [ ] Content quality gate does not consume Source Visit budget for rejected pages
- [ ] CONTEXT.md includes Content Quality Gate as a new glossary term

### Blocked by

None — can start immediately.
