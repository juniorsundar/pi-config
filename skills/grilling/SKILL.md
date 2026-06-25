---
name: grilling
description: Interview the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase instead — use `read`, `grep`, `find`, or read-only `bash`, or dispatch a `scout` subagent for broader exploration. Keep the grilling conversation itself on the main thread; subagents are for gathering codebase evidence only.

Read the project's domain glossary (look for `CONTEXT.md` or `context.md` — case-insensitive) so your questions use the project's own language, and respect any ADRs in the area you're touching. If you want the grilling to also update `CONTEXT.md` and ADRs inline as decisions crystallise, use the `grill-with-docs` skill instead.