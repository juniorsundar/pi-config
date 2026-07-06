/**
 * OmniRoute Provider Extension for Pi
 *
 * Registers the local OmniRoute gateway (an OpenAI-compatible AI gateway that
 * fronts 200+ providers) as a Pi model provider. Models are discovered from the
 * gateway's `/v1/models` endpoint and cached on disk so we don't re-scour the
 * catalog on every startup.
 *
 * Endpoint:  http://localhost:20128/v1  (override with OMNIROUTE_API_URL)
 * Auth:      API token read from ~/.pi/agent/auth.json under the "omniroute"
 *            key (type "api_key"). Set it via `/login` → "Use an API key" →
 *            omniroute, or with the OMNIROUTE_API_KEY env var.
 *
 * Usage:
 *   pi
 *   /login            # → Use an API key → omniroute → paste token
 *   :omniroute-rebuild-cache   # force-refresh the cached model list
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

// =============================================================================
// Constants
// =============================================================================

// The base URL is the OpenAI-compatible root (already includes /v1). The models
// endpoint is `${OMNIROUTE_API_BASE}/models` and chat completions are handled by
// pi's openai-completions driver against `${OMNIROUTE_API_BASE}/chat/completions`.
const OMNIROUTE_API_BASE =
  process.env.OMNIROUTE_API_URL || "http://localhost:20128/v1";
const OMNIROUTE_MODELS_ENDPOINT = `${OMNIROUTE_API_BASE}/models`;

const MODELS_FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILENAME = "omniroute-model-cache.json";

// =============================================================================
// Stored Credential Lookup
// =============================================================================

/**
 * Resolve the OmniRoute API token.
 *
 * Priority:
 *   1. OMNIROUTE_API_KEY env var
 *   2. ~/.pi/agent/auth.json → omniroute (type "api_key" → key, or oauth → access)
 *   3. <cwd>/.pi/agent/auth.json → same
 *
 * Pi's modelRegistry resolves the request-time Authorization header itself via
 * authStorage.getApiKey("omniroute"); this function is only used by the
 * extension to authenticate its own /v1/models catalog fetch.
 */
async function getOmniRouteToken(): Promise<string | undefined> {
  if (process.env.OMNIROUTE_API_KEY) return process.env.OMNIROUTE_API_KEY;

  const home = homedir();
  const authPaths = [
    join(home, ".pi", "agent", "auth.json"),
    join(process.cwd(), ".pi", "agent", "auth.json"),
  ];
  for (const authPath of authPaths) {
    try {
      const content = await readFile(authPath, "utf-8");
      const auth = JSON.parse(content) as Record<string, unknown>;
      const entry = auth.omniroute as Record<string, unknown> | undefined;
      if (!entry) continue;
      if (entry.type === "api_key" && typeof entry.key === "string") {
        return entry.key;
      }
      if (entry.type === "oauth" && typeof entry.access === "string") {
        return entry.access;
      }
    } catch {
      // File missing or unreadable — try next path.
    }
  }
  return undefined;
}

// =============================================================================
// Model Cache
// =============================================================================

interface ModelCache {
  updatedAt: string;
  base: string;
  models: ProviderModelConfig[];
}

function cachePath(): string {
  return join(homedir(), ".pi", "agent", CACHE_FILENAME);
}

async function loadModelCache(expectedBase: string): Promise<ModelCache | null> {
  try {
    const raw = await readFile(cachePath(), "utf-8");
    const data = JSON.parse(raw) as ModelCache;
    const updatedAt = new Date(data.updatedAt).getTime();
    if (isNaN(updatedAt) || Date.now() - updatedAt > CACHE_TTL_MS) {
      console.log("[omniroute] Model cache expired or invalid");
      return null;
    }
    if (data.base && data.base !== expectedBase) {
      // Endpoint changed (e.g. env override) — don't trust the cached list.
      return null;
    }
    if (!Array.isArray(data.models)) return null;
    return data;
  } catch {
    return null;
  }
}

async function saveModelCache(
  base: string,
  models: ProviderModelConfig[],
): Promise<void> {
  try {
    const cacheDir = join(homedir(), ".pi", "agent");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      cachePath(),
      JSON.stringify(
        { updatedAt: new Date().toISOString(), base, models },
        null,
        2,
      ),
      "utf-8",
    );
  } catch (error) {
    console.warn(
      "[omniroute] Failed to write model cache:",
      error instanceof Error ? error.message : error,
    );
  }
}

// =============================================================================
// Model Mapping
// =============================================================================

interface OmniRouteModel {
  id: string;
  name?: string;
  type?: string; // "chat" | "embedding" | "image" | "audio" | "rerank" | "video" | "music" | "moderation"
  context_length?: number;
  max_output_tokens?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  capabilities?: {
    reasoning?: boolean;
    thinking?: boolean;
    vision?: boolean;
    tool_calling?: boolean;
    [key: string]: unknown;
  };
  free?: boolean;
}

/** Non-chat model types returned by the OmniRoute catalog. */
const NON_CHAT_TYPES = new Set([
  "embedding",
  "image",
  "audio",
  "rerank",
  "video",
  "music",
  "moderation",
]);

function isChatModel(m: OmniRouteModel): boolean {
  if (m.type && NON_CHAT_TYPES.has(m.type)) return false;
  const out = m.output_modalities ?? [];
  if (out.includes("image") || out.includes("audio") || out.includes("video")) {
    return false;
  }
  return true;
}

function supportsImages(m: OmniRouteModel): boolean {
  if (m.capabilities?.vision === true) return true;
  return (m.input_modalities ?? []).some((mod) =>
    mod.toLowerCase().includes("image"),
  );
}

