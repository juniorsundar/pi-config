# Agent research lifecycle is stateless (no blocking tool call or notification)

The `deepresearch` tool's agent lifecycle is stateless: the agent proposes research, informs the user, and checks back on a later turn via `status` then `read_brief`. There is no blocking tool call, no system-level notification when a run completes, and no auto-injection of brief content into the agent's working context. The tool surface (`propose`, `status`, `read_brief`, `render_view`, `recommend_resume`) already supports this stateless loop. `render_view` returns a file path for the agent to surface to the user; `recommend_resume` returns resumability metadata for the agent to advise the user. A future version may add blocking tool calls or completion notifications, but v1 deliberately keeps the agent's role simple and user-controlled.

**Considered options**:
1. **Stateless propose-inform-check loop** (chosen) — agent proposes, tells user to approve, checks `status` later, reads brief when terminal.
2. **Blocking tool call** — `propose` with `blocking: true` blocks the agent's tool loop until run completion. Requires a wait/timeout mechanism in the tool layer and ties the agent to the run's duration.
3. **System notification** — inject a completion message before the agent's next turn listing terminal runs. Requires a new event pathway in the Pi agent loop.

**Reasons**: Option 1 keeps the agent's role advisory and user-controlled, requires no new infrastructure, and matches the PRD's principle that the agent cannot silently start or consume research. Blocking and notification are reversible additions; reverting from them would be harder. The agent's tool description can embed a lifecycle rubric without code changes.

**Consequences**: Human-initiated blocking runs pause a human decision path (e.g., grilling), not the agent's tool loop. The agent must proactively call `status` to discover run completion. Cross-session continuity is out of scope — the agent starts fresh each session.
