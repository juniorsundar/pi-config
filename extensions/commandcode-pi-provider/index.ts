/**
 * Command Code Provider Extension for Pi
 *
 * Registers commandcode.ai as a model provider under the id "commandcode".
 * Command Code serves two wire formats from the same upstream:
 *   - /provider/v1/chat/completions  (OpenAI Chat Completions — used for
 *     all non-Claude models: GPT, DeepSeek, Kimi, GLM, MiniMax, MiMo, Qwen,
 *     Step, Gemini, Nemotron, …)
 *   - /provider/v1/messages          (Anthropic Messages — used for
 *     claude-* models, which Command Code explicitly routes here)
 *
 * Per-model routing is handled by setting `api` and `baseUrl` on each
 * ProviderModelConfig entry. pi-ai's built-in streamSimple dispatcher
 * (resolveApiProvider) then routes to the correct streaming implementation
 * without needing a custom streamSimple.
 *
 * Authentication:
 *   - API key via the CMD_API_KEY env var, or
 *   - API key set through the OAuth /login flow that hits
 *     https://commandcode.ai/studio/auth/cli?callback=<local>&state=<nonce>.
 *     The extension spawns an ephemeral loopback HTTP server to receive the
 *     studio's POST and captures the issued API key.
 *
 * Usage:
 *   pi                                # auto-discovers this extension
 *   # Inside pi: /login commandcode    # opens browser to Command Code Studio
 *   # Or:        export CMD_API_KEY=…
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	OAuthCredentials,
	OAuthLoginCallbacks,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";

// =============================================================================
// Constants
// =============================================================================

// Command Code's actual upstream API. Important distinction:
//   - /provider/v1/chat/completions  — OpenAI-compatible. Requires a paid
//     "Provider" plan (or higher). Returns 403 "Go plan doesn't include API
//     access" for free/Go accounts.
//   - /alpha/generate                 — Command Code's native endpoint.
//     Used by the `cmd` CLI and by OmniRoute's commandCode executor. Works
//     on all plan tiers. Speaks a custom JSON request body and a custom SSE
//     event format (text-delta / reasoning-delta / tool-call / finish).
//
// We target /alpha/generate to match what works in production. The
// /provider/v1/models endpoint is still public and is used for model
// discovery (it returns the same catalog, just under the /provider/v1
// host).
const COMMANDCODE_BASE = "https://api.commandcode.ai";
const COMMANDCODE_ALPHA_URL = `${COMMANDCODE_BASE}/alpha/generate`;
const COMMANDCODE_MODELS_URL = "https://api.commandcode.ai/provider/v1/models";
const COMMANDCODE_STUDIO_AUTH_URL = "https://commandcode.ai/studio/auth/cli";
const COMMANDCODE_API = "command-code-alpha"; // custom api value so pi-ai routes to our streamSimple
const MODELS_FETCH_TIMEOUT_MS = 5_000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 min for the user to approve
const CALLBACK_TIMEOUT_MS = Number.parseInt(
	process.env.COMMANDCODE_CALLBACK_TIMEOUT_MS ?? "",
	10,
) || 60_000; // 1 min once the studio starts the POST
const TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000; // 1y; CC keys are long-lived

// pi-ai's built-in dispatcher routes by `model.api`. Claude models use the
// anthropic-messages driver; everything else uses openai-completions. We
// classify by id prefix to keep the routing table explicit.
// classify by id prefix to keep the routing table explicit.
// function classifyModelId(id: string): "anthropic" | "openai" {
// 	return id.startsWith("claude-") ? "anthropic" : "openai";
// }

// =============================================================================
// Model discovery
// =============================================================================

interface CommandCodeRawModel {
	id: string;
	object?: string;
	name?: string;
	context_length?: number;
}

interface CommandCodeModelsResponse {
	object?: string;
	data: CommandCodeRawModel[];
}

function normalizeModelId(id: string): string {
	// Command Code advertises some models with vendor prefixes (e.g.
	// "deepseek/deepseek-v4-pro", "Qwen/Qwen3.7-Max"). Keep them as-is so
	// the user can copy/paste from the studio UI.
	return id;
}

function isVisionCapable(id: string, name: string): boolean {
	const haystack = `${id} ${name}`.toLowerCase();
	return (
		haystack.includes("vision") ||
		haystack.includes("-vl") ||
		haystack.includes(" vl ") ||
		haystack.includes(" multimodal") ||
		haystack.includes("gemini") || // Gemini 3.x accepts image inputs by default
		haystack.includes("claude") // all current Claude models support images
	);
}

function modelSupportsReasoning(id: string, name: string): boolean {
	const haystack = `${id} ${name}`.toLowerCase();
	// Heuristic: Claude, GPT-5.x, DeepSeek V4, GLM-5, Qwen3.7-Max, Gemini 3.x
	// are advertised as reasoning-capable. Adjust as the catalog evolves.
	return (
		haystack.includes("claude") ||
		haystack.includes("gpt-5") ||
		haystack.includes("deepseek-v4") ||
		haystack.includes("deepseek-r1") ||
		haystack.includes("o1") ||
		haystack.includes("o3") ||
		haystack.includes("o4") ||
		haystack.includes("glm-5") ||
		haystack.includes("k2-thinking") ||
		haystack.includes("qwen3") ||
		haystack.includes("nemotron") ||
		haystack.includes("gemini")
	);
}

function mapCommandCodeModel(m: CommandCodeRawModel): ProviderModelConfig {
	const id = normalizeModelId(m.id);
	const name = m.name ?? m.id;
	const isVision = isVisionCapable(id, name);
	const supportsReasoning = modelSupportsReasoning(id, name);

	// All Command Code models hit the same /alpha/generate endpoint with a
	// custom request body and SSE format. We set a custom `api` value so
	// pi-ai routes to our `streamSimple` handler (registered on the
	// provider) instead of one of its built-in drivers. The baseUrl is the
	// /alpha/generate URL itself.
	return {
		id,
		name,
		api: COMMANDCODE_API,
		baseUrl: COMMANDCODE_ALPHA_URL,
		reasoning: supportsReasoning,
		input: isVision ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: m.context_length ?? 128_000,
		maxTokens: 16_384,
	};
}

async function fetchCommandCodeModels(): Promise<ProviderModelConfig[]> {
	const response = await fetch(COMMANDCODE_MODELS_URL, {
		signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
		headers: { Accept: "application/json", "User-Agent": "pi-commandcode-pi-provider" },
	});
	if (!response.ok) {
		throw new Error(
			`Command Code /v1/models returned ${response.status} ${response.statusText}`,
		);
	}
	const json = (await response.json()) as CommandCodeModelsResponse;
	if (!json.data || !Array.isArray(json.data)) {
		throw new Error("Invalid /v1/models response: missing data array");
	}
	return json.data
		.filter((m) => m.object === "model" || m.object === undefined)
		.map(mapCommandCodeModel);
}

// =============================================================================
// Fallback model catalog
// =============================================================================
// Snapshot of https://api.commandcode.ai/provider/v1/models at build time.
// Used when the public endpoint is unreachable so the provider still works
// offline / during CC outages. Refreshed on the next successful live fetch.

const FALLBACK_MODELS: ProviderModelConfig[] = [
	// Claude (Anthropic Messages)
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "claude-fable-5", name: "Claude Fable 5", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "claude-opus-4-8", name: "Claude Opus 4.8", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "claude-opus-4-7", name: "Claude Opus 4.7", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 },

	// OpenAI family (OpenAI Chat Completions)
	{ id: "gpt-5.5", name: "GPT-5.5", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 },
	{ id: "gpt-5.4", name: "GPT-5.4", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400_000, maxTokens: 16_384 },
	{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400_000, maxTokens: 16_384 },
	{ id: "gpt-5.4-mini", name: "GPT-5.4 Mini", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 400_000, maxTokens: 16_384 },

	// DeepSeek
	{ id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },

	// Moonshot Kimi
	{ id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256_000, maxTokens: 16_384 },
	{ id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256_000, maxTokens: 16_384 },
	{ id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256_000, maxTokens: 16_384 },

	// Z.AI GLM
	{ id: "zai-org/GLM-5.1", name: "GLM-5.1", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 },
	{ id: "zai-org/GLM-5", name: "GLM-5", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 },

	// MiniMax
	{ id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 },
	{ id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 },

	// Xiaomi MiMo
	{ id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5 Pro", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "xiaomi/mimo-v2.5", name: "MiMo V2.5", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },

	// Qwen
	{ id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 },
	{ id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 },
	{ id: "Qwen/Qwen3.7-Max", name: "Qwen 3.7 Max", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "Qwen/Qwen3.7-Plus", name: "Qwen 3.7 Plus", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },

	// StepFun
		{ id: "stepfun/Step-3.7-Flash", name: "Step 3.7 Flash", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256_000, maxTokens: 16_384 },
	{ id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },

	// Google
	{ id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
	{ id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },

	// NVIDIA
	{ id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra", api: COMMANDCODE_API, baseUrl: COMMANDCODE_ALPHA_URL, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 16_384 },
];

// =============================================================================
// Login flow
// =============================================================================
//
// Command Code's "auth login" CLI flow spins up a local HTTP server, opens
// the browser to https://commandcode.ai/studio/auth/cli?callback=<local>,
// and the studio POSTs { apiKey, state, userId?, userName?, keyName? } back
// to the local endpoint once the user approves.
//
// We replicate the same loopback here. The HTTP server is bound to
// 127.0.0.1 on an ephemeral port (port 0) and torn down after one POST or
// after CALLBACK_TIMEOUT_MS — never long-lived.

interface StudioCallbackPayload {
	apiKey: string;
	state: string;
	userId?: string;
	userName?: string;
	keyName?: string;
}

class CallbackError extends Error {
	constructor(
		message: string,
		public readonly statusCode: number = 400,
	) {
		super(message);
		this.name = "CallbackError";
	}
}

function readJsonBody(
	req: IncomingMessage,
	maxBytes: number,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		req.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > maxBytes) {
				req.destroy();
				reject(new CallbackError("Request body too large", 413));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(text);
}

function startCallbackServer(
	state: string,
	timeoutMs: number,
): Promise<{ server: Server; port: number; payload: Promise<StudioCallbackPayload> }> {
	const server = createServer();
	const payloadPromise = new Promise<StudioCallbackPayload>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new CallbackError("Studio callback timed out", 408));
		}, timeoutMs);

		server.on("request", async (req, res) => {
			// Only accept POST /callback from loopback.
			if (req.method !== "POST" || req.url !== "/callback") {
				respondJson(res, 404, { success: false, error: "Not found" });
				return;
			}
			const remote = req.socket.remoteAddress ?? "";
			if (!remote.startsWith("127.") && remote !== "::1" && !remote.startsWith("::ffff:127.")) {
				respondJson(res, 403, { success: false, error: "Loopback only" });
				return;
			}

			try {
				const raw = await readJsonBody(req, 16 * 1024);
				const parsed = JSON.parse(raw) as Partial<StudioCallbackPayload>;
				if (typeof parsed.apiKey !== "string" || parsed.apiKey.length === 0) {
					throw new CallbackError("Missing apiKey");
				}
				if (typeof parsed.state !== "string" || parsed.state !== state) {
					throw new CallbackError("State mismatch", 400);
				}
				clearTimeout(timer);
				respondJson(res, 200, { success: true, ok: true });
				resolve({
					apiKey: parsed.apiKey,
					state: parsed.state,
					userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
					userName: typeof parsed.userName === "string" ? parsed.userName : undefined,
					keyName: typeof parsed.keyName === "string" ? parsed.keyName : undefined,
				});
			} catch (error) {
				const status = error instanceof CallbackError ? error.statusCode : 400;
				const message = error instanceof Error ? error.message : "Invalid callback";
				respondJson(res, status, { success: false, error: message });
				if (!(error instanceof CallbackError) || error.statusCode >= 500) {
					clearTimeout(timer);
					reject(error);
				}
			}
		});

		server.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});

	// Bind to ephemeral port on loopback only.
	server.listen(0, "127.0.0.1");

	return new Promise((resolveServer, rejectServer) => {
		server.once("listening", () => {
			const addr = server.address() as AddressInfo;
			resolveServer({ server, port: addr.port, payload: payloadPromise });
		});
		server.once("error", rejectServer);
	});
}

async function loginCommandCode(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	// Ask the user upfront which method they want to use. The loopback
	// callback only works when the browser running the studio and the Pi
	// process share a network namespace (e.g. localhost on the same
	// machine). In remote / WSL / container setups the studio shows
	// "automatic transfer failed" and the key has to be pasted manually.
	//
	// We default to the browser path because it's the lowest friction
	// when it works, and fall back to paste if the loopback times out.
	const method = await callbacks.onSelect?.({
		message: "How would you like to authenticate with Command Code?",
		options: [
			{ id: "browser", label: "Browser (automatic)" },
			{ id: "paste", label: "Paste API key" },
		],
	});

	if (method === "paste") {
		const apiKey = (await callbacks.onPrompt({
			message: "Paste your Command Code API key (from commandcode.ai/studio/api-keys):",
		})).trim();
		if (!apiKey) throw new Error("No API key provided.");
		return {
			refresh: apiKey,
			access: apiKey,
			expires: Date.now() + TOKEN_EXPIRATION_MS,
		};
	}

	// Default: try the browser/loopback flow, with a paste fallback if
	// the callback never arrives (e.g. WSL, remote browser, blocked
	// loopback).
	callbacks.onProgress?.("Opening Command Code Studio…");
	const state = randomBytes(32).toString("base64url");

	const { server, port, payload } = await startCallbackServer(state, CALLBACK_TIMEOUT_MS);
	const callbackUrl = `http://127.0.0.1:${port}/callback`;

	try {
		const authUrl = `${COMMANDCODE_STUDIO_AUTH_URL}?callback=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;
		callbacks.onAuth({
			url: authUrl,
			instructions:
				"Approve the request in your browser. If the browser cannot reach this terminal " +
				"(remote machine, WSL, container, etc.), Command Code will show a \"Copy your API key\" " +
				"prompt — cancel this flow and choose \"Paste API key\" from the menu instead.",
		});
		callbacks.onProgress?.(`Waiting for browser approval (callback ${callbackUrl})…`);

		try {
			const received = await Promise.race([
				payload,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new CallbackError("Loopback callback timed out", 408)), CALLBACK_TIMEOUT_MS),
				),
			]);

			callbacks.onProgress?.("API key received. Login successful.");
			return {
				refresh: received.apiKey,
				access: received.apiKey,
				expires: Date.now() + TOKEN_EXPIRATION_MS,
			};
		} catch (loopbackError) {
			// Loopback failed (timeout, network unreachable, etc.).
			// Offer a paste-key fallback so the user can recover without
			// restarting the login flow.
			const fallback = await callbacks.onSelect?.({
				message:
					"Browser did not return a key automatically (the studio probably said \"automatic transfer failed\"). " +
					"How would you like to continue?",
				options: [
					{ id: "paste", label: "Paste API key" },
					{ id: "cancel", label: "Cancel" },
				],
			});
			if (fallback !== "paste") {
				throw new Error(
					"Login cancelled. Tip: if your browser runs on a different machine than this terminal " +
						"(e.g. WSL, remote SSH, container), use \"Paste API key\" from the start.",
				);
			}
			const apiKey = (await callbacks.onPrompt({
				message: "Paste your Command Code API key:",
			})).trim();
			if (!apiKey) throw new Error("No API key provided.");
			return {
				refresh: apiKey,
				access: apiKey,
				expires: Date.now() + TOKEN_EXPIRATION_MS,
			};
		}
	} finally {
		server.close();
	}
}

async function refreshCommandCodeToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	// Command Code API keys don't expire based on a server-issued token
	// lifetime; they're long-lived credentials. The "refresh" here is a
	// no-op that re-emits the same key. Users who rotate their key via the
	// studio need to /login commandcode again.
	if (credentials.expires > Date.now()) {
		return credentials;
	}
	throw new Error(
		"Command Code credentials expired. Please run /login commandcode to re-authenticate.",
	);
}

// =============================================================================
// Custom streamSimple — Command Code's /alpha/generate protocol
// =============================================================================
//
// The Command Code upstream speaks a custom SSE protocol, not OpenAI
// Chat Completions. We replicate the logic from open-sse/executors/commandCode.ts
// but emit pi-ai's AssistantMessageEventStream events instead of OpenAI
// chunks, so the rest of pi-ai's pipeline (tool execution, compaction,
// usage tracking) works transparently.

const COMMAND_CODE_VERSION = "0.33.2";
const MAX_COMMAND_CODE_TOKENS = 200_000;

interface CCMessage {
	role: string;
	content?: unknown;
	tool_calls?: unknown[];
	tool_call_id?: string;
	name?: string;
}

interface CCTool {
	type?: string;
	function?: { name?: string; description?: string; parameters?: unknown };
	name?: string;
	description?: string;
	parameters?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
	if (isRecord(value)) return value;
	if (typeof value === "string" && value.trim()) {
		try {
			const parsed: unknown = JSON.parse(value);
			if (isRecord(parsed)) return parsed;
		} catch {
			// fall through
		}
	}
	return {};
}

function normalizeContentText(content: unknown): string {
	if (typeof content === "string") return content;
	return asRecordArray(content)
		.filter((part) => part.type === "text")
		.map((part) => stringValue(part.text) || "")
		.join("\n");
}

function convertTools(tools: unknown): unknown[] {
	return asRecordArray(tools).map((tool) => {
		const fn = isRecord(tool.function) ? tool.function : tool;
		return {
			type: "function",
			name: stringValue(fn.name) || "",
			description: stringValue(fn.description) || "",
			input_schema: isRecord(fn.parameters) ? fn.parameters : {},
		};
	});
}

function completeToolCallIds(messages: CCMessage[]): Set<string> {
	const callIds = new Set<string>();
	const resultIds = new Set<string>();
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const call of asRecordArray(message.tool_calls)) {
				const id = stringValue(call.id);
				if (id) callIds.add(id);
			}
		} else if (message.role === "tool") {
			const id = stringValue(message.tool_call_id);
			if (id) resultIds.add(id);
		}
	}
	return new Set([...callIds].filter((id) => resultIds.has(id)));
}

function convertMessages(messages: unknown): { system: string; messages: unknown[] } {
	const source = asRecordArray(messages) as unknown as CCMessage[];
	const pairedToolCallIds = completeToolCallIds(source);
	const out: unknown[] = [];
	const system: string[] = [];

	for (const message of source) {
		const role = stringValue(message.role);
		if (role === "system" || role === "developer") {
			const text = normalizeContentText(message.content);
			if (text) system.push(text);
			continue;
		}
		if (role === "user") {
			out.push({ role: "user", content: message.content ?? "" });
			continue;
		}
		if (role === "assistant") {
			const parts: unknown[] = [];
			const text = normalizeContentText(message.content);
			if (text) parts.push({ type: "text", text });
			for (const call of asRecordArray(message.tool_calls)) {
				const id = stringValue(call.id) || "";
				if (!id || !pairedToolCallIds.has(id)) continue;
				const fn = isRecord(call.function) ? call.function : {};
				parts.push({
					type: "tool-call",
					toolCallId: id,
					toolName: stringValue(fn.name) || "",
					input: recordOrEmpty(fn.arguments),
				});
			}
			if (parts.length > 0) out.push({ role: "assistant", content: parts });
			continue;
		}
		if (role === "tool") {
			const toolCallId = stringValue(message.tool_call_id) || "";
			if (!toolCallId || !pairedToolCallIds.has(toolCallId)) continue;
			out.push({
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId,
						toolName: stringValue(message.name) || "",
						output: { type: "text", value: normalizeContentText(message.content) },
					},
				],
			});
		}
	}
	return { system: system.join("\n\n"), messages: out };
}

function clampMaxTokens(value: unknown): number {
	const numeric = numberValue(value) ?? MAX_COMMAND_CODE_TOKENS;
	return Math.max(1, Math.min(Math.floor(numeric), MAX_COMMAND_CODE_TOKENS));
}

function buildCommandCodeBody(model: string, body: unknown): Record<string, unknown> {
	const input = isRecord(body) ? body : {};
	const converted = convertMessages(input.messages);
	const explicitSystem = typeof input.system === "string" ? input.system : "";
	const system = [converted.system, explicitSystem].filter(Boolean).join("\n\n");

	return {
		config: {
			workingDir: "/workspace",
			date: new Date().toISOString().slice(0, 10),
			environment: "external",
			structure: [],
			isGitRepo: false,
			currentBranch: "",
			mainBranch: "",
			gitStatus: "",
			recentCommits: [],
		},
		memory: "",
		taste: "",
		skills: "",
		permissionMode: "standard",
		params: {
			model,
			messages: converted.messages,
			tools: convertTools(input.tools),
			system,
			max_tokens: clampMaxTokens(input.max_tokens ?? input.max_completion_tokens),
			stream: true,
		},
	};
}

function parseStreamLine(line: string): unknown | undefined {
	let trimmed = line.trim();
	if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return undefined;
	if (trimmed.startsWith("data:")) trimmed = trimmed.slice(5).trim();
	if (!trimmed || trimmed === "[DONE]") return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function mapFinishReason(reason: unknown): "stop" | "length" | "toolUse" {
	if (reason === "tool-calls" || reason === "tool_calls" || reason === "toolUse") return "toolUse";
	if (
		reason === "length" ||
		reason === "max_tokens" ||
		reason === "max-tokens" ||
		reason === "max_output_tokens"
	) return "length";
	return "stop";
}

function usageFromCommandCode(usage: Record<string, unknown> | null) {
	if (!usage) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
	const details = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : {};
	const prompt = (numberValue(usage.inputTokens) || 0) + (numberValue(details.cacheReadTokens) || 0);
	const completion = numberValue(usage.outputTokens) || 0;
	return { input: prompt, output: completion, cacheRead: 0, cacheWrite: 0, totalTokens: prompt + completion };
}

function emptyAssistant(model: Model<string>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

export function streamCommandCode(
	model: Model<string>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const apiKey = options?.apiKey;
	const signal = options?.signal;
	const sessionId = randomBytes(8).toString("hex");

	if (!apiKey) {
		const out = emptyAssistant(model);
		out.stopReason = "error";
		out.errorMessage = "No Command Code API key. Run /login commandcode or set CMD_API_KEY.";
		stream.push({ type: "error", reason: "error", error: out });
		stream.end();
		return stream;
	}

	(async () => {
		const out = emptyAssistant(model);
		let aborted = false;
		try {
			stream.push({ type: "start", partial: out });

			const body = buildCommandCodeBody(model.id, {
				messages: context.messages,
				system: context.systemPrompt,
				tools: context.tools,
			});

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"x-command-code-version": COMMAND_CODE_VERSION,
				"x-cli-environment": "external",
				"x-project-slug": "pi-cc",
				"x-taste-learning": "false",
				"x-co-flag": "false",
				"x-session-id": sessionId,
			};

			const upstream = await fetch(COMMANDCODE_ALPHA_URL, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: signal ?? undefined,
			});

			if (!upstream.ok) {
				const errText = await upstream.text().catch(() => "");
				out.stopReason = "error";
				out.errorMessage = `Command Code API error ${upstream.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`;
				stream.push({ type: "error", reason: "error", error: out });
				stream.end();
				return;
			}

			if (!upstream.body) {
				out.stopReason = "error";
				out.errorMessage = "Command Code response missing body";
				stream.push({ type: "error", reason: "error", error: out });
				stream.end();
				return;
			}

			const reader = upstream.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let textIndex = -1;
			let thinkingIndex = -1;
			const toolCallIndices = new Map<string, number>();

			const ensureTextBlock = (): number => {
				if (textIndex === -1) {
					out.content.push({ type: "text", text: "" });
					textIndex = out.content.length - 1;
					stream.push({ type: "text_start", contentIndex: textIndex, partial: out });
				}
				return textIndex;
			};

			const ensureThinkingBlock = (): number => {
				if (thinkingIndex === -1) {
					out.content.push({ type: "thinking", thinking: "" });
					thinkingIndex = out.content.length - 1;
					stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: out });
				}
				return thinkingIndex;
			};

			const abort = () => {
				aborted = true;
				reader.cancel().catch(() => undefined);
			};
			signal?.addEventListener("abort", abort, { once: true });

			try {
				for (;;) {
					if (aborted) break;
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) {
						const event = parseStreamLine(line);
						if (!isRecord(event)) continue;
						switch (event.type) {
							case "text-delta": {
								const text = stringValue(event.text) || "";
								if (!text) break;
								const idx = ensureTextBlock();
								const block = out.content[idx];
								if (block && block.type === "text") block.text += text;
								stream.push({ type: "text_delta", contentIndex: idx, delta: text, partial: out });
								break;
							}
							case "reasoning-delta": {
								const text = stringValue(event.text) || "";
								if (!text) break;
								const idx = ensureThinkingBlock();
								const block = out.content[idx];
								if (block && block.type === "thinking") block.thinking += text;
								stream.push({ type: "thinking_delta", contentIndex: idx, delta: text, partial: out });
								break;
							}
							case "tool-call": {
								const id = stringValue(event.toolCallId) || stringValue(event.id) || randomUUID();
								const name = stringValue(event.toolName) || stringValue(event.name) || "";
								const args = recordOrEmpty(event.input ?? event.args ?? event.arguments);
								const contentIndex = out.content.length;
								out.content.push({ type: "toolCall", id, name, arguments: args });
								toolCallIndices.set(id, contentIndex);
								stream.push({ type: "toolcall_start", contentIndex, partial: out });
								stream.push({
									type: "toolcall_end",
									contentIndex,
									toolCall: { type: "toolCall", id, name, arguments: args },
									partial: out,
								});
								break;
							}
							case "finish": {
								out.stopReason = mapFinishReason(event.finishReason);
								const usage = isRecord(event.totalUsage) ? event.totalUsage : null;
								out.usage = { ...usageFromCommandCode(usage), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
								break;
							}
							case "error": {
								const err = isRecord(event.error) ? event.error : {};
								throw new Error(stringValue(err.message) || stringValue(event.error) || "Command Code stream error");
							}
						}
					}
				}
			} finally {
				signal?.removeEventListener("abort", abort);
				try { reader.releaseLock(); } catch { /* noop */ }
			}

			// Close any open text/thinking blocks.
			if (textIndex !== -1) {
				const block = out.content[textIndex];
				if (block && block.type === "text") {
					stream.push({ type: "text_end", contentIndex: textIndex, content: block.text, partial: out });
				}
			}
			if (thinkingIndex !== -1) {
				const block = out.content[thinkingIndex];
				if (block && block.type === "thinking") {
					stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: block.thinking, partial: out });
				}
			}

			if (aborted) {
				out.stopReason = "aborted";
				stream.push({ type: "error", reason: "aborted", error: out });
			} else {
				stream.push({ type: "done", reason: out.stopReason as "stop" | "length" | "toolUse", message: out });
			}
			stream.end();
		} catch (error) {
			out.stopReason = aborted ? "aborted" : "error";
			out.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: out.stopReason as "aborted" | "error", error: out });
			stream.end();
		}
	})();

	return stream;
}

