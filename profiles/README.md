# Pi profiles

The tracked `pi` shim in this directory intercepts `pi profiles`; all other commands go to the managed `bin/pi` unchanged. Activate it with `sh ~/.pi/agent/profiles/bootstrap.sh`. The script only replaces `~/.local/bin/pi` if it points to the managed launcher; running it again is safe.

To undo, replace the link with one pointing back to `~/.pi/agent/bin/pi`. If a future Pi installer replaces the PATH link, rerun the bootstrap script. Pi's own `bin/pi` and installed release are never edited.

Create `~/.pi/agent/profiles/coding/` and put any replacement agent-directory files or directories in it. Run `pi profiles list` or `pi profiles run coding [Pi arguments...]`. A present file or directory replaces the corresponding global entry in full; an absent entry inherits it. A profile `AGENTS.md` also suppresses inherited global instruction-file alternatives (`AGENTS.override.md` and `CLAUDE.md`). Project configuration still loads normally. An empty `skills/` masks agent-directory skills, but `~/.agents/skills/`, project skills, and skills in enabled packages still load.

`settings.json` is a complete replacement: repeat the desired `packages` declarations there. Profiles use the shared `git/` and `npm/` installations; missing or different package sources fail before Pi starts. Install or update packages with plain `pi`, not `pi profiles run`. Relative settings paths resolve from the effective agent directory. The effective directory is kept at `${XDG_CACHE_HOME:-$HOME/.cache}/pi-profiles/<name>` so session references to resources remain valid.

Unchanged credentials, sessions, trust decisions, and caches are shared. Simultaneous writes to inherited global files from ordinary Pi and a profile can race; profile runs are not an isolation boundary. Extensions that hardcode `~/.pi/agent` are not profile-aware.

Run `node --test ~/.pi/agent/profiles/cli.test.mjs` to check the overlay and delegation.
