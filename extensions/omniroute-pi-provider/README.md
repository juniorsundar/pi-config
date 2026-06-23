# omniroute-pi-provider

Pi provider extension for the [OmniRoute](https://github.com/diegosouzapw/OmniRoute) local
AI gateway. OmniRoute exposes a single OpenAI-compatible endpoint
(`http://localhost:20128/v1`) that fronts 200+ AI providers with smart routing,
fallback, and token compression.

This extension registers it as a Pi model provider, discovers the available
models from the gateway's `/v1/models` catalog, and **caches that catalog on
disk** (24h TTL) so Pi doesn't re-scour the gateway on every startup.

## Installation

This lives in your global extensions directory and is auto-discovered — no
`pi install` needed:

```
~/.pi/agent/extensions/omniroute-pi-provider/
├── index.ts
├── package.json
└── README.md
```

## Configuration

### Endpoint

Defaults to `http://localhost:20128/v1`. Override with:

```bash
export OMNIROUTE_API_URL=http://localhost:20128/v1
```

### API token

The token is read from `~/.pi/agent/auth.json` under the `omniroute` key
(type `api_key`). Set it through Pi's built-in login flow:

```
/login
# → "Use an API key"
# → omniroute
# → paste your OmniRoute API token
```

Or, without the login flow:

```bash
export OMNIROUTE_API_KEY=omr_...
```

A manually-added `auth.json` entry works too:

```json
{ "omniroute": { "type": "api_key", "key": "omr_..." } }
```

## Caching

- The model catalog is cached at `~/.pi/agent/omniroute-model-cache.json`.
- Cache TTL is 24 hours. On a fresh (or expired) cache, Pi fetches once at
  startup; on subsequent starts within the TTL it reuses the disk cache with no
  network call.
- After session start, the catalog is refreshed in the background and the
  provider is re-registered only when the model list actually changed.
- Force a refresh with the `:omniroute-rebuild-cache` command.

## Models

Only chat models are registered (image / audio / embedding / rerank / video /
music models from the catalog are filtered out). Reasoning and vision
capabilities are derived from each model's `capabilities` field.