// =============================================================================
// Extension entry point
// =============================================================================

export default async function (pi: ExtensionAPI) {
	// Live fetch with hardcoded fallback. Same pattern as the omniroute
	// extension: try the public catalog, fall back to the snapshot if the
	// endpoint is unreachable. We never block startup on a model-list
	// refresh failure.
	let initialModels: ProviderModelConfig[];
	try {
		initialModels = await fetchCommandCodeModels();
	} catch {
		initialModels = FALLBACK_MODELS;
	}

	// Re-fetch on every session start so newly-added Command Code models
	// (and removed ones) reflect in the model selector without /reload.
	pi.on("session_start", async (_event, ctx) => {
		try {
			const fresh = await fetchCommandCodeModels();
			if (fresh.length > 0) {
				ctx.modelRegistry.registerProvider("commandcode", {
					name: "Command Code",
					baseUrl: COMMANDCODE_ALPHA_URL,
					api: COMMANDCODE_API,
					apiKey: "$CMD_API_KEY",
					models: fresh,
					oauth: makeOAuthConfig(),
					streamSimple: streamCommandCode,
				});

			}
		} catch {
			// Silently keep existing models if the live refresh fails.
		}
	});

	// Initial registration. We register the provider up front with the
	// (possibly fallback) model list so the user can pick a model from
	// /model immediately on startup, then session_start above upgrades it.
	pi.registerProvider("commandcode", {
		name: "Command Code",
		baseUrl: COMMANDCODE_ALPHA_URL,
		api: COMMANDCODE_API,
		apiKey: "$CMD_API_KEY",
		models: initialModels,
		oauth: makeOAuthConfig(),
		streamSimple: streamCommandCode,
	});
}

function makeOAuthConfig() {
	return {
		name: "Command Code",
		login: loginCommandCode,
		refreshToken: refreshCommandCodeToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
	};
}
