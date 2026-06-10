# Issue 0039: `proposal.md` Budget section pre-populated with all keys and defaults

### Parent

PRD Amendments: `docs/prd/0005-prd-amendments-gap-resolutions.md` (Amendment #10)

### What to build

Type: AFK.

When a Research Proposal is created and written to `proposal.md`, the Budget section is currently rendered empty — it only shows keys the user explicitly populated. This means approval validation can fail on misspelled or missing budget keys, because the validator expects one of 7 known keys.

Pre-populate the Budget section in generated `proposal.md` files with all 7 valid keys, their default values from `DEFAULT_BUDGET_LIMITS`, and inline comments explaining each field:

```markdown
## Budget

- maxSearches: 10          # max search queries
- maxFetchAttempts: 20     # max fetch attempts (including failed)
- maxSourceVisits: 15      # max successful source visits
- maxSynthesisRounds: 3    # max brief-drafting rounds
- maxModelCalls: 30        # max model calls (all types)
- maxRetryAttempts: 5      # max retry attempts
- maxElapsedSeconds: 600   # max wall-clock seconds (10 min)
```

The user can edit any value or remove keys before approval. The approval validator already handles this — it re-reads `proposal.md` from disk and validates budget keys against the allowlist. Pre-population just makes the valid keys visible and prevents typo-driven failures.

The Evidence Mix section stays free-form with no default categories.

### Acceptance criteria

- [ ] Generated `proposal.md` contains a Budget section with all 7 valid keys and their default values
- [ ] Each budget key has an inline comment explaining the field
- [ ] User can edit or remove any budget key before approval
- [ ] Approval validator continues to enforce the budget key allowlist
- [ ] Evidence Mix section is not pre-populated (stays free-form)
- [ ] Existing proposal parsing and validation tests still pass

### Blocked by

None — can start immediately.
