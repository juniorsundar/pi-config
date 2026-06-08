# Issue 0027: Evidence Mix, Candidate Filtering, and Negative Evidence

### Parent

PRD: `docs/prd/0005-pi-native-deep-research.md`

ADR: `docs/adr/0002-pi-native-research-orchestrator.md`

### What to build

Type: AFK.

Strengthen the Research Run loop so it seeks the approved Evidence Mix rather than summarizing top search results. Candidate Filtering should deterministically deduplicate, annotate, rank or downrank, and record material drops before the Research Brain selects sources. Missing categories, failed searches, contradictions, dropped sources, and user-excluded categories should become visible coverage or Negative Evidence events that affect gaps and confidence.

User stories covered: 23, 24, 28, 29, 52, 53.

### Acceptance criteria

- [x] Evidence Mix state records intended categories and marks each as found, weak, missing, excluded, or not searched due to budget
- [x] Candidate Filtering deduplicates URLs, annotates metadata, prefers primary or official sources when relevant, and downranks low-signal pages
- [x] Dropped candidates are recorded with reasons when material to coverage
- [x] The Research Brain selects from filtered candidates with reasons and does not receive the raw unfiltered search dump by default
- [x] Failed searches, missing categories, contradictions, dropped sources, and user-excluded categories are recorded distinctly
- [x] Research Brief gaps and confidence rationale can consume the coverage and Negative Evidence state
- [x] Tests cover deduplication, ranking, material drops, and category status transitions

### Blocked by

- Issue 0026 — needs the minimal Research Run loop.
