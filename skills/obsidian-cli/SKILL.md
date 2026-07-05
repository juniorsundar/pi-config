---
name: obsidian-cli
description: Obsidian CLI vault operations and TaskNotes (tn) automation. Use when the user asks to operate an Obsidian vault through obsidian-cli, or to capture, schedule, track, Pomodoro, or report TaskNotes tasks.
---

# Obsidian CLI

Use this skill as a thin, predictable wrapper around `obsidian-cli`.

## Workflow

1. Classify the request:
   - **TaskNotes branch**: capture, schedule, prioritize, tag/context/project, recur, remind, estimate, start/stop time tracking, inspect time status, or Pomodoro. Load [`TASKNOTES.md`](TASKNOTES.md).
   - **Command branch**: any other Obsidian action. Load [`COMMANDS.md`](COMMANDS.md) when you need the command name, options, or output formats.

2. Resolve the target:
   - Use `vault=<name>` only when the user names a vault; otherwise let `obsidian-cli` use the active/default vault.
   - Prefer `path=<folder/note.md>` for exact targets and `file=<name>` for wikilink-style name resolution.
   - If the target is ambiguous and the operation writes, moves, deletes, restores, installs, disables, or starts/stops a session, ask or run a read-only discovery command first.

3. Choose the safest command:
   - Prefer read-only discovery before mutation: `read`, `files`, `search`, `properties`, `tasks`, `plugins:enabled`, `sync:status`, `tabs`, or `commands`.
   - Prefer machine-readable output where supported: `format=json` first, then `tsv`/`csv`.
   - For writes, pass exact option values; quote spaces and encode newlines as `\n` when needed.

4. Execute with a visible command line:
   - **TaskNotes branch**: run `tn <command> [options]`.
   - **Command branch**: run `obsidian-cli <command> key=value flag`.
   - If command syntax is uncertain or the catalog may be stale, run `obsidian-cli --help` or `tn --help` before acting.
   - Do not edit vault files directly when `obsidian-cli` or `tn` has a matching command, unless the user explicitly asks for raw file edits.

5. Report completion:
   - State the command family used, affected note/task if any, and the result.
   - For destructive or reversible actions, mention the recovery command family if relevant (`history:*`, `sync:*`).

## Safety rails

- Treat these as high-risk: `delete`, `move`, `rename`, `sync:restore`, `history:restore`, `plugin:install`, `plugin:uninstall`, `plugin:disable`, `plugin:enable`, `plugins:restrict`, `reload`, and `restart`.
- Do not expose secrets from plugin settings. If inspecting `.obsidian/plugins/tasknotes/data.json`, summarize only relevant non-secret settings.
- For TaskNotes statuses, priorities, folder paths, and field mappings, discover local configuration or ask; do not assume another vault's vocabulary.
