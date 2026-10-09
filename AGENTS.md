# Pi Agent Guidelines

## Code Navigation and Editing

Prefer semantic code intelligence over raw text operations for source code.

Prioritise the use of Serena MCP for code navigation and search. If an LSP is not active and/or Serena MCP fails in its task, then default to using standard tooling.

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

