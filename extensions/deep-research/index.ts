import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadDeepresearchConfig, type DeepResearchConfig } from "./config";
import { ResearchStateManager } from "./state-manager";

const DEEP_RESEARCH_AGENTS_DIR = join(homedir(), ".pi", "agent", "agents", "deep-research");
const MAX_ITERATIONS = 10;
// SUBAGENTS_DIR is resolved per-call from ctx.cwd in archiveLatestSubagentOutput

export default function deepResearchExtension(pi: ExtensionAPI) {
  // ── Tools ──────────────────────────────────────────────────────────

  pi.registerTool({
    name: "spawn_research_subagent",
    label: "Spawn Research Subagent",
    description:
      "Spawn a deep-research subagent (r-search, r-learn, r-gap, r-verify, r-synth). " +
      "Use only during the deep-research workflow — not for normal subagent tasks.",
    parameters: Type.Object({
      agent_type: Type.String({
        description:
          "Type of research subagent: r-search (web search), r-learn (fetch/learn from URLs), " +
          "r-gap (gap analysis), r-verify (verify claims), r-synth (final synthesis)",
      }),
      prompt: Type.String({ description: "Task prompt for the research subagent" }),
    }),
    promptGuidelines: [
      "Use spawn_research_subagent ONLY during deep-research workflow to spawn r-search, r-learn, r-gap, r-verify, or r-synth subagents.",
      "Do not use spawn_research_subagent for general subagent tasks — use the regular subagent tool instead.",
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { agent_type, prompt } = params as { agent_type: string; prompt: string };
      const config = loadDeepresearchConfig().config;

      // Dynamic import of spawnSubagent from the subagents extension
      const { spawnSubagent } = await import("../subagents/spawner");

      const result = await spawnSubagent({
        agentType: agent_type,
        task: prompt,
        agentsDir: DEEP_RESEARCH_AGENTS_DIR,
        workDir: ctx.cwd,
        signal,
        onProgress: onUpdate
          ? (feed) => {
              try {
                onUpdate({
                  content: [{ type: "text" as const, text: feed.collapsed.text }],
                  details: feed,
                });
              } catch {
                // Best-effort progress
              }
            }
          : undefined,
        overrides: {
          ...(config.subagentModel ? { model: config.subagentModel } : {}),
        },
      });

      return {
        content: [{ type: "text", text: result.output }],
        details: {
          agentId: result.agentId,
          agentType: result.agentType,
          duration: result.duration,
          model: result.model,
          usage: result.usage,
        },
      };
    },
  });

  pi.registerTool({
    name: "deep_research_complete",
    label: "Deep Research Complete",
    description:
      "Call this when the deep research is complete and the final synthesis has been written to state.md. " +
      "This signals the orchestrator to stop iterating and return the result.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: "Deep research marked as complete. The orchestrator will return the final result." }],
        details: { researchComplete: true },
      };
    },
  });

  // ── Command ────────────────────────────────────────────────────────

  pi.registerCommand("deep-research", {
    description: "Run deep research on a topic: /deep-research <query>",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /deep-research <query>", "warning");
        return;
      }

      // 1. Load config
      const { config, errors } = loadDeepresearchConfig();
      if (errors.length > 0 && !config.subagentModel && !config.orchestratorModel) {
        ctx.ui.notify(
          `deepresearch config error: ${errors[0]}. Add a "deepresearch" key to settings.json.`,
          "error",
        );
        return;
      }

      ctx.ui.notify(`Deep research: "${query}"`, "info");

      // 2. Create research directory and initial state
      const slug = ResearchStateManager.slugify(query);
      const stateManager = new ResearchStateManager(ctx.cwd, slug);
      stateManager.initialize(query, query);

      // 3. Create loop anchor — a fixed point in the session we can navigate back to
      const anchorId = ctx.sessionManager.appendCustomEntry(
        "deep-research-anchor",
        { slug },
      );

      // 4. Set orchestrator model if configured
      if (config.orchestratorModel) {
        const slashIdx = config.orchestratorModel.indexOf("/");
        if (slashIdx > 0) {
          const provider = config.orchestratorModel.slice(0, slashIdx);
          const modelId = config.orchestratorModel.slice(slashIdx + 1);
          const model = ctx.modelRegistry?.find(provider, modelId);
          if (model) {
            await pi.setModel(model);
          }
        }
      }

      // 5. Iteration loop
      // Helper to build the per-iteration prompt
      function buildPrompt(iteration: number): string {
        const isFirst = iteration === 1;
        if (isFirst) {
          return (
            `You are in **deep-research** mode. Your goal is to research the following question by spawning research subagents in sequence.\n\n` +
            `**Research state file:** \`.pi/deep-research/${slug}/state.md\`\n\n` +
            `**How deep research works:**\n` +
            `1. Read the research state file using the \`read\` tool.\n` +
            `2. Decide which research subagent to spawn next using the \`spawn_research_subagent\` tool.\n` +
            `   Available agents: r-search (search web), r-learn (fetch/learn URLs), r-gap (gap analysis), r-verify (verify claims), r-synth (final synthesis).\n` +
            `3. After the subagent returns, read the updated research state file.\n` +
            `4. Update the research state file with:\n` +
            `   - New findings from the subagent\n` +
            `   - Updated gaps and next step suggestions\n` +
            `   - The completed step in the Steps Completed section\n` +
            `5. If research is complete, update state.md to set "Status" to "complete" and call the \`deep_research_complete\` tool.\n\n` +
            `**Important:** Each iteration starts with a fresh context. Always read the state file — do not rely on conversation history.\n\n` +
            `**First step:** Read the state file and spawn the first research subagent (r-search is usually the right starting point).`
          );
        }
        return (
          `Continue deep research. Read \`.pi/deep-research/${slug}/state.md\` and advance the research.\n\n` +
          `Spawn the next appropriate research subagent with \`spawn_research_subagent\`.\n` +
          `After the subagent returns, update state.md with the findings.\n` +
          `When fully complete, set Status to "complete" in state.md and call \`deep_research_complete\`.`
        );
      }

      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        // 5a. Send iteration prompt
        const prompt = buildPrompt(iteration);
        await pi.sendUserMessage(prompt, { deliverAs: "followUp" });

        // 5b. Wait for the agent to process
        await ctx.waitForIdle();

        // 5c. Read current state
        const currentState = stateManager.read();

        // 5d. Check if research is complete (either via status or deep_research_complete tool)
        const isComplete = currentState.includes("## Status\ncomplete") ||
                           currentState.includes("Status: complete") ||
                           wasCompleteToolCalled(ctx);

        if (isComplete) {
          // Archive the final step
          archiveLatestSubagentOutput(ctx, stateManager);

          // Present the result
          const finalState = stateManager.read();
          pi.sendMessage(
            {
              customType: "deep-research-result",
              content: `### Deep Research Complete: ${query}\n\n${finalState}`,
              display: true,
              details: { slug, iterations: iteration },
            },
            { triggerTurn: false },
          );
          ctx.ui.notify(`Deep research complete (${iteration} iteration${iteration > 1 ? "s" : ""}).`, "success");
          return;
        }

        // 5e. Archive the latest subagent output to steps/
        archiveLatestSubagentOutput(ctx, stateManager);

        // 5f. Navigate back to anchor to clear context for next iteration
        await ctx.navigateTree(anchorId, { summarize: false });
      }

      // Max iterations reached
      ctx.ui.notify(
        `Deep research reached ${MAX_ITERATIONS} iterations without completing. ` +
        `Partial results in .pi/deep-research/${slug}/state.md`,
        "warning",
      );
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Check if the last assistant message contains a deep_research_complete tool call.
 */