function supportsReasoning(m: OmniRouteModel): boolean {
  return m.capabilities?.reasoning === true || m.capabilities?.thinking === true;
}

function mapOmniRouteModel(m: OmniRouteModel): ProviderModelConfig {
  const contextWindow = m.context_length && m.context_length > 0
    ? m.context_length
    : 128_000;
  const maxTokens = m.max_output_tokens && m.max_output_tokens > 0
    ? m.max_output_tokens
    : Math.ceil(contextWindow * 0.2);

  return {
    id: m.id,
    name: m.name ?? m.id,
    reasoning: supportsReasoning(m),
    input: supportsImages(m) ? ["text", "image"] : ["text"],
    // OmniRoute's catalog doesn't expose reliable per-token pricing; leave at 0
    // so usage tracking still works (cost will read as $0 unless the gateway
    // returns pricing in a future revision).
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
  };
}

// =============================================================================
// Model Fetching
// =============================================================================

interface OmniRouteModelsResponse {
  data?: OmniRouteModel[];
}

async function fetchOmniRouteModels(
  token?: string,
): Promise<ProviderModelConfig[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "pi-omniroute-provider",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(OMNIROUTE_MODELS_ENDPOINT, {
    headers,
    signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    // If the gateway requires auth and we had no token, retry unauthenticated —
    // some OmniRoute deployments expose the catalog without a key.
    if (response.status === 401 && token) {
      return fetchOmniRouteModels(undefined);
    }
    throw new Error(
      `Failed to fetch OmniRoute models: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as OmniRouteModelsResponse;
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error("Invalid OmniRoute models response: missing data array");
  }

  const seen = new Set<string>();
  const models: ProviderModelConfig[] = [];
  for (const m of json.data) {
    if (!m || typeof m.id !== "string" || m.id.length === 0) continue;
    if (!isChatModel(m)) continue;
    if (seen.has(m.id)) continue; // catalog emits alias + provider-id duplicates
    seen.add(m.id);
    models.push(mapOmniRouteModel(m));
  }
  return models;
}

// =============================================================================
// Provider Config
// =============================================================================

const OMNIROUTE_PROVIDER_CONFIG = {
  name: "OmniRoute",
  baseUrl: OMNIROUTE_API_BASE,
  apiKey: "$OMNIROUTE_API_KEY", // env fallback; auth.json api_key entry is read by pi
  authHeader: true, // send Authorization: Bearer <token>
  api: "openai-completions" as const,
  headers: { "User-Agent": "pi-omniroute-provider" },
};

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
  let models: ProviderModelConfig[] = [];

  // Try the disk cache first — avoids a network fetch on every startup.
  const cache = await loadModelCache(OMNIROUTE_API_BASE);
  if (cache) {
    models = cache.models;
  } else {
    // Cache miss — fetch once (blocking) so the provider is populated before
    // startup finishes and `pi --list-models` sees it.
    try {
      const token = await getOmniRouteToken();
      models = await fetchOmniRouteModels(token);
      console.log(
        `[omniroute] Fetched ${models.length} models from ${OMNIROUTE_API_BASE}`,
      );
      saveModelCache(OMNIROUTE_API_BASE, models).catch((err) =>
        console.warn(
          "[omniroute] Failed to save model cache:",
          err instanceof Error ? err.message : err,
        ),
      );
    } catch (error) {
      console.warn(
        "[omniroute] Failed to fetch models at startup:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  pi.registerProvider("omniroute", {
    ...OMNIROUTE_PROVIDER_CONFIG,
    models,
  });

  // After the session starts, refresh the catalog in the background so the
  // model list stays current without slowing startup. Re-register only when the
  // list actually changes.
  pi.on("session_start", async (_event, ctx) => {
    try {
      const token = await getOmniRouteToken();
      const fresh = await fetchOmniRouteModels(token);

      if (fresh.length === 0) return;

      const signature = (list: ProviderModelConfig[]) =>
        list.map((m) => m.id).join("\n");
      if (signature(fresh) === signature(models) && fresh.length === models.length) {
        // No drift — just refresh the cache timestamp occasionally.
        return;
      }

      models = fresh;
      saveModelCache(OMNIROUTE_API_BASE, models).catch((err) =>
        ctx.ui.notify?.(
          `[omniroute] Failed to save model cache on session_start: ${err instanceof Error ? err.message : err}`,
          "error",
        ),
      );
      ctx.modelRegistry.registerProvider("omniroute", {
        ...OMNIROUTE_PROVIDER_CONFIG,
        models,
      });
      ctx.ui.notify?.(`OmniRoute model list refreshed (${models.length} models)`, "info");
    } catch (error) {
      ctx.ui.notify?.(
        `[omniroute] Failed to refresh models at session start: ${error instanceof Error ? error.message : error}`,
        "error",
      );
    }
  });

  // Command: force-rebuild the disk cache with fresh model data.
  pi.registerCommand("omniroute-rebuild-cache", {
    description: "Rebuild the cached OmniRoute model list from the gateway",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Fetching OmniRoute models from gateway...", "info");
      try {
        const token = await getOmniRouteToken();
        const fresh = await fetchOmniRouteModels(token);
        models = fresh;
        await saveModelCache(OMNIROUTE_API_BASE, models);
        ctx.modelRegistry.registerProvider("omniroute", {
          ...OMNIROUTE_PROVIDER_CONFIG,
          models,
        });
        ctx.ui.notify(
          `OmniRoute model cache rebuilt (${models.length} models)`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(
          `Failed to rebuild cache: ${error instanceof Error ? error.message : error}`,
          "error",
        );
      }
    },
  });
}