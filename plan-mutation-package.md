# Plan: Package mutation behavior

## Goal
Make the Mutation Package the single canonical owner of edit/write diff approval, Bash Approval, and permission profile behavior, while using a short migration path to remove legacy entrypoints safely.

## Slices

1. **Compose the canonical Mutation Package** — ✅ done
   - What: Make the mutation package entrypoint register edit/write approval plus permission profile behavior through small internal factories.
   - Test: Loading the mutation package registers write/edit overrides and `/permissions`, and existing edit/write policy behavior still works.
   - Touches: mutation package entrypoint, permission profile module, permission policy imports, mutation tests.
   - Depends on: none
   - Notes: Composed `extensions/mutation/index.ts` from a new internal permission-profile factory plus diff approval, made the legacy permission-profiles entrypoint inert, and extended mutation tests to cover canonical command registration and risky bash no-UI blocking.

2. **Extract Bash Approval into the Mutation Package** — ✅ done
   - What: Move only the live bash approval workflow into a dedicated internal Bash Approval module and wire it into the mutation package.
   - Test: Bash approval prompts, denial, yolo bypass, no-UI blocking, Neovim edit approval path where practical via unit coverage or mocks.
   - Touches: bash approval module, mutation package entrypoint, tests.
   - Depends on: #1
   - Notes: Added `extensions/mutation/bash-approval.ts`, composed it into the canonical mutation package, converted the legacy confirm-mutating-tools entrypoint into an inert shim, and extended mutation tests to cover canonical bash approval and denial paths.

3. **Delete dead edit/write approval code from the legacy confirm flow** — ✅ done
   - What: Remove the obsolete edit/write confirmation implementation that is no longer reachable; keep edit/write approval solely in the diff approval flow.
   - Test: Existing edit/write mutation tests still pass; no confirm-mutating path handles edit/write.
   - Touches: Bash Approval extraction fallout, old confirm entrypoint, tests.
   - Depends on: #2
   - Notes: Replaced the legacy confirm-mutating-tools implementation with an inert shim, which removed the unreachable edit/write approval code entirely and left edit/write approval owned only by the diff approval flow.

4. **Convert legacy entrypoints into inert Compatibility Shims** — ✅ done
   - What: Keep old files present but non-canonical and non-registering by default, so auto-discovery does not double-register hooks during migration.
   - Test: Loading old shim files does not register duplicate tool hooks or `/permissions`; canonical mutation package still does.
   - Touches: legacy shim files, tests.
   - Depends on: #3
   - Notes: Both legacy entrypoints now default to inert shims while re-exporting internal factories for explicit migration imports, and the mutation tests assert the confirm-mutating shim stays inert.

5. **Clean imports, docs, and verification** — ✅ done
   - What: Update stale comments and import paths, keep glossary language consistent, and run focused plus full tests.
   - Test: Relevant mutation and permission tests, then the full test suite, pass.
   - Touches: comments, docs, tests if needed.
   - Depends on: #4
   - Notes: Moved permission policy ownership into `extensions/mutation/`, updated canonical imports and tests, refreshed legacy comments, and passed both focused mutation tests and the full Vitest suite.

6. **Remove legacy entrypoints** — ✅ done
   - What: Delete the old confirm-mutating-tools and permission-profiles entrypoints once the Mutation Package is canonical and no tests or config depend on them.
   - Test: Auto-discovery loads only the Mutation Package behavior; full test suite passes without legacy files.
   - Touches: legacy extension entrypoints, tests and import references.
   - Depends on: #5
   - Notes: Deleted the legacy entrypoints and the old `extensions/lib/` permission-policy files after moving tests and imports to the mutation package.

## Scope
- In scope: one canonical Mutation Package entrypoint; internal factories for diff approval, Bash Approval, and permission profiles; permission policy moved under the mutation package; dead edit/write code removed from the old confirm flow; temporary inert shims during migration; tests updated for the new ownership model; final legacy file removal.
- Out of scope: changing permission profile semantics; redesigning edit/write diff approval UX; publishing as a separate npm or git Pi package.

## Open questions
- None — ready to go.
