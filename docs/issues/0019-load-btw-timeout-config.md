# Issue 0019: Load BTW timeout config

### Parent

PRD: `docs/prd/0008-btw-async-side-question.md`

### What to build

Allow BTW to read its timeout setting from pi settings while preserving a safe default. A user who does nothing gets the default five-minute timeout, and a user who configures a BTW timeout gets that value applied consistently when a BTW Process is later spawned.

### Acceptance criteria

- [ ] BTW has a default timeout of five minutes
- [ ] A configured timeout value overrides the default
- [ ] Missing BTW settings fall back to the default without error
- [ ] Invalid timeout values fall back safely or produce a clear configuration error consistent with existing extension conventions
- [ ] The parsed timeout is available to the BTW command path
- [ ] Tests cover default, configured, missing, and invalid timeout settings

### Blocked by

- Issue 0018 — needs the BTW extension skeleton and command surface
