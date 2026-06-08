import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getStatus } from "../lifecycle/status";
import { proposeWithReadiness } from "../proposals/propose-with-readiness";
import { approveAndActivateRun } from "../lifecycle/approve-and-create-run";
import { getProposal } from "../proposals/proposal-manager";
import { doctor, resolveModel } from "../brain/setup-policy/setup-policy";
import { writeDoctorDiagnostic } from "../brain/setup-policy/diagnostics";
import { renderRun } from "../rendering/human-view-facade";
import type { BrainFactory } from "./tool";
import { OllamaBrain } from "../brain/harness/ollama-brain";
import { loadDeepresearchConfig } from "../brain/harness/config";

const defaultBrainFactory: BrainFactory = async () => {
  const config = await loadDeepresearchConfig();
  return new OllamaBrain({
    model: config.model,
    host: config.ollamaHost,
    systemPrompt: config.systemPrompt,
    options: config.options,
  });
};

/** Register the human `/research` command surface. */
export function registerResearchCommand(
  pi: ExtensionAPI,
  getBrain: BrainFactory = defaultBrainFactory,
): void {
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
          const modeTag = result.activeRun.mode
            ? ` (${result.activeRun.mode})`
            : "";
          ctx.print(
            `Active Run: ${result.activeRun.id} (${result.activeRun.status}${modeTag})`,
          );
          ctx.print("");

          // Print the progress digest text if available
          if (result.activeProgressDigest) {
            ctx.print("── Progress Digest ──");
            ctx.print("");
            // Split digest into lines and print each (trim trailing blank line)
            const digestLines = result.activeProgressDigest.split("\n");
            for (const line of digestLines) {
              if (line.trim().length > 0) {
                ctx.print(line);
              }
            }
            ctx.print("");
          }

          // Print artifact pointers
          if (result.activeArtifactPointers) {
            const ptrs = result.activeArtifactPointers;
            // Derive prefix from storePath (e.g., ".pi/research/" → "runs/...")
            const storeRel = result.storePath.replace(/^.*?(\\.pi[\/\\\\]research)/, "$1");
            ctx.print("── Artifact paths ──");
            if (ptrs.progressDigest) ctx.print(`  Digest:  ${storeRel}/${ptrs.progressDigest}`);
            if (ptrs.runSummary)    ctx.print(`  Summary: ${storeRel}/${ptrs.runSummary}`);
            if (ptrs.brief)         ctx.print(`  Brief:   ${storeRel}/${ptrs.brief}`);
            if (ptrs.sourceNoteCount > 0) ctx.print(`  Source notes: ${ptrs.sourceNoteCount}`);
            ctx.print("");
          }
        } else {
          ctx.print("No active research run.");
        }

        ctx.print(`Proposals: ${result.proposals.length}`);
        ctx.print(`Runs: ${result.runs.length}`);

        // List individual proposals and runs for detailed lifecycle view
        if (result.proposals.length > 0) {
          ctx.print("");
          ctx.print("Proposals:");
          for (const p of result.proposals) {
            ctx.print(`  • ${p.id} (${p.status}): ${p.question.slice(0, 60)}`);
          }
        }

        if (result.runs.length > 0) {
          ctx.print("");
          ctx.print("Runs:");
          for (const r of result.runs) {
            const modeTag = r.mode ? `, ${r.mode}` : "";
            const isActive = result.activeRun && result.activeRun.id === r.id;
            const activeTag = isActive ? " ← active" : "";
            ctx.print(`  • ${r.id} (${r.status}${modeTag})${activeTag}: ${r.question.slice(0, 60)}`);
          }
        }

        // Surface interruption state for terminal runs that need attention
        if (!result.activeRun && result.runs.length > 0) {
          const interruptedRuns = result.runs.filter(
            (r) => r.status === "interrupted",
          );
          if (interruptedRuns.length > 0) {
            ctx.print("");
            ctx.print(`⚠️ Interrupted runs: ${interruptedRuns.length} run(s) were interrupted.`);
            ctx.print(`Use /research resume ${interruptedRuns[0].id} to continue.`);
          }
        }

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

        const brain = await getBrain();
        const result = await proposeWithReadiness(brain, cwd, {
          question,
          trigger: trigger.length > 0 ? trigger : undefined,
          triggerSource: "human",
        });

        if (result.type === "setup_blocked") {
          ctx.print(`Setup Blocked: ${result.error}`);
          ctx.print("");
          ctx.print(result.guidance);
          if (result.diagnosticPath) {
            ctx.print(`\nDiagnostic: ${result.diagnosticPath}`);
          }
          return;
        }

        const meta = result.meta;
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
        // Parse optional --model <id> override
        const rest = args.slice("doctor".length).trim();
        let modelOverride: string | undefined;
        if (rest.startsWith("--model")) {
          const modelPart = rest.slice("--model".length).trim();
          const mMatch = modelPart.match(/^"([^"]*)"/) ?? modelPart.match(/^(\S+)/);
          if (mMatch) {
            modelOverride = mMatch[1];
          }
        }

        // Load config and create brain
        let brain: Awaited<ReturnType<BrainFactory>>;
        let model: string;

        if (modelOverride) {
          const config = await loadDeepresearchConfig();
          brain = new OllamaBrain({
            model: modelOverride,
            host: config.ollamaHost,
            systemPrompt: config.systemPrompt,
            options: config.options,
          });
          model = modelOverride;
        } else {
          brain = await getBrain();
          // Extract model name from the brain's config
          const config = await loadDeepresearchConfig();
          model = config.model;
        }

        ctx.print(`Running doctor diagnostics against ${model}...`);
        ctx.print("");

        const result = await doctor({
          brain: Object.assign(brain, { model }),
          explicitModel: modelOverride,
        });

        // Write diagnostic artifact
        const writtenPath = await writeDoctorDiagnostic(cwd, model, result.harness);

        // Display summary
        ctx.print(result.harness.summary);

        if (result.harness.failed > 0 || result.harness.recoverable > 0) {
          ctx.print("");
          ctx.print(
            `Diagnostic artifact: ${writtenPath}`,
          );
        }
      } else if (args.startsWith("approve")) {
        // Parse: /research approve <proposal-id>
        const proposalId = args.slice("approve".length).trim();

        if (proposalId.length === 0) {
          ctx.print("Usage: /research approve <proposal-id>");
          ctx.print("");
          ctx.print(
            "Approves a draft Research Proposal, creates a Research Run, and either",
          );
          ctx.print(
            "activates it immediately or queues it behind an active run.",
          );
          return;
        }

        // Read the proposal to get any model override
        const proposal = getProposal(cwd, proposalId);
        if (!proposal) {
          ctx.print(`Proposal not found: ${proposalId}`);
          return;
        }

        // Load config and resolve model (with proposal for modelOverride tier)
        const config = await loadDeepresearchConfig();
        const resolved = resolveModel({
          config,
          proposal,
        });

        // Get the brain for readiness checking
        let brain: Awaited<ReturnType<BrainFactory>>;
        if (resolved.model !== config.model) {
          brain = new OllamaBrain({
            model: resolved.model,
            host: config.ollamaHost,
            systemPrompt: config.systemPrompt,
            options: config.options,
          });
        } else {
          brain = await getBrain();
        }

        try {
          const result = await approveAndActivateRun(
            cwd,
            proposalId,
            resolved,
            Object.assign(brain, { model: resolved.model }),
          );

          ctx.print(`Proposal approved: ${proposalId}`);
          ctx.print(`  Run ID:     ${result.run.identity.id}`);
          ctx.print(`  Status:     ${result.run.status}`);
          ctx.print(`  Question:   ${result.run.question}`);

          if (result.activated) {
            ctx.print(`  Activated:  yes (readiness passed)`);
            ctx.print(
              `  Model:      ${result.activationResult!.testedModel}`,
            );
          } else {
            ctx.print(`  Activated:  no (queued behind active run)`);
          }

          ctx.print(
            `  Path:       .pi/research/runs/${result.run.identity.id}/`,
          );
        } catch (err: any) {
          const message = err.message ?? String(err);
          if (message.includes("Readiness Check") || message.includes("readiness")) {
            ctx.print(`Proposal approved but readiness check failed: ${message}`);
            ctx.print(
              "The run was created in readiness_failed status. " +
              "Check run diagnostics for details and retry after fixing the model setup.",
            );
          } else if (message.includes("not found")) {
            ctx.print(`Approval failed: ${message}`);
          } else {
            ctx.print(`Approval failed: ${message}`);
          }
        }
      } else if (args.startsWith("render")) {
        const rest = args.slice("render".length).trim();

        // Parse optional --allow-failed flag
        let runId = rest;
        let allowFailed = false;
        if (runId.includes("--allow-failed")) {
          allowFailed = true;
          runId = runId.replace("--allow-failed", "").trim();
        }

        if (runId.length === 0) {
          ctx.print("Usage: /research render <run-id> [--allow-failed]");
          ctx.print("");
          ctx.print(
            "Generates a Human Research View for the given run. " +
            "Only works for completed or budget_exhausted runs. " +
            "Use --allow-failed to inspect a failed run explicitly.",
          );
          return;
        }

        try {
          const viewPath = await renderRun(cwd, runId, { allowFailed });
          ctx.print(`Human Research View written to:`);
          ctx.print(`  ${viewPath}`);
          ctx.print("");
          ctx.print(
            "Open this file in your browser to view the formatted research results.",
          );
        } catch (err: any) {
          ctx.print(`Error: ${err.message ?? String(err)}`);
        }
      } else {
        ctx.print(`Unknown research subcommand: ${args.slice(0, 50)}`);
        ctx.print("Available: status, propose, approve, doctor, render");
      }
    },
  });
}
