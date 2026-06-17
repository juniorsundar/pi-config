# Issue 0025: Render BTW Review newest-first with navigation

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Add the BTW Review view for completed side-question results. A user can open the review, see completed BTW entries newest-first, read the latest result immediately, expand older results on demand, move through entries with keyboard navigation, and close the view quickly.

### Acceptance criteria

- [ ] Opening BTW Review displays completed BTW entries newest-first
- [ ] The most recent completed BTW result is expanded by default
- [ ] Older completed BTW results are collapsed by default
- [ ] Up and down navigation moves the selected BTW result
- [ ] Enter or the configured open/toggle key expands and collapses the selected result
- [ ] Escape closes BTW Review and returns to the editor
- [ ] Empty completed state renders a helpful message instead of a blank view
- [ ] BTW Review styling is visually consistent with existing subagent-style result presentation
- [ ] Tests cover ordering, default expansion state, navigation, toggle behavior, close behavior, and empty state

### Blocked by

- Issue 0023 — needs completed BTW entries to review
