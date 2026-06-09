import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getStatus } from "../lifecycle/status";
import { proposeWithReadiness } from "../proposals/propose-with-readiness";
import { approveAndActivateRun } from "../lifecycle/approve-and-create-run";
import { getProposal } from "../proposals/proposal-manager";
import { doctor, resolveModel } from "../brain/setup-policy/setup-policy";
import { writeDoctorDiagnostic } from "../brain/setup-policy/diagnostics";
import { renderRun } from "../rendering/human-view-facade";
import { writeSteeringSignal } from "../steering/steering";
import { getRun, updateStatus } from "../lifecycle/run-store";
import { getStorePath } from "../workspace/store";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { type BrainFactory, defaultBrainFactory } from "../brain/harness/shared";
import { OllamaBrain } from "../brain/harness/ollama-brain";
import { loadDeepresearchConfig } from "../brain/harness/config";
import { promoteResearchBrief } from "../promotion/promote";
import { executeResearchRun } from "../run-loop/run-loop";
import { createBudget, type BudgetLimits } from "../budgets/budget";
import { buildRunLoopOptions } from "../run-loop/pi-adapters";
import type { ResearchRunMeta } from "../run-loop/types";
import type { ResearchBrain } from "../brain/harness/types";

/**
 * Default budget limits applied when a proposal does not specify them.
 */
const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxSearches: 10,
  maxFetchAttempts: 20,
  maxSourceVisits: 15,
  maxSynthesisRounds: 3,
  maxModelCalls: 30,
  maxRetryAttempts: 5,
  maxElapsedSeconds: 600,
};

function buildBudgetFromLimits(limits?: Partial<BudgetLimits>): import("../budgets/budget").Budget {
  return createBudget({
    maxSearches: limits?.maxSearches ?? DEFAULT_BUDGET_LIMITS.maxSearches,
    maxFetchAttempts: limits?.maxFetchAttempts ?? DEFAULT_BUDGET_LIMITS.maxFetchAttempts,
    maxSourceVisits: limits?.maxSourceVisits ?? DEFAULT_BUDGET_LIMITS.maxSourceVisits,
    maxSynthesisRounds: limits?.maxSynthesisRounds ?? DEFAULT_BUDGET_LIMITS.maxSynthesisRounds,
    maxModelCalls: limits?.maxModelCalls ?? DEFAULT_BUDGET_LIMITS.maxModelCalls,
    maxRetryAttempts: limits?.maxRetryAttempts ?? DEFAULT_BUDGET_LIMITS.maxRetryAttempts,
    maxElapsedSeconds: limits?.maxElapsedSeconds ?? DEFAULT_BUDGET_LIMITS.maxElapsedSeconds,
  });
}

