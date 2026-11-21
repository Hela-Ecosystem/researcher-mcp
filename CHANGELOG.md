## [4.1.0] - 2026-11-22

### Added
- `research_brief` retries once with a reduced query when every source returns nothing, and discloses it (`backoff: "…"`) in the header. Google CSE over-constrains on long natural-language questions, so a normal research question could return "No results from any source" while a three-word version of the same question found seven. The retry keeps the highest-information terms, preserves their order, is scored against the original question, and is capped at one attempt. (`researcher-mcp#34`)
- `research_brief` now returns a feedback handle — the routing class and the sources that produced results — plus the exact `genome search_feedback(...)` call, so recording a decision no longer requires re-deriving the class. A follow-up tool called on a URL from a recent brief appends the same call with `used=true`, which is the moment the signal actually exists. (`researcher-mcp#35`)

### Changed
- Relevance scoring folds light morphological variants (`tool`/`tools`, `call`/`calls`) before counting coverage, so a duplicated stem no longer dilutes a result. Terms are weighted by how much they discriminate among the candidates in hand (IDF), normalised to a mean of one so the existing relevance floors keep their meaning. A term present in every title contributes almost nothing; a rare one carries the match. (`researcher-mcp#36`)

## [4.0.9] - 2026-11-19

### Fixed
- CI failed on Node 20 because the priors suite imported `node:sqlite` at file scope, and that module only exists from Node 22.5. The package still claims Node 20, where the learned priors deliberately degrade to the static table, so the database cases are now gated on the runtime version and the constructor is loaded lazily. Nothing changes on Node 22+.

## [4.0.8] - 2026-11-19

### Fixed
- Learned priors never applied on a host still using genome's legacy store. Enzyme resolved `~/memory/memory.db` only, while genome keeps using `~/memory.db` when its migration did not run, so every brief reported `priors: static` and wrote nothing anywhere. Resolution now follows genome: the migrated path when it exists, otherwise the legacy file. Two tests cover both layouts, and a live run confirms `priors: learned (10 samples)` with the rows landing in the file genome actually writes.
## [4.0.7] - 2026-11-19

### Added
- Learned search-source priors. `research_brief` and `multi_site_search` now read hela-genome's `source_feedback` table READ-ONLY (`node:sqlite` with the read-only flag, no new dependency) and derive per-source multipliers from recorded caller decisions instead of ranking on static constants alone. The genome database is resolved the way genome resolves it — `GUARDIAN_CENTRAL_DB` when absolute, else `~/memory/memory.db` — and one read is cached for 60 seconds, so a brief is not one query per candidate. A missing, unreadable or empty database silently falls back to today's static multipliers; both tools print which table was used (`priors: static` / `priors: learned (N samples)`).
- Collapse guard. Once a `(query_class, source)` cell has at least 5 samples, a Beta-smoothed success rate `p = (used + 1) / (n + 2)` maps to `clamp(1 + 1.0 * (p - 0.5), 0.5, 1.5)`; below that the static prior stands. A source with no samples in a class that already has 5, or whose newest sample is over 30 days old, is floored at 1.0 and lifted by a 0.15 exploration bonus, so a source that stopped being sampled can always be picked again and recover. Fifteen tests, three of which fail if the guard is removed.

## [4.0.6] - 2026-11-19

### Fixed
- Score and filter search results by query relevance, with a stricter floor for Wikipedia's OR-matched results.
- Apply inexpensive query-class routing priors in research briefs and multi-site search, and show ranked scores in search output.
- Enforce academic arXiv publication date ranges before returning papers.

### Added
- Regression tests for relevance filtering, score ordering, source routing and arXiv date filtering.

## [4.0.5] - 2026-11-19

### Changed
- npm audit fix clears two moderate advisories; search behaviour unchanged.

## [4.0.4] - 2026-11-18

### Fixed
- Centralize the advertised MCP server version and guard it against package.json drift.

## [4.0.3] - 2026-11-18

### Fixed
- `multi_site_search` without `sites` crashed into a success-shaped result (`Cannot read properties of undefined (reading 'join')`); it now returns a real error naming the missing argument, and the failure path sets `isError`.
- Advertised version aligned with `package.json` in the server, config and schema metadata.

### Added
- `npm run test:fallback` proves the degradation chain against the live network: zero keys uses keyless engines, an invalid Google key swallows the CSE 400 and still returns results, and misuse of `multi_site_search` is an error.

# Changelog

## [4.0.2] - 2026-11-18

### Fixed
- Fail with a clear Node.js version message before loading dependencies that require the global `File` constructor.

## [4.0.1] - 2026-11-13

### Fixed
- Restored clean tool callback builds with the declared Zod 4 dependency while retaining Zod 3 compatibility.

## [4.0.0] - 2026-11-13

- **Breaking:** `google_search` requires `query`, matching the other text-search tools. `q` is rejected, not translated or retained as an alias. Batch APIs keep `queries`.
- Share strict Google search validation between the shipped and modular entrypoints: non-empty trimmed queries, integer result counts from 1 to 10, and rejection of unknown fields before provider requests.
- Report Google search failures as MCP tool errors. Provider-facing HTTP `q` parameters remain unchanged.

All notable changes to this project.

## [3.0.0] - 2026-10-31

### Changed
- **Version reset to 3.0.0** — per-server version metadata baseline reset (Phase 7). All `package.json`, MCP `ServerInfo.version`, and HTTP metadata now report `3.0.0`. This is a metadata/interface baseline reset; for `hela-plastid` it is not an upgrade from the previous `4.2.0` advert.
