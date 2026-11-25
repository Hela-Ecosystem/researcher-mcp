## [4.3.4] - 2026-11-25

### Fixed
- `news_monitor` marks links that are only the publisher home page ("publisher home, article URL unavailable") instead of presenting them as article URLs. (ISS-72, `researcher-mcp#44`)
- `google_search` news fallback (date-restricted queries) follows Google News links and marks publisher-home results the same way, via a `publisherHome` flag and a snippet note. (ISS-72, `researcher-mcp#44`)
- `fact_checker` classifies stance against the claim: a source is `unclear` unless it mentions the claim's key terms, and `supports` additionally needs assertion wording; snippets that merely discuss the claim (whether, debate, questions) stay `unclear`. (ISS-73, `researcher-mcp#44`)
- `data_export` leaves plain numbers unquoted and builds the column set as the union of all rows. (ISS-74, `researcher-mcp#44`)

### Known limitations
- ISS-74: preserving input column order could not be reproduced in this repository, so only the plain-number and column-union parts shipped. Column order is not covered by this release. (`researcher-mcp#44`)

## [4.3.3] - 2026-11-23

### Changed
- `content_deduplication` returns the surviving objects (title/url/snippet) with `mergedFrom` and `stats` instead of titles only, and canonicalises URLs (strips `utm_*`, fragments, trailing slash) before comparing.

### Fixed
- `content_summarizer` strips skip-links/nav/footer, joins blocks with spaces, and prefers `og:description`/meta description then the first main paragraph over raw body text. (`researcher-mcp#43`)
- `fact_checker` labels each source with a stance and returns an overall verdict (ClaimReview ratings when a key is configured, otherwise inferred from source wording and labelled heuristic).
- `research_assistant` deduplicates identical results across query variants and includes URLs/domains.
- `wikipedia_get` removes the empty-parentheses artefact left after cleaning.
- `multi_site_search` reports a per-site result count, so a zero-result site is visible instead of silent.

## [4.3.2] - 2026-11-22

### Fixed
- `citation_formatter` keeps every author and follows each style. APA formats `Surname, G. M.,` lists with `&` before the last and initials; MLA inverts the first author and collapses three or more to `et al.`; Chicago inverts only the first and uses `and` before the last. Names accept `{given, family}` objects, particles and suffixes, and an unparseable name is kept verbatim with a warning instead of being dropped. `doi` is accepted alongside `url`. (`researcher-mcp#38`)

## [4.3.1] - 2026-11-22

### Fixed
- `content_sentiment_analysis` applies negation across a short window instead of a single token, so "never recommend", "nobody loved it" and "hardly a success" score negative. The window stops at clause boundaries, negations the AFINN library already applied are reported but not flipped twice, and the response lists the negations it found plus a note that the method is lexicon-based. (`researcher-mcp#37`)

## [4.3.0] - 2026-11-22

### Changed
- `search_trends` and `search_analytics` no longer report result-page counts as search interest. They state the UTC window they applied, report a Google matching-page estimate only when CSE provides one, and otherwise say the series is unavailable. (`researcher-mcp#39`)

### Fixed
- `data_export` CSV escapes quotes (round-trip through a strict reader works), prefixes string fields starting with `= + - @ TAB CR` so a spreadsheet cannot execute them, and accepts a bare array or `{rows:[...]}` as well as an object. Numeric negatives stay numbers. (`researcher-mcp#40`)
- `research_session_manager` persists to disk: atomic write (temp + fsync + rename), `proper-lockfile` around read-modify-write, `HELA_RESEARCH_SESSION_DIR` or XDG data home, `0600` file and `0700` directory, 100-session/8 MiB caps, and `ok:false` with a reason when a save cannot be honoured. A corrupt store is reported and left untouched. (`researcher-mcp#42`)
- `news_monitor` enforces `dateRestrict`: the window is applied to the feed query and to each item, the response states it, and out-of-window articles are counted as dropped. RSS entities are decoded and Google News redirect links resolve to the publisher (or its home) instead of a wrapper. (`researcher-mcp#41`)
- `research_brief` folds morphological variants and weights terms by rarity among the pages it actually returned. (`researcher-mcp#36`)

## [4.2.2] - 2026-11-22

### Fixed
- The IDF half of the relevance scorer was inert in production: `research_brief` called `scoreSearchResult` without a candidate corpus, so every term kept the uniform weight and only morphological folding applied. The brief now builds the corpus from the pages it actually returned, so a term present in every title contributes little and a rare one carries the match (researcher-mcp#36).

## [4.2.1] - 2026-11-22

### Fixed
- The query backoff and feedback-spool behaviour shipped in 4.1.0/4.2.0 landed in `src/combinedMcp.ts`, but the executable entry point is the root `research-server.ts` (`dist/index.js` loads it). Production therefore kept the old `research_brief`: no backoff, no feedback handle, no spool writes. Ported to the real entry; a live probe of `dist/index.js` now shows `backoff: "…"` and the `feedback:` line. Found by end-to-end verification after deploy, not by the unit tests, which exercise the other entry.
- Backoff now triggers on an empty **ranked** result rather than empty raw sources. Google can return pages that all fall below the relevance floor, which still reads as "No results from any source" to the caller.
- `extract_content` on a URL a recent brief returned appends the used=true signal and says so, in the production entry as well.

## [4.2.0] - 2026-11-22

### Added
- Follow-up signals are written, not just described. When a tool opens a URL a recent `research_brief` returned, Enzyme now appends a used=true record (with the display rank) to `~/.local/state/hela/search-feedback.jsonl`; genome drains it on the next `search_priors`/`search_feedback` call. The response still says what happened, and falls back to the manual call when the append fails. This closes the gap in 4.1.0, where the loop was feedable but nobody fed it. (`researcher-mcp#35`)

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
