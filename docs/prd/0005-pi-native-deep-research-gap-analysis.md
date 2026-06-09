# Gap Analysis: 0005-pi-native-deep-research.md

**Date**: 2026-06-09
**Subject**: [PRD 0005 — Pi-native Deep Research Extension](./0005-pi-native-deep-research.md)
**Status**: Final (glossary-sharpened)
**Glossary source**: [CONTEXT.md](../../CONTEXT.md)

## Context

This document captures a gap analysis performed on PRD 0005 after implementation revealed a crucial seam-level gap. The PRD already contains a "Known Gaps → Issue 0036" section listing integration-level bugs (wiring, duplicate factories, missing real implementations). Those are *integration gaps*. The gaps documented here are *design gaps* in the PRD itself — things the spec left undefined that became visible only after the components were built and wired together.

The analysis is presented in two passes: an initial pass that identified the crucial gap and several secondary gaps, followed by a glossary-sharpened pass after reading `CONTEXT.md`.

---

## Pass 1: Initial Gap Analysis

### Headline Finding — The Crucial Gap

**The PRD does not close the agent's research lifecycle loop.** The system specifies how a research *run* executes (proposal → readiness → search → extract → synthesize → brief) but never specifies how a coding *agent*:

1. decides it needs to research,
2. gets its proposed run approved by the user,
3. learns the run has finished,
4. gets the brief into its working context, and
5. applies the brief to the in-flight task.

This is the gap that becomes obvious *after* everything is built: each component is correct in isolation, but the wiring between the agent and the orchestrator is missing. The agent is left with a tool surface (`propose`, `status`, `read_brief`, `render_view`, `recommend_resume`) that has no defined handoff protocol.

### Why This Is Crucial

The PRD's stated value proposition is that the system is "useful both to humans and to the coding agent." Without lifecycle integration, the system is useful only to humans. The agent is reduced to a CLI invocation wrapper: it can fire `propose` and call `read_brief`, but it cannot integrate research into its own reasoning loop. This means:

- The "agent-triggered" mode degrades to a fancy file-based proposal.
- The "blocking run" mode can't actually block the agent in a chat context.
- The "task implications" in the brief have no defined consumer.

### Specific Undefined Elements

1. **Research Trigger Detection Heuristic**: The PRD says agents should refuse "routine lookup, local codebase exploration, and curiosity-only requests" but does not define what makes a request a "valid" trigger vs. a refused one. The agent has no rubric to follow.
2. **`propose` Return Contract**: When the agent calls `deepresearch.propose(question, trigger, ...)`, what does it receive? A run ID? The proposal markdown? A summary? Without this, the agent cannot communicate to the user what was proposed.
3. **Blocking-Run Synchronization**: A blocking run "pauses the dependent decision path" — but in a chat context, the agent doesn't pause. There is no defined mechanism for the agent to wait for user approval or for run completion. The PRD implicitly assumes the agent stops processing and the user drives the next steps, which contradicts the "agent triggers and consumes" model.
4. **Run-Completion Notification**: Background runs "emit Progress Digests, respond to status checks, and complete without blocking unrelated conversation." But how does the agent know the run completed? Polling? An event? The PRD is silent on the notification mechanism.
5. **`read_brief` Content Integration**: The brief is a markdown document. When the agent calls `read_brief`, does the content get injected into the agent's working context automatically? Or does the agent have to manually re-read and re-apply? The PRD says "Pi can use them in later work" but the mechanism is undefined.
6. **"Task-Triggered" Mode**: User story 34 mentions "agent-triggered or task-triggered" modes, but the implementation decisions only define "agent-triggered" and "human-initiated." Task-triggered is a phantom category.

### Other Significant Gaps

