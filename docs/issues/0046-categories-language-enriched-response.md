# Categories, language & enriched response format

## Parent

PRD: [docs/prd/0006-switch-web-search-to-searxng.md](../prd/0006-switch-web-search-to-searxng.md)

## What to build

Add `categories` and `language` as enumerated parameters to `web_search`, drop the `region` parameter, and enrich the response format with SearXNG's extra fields. Both new parameters use TypeScript `StringEnum` so the agent cannot pass invalid values.

**Categories**: `general` (default), `it`, `news`, `science`, `files`, `social media`.

**Language**: `all` (default), `en`, `de`, `fr`, `es`, `pt`, `zh`, `ja`, `ko`, `ar`, `ru`.

**Enriched response**: Surface `answers` (direct answer boxes), `corrections` (spell corrections), and `suggestions` (related queries) above the result list. Each result includes `publishedDate` and `engines` (which engines found it). Per-result `score`, `category`, and `infoboxes` are excluded from the output.

Update the tool description and prompt guidelines to reflect SearXNG's capabilities instead of DuckDuckGo.

## Acceptance criteria

- [ ] `categories` parameter works with all six valid values; invalid values are rejected
- [ ] `language` parameter works with all eleven valid values; invalid values are rejected
- [ ] `region` parameter is removed and no longer accepted
- [ ] Response output includes `answers`, `corrections`, and `suggestions` when SearXNG returns them
- [ ] Each result in the output includes `publishedDate` and `engines`
- [ ] `score`, `category`, and `infoboxes` are not present in the formatted output
- [ ] Tool description and prompt guidelines mention SearXNG, categories, and language (not DDG-specific details)
- [ ] `web_fetch` is unaffected
- [ ] TypeScript compiles without errors

## Blocked by

- [0045-basic-searxng-search-wiring](./0045-basic-searxng-search-wiring.md)
