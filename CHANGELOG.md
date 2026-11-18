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
