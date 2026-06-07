import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getStatus } from "../lifecycle/status";

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
        ctx.print("Proposal creation is not yet implemented.");
      } else if (args.startsWith("doctor")) {
        ctx.print("Doctor diagnostics are not yet implemented.");
      } else {
        ctx.print(`Unknown research subcommand: ${args.slice(0, 50)}`);
        ctx.print("Available: status, propose, doctor");
      }
    },
  });
}