/** Register the human `/research` command surface. */
export function registerResearchCommand(
  pi: ExtensionAPI,
  getBrain: BrainFactory = defaultBrainFactory,
  executeRun: (
    cwd: string,
    runId: string,
    brain: ResearchBrain,
    budget: import("../budgets/budget").Budget,
    options: import("../run-loop/types").RunLoopOptions,
    minimumSourceNotes?: number,
    evidenceCategories?: string[],
  ) => Promise<ResearchRunMeta> = executeResearchRun,
): void {
  pi.registerCommand("research", {
    description:
      "Manage Research Runs: status, propose, approve, deny, doctor, " +
      "cancel, force_synthesis, add_instruction, render, resume, promote.",
    handler: async (args: string, ctx) => {
      const cwd = ctx.cwd;
      const outputLines: string[] = [];
      const print = (...parts: unknown[]) => {
        outputLines.push(parts.map((part) => String(part)).join(" "));
      };
      const flushOutput = () => {
        if (outputLines.length === 0) return;

        // Older pi builds exposed ctx.print(); current command contexts do not.
        // Keep the fallback for existing tests/back-compat, and use a displayed
        // custom message in modern pi so command output appears in the transcript.
        const legacyPrint = (ctx as unknown as { print?: (...parts: string[]) => void }).print;
        if (typeof legacyPrint === "function") {
          for (const line of outputLines) legacyPrint(line);
          return;
        }

        pi.sendMessage({
          customType: "deepresearch-command-output",
          content: outputLines.join("\n"),
          display: true,
          details: {
            command: "research",
            args: args.trim(),
          },
        });
      };

      try {
      if (args.trim() === "" || args.startsWith("status")) {
        const result = getStatus(cwd);

        print("Workspace Research Store:", result.storePath);
        print("");

        if (result.activeRun) {
          const modeTag = result.activeRun.mode
            ? ` (${result.activeRun.mode})`
            : "";
          print(
            `Active Run: ${result.activeRun.id} (${result.activeRun.status}${modeTag})`,
          );
          print("");

          // Print the progress digest text if available
          if (result.activeProgressDigest) {
            print("── Progress Digest ──");
            print("");
            // Split digest into lines and print each (trim trailing blank line)
            const digestLines = result.activeProgressDigest.split("\n");
            for (const line of digestLines) {
              if (line.trim().length > 0) {
                print(line);
              }
            }
            print("");
          }

          // Print artifact pointers
          if (result.activeArtifactPointers) {
            const ptrs = result.activeArtifactPointers;
            // Derive prefix from storePath (e.g., ".pi/research/" → "runs/...")
            const storeRel = result.storePath.replace(/^.*?(\\.pi[\/\\\\]research)/, "$1");
            print("── Artifact paths ──");
            if (ptrs.progressDigest) print(`  Digest:  ${storeRel}/${ptrs.progressDigest}`);
            if (ptrs.runSummary)    print(`  Summary: ${storeRel}/${ptrs.runSummary}`);
            if (ptrs.brief)         print(`  Brief:   ${storeRel}/${ptrs.brief}`);
            if (ptrs.sourceNoteCount > 0) print(`  Source notes: ${ptrs.sourceNoteCount}`);
            print("");
          }
        } else {
          print("No active research run.");
        }

        print(`Proposals: ${result.proposals.length}`);
        print(`Runs: ${result.runs.length}`);

        // List individual proposals and runs for detailed lifecycle view
        if (result.proposals.length > 0) {
          print("");
          print("Proposals:");
          for (const p of result.proposals) {
            print(`  • ${p.id} (${p.status}): ${p.question.slice(0, 60)}`);
          }
        }

        if (result.runs.length > 0) {
          print("");
          print("Runs:");
          for (const r of result.runs) {
            const modeTag = r.mode ? `, ${r.mode}` : "";
            const isActive = result.activeRun && result.activeRun.id === r.id;
            const activeTag = isActive ? " ← active" : "";
            print(`  • ${r.id} (${r.status}${modeTag})${activeTag}: ${r.question.slice(0, 60)}`);
          }
        }

        // Surface interruption state for terminal runs that need attention
        if (!result.activeRun && result.runs.length > 0) {
          const interruptedRuns = result.runs.filter(
            (r) => r.status === "interrupted",
          );
          if (interruptedRuns.length > 0) {
            print("");
            print(`⚠️ Interrupted runs: ${interruptedRuns.length} run(s) were interrupted.`);
            print(`Use /research resume ${interruptedRuns[0].id} to continue.`);
          }
        }

        if (result.proposals.length === 0 && result.runs.length === 0) {
          print("");
          print(
            "No research proposals or runs yet. Use /research propose to create one.",
          );
        }
      } else if (args.startsWith("propose")) {
        // Parse: /research propose "question" --trigger "trigger text"
        const rest = args.slice("propose".length).trim();
        if (rest.length === 0) {
          print(
            "Usage: /research propose \"question\" --trigger \"decision context\"",
          );
          print("");
          print("Creates a draft Research Proposal for review and approval.");
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
          print(
            "Usage: /research propose \"question\" --trigger \"decision context\"",
          );
          return;
        }

        const brain = await getBrain();
        const result = await proposeWithReadiness(brain, cwd, {
          question,
          trigger: trigger.length > 0 ? trigger : undefined,
          triggerSource: "human",
          mode: "blocking",
        });

        if (result.type === "setup_blocked") {
          print(`Setup Blocked: ${result.error}`);
          print("");
          print(result.guidance);
          if (result.diagnosticPath) {
            print(`\nDiagnostic: ${result.diagnosticPath}`);
          }
          return;
        }

        const meta = result.meta;
        print(`Draft proposal created: ${meta.identity.id}`);
        print(`  Status:  ${meta.status}`);
        print(`  Question: ${meta.question}`);
        if (meta.trigger) {
          print(`  Trigger:  ${meta.trigger}`);
        }
        print(
          `  Path:    .pi/research/proposals/${meta.identity.id}/proposal.md`,
        );
        print("");
        print(
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

        print(`Running doctor diagnostics against ${model}...`);
        print("");

        const result = await doctor({
          brain: Object.assign(brain, { model }),
          explicitModel: modelOverride,
        });

        // Write diagnostic artifact
        const writtenPath = await writeDoctorDiagnostic(cwd, model, result.harness);

        // Display summary
        print(result.harness.summary);

        if (result.harness.failed > 0 || result.harness.recoverable > 0) {
          print("");
          print(
            `Diagnostic artifact: ${writtenPath}`,
          );
        }
      } else if (args.startsWith("approve")) {
        // Parse: /research approve <proposal-id>
        const proposalId = args.slice("approve".length).trim();

        if (proposalId.length === 0) {
          print("Usage: /research approve <proposal-id>");
          print("");
          print(
            "Approves a draft Research Proposal, creates a Research Run, and either",
          );
          print(
            "activates it immediately or queues it behind an active run.",
          );
          return;
        }

        // Read the proposal to get any model override
        const proposal = getProposal(cwd, proposalId);
        if (!proposal) {
          print(`Proposal not found: ${proposalId}`);
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

          print(`Proposal approved: ${proposalId}`);
          print(`  Run ID:     ${result.run.identity.id}`);
          print(`  Status:     ${result.run.status}`);
          print(`  Question:   ${result.run.question}`);

          if (result.activated) {
            print(`  Activated:  yes (readiness passed)`);
            print(
              `  Model:      ${result.activationResult!.testedProvider}/${result.activationResult!.testedModel}`,
            );
          } else {
            print(`  Activated:  no (queued behind active run)`);
          }

          print(
            `  Path:       .pi/research/runs/${result.run.identity.id}/`,
          );

          // ── Fire the run loop for blocking-mode activated runs ────────
          // Treat undefined mode as blocking (default when not specified)
          if (result.activated && result.run.mode !== "background") {
            const budget = buildBudgetFromLimits(result.run.budgetLimits);
            const options = buildRunLoopOptions(pi);
            const evidenceCategories: string[] = proposal.evidenceMix ?? [];

            // Fire-and-forget — the handler returns before the loop finishes
            executeRun(
              cwd,
              result.run.identity.id,
              brain,
              budget,
              options,
              1,
              evidenceCategories,
            ).then(
              (meta: ResearchRunMeta) => {
                pi.sendMessage({
                  customType: "deepresearch-command-output",
                  content:
                    `Research Run ${result.run.identity.id} completed.\n\n` +
                    `Brief: .pi/research/runs/${result.run.identity.id}/brief.md\n` +
                    `Source notes: ${meta.sourceNoteCount}\n` +
                    `Rounds: ${meta.roundCount}`,
                  display: true,
                  details: { command: "research", args: "approve" },
                });
              },
              (err: Error) => {
                const errMsg = err.message ?? String(err);
                updateStatus(cwd, result.run.identity.id, "interrupted", errMsg);
                pi.sendMessage({
                  customType: "deepresearch-command-output",
                  content:
                    `Research Run ${result.run.identity.id} interrupted: ${errMsg}`,
                  display: true,
                  details: { command: "research", args: "approve" },
                });
              },
            );
          }
        } catch (err: any) {
          const message = err.message ?? String(err);
          if (message.includes("Readiness Check") || message.includes("readiness")) {
            print(`Proposal approved but readiness check failed: ${message}`);
            print(
              "The run was created in readiness_failed status. " +
              "Check run diagnostics for details and retry after fixing the model setup.",
            );
          } else if (message.includes("not found")) {
            print(`Approval failed: ${message}`);
          } else {
            print(`Approval failed: ${message}`);
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
          print("Usage: /research render <run-id> [--allow-failed]");
          print("");
          print(
            "Generates a Human Research View for the given run. " +
            "Only works for completed or budget_exhausted runs. " +
            "Use --allow-failed to inspect a failed run explicitly.",
          );
          return;
        }

        try {
          const viewPath = await renderRun(cwd, runId, { allowFailed });
          print(`Human Research View written to:`);
          print(`  ${viewPath}`);
          print("");
          print(
            "Open this file in your browser to view the formatted research results.",
          );
        } catch (err: any) {
          print(`Error: ${err.message ?? String(err)}`);
        }
      } else if (args.startsWith("cancel")) {
        // Parse: /research cancel <run-id> [--reason "..."]
        let rest = args.slice("cancel".length).trim();
        let reason: string | undefined;
        const reasonMatch = rest.match(/--reason "([^"]*)"/);
        if (reasonMatch) {
          reason = reasonMatch[1];
          rest = rest.replace(reasonMatch[0], "").trim();
        }
        const runId = rest;

        if (runId.length === 0) {
          print("Usage: /research cancel <run-id> [--reason \"why\"]");
          print("");
          print(
            "Cancels an active Research Run. Preserves source notes and ledger. " +
            "Does not produce a Research Brief.",
          );
          return;
        }

        const run = getRun(cwd, runId);
        if (!run) {
          print(`Run not found: ${runId}`);
          return;
        }

        if (run.status !== "running") {
          print(`Run ${runId} is not active (status: ${run.status}). Cannot cancel.`);
          return;
        }

        // Write steering signal for the run loop to pick up
        writeSteeringSignal(cwd, runId, {
          timestamp: new Date().toISOString(),
          type: "cancel",
          text: reason,
        });

        print(`Cancel signal sent to run ${runId}.`);
        print(
          "The run loop will stop after completing its current step. " +
          "Use /research status to check progress.",
        );
      } else if (args.startsWith("force_synthesis")) {
        // Parse: /research force_synthesis <run-id> [--reason "..."]
        let rest = args.slice("force_synthesis".length).trim();
        let reason: string | undefined;
        const reasonMatch = rest.match(/--reason "([^"]*)"/);
        if (reasonMatch) {
          reason = reasonMatch[1];
          rest = rest.replace(reasonMatch[0], "").trim();
        }
        const runId = rest;

        if (runId.length === 0) {
          print(
            "Usage: /research force_synthesis <run-id> [--reason \"why\"]",
          );
          print("");
          print(
            "Forces synthesis of a Research Brief after the current step. " +
            "Refused if no Source Notes exist yet.",
          );
          return;
        }

        const run = getRun(cwd, runId);
        if (!run) {
          print(`Run not found: ${runId}`);
          return;
        }

        if (run.status !== "running") {
          print(
            `Run ${runId} is not active (status: ${run.status}). Cannot force synthesis.`,
          );
          return;
        }

        // Write steering signal
        writeSteeringSignal(cwd, runId, {
          timestamp: new Date().toISOString(),
          type: "force_synthesis",
          text: reason,
        });

        print(`Force-synthesis signal sent to run ${runId}.`);
        print(
          "The run loop will check for source notes and synthesize if possible. " +
          "Use /research status to check progress.",
        );
      } else if (args.startsWith("add_instruction")) {
        // Parse: /research add_instruction <run-id> "instruction text"
        const rest = args.slice("add_instruction".length).trim();
        const instructionMatch = rest.match(/^(\S+)\s+"([^"]*)"/);

        if (!instructionMatch) {
          print(
            "Usage: /research add_instruction <run-id> \"instruction text\"",
          );
          print("");
          print(
            "Adds a steering instruction to an active Research Run. " +
            "Instructions may narrow, prioritize, exclude, or clarify within " +
            "the approved Research Question. Scope-broadening instructions are rejected.",
          );
          return;
        }

        const runId = instructionMatch[1];
        const instructionText = instructionMatch[2];

        const run = getRun(cwd, runId);
        if (!run) {
          print(`Run not found: ${runId}`);
          return;
        }

        if (run.status !== "running") {
          print(
            `Run ${runId} is not active (status: ${run.status}). Cannot add instruction.`,
          );
          return;
        }

        // Write steering signal
        writeSteeringSignal(cwd, runId, {
          timestamp: new Date().toISOString(),
          type: "add_instruction",
          text: instructionText,
        });

        print(`Instruction sent to run ${runId}: "${instructionText}"`);
        print(
          "The run loop will validate and apply the instruction. " +
          "Use /research status to check progress.",
        );
      } else if (args.startsWith("resume")) {
        const runId = args.slice("resume".length).trim();

        if (runId.length === 0) {
          print("Usage: /research resume <run-id>");
          print("");
          print(
            "Shows resume state summary for an interrupted, readiness_failed, or budget_exhausted run.",
          );
          return;
        }

        const run = getRun(cwd, runId);
        if (!run) {
          print(`Run not found: ${runId}`);
          return;
        }

        // Check if resumable
        const RESUMABLE = new Set(["interrupted", "readiness_failed", "budget_exhausted"]);
        if (run.status === "completed") {
          print(
            `Run ${runId} has status "completed" which is terminal in v1. ` +
            "To research new facts or angles, create a new Research Proposal.",
          );
          return;
        }

        if (!RESUMABLE.has(run.status)) {
          print(`Run ${runId} has status "${run.status}" and cannot be resumed.`);
          return;
        }

        // Gather state summary
        const storePath = getStorePath(cwd);
        const runDirPath = join(storePath, "runs", runId);
        const notesDir = join(runDirPath, "source-notes");
        let sourceNoteCount = 0;
        if (existsSync(notesDir)) {
          try {
            sourceNoteCount = readdirSync(notesDir).filter(f => f.endsWith(".md")).length;
          } catch { sourceNoteCount = 0; }
        }

        const ledgerPath = join(runDirPath, "ledger.jsonl");
        let ledgerEntryCount = 0;
        if (existsSync(ledgerPath)) {
          try {
            const raw = readFileSync(ledgerPath, "utf-8");
            ledgerEntryCount = raw.split("\n").filter(l => l.trim().length > 0).length;
          } catch { ledgerEntryCount = 0; }
        }

        print(`Resuming: ${runId}`);
        print(`  Status:     ${run.status}`);
        print(`  Question:   ${run.question.slice(0, 80)}`);
        print(`  Source Notes: ${sourceNoteCount}`);
        print(`  Ledger Entries: ${ledgerEntryCount}`);
        if (run.terminationReason) {
          print(`  Termination: ${run.terminationReason}`);
        }
        print("");
        print(
          "To proceed, approve a revised Research Budget and re-run with the resume capability.",
        );
      } else if (args.startsWith("promote")) {
        // Parse: /research promote <run-id> --to <destination> [--force]
        const rest = args.slice("promote".length).trim();

        if (rest.length === 0) {
          print(
            "Usage: /research promote <run-id> --to <destination> [--force]",
          );
          print("");
          print(
            "Promotes a completed or budget-exhausted Research Brief to the given destination. " +
            "Creates parent directories as needed.",
          );
          print("");
          print(
            "The promoted package includes brief.md and appendix.md (source-reference metadata " +
            "and evidence snippets). Raw diagnostics and raw model responses are excluded.",
          );
          print("");
          print(
            "Use --force to overwrite existing files at the destination.",
          );
          return;
        }

        // Extract run-id, --to path, and optional --force (quote-aware for --to)
        const runMatch = rest.match(/^(\S+)/);
        let runId = runMatch?.[1] ?? "";
        let destPath = "";
        let force = false;

        // Parse --to with optional quoted value: --to "path with spaces" or --to /path
        const toMatch = rest.match(/--to\s+"([^"]*)"/) ?? rest.match(/--to\s+(\S+)/);
        if (toMatch) {
          destPath = toMatch[1];
        }

        // Parse --force flag
        if (/--force/.test(rest)) {
          force = true;
        }

        if (runId.length === 0 || destPath.length === 0) {
          print(
            "Usage: /research promote <run-id> --to <destination> [--force]",
          );
          return;
        }

        try {
          const result = promoteResearchBrief(cwd, runId, {
            to: destPath,
            force,
          });

          print(`Promoted research brief from run ${runId}:`);
          print("");
          for (const file of result.files) {
            print(`  ${file.absolutePath}`);
          }
          print("");
          print(
            `Promotion written to: ${result.destDir}`,
          );
          print(
            "This package includes brief.md and appendix.md (source-reference metadata and evidence snippets).",
          );
        } catch (err: any) {
          print(`Error: ${err.message ?? String(err)}`);
        }
      } else {
        print(
          "Available: status, propose, approve, deny, doctor, render, cancel, " +
          "force_synthesis, add_instruction, resume, promote",
        );
      }
      } finally {
        flushOutput();
      }
    },
  });
}
