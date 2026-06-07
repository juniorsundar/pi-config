import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getStatus } from "../lifecycle/status";
import { validateTrigger } from "../proposals/trigger-validation";
import { proposeWithReadiness } from "../proposals/propose-with-readiness";
import type { ResearchBrain } from "../brain/harness/types";
import { OllamaBrain } from "../brain/harness/ollama-brain";
import { loadDeepresearchConfig } from "../brain/harness/config";

/** Factory type for creating a ResearchBrain. Injectable for testing. */
export type BrainFactory = () => Promise<ResearchBrain>;

const defaultBrainFactory: BrainFactory = async () => {
  const config = await loadDeepresearchConfig();
  return new OllamaBrain({
    model: config.model,
    host: config.ollamaHost,
    systemPrompt: config.systemPrompt,
    options: config.options,
  });
};

/**
 * Preserve parameter inference for tool definitions.
 * Mirrors the defineTool pattern from the subagents extension.
 */
function defineTool<TParams, TDetails = unknown, TState = any>(
  tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
  return tool;
}

/** Register the agent-facing high-level `deepresearch` tool. */
export function registerDeepresearchTool(
  pi: ExtensionAPI,
  getBrain: BrainFactory = defaultBrainFactory,
): void {
  const deepresearchTool = defineTool({
    name: "deepresearch",
    label: "Deep Research",
    description:
      "Research Orchestrator for bounded, source-grounded research. " +
      "Available actions: " +
      "propose (create a Research Proposal for user approval), " +
      "status (query workspace research state), " +
      "read_brief (read a completed Research Brief), " +
      "render_view (render a Human Research View), " +
      "recommend_resume (check if a run can be resumed). " +
      "The tool cannot approve, deny, start, resume, cancel, " +
      "force synthesis, add steering instructions, or otherwise steer runs.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "propose",
            "status",
            "read_brief",
            "render_view",
            "recommend_resume",
          ],
          description:
            "Research Orchestrator action. For status queries, use 'status'. " +
            "To propose new research, use 'propose'.",
        },
        question: {
          type: "string",
          description:
            "Research Question (required for propose action).",
        },
        trigger: {
          type: "string",
          description:
            "Research Trigger (required for propose action) — " +
            "the external decision-relevant uncertainty justifying this research.",
        },
        run_id: {
          type: "string",
          description:
            "Research Run ID for read_brief, render_view, and recommend_resume actions.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const action = params.action as string;

      if (action === "status") {
        const result = getStatus(cwd);

        let text = `## Research Status\n\n`;
        text += `**Store**: \`${result.storePath}\`\n\n`;

        if (result.activeRun) {
          text += `**Active Run**: ${result.activeRun.id} (${result.activeRun.status})\n\n`;
        } else {
          text += `**Active Run**: none\n\n`;
        }

        text += `**Proposals**: ${result.proposals.length}\n\n`;
        text += `**Runs**: ${result.runs.length}\n\n`;

        if (result.proposals.length === 0 && result.runs.length === 0) {
          text += `No research proposals or runs exist in this workspace. `;
          text += `Use \`/research propose\` to create one.`;
        }

        return {
          content: [{ type: "text", text }],
          details: result,
        };
      }

      if (action === "propose") {
        const question = params.question as string | undefined;
        const trigger = params.trigger as string | undefined;

        if (!question || question.trim().length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "**Error**: Research Question is required for proposal creation. " +
                  "Please provide a `question` parameter.",
              },
            ],
            details: { action: "propose", status: "error",
              reason: "missing_question" },
          };
        }

        if (!trigger || trigger.trim().length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "**Error**: Research Trigger is required for proposal creation. " +
                  "Please provide a `trigger` parameter describing the external " +
                  "decision-relevant uncertainty.",
              },
            ],
            details: { action: "propose", status: "error",
              reason: "missing_trigger" },
          };
        }

        // Validate trigger quality for agent-triggered proposals.
        const triggerValidation = validateTrigger(trigger);
        if (!triggerValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text:
                  `**Error**: Invalid Research Trigger. ${triggerValidation.reason}`,
              },
            ],
            details: {
              action: "propose",
              status: "error",
              reason: "invalid_trigger",
              triggerValidation,
            },
          };
        }

        // Run quick reachability before creating the proposal
        const brain = await getBrain();
        const proposeResult = await proposeWithReadiness(brain, cwd, {
          question,
          trigger,
          triggerSource: "agent",
        });

        if (proposeResult.type === "setup_blocked") {
          return {
            content: [
              {
                type: "text",
                text:
                  `## Setup Blocked\n\n` +
                  `**Error**: ${proposeResult.error}\n\n` +
                  `${proposeResult.guidance}\n\n` +
                  `**Diagnostic**: \`${proposeResult.diagnosticPath ?? "not written"}\``,
              },
            ],
            details: {
              action: "propose",
              status: "setup_blocked",
              error: proposeResult.error,
              diagnosticPath: proposeResult.diagnosticPath,
            },
          };
        }

        const meta = proposeResult.meta;
        const proposalPath = `.pi/research/proposals/${meta.identity.id}/proposal.md`;

        return {
          content: [
            {
              type: "text",
              text:
                `## Research Proposal (draft)\n\n` +
                `**ID**: \`${meta.identity.id}\`\n` +
                `**Status**: ${meta.status}\n` +
                `**Question**: ${meta.question}\n` +
                `**Trigger**: ${meta.trigger}\n` +
                `**Trigger Source**: agent\n\n` +
                `**Proposal file**: \`${proposalPath}\`\n\n` +
                `Review and edit \`${proposalPath}\` before approving.`,
            },
          ],
          details: {
            action: "propose",
            status: "draft",
            proposal: {
              id: meta.identity.id,
              path: proposalPath,
            },
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Action '${action}' is registered but not yet implemented.`,
          },
        ],
        details: { action, status: "not_implemented" },
      };
    },
  });

  pi.registerTool(deepresearchTool);
}
