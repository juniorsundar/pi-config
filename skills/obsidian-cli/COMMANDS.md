# Obsidian CLI command catalog

This catalog is a snapshot of `obsidian-cli --help` from this machine. If a command fails or seems missing, refresh with `obsidian-cli --help` and follow the current output.

## Command families

- **Files and folders**: `files`, `file`, `read`, `create`, `append`, `prepend`, `delete`, `move`, `rename`, `folders`, `folder`, `open`, `random`, `random:read`, `recents`, `wordcount`.
- **Daily notes and templates**: `daily`, `daily:path`, `daily:read`, `daily:append`, `daily:prepend`, `templates`, `template:insert`, `template:read`.
- **Links and graph hygiene**: `links`, `backlinks`, `aliases`, `tags`, `tag`, `properties`, `property:read`, `property:set`, `property:remove`, `orphans`, `deadends`, `unresolved`, `outline`.
- **Search**: `search`, `search:context`, `search:open`.
- **Tasks**: `tasks`, `task`, plus TaskNotes commands in `TASKNOTES.md`.
- **Bases and bookmarks**: `bases`, `base:views`, `base:query`, `base:create`, `bookmark`, `bookmarks`.
- **Tabs, workspaces, vaults, web, app lifecycle**: `tab:open`, `tabs`, `workspace`, `vault`, `vaults`, `web`, `reload`, `restart`, `version`, `help`.
- **Commands and hotkeys**: `commands`, `command`, `hotkeys`, `hotkey`.
- **Plugins, snippets, themes**: `plugins`, `plugins:enabled`, `plugins:restrict`, `plugin:*`, `snippets`, `snippets:enabled`, `snippet:*`, `themes`, `theme:*`.
- **History and Sync**: `history:*`, `sync:*`, `diff`.
- **Developer tools**: `dev:*`, `devtools`, `eval`.

## Full help

