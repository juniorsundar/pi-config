# Issue 0022: Editable Research Proposals

### Parent

PRD: `docs/prd/0005-pi-native-deep-research.md`

ADR: `docs/adr/0002-pi-native-research-orchestrator.md`

### What to build

Type: AFK.

Build the file-backed Research Proposal flow. A user can propose a bounded Research Question, review the Proposal Summary, trigger, purpose, Evidence Mix, Research Budget, blocking/background mode, and optional Research Brain model override, then edit or deny the proposal before it becomes a Research Run. Proposal generation should be deterministic enough to avoid spending approved Research Budget before approval.

User stories covered: 1, 2, 3, 4, 6, 46, 47.

### Acceptance criteria

- [x] Human-initiated requests create draft Research Proposals with all required editable fields
- [x] Proposal artifacts include a human-editable source of truth and a generated parsed cache for validation and preview
- [x] Approval always re-reads and validates the editable proposal before creating any Research Run
- [x] Parse or validation failures block approval with actionable feedback
- [x] Denied proposals are recorded as proposals and do not become Research Runs
- [x] Proposal generation does not consume approved Research Budget
- [x] Tests cover create, edit-then-approve, invalid edit, and deny flows

### Blocked by

- Issue 0021 — needs the Research Orchestrator extension skeleton.
