# Issue 0043: `add_instruction` gated to `running`/`queued` status only

### Parent

PRD Amendments: `docs/prd/0005-prd-amendments-gap-resolutions.md` (Amendment #7)

### What to build

Type: AFK.

Steering instructions via `add_instruction` are currently written to a `steering-signal.json` file regardless of the Research Run's status. This means instructions can be queued for runs that cannot meaningfully use them — a `completed` run will never read its steering signal, and a `synthesizing` run may produce incoherent output if an instruction arrives mid-synthesis.

Gate `add_instruction` to accepted statuses:

- **Accepted**: `running`, `queued` — the instruction is written to the steering signal file and will be processed in the next round (or when the run starts, for queued)
- **Rejected with clear message**: `synthesizing` (Brain is drafting the brief — risk of incoherent output), `completed`, `budget_exhausted`, `cancelled`, `interrupted`, `failed`, `readiness_failed` (terminal or paused states — the run will never process the signal)

The rejection message should tell the user the current status and suggest the appropriate action: for terminal states, suggest a new Research Proposal; for paused states, suggest resume first.

`cancel` and `force_synthesis` are not affected by this gate — they have their own status checks (force_synthesis requires at least one Source Note, etc.).

### Acceptance criteria

- [ ] `add_instruction` on `running` run → accepted, steering signal written
- [ ] `add_instruction` on `queued` run → accepted, will be processed when run starts
- [ ] `add_instruction` on `synthesizing` run → rejected with clear message
- [ ] `add_instruction` on `completed` run → rejected, suggests new proposal
- [ ] `add_instruction` on `budget_exhausted` run → rejected, suggests continuation or resume
- [ ] `add_instruction` on `interrupted`/`cancelled`/`failed`/`readiness_failed` → rejected, suggests resume
- [ ] `cancel` and `force_synthesis` unaffected by this gate

### Blocked by

None — can start immediately.
