### Parent

Spec 0009 — Recoverable Web Fetches and GitHub Resources

### What to build

A Python module that classifies `github.com` URLs into resource families (repository-root, tree, blob, or non-specialized) and resolves the identified ref and path components. Ref resolution handles ambiguous cases — branches and tags containing `/` — by querying the GitHub API for the longest valid ref prefix.

Non-specialized URL families (issues, pull requests, releases, commits, gists, `raw.githubusercontent.com`) are explicitly excluded and retain ordinary fetch behavior.

When `GITHUB_TOKEN` is available, it is used for API requests but confined to fixed GitHub API hosts only.

### Acceptance criteria

- [ ] A Python module exposes a URL classification function: URL in → (resource type, owner, repo, ref, path) or non-specialized
- [ ] Repository-root URLs (with and without `.git` suffix, with `www.` alias) are recognized
- [ ] Tree URLs (`/tree/<ref>/<path>`) are recognized
- [ ] Blob URLs (`/blob/<ref>/<path>`) are recognized
- [ ] Percent-encoded path segments are handled correctly
- [ ] Issues, PRs, releases, commits, gists, and `raw.githubusercontent.com` URLs are classified as non-specialized
- [ ] Ref resolution queries the GitHub API and selects the longest valid ref prefix
- [ ] Slash-containing branch and tag names are resolved correctly
- [ ] Commit SHAs are resolved as valid refs
- [ ] `GITHUB_TOKEN` is sent only to fixed GitHub API hosts, never to other origins
- [ ] Comprehensive unit tests cover all URL families, ref resolution cases, and invalid/malformed inputs

### Blocked by

None — can start immediately
