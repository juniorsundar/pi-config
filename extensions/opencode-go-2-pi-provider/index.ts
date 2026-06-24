/**
 * OpenCode Go 2 Provider Extension for Pi
 *
 * Registers a second OpenCode Go provider under the id "opencode-go-2".
 * It clones Pi's built-in opencode-go model catalog but resolves credentials
 * independently so you can use a second OpenCode Go workspace/subscription
 * alongside the built-in opencode-go provider.
 *
 * Authentication:
 *   - API key via the OPENCODE_GO_2_API_KEY env var, or
 *   - API key set through `/login opencode-go-2` (paste-key flow).
 *
 * Usage:
 *   export OPENCODE_GO_2_API_KEY=...
 *   # or, inside pi: /login opencode-go-2
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getModels } from "@earendil-works/pi-ai/compat";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@earendil-works/pi-ai/compat";

const SOURCE_PROVIDER = "opencode-go";
const PROVIDER_ID = "opencode-go-2";
const PROVIDER_NAME = "OpenCode Go 2";
const OPENCODE_GO_BASE = "https://opencode.ai/zen/go/v1";
const TOKEN_EXPIRATION_MS = 365 * 24 * 60 * 60 * 1000; // 1y; API keys are long-lived.

function cloneOpenCodeGoModels(): ProviderModelConfig[] {
	return getModels(SOURCE_PROVIDER).map((model) => ({
		id: model.id,
		name: model.name,
		api: model.api,
		baseUrl: model.baseUrl,
		reasoning: model.reasoning,
		thinkingLevelMap: model.thinkingLevelMap,
		input: model.input,
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		compat: model.compat,
	}));
}

async function loginOpenCodeGo2(
	callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	callbacks.onProgress?.(
		"Paste an API key from your second OpenCode Go workspace/subscription. " +
			"This will be stored separately from the built-in opencode-go credentials.",
	);

	const apiKey = (
		await callbacks.onPrompt({
			message: "Paste your second OpenCode Go API key:",
		})
	).trim();

	if (!apiKey) throw new Error("No API key provided.");

	return {
		refresh: apiKey,
		access: apiKey,
		expires: Date.now() + TOKEN_EXPIRATION_MS,
	};
}

async function refreshOpenCodeGo2Token(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	if (credentials.expires > Date.now()) {
		return credentials;
	}

	throw new Error(
		"OpenCode Go 2 credentials expired. Please run /login opencode-go-2 to re-authenticate.",
	);
}

function makeOAuthConfig() {
	return {
		name: PROVIDER_NAME,
		login: loginOpenCodeGo2,
		refreshToken: refreshOpenCodeGo2Token,
		getApiKey: (credentials: OAuthCredentials) => credentials.access,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: PROVIDER_NAME,
		baseUrl: OPENCODE_GO_BASE,
		api: "openai-completions",
		apiKey: "$OPENCODE_GO_2_API_KEY",
		models: cloneOpenCodeGoModels(),
		oauth: makeOAuthConfig(),
	});

	// Pi's OpenAI-compatible driver has a small built-in replay compatibility
	// shim scoped to provider id "opencode-go": it serializes streamed
	// `reasoning` blocks back as `reasoning_content` for DeepSeek-style models.
	// Because this clone has a distinct provider id, mirror that payload fix here
	// before requests go out.
	pi.on("before_provider_request", (event, _ctx) => {
		if (event.provider !== PROVIDER_ID) return;
		const payload = event.payload;
		if (!payload || !Array.isArray(payload.messages)) return;

		for (const message of payload.messages) {
			if (!message || message.role !== "assistant") continue;

			const record = message as Record<string, unknown>;
			if (typeof record.reasoning !== "string" || record.reasoning.length === 0) {
				continue;
			}

			if (
				record.reasoning_content === undefined ||
				record.reasoning_content === ""
			) {
				record.reasoning_content = record.reasoning;
			}
			delete record.reasoning;
		}

		return payload;
	});
}
