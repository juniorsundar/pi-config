### Parent

Spec 0009 — Recoverable Web Fetches and GitHub Resources

### What to build

Repository-root and tree URLs recognized by the GitHub URL module are fetched via the GitHub API and represented as deterministic, sorted recursive trees. Repository roots resolve against the repository's default branch. Trees are bounded at 2,000 entries; exceeding the bound returns a partial tree with `sourceTruncated: true` and an explicit warning.

Supports readable mode (Markdown with structured metadata and fenced path listing, or plain text with metadata and paths) and raw mode (the canonical GitHub API JSON representation). All output goes through the representation pipeline's preview and content-artifact path.

Authentication uses `GITHUB_TOKEN` when available, confined to fixed GitHub API hosts.

### Acceptance criteria

- [ ] Repository-root URLs resolve against the repository's default branch via the GitHub API
- [ ] Tree URLs resolve against the identified ref and requested directory
- [ ] Descendant paths are lexicographically sorted and deterministic across repeated calls
- [ ] Markdown mode produces structured repository metadata plus a fenced path listing
- [ ] Text mode produces plain metadata and paths
- [ ] Raw mode returns the GitHub API JSON representation
- [ ] Trees are bounded at 2,000 displayed entries
- [ ] Trees exceeding the bound return a partial tree with `sourceTruncated: true` and an explicit warning
- [ ] Empty trees are handled gracefully
- [ ] Output goes through the preview/artifact pipeline (truncation produces a content artifact)
- [ ] `GITHUB_TOKEN` is used when available, confined to fixed GitHub API hosts
- [ ] Tests cover: default-branch resolution, subdirectory trees, deterministic sorting, Markdown and text rendering, raw JSON rendering, empty trees, exactly 2,000 entries, more than 2,000 entries, upstream-truncated trees

### Blocked by

- 0048 — Prefactor: Extract representation pipeline as a deep module
- 0049 — Content artifact persistence and recoverable truncation
- 0052 — GitHub URL recognition and ref/path resolution