```text
Obsidian CLI

Usage: obsidian <command> [options]

Options:
  vault=<name>          Target a specific vault by name

Notes:
  file resolves by name (like wikilinks), path is exact (folder/note.md)
  Most commands default to the active file when file/path is omitted
  Quote values with spaces: name="My Note"
  Use \n for newline, \t for tab in content values

Commands:
  aliases               List aliases in the vault
    file=<name>         - File name
    path=<path>         - File path
    total               - Return alias count
    verbose             - Include file paths
    active              - Show aliases for active file

  append                Append content to a file
    file=<name>         - File name
    path=<path>         - File path
    content=<text>      - Content to append (required)
    inline              - Append without newline

  backlinks             List backlinks to a file
    file=<name>         - Target file name
    path=<path>         - Target file path
    counts              - Include link counts
    total               - Return backlink count
    format=json|tsv|csv - Output format (default: tsv)

  base:create           Create a new item in a base
    file=<name>         - Base file name
    path=<path>         - Base file path
    view=<name>         - View name
    name=<name>         - New file name
    content=<text>      - Initial content
    open                - Open file after creating
    newtab              - Open in new tab

  base:query            Query a base and return results
    file=<name>         - Base file name
    path=<path>         - Base file path
    view=<name>         - View name to query
    format=json|csv|tsv|md|paths  - Output format (default: json)

  base:views            List views in the current base file

  bases                 List all base files in vault

  bookmark              Add a bookmark
    file=<path>         - File to bookmark
    subpath=<subpath>   - Subpath (heading or block) within file
    folder=<path>       - Folder to bookmark
    search=<query>      - Search query to bookmark
    url=<url>           - URL to bookmark
    title=<title>       - Bookmark title

  bookmarks             List bookmarks
    total               - Return bookmark count
    verbose             - Include bookmark types
    format=json|tsv|csv - Output format (default: tsv)

  command               Execute an Obsidian command
    id=<command-id>     - Command ID to execute (required)

  commands              List available commands
    filter=<prefix>     - Filter by ID prefix

  create                Create a new file
    name=<name>         - File name
    path=<path>         - File path
    content=<text>      - Initial content
    template=<name>     - Template to use
    overwrite           - Overwrite if file exists
    open                - Open file after creating
    newtab              - Open in new tab

  daily                 Open daily note
    paneType=tab|split|window  - Pane type to open in

  daily:append          Append content to daily note
    content=<text>      - Content to append (required)
    inline              - Append without newline
    open                - Open file after adding
    paneType=tab|split|window  - Pane type to open in

  daily:path            Get daily note path

  daily:prepend         Prepend content to daily note
    content=<text>      - Content to prepend (required)
    inline              - Prepend without newline
    open                - Open file after adding
    paneType=tab|split|window  - Pane type to open in

  daily:read            Read daily note contents

  deadends              List files with no outgoing links
    total               - Return dead-end count
    all                 - Include non-markdown files

  delete                Delete a file
    file=<name>         - File name
    path=<path>         - File path
    permanent           - Skip trash, delete permanently

  diff                  List or diff local/sync versions
    file=<name>         - File name
    path=<path>         - File path
    from=<n>            - Version number to diff from
    to=<n>              - Version number to diff to
    filter=local|sync   - Filter by version source

  file                  Show file info
    file=<name>         - File name
    path=<path>         - File path

  files                 List files in the vault
    folder=<path>       - Filter by folder
    ext=<extension>     - Filter by extension
    total               - Return file count

  folder                Show folder info
    path=<path>         - Folder path (required)
    info=files|folders|size  - Return specific info only

  folders               List folders in the vault
    folder=<path>       - Filter by parent folder
    total               - Return folder count

  help                  Show list of all available commands
    <command>           - Show help for a specific command

  history               List file history versions
    file=<name>         - File name
    path=<path>         - File path

  history:list          List files with history

  history:open          Open file recovery
    file=<name>         - File name
    path=<path>         - File path

  history:read          Read a file history version
    file=<name>         - File name
    path=<path>         - File path
    version=<n>         - Version number (default: 1)

  history:restore       Restore a file history version
    file=<name>         - File name
    path=<path>         - File path
    version=<n>         - Version number (required)

  hotkey                Get hotkey for a command
    id=<command-id>     - Command ID (required)
    verbose             - Show if custom or default

  hotkeys               List hotkeys
    total               - Return hotkey count
    verbose             - Show if hotkey is custom
    format=json|tsv|csv - Output format (default: tsv)
    all                 - Include commands without hotkeys

  links                 List outgoing links from a file
    file=<name>         - File name
    path=<path>         - File path
    total               - Return link count

  move                  Move or rename a file
    file=<name>         - File name
    path=<path>         - File path
    to=<path>           - Destination folder or path (required)

  open                  Open a file
    file=<name>         - File name
    path=<path>         - File path
    newtab              - Open in new tab

  orphans               List files with no incoming links
    total               - Return orphan count
    all                 - Include non-markdown files

  outline               Show headings for the current file
    file=<name>         - File name
    path=<path>         - File path
    format=tree|md|json - Output format (default: tree)
    total               - Return heading count

  plugin                Get plugin info
    id=<plugin-id>      - Plugin ID (required)

  plugin:disable        Disable a plugin
    id=<id>             - Plugin ID (required)
    filter=core|community  - Plugin type

  plugin:enable         Enable a plugin
    id=<id>             - Plugin ID (required)
    filter=core|community  - Plugin type

  plugin:install        Install a community plugin
    id=<id>             - Plugin ID (required)
    enable              - Enable after install

  plugin:reload         Reload a plugin (for developers)
    id=<id>             - Plugin ID (required)

  plugin:uninstall      Uninstall a community plugin
    id=<id>             - Plugin ID (required)

  plugins               List installed plugins
    filter=core|community  - Filter by plugin type
    versions            - Include version numbers
    format=json|tsv|csv - Output format (default: tsv)

  plugins:enabled       List enabled plugins
    filter=core|community  - Filter by plugin type
    versions            - Include version numbers
    format=json|tsv|csv - Output format (default: tsv)

  plugins:restrict      Toggle or check restricted mode
    on                  - Enable restricted mode
    off                 - Disable restricted mode

  prepend               Prepend content to a file
    file=<name>         - File name
    path=<path>         - File path
    content=<text>      - Content to prepend (required)
    inline              - Prepend without newline

  properties            List properties in the vault
    file=<name>         - Show properties for file
    path=<path>         - Show properties for path
    name=<name>         - Get specific property count
    total               - Return property count
    sort=count          - Sort by count (default: name)
    counts              - Include occurrence counts
    format=yaml|json|tsv  - Output format (default: yaml)
    active              - Show properties for active file

  property:read         Read a property value from a file
    name=<name>         - Property name (required)
    file=<name>         - File name
    path=<path>         - File path

  property:remove       Remove a property from a file
    name=<name>         - Property name (required)
    file=<name>         - File name
    path=<path>         - File path

  property:set          Set a property on a file
    name=<name>         - Property name (required)
    value=<value>       - Property value (required)
    type=text|list|number|checkbox|date|datetime  - Property type
    file=<name>         - File name
    path=<path>         - File path

  random                Open a random note
    folder=<path>       - Limit to folder
    newtab              - Open in new tab

  random:read           Read a random note
    folder=<path>       - Limit to folder

  read                  Read file contents
    file=<name>         - File name
    path=<path>         - File path

  recents               List recently opened files
    total               - Return recent file count

  reload                Reload the vault

  rename                Rename a file
    file=<name>         - File name
    path=<path>         - File path
    name=<name>         - New file name (required)

  restart               Restart the app

  search                Search vault for text
    query=<text>        - Search query (required)
    path=<folder>       - Limit to folder
    limit=<n>           - Max files
    total               - Return match count
    case                - Case sensitive
    format=text|json    - Output format (default: text)

  search:context        Search with matching line context
    query=<text>        - Search query (required)
    path=<folder>       - Limit to folder
    limit=<n>           - Max files
    case                - Case sensitive
    format=text|json    - Output format (default: text)

  search:open           Open search view
    query=<text>        - Initial search query

  snippet:disable       Disable a CSS snippet
    name=<name>         - Snippet name (required)

  snippet:enable        Enable a CSS snippet
    name=<name>         - Snippet name (required)

  snippets              List installed CSS snippets

  snippets:enabled      List enabled CSS snippets

  sync                  Pause or resume sync
    on                  - Resume sync
    off                 - Pause sync

  sync:deleted          List deleted files in sync
    total               - Return deleted file count

  sync:history          List sync version history for a file
    file=<name>         - File name
    path=<path>         - File path
    total               - Return version count

  sync:open             Open sync history
    file=<name>         - File name
    path=<path>         - File path

  sync:read             Read a sync version
    file=<name>         - File name
    path=<path>         - File path
    version=<n>         - Version number (required)

  sync:restore          Restore a sync version
    file=<name>         - File name
    path=<path>         - File path
    version=<n>         - Version number (required)

  sync:status           Show sync status

  tab:open              Open a new tab
    group=<id>          - Tab group ID
    file=<path>         - File to open
    view=<type>         - View type to open

  tabs                  List open tabs
    ids                 - Include tab IDs

  tag                   Get tag info
    name=<tag>          - Tag name (required)
    total               - Return occurrence count
    verbose             - Include file list and count

  tags                  List tags in the vault
    file=<name>         - File name
    path=<path>         - File path
    total               - Return tag count
    counts              - Include tag counts
    sort=count          - Sort by count (default: name)
    format=json|tsv|csv - Output format (default: tsv)
    active              - Show tags for active file

  task                  Show or update a task
    ref=<path:line>     - Task reference (path:line)
    file=<name>         - File name
    path=<path>         - File path
    line=<n>            - Line number
    toggle              - Toggle task status
    done                - Mark as done
    todo                - Mark as todo
    daily               - Use daily note
    status="<char>"     - Set status character

  tasknotes:capture     [TaskNotes]: Create a TaskNotes task from free text or explicit flags
    text=<text>         - Task text to parse with NLP unless --literal is set
    title=<title>       - Explicit task title; overrides NLP-derived title
    details=<details>   - Task details/body; overrides NLP-derived details
    status=<status>     - Explicit task status
    priority=<priority> - Explicit task priority
    due=<date>          - Due date or datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM)
    scheduled=<date>    - Scheduled date or datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM)
    tags=<tag1,tag2>    - Comma-separated tags; overrides NLP-derived tags
    contexts=<ctx1,ctx2>  - Comma-separated contexts; overrides NLP-derived contexts
    projects=<proj1,proj2>  - Comma-separated projects; overrides NLP-derived projects
    recurrence=<rrule>  - Explicit recurrence rule
    recurrence-anchor=<scheduled|completion>  - How recurring tasks advance: from the scheduled date or completion date
    reminders=<spec>    - Reminder spec(s): due:-PT1H;scheduled:-PT30M;at:2026-04-02T09:00 or a JSON array
    estimate=<minutes>  - Time estimate in minutes
    literal             - Treat --text as a literal title instead of parsing it with NLP

  tasknotes:pomodoro    [TaskNotes]: Control TaskNotes Pomodoro sessions or inspect the current Pomodoro state
    action=<status|start|pause|resume|stop|short-break|long-break>  - Pomodoro action to perform (default: status)
    path=<path>         - Exact task file path for action=start
    title=<title>       - Exact task title for action=start
    query=<text>        - Substring match against task title or path for action=start
    duration=<minutes>  - Optional work-session duration override for action=start

  tasknotes:start-time  [TaskNotes]: Start time tracking for a task
    path=<path>         - Exact task file path
    title=<title>       - Exact task title
    query=<text>        - Substring match against task title or path
    description=<text>  - Optional description for the started time entry

  tasknotes:stop-time   [TaskNotes]: Stop time tracking for a task, or for the only active session if unambiguous
    path=<path>         - Exact task file path
    title=<title>       - Exact task title
    query=<text>        - Substring match against task title or path

  tasknotes:time-status [TaskNotes]: Show active time-tracking sessions, or detailed status for a specific task
    path=<path>         - Exact task file path
    title=<title>       - Exact task title
    query=<text>        - Substring match against task title or path

  tasks                 List tasks in the vault
    file=<name>         - Filter by file name
    path=<path>         - Filter by file path
    total               - Return task count
    done                - Show completed tasks
    todo                - Show incomplete tasks
    status="<char>"     - Filter by status character
    verbose             - Group by file with line numbers
    format=json|tsv|csv - Output format (default: text)
    active              - Show tasks for active file
    daily               - Show tasks from daily note

  template:insert       Insert template into active file
    name=<template>     - Template name (required)

  template:read         Read template content
    name=<template>     - Template name (required)
    resolve             - Resolve template variables
    title=<title>       - Title for variable resolution

  templates             List templates
    total               - Return template count

  theme                 Show active theme or get info
    name=<name>         - Theme name for details

  theme:install         Install a community theme
    name=<name>         - Theme name (required)
    enable              - Activate after install

  theme:set             Set active theme
    name=<name>         - Theme name (empty for default) (required)

  theme:uninstall       Uninstall a theme
    name=<name>         - Theme name (required)

  themes                List installed themes
    versions            - Include version numbers

  unresolved            List unresolved links in vault
    total               - Return unresolved link count
    counts              - Include link counts
    verbose             - Include source files
    format=json|tsv|csv - Output format (default: tsv)

  vault                 Show vault info
    info=name|path|files|folders|size  - Return specific info only

  vaults                List known vaults
    total               - Return vault count
    verbose             - Include vault paths

  version               Show Obsidian version

  web                   Open URL in web viewer
    url=<url>           - URL to open (required)
    newtab              - Open in new tab

  wordcount             Count words and characters
    file=<name>         - File name
    path=<path>         - File path
    words               - Return word count only
    characters          - Return character count only

  workspace             Show workspace tree
    ids                 - Include workspace item IDs


Developer:
  dev:cdp               Run a Chrome DevTools Protocol command
    method=<CDP.method> - CDP method to call (required)
    params=<json>       - Method parameters as JSON

  dev:console           Show captured console messages
    clear               - Clear the console buffer
    limit=<n>           - Max messages to show (default 50)
    level=log|warn|error|info|debug  - Filter by log level

  dev:css               Inspect CSS with source locations
    selector=<css>      - CSS selector (required)
    prop=<name>         - Filter by property name

  dev:debug             Attach/detach Chrome DevTools Protocol debugger
    on                  - Attach debugger
    off                 - Detach debugger

  dev:dom               Query DOM elements
    selector=<css>      - CSS selector (required)
    total               - Return element count
    text                - Return text content
    inner               - Return innerHTML instead of outerHTML
    all                 - Return all matches instead of first
    attr=<name>         - Get attribute value
    css=<prop>          - Get CSS property value

  dev:errors            Show captured errors
    clear               - Clear the error buffer

  dev:mobile            Toggle mobile emulation
    on                  - Enable mobile emulation
    off                 - Disable mobile emulation

  dev:screenshot        Take a screenshot
    path=<filename>     - Output file path

  devtools              Toggle Electron dev tools

  eval                  Execute JavaScript and return result
    code=<javascript>   - JavaScript code to execute (required)
```
