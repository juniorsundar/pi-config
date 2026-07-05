# TaskNotes quick reference

Use this branch to work with TaskNotes tasks through the `tn` CLI (`tasknotes-cli`).

## Discovery

- Verify the plugin is installed and enabled:
  ```sh
  obsidian-cli plugins:enabled filter=community format=tsv | grep tasknotes
  ```
- `tn` communicates with the TaskNotes plugin API. If commands fail, ensure Obsidian is running and the TaskNotes plugin is enabled.
- Task IDs (`<taskId>`) are shown by `tn list` and `tn search`. Use them for all task-specific operations (complete, update, timer, pomodoro, etc.).
- If local vocabulary matters, inspect non-secret TaskNotes settings: `.obsidian/plugins/tasknotes/manifest.json` and `.obsidian/plugins/tasknotes/data.json`.
- Relevant keys include `customStatuses`, `customPriorities`, `defaultTaskStatus`, `defaultTaskPriority`, `fieldMapping`, `taskTag`, and `taskFolder`.

## Creating tasks

```sh
tn create "Buy groceries tomorrow 9am #personal priority=high"
```

`tn create` uses natural-language parsing (NLP) — dates, times, tags, priorities, and projects are extracted from the text. There are no explicit flags for structured fields; to set fields explicitly, create then update.

To set fields that NLP can't infer:

```sh
tn create "Write Q4 report"
tn update <taskId> --priority high --due 2026-07-10 --add-tags work
```

## Listing and searching tasks

```sh
tn list                          # all tasks
tn list --filter "status:open"   # only open tasks
tn list --filter "priority:high AND status:in-progress"
tn search "drone provisioning"
```

**Filter expressions** support:
- `status:<value>` — `open`, `in-progress`, `done`, `cancelled`, `follow-up`
- `priority:<value>` — `highest`, `high`, `medium`, `low`, `lowest`
- `AND`, `OR`, parentheses grouping
- Omit `--filter` to see all tasks

## Updating tasks

```sh
tn update <taskId> --title "New title"
tn update <taskId> --status in-progress
tn update <taskId> --priority high
tn update <taskId> --due 2026-07-10
tn update <taskId> --scheduled 2026-07-08
tn update <taskId> --estimate 30
tn update <taskId> --add-tags admin,review
tn update <taskId> --remove-tags backlog
tn update <taskId> --add-contexts @office
tn update <taskId> --add-projects ssrc-vnu
```

## Completing and toggling

```sh
tn complete <taskId>              # mark done
tn toggle <taskId>                # toggle open/closed
tn archive <taskId>               # toggle archive
```

## Time tracking

```sh
tn timer start --task <taskId>
tn timer stop --task <taskId>
tn timer status                   # active sessions
tn timer log                      # today's log
tn timer log --period week        # weekly log
tn timer log --period month       # monthly log
tn timer log --from 2026-07-01 --to 2026-07-07
tn timer log --limit 20
```

Rules:
- Use `tn list` or `tn search` first to find the task ID if unknown.
- `--task` is required for `start` and `stop`; `status` and `log` can run without it.

## Pomodoro

```sh
tn pomodoro status                # current state
tn pomodoro start --task <taskId>
tn pomodoro start --task <taskId> --duration 25
tn pomodoro pause
tn pomodoro resume
tn pomodoro stop
tn pomodoro short-break
tn pomodoro long-break
tn pomodoro stats                 # session statistics
tn pomodoro stats --week
tn pomodoro stats --month
tn pomodoro sessions              # past sessions
tn pomodoro sessions --date 2026-07-04
tn pomodoro sessions --limit 10
```

## Stats and projects

```sh
tn stats                          # task statistics
tn stats --json                   # machine-readable output
tn projects list
tn projects show <projectName>
tn projects create <projectName> --description "..." --folder "task_notes/projects"
tn projects stats <projectName> --period month
```

## Deleting and archiving

```sh
tn delete <taskId>                # delete permanently
tn archive <taskId>               # toggle archive
```

## Configuration

```sh
tn config --list                  # show all settings
tn config --get vault             # get single value
tn config --set vault=MyVault     # set value
```

## General safety rules

1. Use `tn list` or `tn search` before any write-by-ID to confirm the right task.
2. Prefer `tn list --filter` over `tn search` for structured queries; prefer `tn search` for free-text.
3. `tn create` uses NLP — the user can write natural language with dates, priorities, tags, and projects inline. Do not add explicit flags to `tn create`; use `tn update` for post-creation field adjustments.
4. For destructive operations (`delete`, `archive`), confirm with the user if the ID looks ambiguous.
