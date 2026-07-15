### Parent

Spec 0009 — Recoverable Web Fetches and GitHub Resources

### What to build

Blob URLs recognized by the GitHub URL module return file content via the GitHub API. Readable and raw modes work for text blobs; detected binary blobs are rejected with guidance to use download mode. Download mode obtains blob bytes through the API, applies existing byte-ceiling and media-type policies, and returns binary download metadata.

Authentication uses `GITHUB_TOKEN` when available, confined to fixed GitHub API hosts.

### Acceptance criteria

- [ ] Text blob URLs return file content in readable mode (Markdown or text extraction applied)
- [ ] Text blob URLs return decoded file source in raw mode (no extraction)
- [ ] Detected binary blobs are rejected in readable and raw modes with a clear message guiding the agent to use `download: true`
- [ ] Download mode obtains blob bytes through the GitHub API
- [ ] Download mode applies existing byte-ceiling and supported media-type policies
- [ ] Download mode returns the existing binary download metadata structure (local path, content type, size)
- [ ] Unicode content is decoded correctly
- [ ] Output goes through the preview/artifact pipeline for text modes
- [ ] `GITHUB_TOKEN` is confined to fixed GitHub API hosts
- [ ] Tests cover: public and authenticated text file fetch, raw source, readable text, Unicode content, missing files, unsupported binary blob rejection, supported image/PDF download, byte ceiling enforcement, content-addressed temporary download metadata

### Blocked by

- 01 — Prefactor: Extract representation pipeline as a deep module
- 02 — Content artifact persistence and recoverable truncation
- 05 — GitHub URL recognition and ref/path resolution
