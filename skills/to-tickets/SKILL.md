---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in a local file, or native blocking links on a real tracker.
---

# To Tickets

Break a plan, spec, or conversation into a set of tickets — tracer-bullet vertical slices, each declaring the tickets that block it.

## When to use

- You have a plan, spec, or conversation that needs to be broken into implementation tickets
- You want independently-grabbable tickets that can be worked on in parallel
- The user wants to hand off implementation work to an issue tracker

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, ticket path, issue number, or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

Rules for vertical slices:
- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the configured tracking strategy — the tickets are the same either way, only the shape of the blocking edges changes:

- **Local Markdown tracker** → write one file per ticket under `.scratch/<feature-slug>/tickets/<NN>-<slug>.md`, in dependency order (blockers first), each with its "Blocked by" listing the titles it depends on. Use the ticket template below.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking / sub-issue relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. Apply the `ready-for-agent` triage label unless instructed otherwise — the tickets are agent-grabbable by construction.

Do NOT close or modify any parent issue.

## Ticket Template

```markdown
### Parent

A reference to the parent issue on the issue tracker (if the source was an existing issue, otherwise omit this section).

### What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

Avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it here and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Blocked by

- A reference to the blocking ticket (if any)
```

Or "None - can start immediately" if no blockers.

## Rules

- Use vertical slices (tracer bullets) — each ticket cuts through all layers end-to-end.
- Prefer AFK slices over HITL. Only mark HITL when human interaction is genuinely required.
- Prefer many thin slices over few thick ones.
- Use the project's domain glossary vocabulary from `CONTEXT.md` throughout. Look for both `CONTEXT.md` and `context.md` (case-insensitive) when searching.
- Respect any ADRs in the area you're touching.
- When exploring the codebase, use `read`, `grep`, `find`, or read-only `bash` — or dispatch a `scout` subagent for broader exploration.
- Do not include file paths or code snippets in ticket descriptions (except for prototype snippets that encode decisions precisely).
- If no issue tracker integration is available, ask the user where to write the ticket files.
- Use `read` over shelling out to `cat` for file contents.