| # | Gap | Location |
|---|-----|----------|
| 1 | **`recommend_resume` is orphan-shaped.** It is listed as a deepresearch tool action but resume itself is explicitly a *human* command (decisions). The tool's return value and use case are never described. | Tool surface |
| 2 | **`render_view` doesn't fit the agent context.** Pi "prints the path instead of opening it" — for humans. For an agent, a path to HTML is awkward and the PRD offers no alternative return. | Tool surface |
| 3 | **Evidence-grounded synthesis readiness test is undefined.** The decision says it should validate "evidence-grounded synthesis from supplied fake Source Notes" but there is no contract: what prompt, what expected output, what counts as failure. Tests cannot be written. | Readiness check, Testing decisions |
| 4 | **Cross-session continuity is undefined.** Story 43 says active runs are interrupted on shutdown, but the agent's *working context* after restart is not specified. Does the agent remember it triggered a run? Re-read the brief? | Shutdown / resume |
| 5 | **No retention/cleanup policy.** Workspace accumulates `.pi/research/runs/*` indefinitely. No delete, archive, or expire command. | Storage |
| 6 | **`add_instruction` timing is unspecified.** `force_synthesis` has "after current step" but `add_instruction` is silent on readiness / queued / running / synthesizing applicability. | Steering |
| 7 | **"Stale" is undefined for prior brief versions.** Stories refer to "stale/failed-continuation warnings" with no staleness window, no re-verification check, no flag for known-stale sources. | Brief versioning |
| 8 | **Promotion `--force` overwrites without audit.** The decision says `--force` "avoids overwriting existing files" — only by default. With `--force`, no version history, no ledger event of what was replaced. | Promotion |
| 9 | **No "weak trigger" criteria.** Story 7 says "weak triggers may warn but can proceed after explicit confirmation" with no definition of weak vs. strong. | Trigger validation |
| 10 | **No test for `propose` agent-tool return contract.** Testing decisions cover most modules but not the deepresearch tool's typed return shape. | Testing |

### Recommendations (Pass 1)

To close the crucial gap, the PRD should add a new section defining the **Agent Research Lifecycle Contract**. This section should specify:

1. **The trigger detection rubric**: a clear set of conditions that distinguish "valid research trigger" from "routine lookup" from "curiosity-only." This rubric should be testable.
2. **The `propose` return value**: a typed return shape including proposal path, proposal ID, and a short summary suitable for telling the user.
3. **The blocking-run synchronization mechanism**: how the agent waits for approval and completion. Likely involves a wait loop with progress digest polling, or a defined "blocking research" command that takes over the agent's tool call until completion.
4. **The run-completion notification**: how the agent learns a background run has finished. Possibly an event or a status check before the agent's next response.
5. **The `read_brief` integration mode**: whether the content is auto-injected, returned as a tool result, or both. Likely both — auto-injected for the current turn, available for re-reading.
6. **Removal or definition of "task-triggered"**: either define what task-triggered means or remove it from user story 34.

To close the secondary gaps, the PRD should:

- Either remove `recommend_resume` and `render_view` from the agent tool surface, or define their return values and use cases.
- Define the evidence-grounded synthesis readiness test contract.
- Define cross-session continuity (or scope-limit to within-session).
- Add a retention/cleanup story.
- Define "weak trigger" criteria.
- Define `add_instruction` timing.
- Define "stale" for prior brief versions.

### Closing Note (Pass 1)

The PRD is well-specified for the orchestrator and human UX. The crucial gap is in the agent's role, which is the system's primary consumer for non-human-triggered runs. After implementation, the system passes all tests for individual components but the agent-research loop is not testable as a whole because it isn't defined. This is the "very crucial gap" — the system is complete except for the loop that gives it purpose.

---

## Pass 2: Glossary-Sharpened Update

After reading `CONTEXT.md`, the analysis is refined using the project's domain language.

### Glossary confirms a small PRD/glossary inconsistency

