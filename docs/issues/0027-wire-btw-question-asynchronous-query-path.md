# Issue 0027: Wire `/btw <question>` asynchronous query path

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Connect the user-facing `/btw <question>` command to the full asynchronous side-question flow. A user can ask one or more side-questions, continue working while they run, see them in the Spinning List, and later find their results in BTW Review without those results entering the current session's conversation context.

### Acceptance criteria

- [ ] `/btw <question>` starts a BTW Process without blocking the main session UI
- [ ] Multiple `/btw <question>` invocations can run concurrently
- [ ] Quoted and unquoted question text both produce the intended query string
- [ ] Starting a BTW Process adds it to running BTW entries
- [ ] Successful completion moves the BTW entry to completed results
- [ ] Failure moves the BTW entry to completed error results
- [ ] The Spinning List updates when BTW Processes start and finish
- [ ] BTW answers are displayed outside the conversation stream
- [ ] BTW answers are not appended to the current session file
- [ ] Tests cover starting one query, starting multiple queries, quoted input, unquoted input, success completion, failure completion, Spinning List updates, and no conversation-stream insertion

### Blocked by

- Issue 0020 — needs BTW Process spawning and result parsing
- Issue 0022 — needs bounded process lifecycle behavior
- Issue 0023 — needs BTW registry state
- Issue 0024 — needs Spinning List rendering
