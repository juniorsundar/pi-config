# Plan: Add r-plan Research Subagent

## Goal
Add an r-plan subagent that runs on iteration 1 to decompose the research question into areas, suggest initial search angles, and flag likely hard parts — giving the orchestrator a scoped starting point instead of improvising from scratch.

## Slices

1. **Agent definition** — ✅ done
   - What: Create `agents/deep-research/r-plan.md` with YAML frontmatter and system prompt. r-plan reads state.md, writes `## Research Plan` section, and returns.
   - Test: Agent definition file exists with correct frontmatter fields (name, model, tools, timeout) and a system prompt that instructs writing a Research Plan section.
   - Touches: `agents/deep-research/r-plan.md`
   - Depends on: none
   - Notes: Created `agents/deep-research/r-plan.md` — timeout 120s, read/write only, system prompt covers research areas, search angles, likely hard parts, worst-case scenarios.

2. **State template update** — ✅ done
   - What: Add `## Research Plan` section to `DEFAULT_STATE_TEMPLATE` in `state-manager.ts`, positioned between `## Original Question` and `## Summary`. Update the placeholder text to `*No plan yet — awaiting r-plan.*`.
   - Test: Unit test that `initialize()` produces state.md containing `## Research Plan` in the correct position. Existing state-manager tests continue to pass.
   - Touches: `state-manager.ts`, `state-manager.test.ts`
   - Depends on: none
   - Notes: Added new test for section position ordering (planIndex > originalQIndex, summaryIndex > planIndex).

3. **Iteration 1 prompt change** — ✅ done
   - What: Change `buildPrompt(1)` in `index.ts` to instruct the orchestrator to spawn r-plan first instead of r-search. Update the "First step" line and the agent list to include r-plan. Change the continuation prompt to mention the Research Plan section as context the orchestrator should reference.
   - Test: Unit test that the iteration 1 prompt contains "r-plan" and "Research Plan" and does not say "r-search is usually the right starting point". Existing iteration prompt tests continue to pass.
   - Touches: `index.ts`, `index.test.ts`
   - Depends on: #2 (state template must have the section before orchestrator is told to use it)
   - Notes: Continuation prompt now references "Research Plan" section. Checkpoint-reviewer approved with no blockers.

4. **Tool description update** — ✅ done
   - What: Update `spawn_research_subagent` tool description and parameter description to include r-plan in the list of available agent types.
   - Test: Unit test that the registered tool description mentions r-plan.
   - Touches: `index.ts`, `index.test.ts`
   - Depends on: #1 (agent must exist for description to reference it)
   - Notes: Added new "tool registration" describe block with two tests. Added promptGuideline: "r-plan is spawned automatically on iteration 1; do not spawn it again."

5. **Existing test alignment** — ✅ done
   - What: Update existing tests that assert on the iteration 1 prompt content (Slice 6 in `index.test.ts` checks for "r-search" in the first prompt). Align those assertions with the new r-plan-first behavior. Verify all existing tests pass.
   - Test: Full test suite passes (`vitest run`).
   - Touches: `index.test.ts`
   - Depends on: #3
   - Notes: Added r-plan assertion to iteration 1 test. Added Research Plan assertion to continuation prompt test. 72/72 tests pass.

## Scope
- In scope: r-plan agent definition, state template change, iteration 1 prompt change, tool description update, test alignment
- Out of scope: Resume command, parallel subagent execution, source deduplication, configurable max iterations, any changes to other r-* agents

## Open questions
- Continuation prompt when r-plan hasn't run: the prompt unconditionally says "Refer to the **Research Plan** section" — if r-plan failed, the orchestrator sees a placeholder. A future refinement could make this conditional.

## Known gaps — deep research system (beyond this plan)

This plan addresses the planning gap. The rest are pre-existing gaps identified during initial scoping.

| Gap | Severity | Fix Difficulty | Addressed? |
|---|---|---|---|
| No explicit planning step | Medium — LLM sometimes picks wrong agent | Easy (add r-plan agent) | ✅ This plan |
| No resume command | High — state.md is right there | Medium | ❌ |
| No parallel subagents | High — biggest perf gap | Hard (requires pi subagent changes) | ❌ |
| No source deduplication | Medium — wasted fetches | Medium | ❌ |
| No unified bibliography | Low — nice to have | Easy | ❌ |
| Hardcoded MAX_ITERATIONS=10 | Low — usually enough | Trivial | ❌ |
| Section-order fragility in state.md | Low — works until it doesn't | Medium (switch to structured format) | ❌ |
| No token/clock budget | Low — iteration cap works | Medium | ❌ |

## Untested edge cases (from checkpoint-reviewer)

| Edge Case | Tested? | Location |
|---|---|---|
| r-plan failure (subagent error) | ✅ | `index.test.ts` Slice 13 (AC1) |
| r-plan empty output | ✅ | `index.test.ts` Slice 14 (AC2) |
| r-plan retry (error → retry → success) | ✅ | `index.test.ts` Slice 15 (AC3) |
| r-plan double failure | ✅ | `index.test.ts` Slice 15 |
| Continuation prompt references Research Plan | ✅ | `index.test.ts:490-492` |
| Iteration 1 prompt instructs r-plan first | ✅ | `index.test.ts:484-488` |
| Research Plan section in initial state | ✅ | `state-manager.test.ts:68-76` |
| Research Plan positioned before Summary | ✅ | `state-manager.test.ts:74-76` |
| r-plan never runs → placeholder persists | ❌ | Not tested — no resume command exists |
| r-plan writes malformed plan (missing sections) | ❌ | Not tested — subagent output validation gap |
| r-plan writes plan that's too long | ❌ | Not tested — no output size guard |
| Very narrow question (r-plan should produce 1-2 areas) | ❌ | Not tested — behavioural, hard to unit test |
| Very vague question (r-plan should suggest refinement) | ❌ | Not tested — behavioural, hard to unit test |

