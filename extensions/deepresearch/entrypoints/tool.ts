import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getStatus } from "../lifecycle/status";
import { validateTrigger } from "../proposals/trigger-validation";
import { proposeWithReadiness } from "../proposals/propose-with-readiness";
import { renderRun } from "../rendering/human-view-facade";
import { getRun } from "../lifecycle/run-store";
import { getStorePath } from "../workspace/store";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
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
          text += `**Active Run**: ${result.activeRun.id} (${result.activeRun.status}`;
          if (result.activeRun.mode) {
            text += `, ${result.activeRun.mode}`;
          }
          text += `)\n\n`;

          // Include progress digest for active run
          if (result.activeProgressDigest) {
            text += result.activeProgressDigest;
          } else {
            text += `No progress digest yet — run is still starting up.\n\n`;
          }

          // Include artifact pointers for active run
          if (result.activeArtifactPointers) {
            const ptrs = result.activeArtifactPointers;
            text += `**Artifact paths** (relative to store):\n`;
            if (ptrs.progressDigest) text += `- Digest: \`${ptrs.progressDigest}\`\n`;
            if (ptrs.runSummary)    text += `- Summary: \`${ptrs.runSummary}\`\n`;
            if (ptrs.brief)         text += `- Brief: \`${ptrs.brief}\`\n`;
            if (ptrs.sourceNoteCount > 0) {
              text += `- Source notes: ${ptrs.sourceNoteCount}\n`;
            }
            text += `\n`;
          }
        } else {
          text += `**Active Run**: none\n\n`;
        }

        text += `**Proposals**: ${result.proposals.length}\n\n`;
        text += `**Runs**: ${result.runs.length}\n\n`;

        // List individual proposals and runs for detailed lifecycle view
        if (result.proposals.length > 0) {
          text += `**Proposals**:\n`;
          for (const p of result.proposals) {
            text += `  - ${p.id} (${p.status}) — ${p.question.slice(0, 60)}\n`;
          }
          text += `\n`;
        }

        if (result.runs.length > 0) {
          text += `**Runs**:\n`;
          for (const r of result.runs) {
            const modeTag = r.mode ? `, ${r.mode}` : "";
            const isActive = result.activeRun && result.activeRun.id === r.id;
            const activeTag = isActive ? " ⬅️ active" : "";
            text += `  - ${r.id} (${r.status}${modeTag})${activeTag} — ${r.question.slice(0, 60)}\n`;
          }
          text += `\n`;
        }

        // Surface interruption state for terminal runs that need attention
        if (!result.activeRun && result.runs.length > 0) {
          const interruptedRuns = result.runs.filter(
            (r) => r.status === "interrupted",
          );
          if (interruptedRuns.length > 0) {
            text += `⚠️ **Interrupted runs**: ${interruptedRuns.length} run(s) were interrupted. `;
            text += `Use \`/research resume ${interruptedRuns[0].id}\` to continue.\n\n`;
          }
          const cancelledRuns = result.runs.filter(
            (r) => r.status === "cancelled",
          );
          if (cancelledRuns.length > 0) {
            text += `🚫 **Cancelled runs**: ${cancelledRuns.length} run(s) were cancelled.\n\n`;
          }
        }

        if (result.proposals.length === 0 && result.runs.length === 0) {
          text += `No research proposals or runs exist in this workspace. `;
          text += `Use \`/research propose\` to create one.\n\n`;
        }

        // details excludes raw diagnostics — only the rendered status info
        return {
          content: [{ type: "text", text }],
          details: {
            action: "status",
            storePath: result.storePath,
            activeRun: result.activeRun,
            proposals: result.proposals,
            runs: result.runs,
            activeProgressDigest: result.activeProgressDigest,
            activeArtifactPointers: result.activeArtifactPointers,
          },
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

      // render_view — generate a Human Research View from run artifacts
      if (action === "render_view") {
        const runId = params.run_id as string | undefined;

        if (!runId || runId.trim().length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "**Error**: Research Run ID is required for render_view. " +
                  "Please provide a `run_id` parameter.",
              },
            ],
            details: { action: "render_view", status: "error", reason: "missing_run_id" },
          };
        }

        try {
          const viewPath = await renderRun(cwd, runId);
          return {
            content: [
              {
                type: "text",
                text:
                  `## Human Research View\n\n` +
                  `**Run**: \`${runId}\`\n` +
                  `**View path**: \`${viewPath}\``,
              },
            ],
            details: {
              action: "render_view",
              status: "success",
              runId,
              viewPath,
            },
          };
        } catch (err: any) {
          return {
            content: [
              {
                type: "text",
                text:
                  `**Error**: ${err.message ?? String(err)}`,
              },
            ],
            details: {
              action: "render_view",
              status: "error",
              runId,
              reason: err.message ?? String(err),
            },
          };
        }
      }

      // read_brief — read the Research Brief markdown
      if (action === "read_brief") {
        const runId = params.run_id as string | undefined;

        if (!runId || runId.trim().length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "**Error**: Research Run ID is required for read_brief. " +
                  "Please provide a `run_id` parameter.",
              },
            ],
            details: { action: "read_brief", status: "error", reason: "missing_run_id" },
          };
        }

        // Use getRun to find the run, check status policy, read brief.md
        const meta = getRun(cwd, runId);

        if (!meta) {
          return {
            content: [
              { type: "text", text: `**Error**: Run not found: ${runId}` },
            ],
            details: { action: "read_brief", status: "error", runId, reason: "not_found" },
          };
        }

        // Only completed and budget_exhausted produce readable briefs
        const readableStatuses = new Set(["completed", "budget_exhausted"]);
        if (!readableStatuses.has(meta.status)) {
          if (meta.status === "failed" && (meta as any).previousBriefAvailable) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `**Error**: Run ${runId} has status "failed". ` +
                    `A previous brief version exists but may be stale. ` +
                    `Use the status action to inspect, or run ` +
                    `\`/research render ${runId} --allow-failed\` ` +
                    `for explicit human inspection.`,
                },
              ],
              details: { action: "read_brief", status: "error", runId, reason: "failed_with_previous_brief" },
            };
          }
          return {
            content: [
              {
                type: "text",
                text:
                  `**Error**: Run ${runId} has status "${meta.status}". ` +
                  `Briefs can only be read for completed or budget_exhausted runs.`,
              },
            ],
            details: { action: "read_brief", status: "error", runId, reason: "unreadable_status" },
          };
        }

        // Try to read brief.md
        const briefPath = join(getStorePath(cwd), "runs", runId, "brief.md");

        if (!existsSync(briefPath)) {
          return {
            content: [
              {
                type: "text",
                text: `**Error**: No brief.md found for run ${runId}. ` +
                  `The run has status "${meta.status}" but the brief file is missing.`,
              },
            ],
            details: { action: "read_brief", status: "error", runId, reason: "missing_brief" },
          };
        }

        const briefContent = readFileSync(briefPath, "utf-8");

        return {
          content: [
            {
              type: "text",
              text:
                `## Research Brief: ${runId}\n\n` +
                `**Status**: ${meta.status}\n\n` +
                briefContent,
            },
          ],
          details: {
            action: "read_brief",
            status: "success",
            runId,
            briefPath,
            sections: meta.status,
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