The glossary treats `task-triggered` as a real category. The **Research Brief** entry says it "includes implications for Pi or the current task only when the run was agent-triggered **or task-triggered**." The PRD echoes this in user story 34. But the implementation decisions define only two run-initiation modes — `agent-triggered` and `human-initiated` — and never describe what `task-triggered` is. Either the glossary and the user story reference a real third mode (e.g., a skill like `grill-with-docs` triggering research on the user's behalf), or it is a leftover that needs pruning. The PRD/glossary should resolve this.

The glossary also defines **Research Trigger** by examples — "technology feasibility, library or provider comparisons, current API behavior, benchmarks, pricing, recent changes, and alternatives for an architectural choice" — and by invalid categories — "routine lookup or curiosity-only requests." But it does not give a *testable rubric* the agent can apply. The agent has examples to match against, not a decision procedure.

### The crucial gap, in glossary-precise terms

**The PRD does not close the lifecycle between the agent and the Research Orchestrator.**

The glossary defines **Research Orchestrator** as exposing "a `/research` command for human use and one high-level `deepresearch` tool for agent use." Neither the glossary nor the PRD defines:

1. **What `deepresearch.propose` returns to the calling agent** — a typed contract is missing.
2. **How a Blocking Research Run actually pauses the agent** — the glossary says it "pauses the current decision path," but in a chat-loop agent, "pauses" has no defined mechanism.
3. **How the agent learns a Background Research Run is complete** — the glossary says background runs "surface... its Research Brief without blocking non-dependent discussion" but says nothing about notifying the agent that triggered the run.
4. **How the Research Brief enters the agent's working context** — the glossary claims briefs are "written for both the user and the coding agent" but the consumption step is undefined.
5. **What `render_view` and `recommend_resume` are for as agent tools** — the glossary treats the Human Research View as a *human* artifact, so its presence in the agent tool surface is un-justified; `recommend_resume` is similar.

This is the gap that surfaces *after* implementation: every component is well-spec'd in isolation (proposal, run, source note, ledger, brief, view), but the *seams* between the agent and the orchestrator are not. The agent's loop is open.

### Glossary-mapped recommendations

| # | Gap | Recommendation |
|---|-----|----------------|
| 1 | `task-triggered` undefined despite being in the glossary | Define the third initiation mode (skill-triggered? workflow-triggered?) or remove it from the glossary, the user story, and the Research Brief entry. |
| 2 | `update findings` is one of the 5 V1 Research Brain intents but maps to no glossary term | Map it explicitly to **Claim/Evidence Ledger** events. The intent is "append claim/evidence/contradiction/gap events to the ledger." Without this mapping the intent is not implementable. |
| 3 | `deepresearch` tool surface lacks typed return shapes | Add return contracts: `propose → {proposalPath, runId, summary, budget, evidenceMix, blockingMode}`, `status → {status, lastDigestPath, artifactPath}`, `read_brief → {briefMarkdown, versionNumber, status, isStale}`. |
| 4 | Blocking Research Run has no defined synchronization mechanism | Specify that the agent's blocking proposal call **blocks the agent's tool loop** until user approves and the run reaches a terminal status, with periodic Progress Digest emission during the wait. Alternatively, define an explicit polling contract. Pick one. |
| 5 | Background Research Run has no completion notification for the triggering agent | Define the notification contract: e.g., a system message injected before the agent's next turn listing any newly terminal runs and their brief paths. |
| 6 | `read_brief` integration mode is undefined | Specify that the returned `briefMarkdown` is *both* a tool result *and* injected into the agent's working context for the current turn, so the agent can reason over it without manual re-reads. |
| 7 | `render_view` and `recommend_resume` are misclassified as agent tools | Either remove them from the agent tool surface (the glossary treats Human Research View as human-only) or define agent-side return shapes and use cases (`render_view` → HTML string, `recommend_resume` → `{resumable, runId, reason}`). |
| 8 | **Research Trigger** has examples, not a rubric | Add a small testable rubric: a request qualifies if it (a) names a specific decision, (b) requires facts outside the agent's training data, and (c) is not answerable by local codebase exploration. The rubric should be small enough to embed in the agent's prompt. |

### Closing Note (Pass 2)

The PRD is well-specified for the **Research Orchestrator** and the **Research Brain** and the artifacts they exchange. The crucial gap is in the **agent ↔ Research Orchestrator** seam — the lifecycle contract that lets an agent propose a **Research Run**, wait for it, and consume its **Research Brief** within one continuous task. The glossary is consistent with this finding: every concept is defined, but the *handoff protocol* between the agent and the orchestrator is not. That is the very crucial gap that becomes visible only after the pieces are wired together.

---

## Summary of Findings

**Crucial gap (single, most important)**: The PRD does not close the agent-research lifecycle loop. The agent can `propose` and `read_brief` but the synchronization, notification, and content-integration protocols between them are undefined. This is the gap that becomes visible only after the components are built and wired.

**Secondary gaps (10)**: All listed in Pass 1, table above.

**Glossary-driven refinements (8)**: All listed in Pass 2, table above.

**Suggested PRD additions**:

- A new section: **Agent Research Lifecycle Contract** (Pass 1, recommendation block).
- A small **Research Trigger rubric** that the agent's prompt can embed.
- A typed return-shape table for the `deepresearch` tool surface.
- A decision on `task-triggered`: define it or remove it from the glossary, user story 34, and the Research Brief entry.
- A mapping of the `update findings` Research Brain intent to Claim/Evidence Ledger events.
