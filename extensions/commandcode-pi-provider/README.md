# Command Code Provider Extension for Pi

Pi extension that registers [Command Code](https://commandcode.ai) as a model
provider under the id **`commandcode`**.

> **Package name:** `pi-commandcode-pi-provider`

## Install

The extension is auto-discovered when placed in `~/.pi/agent/extensions/commandcode-pi-provider/`.
No extra steps — restart `pi` (or run `/reload`) and the provider is registered.

```bash
ls ~/.pi/agent/extensions/commandcode-pi-provider/
# package.json  index.ts  README.md
```

## Authenticate

The first time you select **Command Code** in `/login`, the extension asks
how you want to authenticate:

1. **Browser (automatic)** — opens Command Code Studio. The extension
   hosts a loopback HTTP server on `127.0.0.1` (ephemeral port) to receive
   the issued API key.
2. **Paste API key** — prompts you to paste a key from
   <https://commandcode.ai/studio/api-keys>.

If you pick **Browser** but the studio shows **"Copy your API key —
automatic transfer failed"** (which happens whenever the browser can't
reach the Pi's loopback — WSL, remote SSH, container, sandboxed browser,
etc.), the extension detects the timeout and offers a paste fallback so
you don't have to restart the flow.

The key is stored in `~/.pi/agent/auth.json` under the `commandcode`
entry.

### Environment variable

```bash
export CMD_API_KEY=sk-cmd-...
pi
```

takes precedence over the auth file when set.

## Use

```
/model
# pick any "commandcode / …" model
```

Available models include Claude 4.x (Sonnet, Opus, Haiku), GPT-5.x,
DeepSeek V4, Kimi K2.x, GLM-5.x, MiniMax, MiMo, Qwen 3.x, Gemini 3.x,
Step, Nemotron, and more — discovered live from
`https://api.commandcode.ai/provider/v1/models` at startup, with a
hardcoded fallback catalog used when the public endpoint is unreachable.

> **Model availability depends on your Command Code plan.** Most flagship
> models (Claude 4.x, GPT-5.x, GLM-5.x) require a Pro/Provider plan or
> extra on-demand usage. Free/Go plan accounts typically have access to
> the DeepSeek V4 and similar mid-tier models. If you get a
> `MODEL_NOT_IN_PLAN` 403 from CC, pick a different model.

## How it works

- **Endpoint** — All requests go to
  `https://api.commandcode.ai/alpha/generate`. This is Command Code's
  native streaming endpoint (the same one the `cmd` CLI uses). We do
  **not** use the `/provider/v1/...` OpenAI/Anthropic-compatible layer
  because that requires a Provider-tier plan and a different (more
  restrictive) key format.

- **Wire format** — Command Code's `/alpha/generate` speaks a custom JSON
  request body (a wrapped `params` envelope with `config`, `memory`,
  `taste`, `skills`, `permissionMode`) and a custom SSE event protocol
  (`text-delta`, `reasoning-delta`, `tool-call`, `finish` events). The
  extension implements a custom `streamSimple` handler that:
  1. Builds the custom request body from pi-ai's `Context`.
  2. POSTs to `/alpha/generate` with `Authorization: Bearer <key>` and
     a few CC-specific headers (`x-command-code-version`,
     `x-cli-environment`, `x-project-slug`, `x-session-id`).
  3. Parses the upstream SSE and translates each event into pi-ai's
     `AssistantMessageEventStream` protocol (`text_start/text_delta/
     text_end`, `thinking_start/.../thinking_end`, `toolcall_start/
     toolcall_end`, `done`/`error`).
  4. Propagates upstream errors as `MODEL_NOT_IN_PLAN`,
     `FORBIDDEN`, etc. through the standard pi error path.

- **Model discovery** — On startup, the extension calls
  `GET https://api.commandcode.ai/provider/v1/models` (5 s timeout,
  public endpoint, no auth required). If that fails (CC outage, no
  network), it falls back to a 30-model snapshot baked into `index.ts`.
  On every `session_start`, the live list is re-fetched so newly added
  models show up without `/reload`.

- **Loopback login** — The `/login` flow spawns an HTTP server on
  `127.0.0.1:<random>`, passes the URL as `?callback=…` to the Command
  Code Studio, and waits for the studio to POST `{ apiKey, state, … }`
  back. State is verified; payload is loopback-allowlisted; the server
  is closed once a key is received or after 60 s of silence. The whole
  flow is hard-capped at 5 minutes (`COMMANDCODE_CALLBACK_TIMEOUT_MS`).

## Files

| File | Purpose |
|------|---------|
| `package.json` | Pi package manifest (`pi.extensions: ["./index.ts"]`) |
| `index.ts` | Extension entry point — model discovery, OAuth, custom streamSimple |
| `README.md` | This file |

## Environment overrides

| Var | Default | Purpose |
|-----|---------|---------|
| `CMD_API_KEY` | _(unset)_ | API key (used by `getApiKey` if no OAuth credential is set) |
| `COMMANDCODE_CALLBACK_TIMEOUT_MS` | `60000` | How long to wait for the studio's loopback POST before offering the paste fallback. Lower this for fast-fail testing. |

## Troubleshooting

- **"No API key found for commandcode"** — run `/login` or `export CMD_API_KEY=…`.
- **Provider not in `/model` list** — check `pi` startup output for
  `[commandcode] Discovered N models`. If it says "using fallback list",
  the live endpoint is unreachable; check network/proxy.
- **Studio says "automatic transfer failed"** — the browser can't reach
  the Pi's loopback. The extension offers a paste fallback automatically
  after `COMMANDCODE_CALLBACK_TIMEOUT_MS`; pick it and paste the key from
  <https://commandcode.ai/studio/api-keys>.
- **Loopback succeeds but the key never reaches Pi** — the studio's POST
  to `127.0.0.1:<port>` is being blocked by a browser permission (e.g.
  Chrome's "local network access" prompt). Click **Allow** when prompted.
- **403 `MODEL_NOT_IN_PLAN: <model> available in Pro and above plans`**
  — your Command Code plan doesn't include that model. Switch to one
  that your plan supports (e.g. `deepseek/deepseek-v4-flash` for Go
  plans).
- **403 `Your Go plan doesn't include API access`** — only seen if you
  hit the `/provider/v1/...` endpoints directly. This extension targets
  `/alpha/generate` instead, which works on all plan tiers; if you see
  this error, your key may be issued for the wrong tier, or the model
  itself isn't available on your plan.
