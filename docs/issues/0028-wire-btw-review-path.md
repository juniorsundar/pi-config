# Issue 0028: Wire `/btw` review path

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Connect `/btw` with no arguments to BTW Review. A user can ask side-questions during a session and later run `/btw` to inspect completed success and error outcomes without reintroducing those results into the conversation context.

### Acceptance criteria

- [ ] `/btw` with no arguments opens BTW Review instead of starting a new BTW Process
- [ ] BTW Review receives completed entries from the registry newest-first
- [ ] Completed success results can be opened from the review path
- [ ] Completed error results can be opened from the review path
- [ ] Opening and closing BTW Review does not append BTW results to the conversation stream
- [ ] Running `/btw` when no results exist shows the empty review state
- [ ] Tests cover no-argument routing, completed success results, completed error results, empty state, and no conversation-stream insertion

### Blocked by

- Issue 0025 — needs BTW Review navigation and layout
- Issue 0026 — needs BTW result detail rendering
