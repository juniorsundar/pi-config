# Pi Agent Guidelines

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

