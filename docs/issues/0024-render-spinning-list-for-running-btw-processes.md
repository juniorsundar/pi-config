# Issue 0024: Render the Spinning List for running BTW Processes

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Show a Spinning List above the editor while BTW Processes are running. The list gives users lightweight awareness of pending side-questions, supports multiple concurrent items, includes a progress count, and disappears naturally when no BTW Processes remain.

### Acceptance criteria

- [ ] No Spinning List is shown when there are no running BTW Processes
- [ ] One running BTW Process shows a BTW header and one spinner item
- [ ] Multiple running BTW Processes show one spinner item per question
- [ ] The header shows the current BTW progress count
- [ ] Each spinner item includes enough question text to identify the side-question
- [ ] Completing or failing a BTW Process updates the Spinning List
- [ ] The Spinning List clears when the final running BTW Process completes or fails
- [ ] Tests cover empty, single-running, multiple-running, update, and clear rendering behavior

### Blocked by

- Issue 0023 — needs running BTW entries to render
