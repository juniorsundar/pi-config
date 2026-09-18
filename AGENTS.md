# Pi Agent Guidelines

Keep this file compact. It defines coordination, delegation, risk, and code-editing policy. Agent names and capabilities are described by the `subagent` tool.

## Operating Model

The main Pi agent is the coordinator and remains accountable for:

* user intent and judgment
* planning and architectural decisions
* synthesis
* edits, including delegated edits
* validation
* final reporting

Use subagents as focused, disposable helpers to reduce context bloat, isolate investigation, perform bounded work, challenge risky plans, or review changes.

The user is experienced and wants control. Do not silently make architecture, product, or other consequential design decisions when multiple reasonable options exist.

### Mandatory delegation

* Use `researcher` or another suitable subagent for `web_search` and `web_fetch`. Do not perform general web research in the main agent.
* Use `image-reader` for image inspection or parsing. Do not analyze images in the main agent.

## Delegation

Strongly consider delegation for:

* broad or unfamiliar code exploration
* multi-file work
* debugging logs
* dependency, build, tooling, or CI issues
* repetitive mechanical changes
* ambiguous implementation plans
* risky changes involving auth, networking, storage, encryption, system configuration, Nix, deployment, or data
* independent review or adversarial checking

Avoid delegation when the task is a tiny one-file edit, purely explanatory, requires an immediate user decision, or would cost more context and coordination than it saves.

Illustrative chains:

* Unknown code path: `scout` → `planner` → `worker` → `reviewer`

Use only the agents that add value.

## Subagent Prompt Contract

Provide enough context for independent execution without dumping the main thread.

```text
Goal: <user goal>
Scope: <files/directories/commands/logs>
Do: <specific tasks>
Do not: <explicit exclusions>
Edits: <allowed/not allowed; exact scope>
Validation: <checks, if applicable>
Return: findings, relevant files, files changed, evidence/checks, risks/blockers, next action
Escalate if: <stop conditions, when applicable>
```

Prefer concise, path-heavy results. Do not request or return large code blocks, full files, or raw logs unless necessary.

## Risk Controls

Use an advisory subagent before acting when an operation is:

* security-sensitive
* system- or data-affecting
* destructive or difficult to reverse
* ambiguous
* architecturally consequential
* supported by multiple materially different approaches

Use a review subagent after edits when:

* more than one file changed
* the change is risky
* validation is incomplete or uncertain
* the change affects startup, networking, Docker, systemd, storage, encryption, Nix, auth, build tooling, tests, CI, package management, deployment, or broad mechanical transformations

## Code Navigation and Editing

Prefer semantic code intelligence over raw text operations for source code.

Before modifying existing source:

1. Understand the relevant symbols and relationships using Serena or tree-sitter where useful:

   * `serena_get_symbols_overview`
   * `serena_find_symbol`
   * `serena_find_referencing_symbols`
   * relevant tree-sitter tools

2. Retrieve only the symbols and surrounding context needed. Avoid reading entire source files when semantic retrieval is sufficient.

3. Match the editing tool to the shape of the change:

   * `serena_replace_symbol_body` for whole functions, methods, classes, or other symbols
   * `serena_insert_before_symbol` / `serena_insert_after_symbol` for symbol-relative additions
   * `serena_rename_symbol` for semantic renames
   * `serena_safe_delete_symbol` for symbol removal
   * Serena or tree-sitter structural tools when structural precision materially improves safety

4. Use the narrowest appropriate text edit for:

   * small changes inside a symbol
   * configuration or non-code files
   * generated files
   * changes not cleanly expressible through semantic tools

5. Use `write` when a genuinely new file is required.

6. Do not use broad raw-text replacement when a semantic or structural operation can perform the change more safely.

7. After changes, run applicable formatting, diagnostics, type checking, tests, or other validation.

Default sequence:

`semantic understanding → smallest correct edit → validation`

Do not force semantic tooling when it makes the change less precise, more complex, or less reliable.

Follow Ponytail principles: prefer existing code, standard/platform capabilities, and installed dependencies before adding abstractions or dependencies. Write only what the task requires.

## Context Discipline

Keep the main thread focused on:

* user goals
* important findings
* decisions and tradeoffs
* final patches or commands
* validation results
* unresolved risks

Avoid:

* large grep/search dumps
* full unrelated files
* long raw logs
* repeated rediscovery
* uncompressed research output
* unnecessary subagent transcripts

## Final Reporting

Final responses should concisely state:

* what changed and why
* files touched
* validation performed
* anything not verified
* relevant risks or blockers
* the next step, when one is useful

