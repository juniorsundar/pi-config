---
name: implement
description: "Implement a piece of work based on a plan, spec, or set of tickets."
disable-model-invocation: true
---

# Implement

Implement the work described by the user — from a plan, spec, or tickets.

## Process

1. **Load the target.** Read the plan (`plan-<slug>.md`), spec, or ticket(s) the user points at. If a plan file exists with a slice status, pick up at the first incomplete slice.

2. **Explore before editing.** Use `read`, `grep`, `find`, or read-only `bash` — or dispatch a `scout` subagent for broader exploration. Read the project's domain glossary (look for `CONTEXT.md` or `context.md` — case-insensitive) so naming matches the project's language, and respect any ADRs in the area you're touching.

3. **Use the `tdd` skill where possible**, at pre-agreed seams. Vertical slices, one test at a time, behaviour verified through public interfaces.

4. **Verify continuously.** Run typechecking regularly, single test files regularly, and the full test suite once at the end.

5. **Review the work.** When the implementation is complete, dispatch a `reviewer` subagent to check the diff against the plan, the skill's rules, and any acceptance criteria.

6. **Commit your work to the current branch** when green.

## Rules

- Use the project's domain glossary vocabulary from `CONTEXT.md` throughout. Look for both `CONTEXT.md` and `context.md` (case-insensitive) when searching.
- Respect any ADRs in the area you're touching.
- Use `read` over shelling out to `cat` for file contents.
- Dispatch a `reviewer` subagent after edits when more than one file changed or the change is risky.
