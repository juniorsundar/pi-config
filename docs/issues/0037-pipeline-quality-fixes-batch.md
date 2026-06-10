# Issue 0037: Pipeline quality fixes batch

### Parent

PRD Amendments: `docs/prd/0005-prd-amendments-gap-resolutions.md`

Gap Analysis: `docs/prd/0005-pi-native-deep-research-gap-analysis.md`

Shortcomings: `docs/prd/deepresearch-shortcomings.md`

### What to build

Type: AFK. First issue to resolve — a batch of small, independent fixes that improve pipeline quality, fill in missing command branches, and align types with the resolved glossary.

Nine fixes across three categories:

**Brain pipeline quality:**
1. **URL validation against search results**: Before fetching, validate that every URL the Research Brain selected in `select_sources` appeared in accumulated search results from previous rounds. Hallucinated URLs are rejected and recorded as Negative Evidence. Allow a configurable override for "known URLs" the Brain explicitly justifies.
2. **Fuzzy brief normalization**: `normalizeBriefDraft` currently requires exact `## Bottom Line / ## Evidence / ## Interpretation` section headers. Make matching fuzzy — accept "Key Finding" as Bottom Line, "Analysis" as Interpretation, etc. When normalization would degrade a valid brief into boilerplate, attempt a model repair pass before falling back.
3. **EvidenceMix visibility in Brain prompt**: The coverage section in the Brain prompt currently shows status summaries ("not-searched"). Enhance it to include suggested search queries for uncovered categories — e.g., "Category 'Community comparison articles' is not searched. Consider searching for: 'Hermes agent vs Pi coding agent comparison'."
4. **Research simulation readiness probe**: Add a readiness probe that sends the model a realistic prompt with source notes, budget tracking, and evidence coverage, then verifies it produces a valid search/select_sources/update_findings intent. This tests actual research capability, not just JSON formatting.
5. **Comparison heuristic replaced**: `isComparisonQuery()` currently uses fragile English-only regex. Replace with semantic matching or have the Brain self-classify its query type as part of its first intent.

**Command surface gaps:**
6. **`/research deny <proposal-id>`**: Listed in the command description but no code branch exists. Implement it — updates the proposal status to `denied` and marks the proposal directory accordingly.
7. **`/research resume <run-id>`**: Currently prints a summary-only stub (source-note count, ledger count, termination reason) with a "to proceed, approve a revised Research Budget" instruction. Wire it to actually call `resumeResearchRun`/`continueResearchRun` for interrupted, readiness-failed, and budget-exhausted runs.

**Config and type alignment:**
8. **`settings.json` config path**: The deep-research extension looks for config in the current working directory's `settings.json`. Fix to check the global Pi config at `~/.pi/agent/settings.json`.
9. **`triggerSource` type cleanup**: `domain/types.ts` defines `triggerSource: "human" | "agent" | "task"`. Remove `"task"` — the only two run-initiation modes are `human-initiated` and `agent-triggered`.

### Acceptance criteria

- [ ] Hallucinated URLs selected by the Brain are rejected before fetch and recorded as Negative Evidence
- [ ] Brief normalization accepts variant section headers (e.g., "Key Finding", "Analysis") without replacing content with boilerplate
- [ ] Brain prompt coverage section includes suggested search queries for not-searched Evidence Mix categories
- [ ] Readiness check includes a research simulation probe that tests the model against a realistic multi-source prompt
- [ ] Comparison detection works for implicit and non-English queries, or the Brain self-classifies
- [ ] `/research deny <proposal-id>` updates proposal status to `denied`
- [ ] `/research resume <run-id>` invokes the actual resume loop for resumable runs
- [ ] Deep-research config loads from `~/.pi/agent/settings.json` not CWD
- [ ] `triggerSource` type is `"human" | "agent"` only

### Blocked by

None — can start immediately.
