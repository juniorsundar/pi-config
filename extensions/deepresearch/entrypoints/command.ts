import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getStatus } from "../lifecycle/status";
import { createProposal } from "../proposals/proposal-manager";

/** Register the human `/research` command surface. */
export function registerResearchCommand(pi: ExtensionAPI): void {
  pi.registerCommand("research", {
    description:
      "Manage Research Runs: status, propose, approve, deny, doctor, " +
      "cancel, force_synthesis, add_instruction, promote, resume, render.",
    handler: async (args: string, ctx) => {
      const cwd = ctx.cwd;

      if (args.trim() === "" || args.startsWith("status")) {
        const result = getStatus(cwd);

        ctx.print("Workspace Research Store:", result.storePath);
        ctx.print("");

        if (result.activeRun) {
          ctx.print(
            `Active Run: ${result.activeRun.id} (${result.activeRun.status})`,
          );
        } else {
          ctx.print("No active research run.");
        }

        ctx.print(`Proposals: ${result.proposals.length}`);
        ctx.print(`Runs: ${result.runs.length}`);

        if (result.proposals.length === 0 && result.runs.length === 0) {
          ctx.print("");
          ctx.print(
            "No research proposals or runs yet. Use /research propose to create one.",
          );
        }
      } else if (args.startsWith("propose")) {
        // Parse: /research propose "question" --trigger "trigger text"
        const rest = args.slice("propose".length).trim();
        if (rest.length === 0) {
          ctx.print(
            "Usage: /research propose \"question\" --trigger \"decision context\"",
          );
          ctx.print("");
          ctx.print("Creates a draft Research Proposal for review and approval.");
          return;
        }

        // Extract question (first quoted string or rest until --trigger)
        let question = "";
        let trigger = "";
        let remaining = rest;

        // Match quoted question
        const qMatch = remaining.match(/^"([^"]*)"/);
        if (qMatch) {
          question = qMatch[1];
          remaining = remaining.slice(qMatch[0].length).trim();
        } else {
          // Unquoted: take everything before --trigger
          const triggerIdx = remaining.indexOf("--trigger");
          if (triggerIdx !== -1) {
            question = remaining.slice(0, triggerIdx).trim();
            remaining = remaining.slice(triggerIdx);
          } else {
            question = remaining.trim();
            remaining = "";
          }
        }

        // Extract trigger
        if (remaining.startsWith("--trigger")) {
          remaining = remaining.slice("--trigger".length).trim();
          const tMatch = remaining.match(/^"([^"]*)"/);
          if (tMatch) {
            trigger = tMatch[1];
          } else {
            trigger = remaining.trim();
          }
        }

        if (question.length === 0) {
          ctx.print(
            "Usage: /research propose \"question\" --trigger \"decision context\"",
          );
          return;
        }

        const meta = createProposal(ctx.cwd, {
          question,
          trigger: trigger.length > 0 ? trigger : undefined,
          triggerSource: "human",
        });

        ctx.print(`Draft proposal created: ${meta.identity.id}`);
        ctx.print(`  Status:  ${meta.status}`);
        ctx.print(`  Question: ${meta.question}`);
        if (meta.trigger) {
          ctx.print(`  Trigger:  ${meta.trigger}`);
        }
        ctx.print(
          `  Path:    .pi/research/proposals/${meta.identity.id}/proposal.md`,
        );
        ctx.print("");
        ctx.print(
          "Edit the proposal.md file to refine before approving with /research approve.",
        );
      } else if (args.startsWith("doctor")) {
        ctx.print("Doctor diagnostics are not yet implemented.");
      } else {
        ctx.print(`Unknown research subcommand: ${args.slice(0, 50)}`);
        ctx.print("Available: status, propose, doctor");
      }
    },
  });
}
