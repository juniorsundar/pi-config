# TaskNotes quick reference

Use this branch for TaskNotes task capture, scheduling, time tracking, Pomodoro, and task reporting.

## Discovery

- Verify the plugin when needed: `obsidian-cli plugins:enabled filter=community format=tsv` and look for `tasknotes`.
- If local vocabulary matters, inspect non-secret TaskNotes settings: `.obsidian/plugins/tasknotes/manifest.json` and `.obsidian/plugins/tasknotes/data.json`.
- Relevant TaskNotes setting keys include `customStatuses`, `customPriorities`, `defaultTaskStatus`, `defaultTaskPriority`, `fieldMapping`, `taskTag`, and `taskFolder`.
- If multiple tasks may match, search/list first and then use `path=<path>` for the write.

## Capture

Command:

```sh
obsidian-cli tasknotes:capture text="..."
```

Options:

- `text=<text>`: free text parsed with NLP unless `literal` is set.
- `title=<title>`: explicit task title; overrides NLP-derived title.
- `details=<details>`: explicit body/details.
- `status=<status>`: TaskNotes status.
- `priority=<priority>`: TaskNotes priority.
- `due=<date>`: due date or datetime, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`.
- `scheduled=<date>`: scheduled date or datetime.
- `tags=<tag1,tag2>`: comma-separated tags.
- `contexts=<ctx1,ctx2>`: comma-separated contexts.
- `projects=<proj1,proj2>`: comma-separated projects.
- `recurrence=<rrule>`: recurrence rule.
- `recurrence-anchor=<scheduled|completion>`: how recurring tasks advance.
- `reminders=<spec>`: `due:-PT1H;scheduled:-PT30M;at:2026-04-02T09:00` or JSON array.
- `estimate=<minutes>`: estimate in minutes.
- `literal`: treat `text` as literal title instead of NLP.

Predictable capture rules:

- Use `text` without `literal` when the user wants natural-language parsing.
- Use `title`, `details`, and explicit flags when the user provides structured fields or when accuracy matters.
- Use `literal` when the requested title contains dates, tags, or words that should not be parsed.

Examples:

```sh
obsidian-cli tasknotes:capture text="Submit rent receipt tomorrow 9am #admin" priority=high estimate=10
obsidian-cli tasknotes:capture text="Submit rent receipt" due=2026-07-05 priority=high tags=admin estimate=10 literal
obsidian-cli tasknotes:capture title="Review weekly plan" scheduled=2026-07-06 recurrence="FREQ=WEEKLY;BYDAY=MO" recurrence-anchor=scheduled
```

## Time tracking

Start:

```sh
obsidian-cli tasknotes:start-time path="Tasks/Submit rent receipt.md" description="Filing receipt"
obsidian-cli tasknotes:start-time title="Submit rent receipt"
obsidian-cli tasknotes:start-time query="rent receipt"
```

Stop:

```sh
obsidian-cli tasknotes:stop-time path="Tasks/Submit rent receipt.md"
obsidian-cli tasknotes:stop-time query="rent receipt"
obsidian-cli tasknotes:stop-time
```

Status:

```sh
obsidian-cli tasknotes:time-status
obsidian-cli tasknotes:time-status path="Tasks/Submit rent receipt.md"
obsidian-cli tasknotes:time-status query="rent receipt"
```

Rules:

- Prefer `path` over `title`, and `title` over `query`, for writes.
- Use bare `tasknotes:stop-time` only when the only active session is unambiguous.

## Pomodoro

Command:

```sh
obsidian-cli tasknotes:pomodoro action=<status|start|pause|resume|stop|short-break|long-break>
```

Examples:

```sh
obsidian-cli tasknotes:pomodoro action=status
obsidian-cli tasknotes:pomodoro action=start path="Tasks/Submit rent receipt.md" duration=25
obsidian-cli tasknotes:pomodoro action=pause
obsidian-cli tasknotes:pomodoro action=resume
obsidian-cli tasknotes:pomodoro action=short-break
obsidian-cli tasknotes:pomodoro action=stop
```

Rules:

- For `action=start`, provide one of `path`, `title`, or `query`; prefer `path`.
- `duration=<minutes>` overrides the work-session duration.

## Classic markdown tasks

TaskNotes is note-based, but the CLI also supports markdown checkbox tasks:

```sh
obsidian-cli tasks todo verbose format=json
obsidian-cli task ref="Daily/2026-07-04.md:12" done
obsidian-cli task path="Daily/2026-07-04.md" line=12 toggle
obsidian-cli task daily line=5 status="/"
```

Use these only for markdown checkboxes, not TaskNotes note files, unless the user asks for markdown task operations.
