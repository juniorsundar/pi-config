# Issue 0023: Track running and completed BTW entries

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Create the in-memory BTW registry that tracks running side-questions and completed outcomes for the current session. Multiple BTW Processes can run at once, each keeps its question text and timing metadata, and completed successes or errors are available newest-first for the BTW Review.

### Acceptance criteria

- [ ] Adding a BTW entry makes it visible as running
- [ ] Completing a running BTW entry removes it from running and adds a success result to completed entries
- [ ] Failing a running BTW entry removes it from running and adds an error result to completed entries
- [ ] Multiple running BTW entries can coexist without overwriting each other
- [ ] Completed BTW entries are returned newest-first
- [ ] The registry can terminate all running BTW Processes on request
- [ ] Clearing the registry removes running and completed state
- [ ] Tests cover add, complete, fail, multiple concurrent entries, newest-first completed entries, kill-all behavior, and clear behavior

### Blocked by

- Issue 0018 — needs the BTW extension skeleton and command surface