function wasCompleteToolCalled(ctx: { sessionManager: { getBranch: () => any[] } }): boolean {
  try {
    const entries = ctx.sessionManager.getBranch();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        Array.isArray(entry.message.content)
      ) {
        for (const block of entry.message.content) {
          if (block.type === "toolCall" && block.name === "deep_research_complete") {
            return true;
          }
        }
        // Only check the latest assistant message
        break;
      }
    }
  } catch {
    // Ignore errors during scanning
  }
  return false;
}

/**
 * Find the latest spawn_research_subagent tool result in the session
 * and copy its output to the steps archive.
 */
function archiveLatestSubagentOutput(ctx: { cwd?: string; sessionManager: any }, stateManager: ResearchStateManager): void {
  try {
    const entries = ctx.sessionManager.getBranch();
    // Scan from newest to oldest
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (
        entry.type === "message" &&
        entry.message?.role === "toolResult" &&
        entry.message?.toolName === "spawn_research_subagent"
      ) {
        const agentId = entry.message.details?.agentId;
        const agentType = entry.message.details?.agentType;
        if (agentId && agentType) {
          const outputPath = join(ctx.cwd || process.cwd(), ".pi", "subagents", agentId, "output.md");
          if (existsSync(outputPath)) {
            const output = readFileSync(outputPath, "utf-8");
            const stepRecord = stateManager.archiveStep(output, agentType, agentId);
            // Update state.md's Steps Completed section
            const currentState = stateManager.read();
            const updated = stateManager.appendStepToState(currentState, stepRecord);
            stateManager.write(updated);
          }
        }
        return; // Only the latest spawn
      }
    }
  } catch {
    // Ignore errors during archive
  }
}
