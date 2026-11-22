# HeLa Enzyme: canonical tools

Server version **4.3.2**. Generated from the ecosystem schema catalog; regenerate with `npm run docs:generate -- --servers` in the ecosystem checkout.

Only names advertised by `tools/list` are listed here. Older aliases in migration examples are not additional tools. Runtime namespace prefixes are optional and do not change these server-local names.

## `academic_search`

Search academic papers and research documents

## `archive_org_search`

Search archived web pages on Archive.org (Wayback Machine)

## `citation_formatter`

Format citations in APA, MLA, or Chicago style

## `content_deduplication`

Deduplicate structured `{title, url, snippet}` items by canonical URL and title similarity; returns surviving objects plus a `mergedFrom` list as JSON

## `content_sentiment_analysis`

Analyze sentiment of text content using built-in sentiment analysis

## `content_summarizer`

Summarize content from multiple URLs, preferring og:description or the first main-content paragraph over raw body text

## `data_export`

Export research data in various formats (JSON, CSV, Markdown)

## `extract_content`

Canonical content extraction: fetch a URL and extract its main content. Use hela-cytosol browser_get_content (format=markdown) only when client-side JavaScript is required.

## `fact_checker`

Check a claim against fact-checking sources: labels each source stance and derives an overall verdict (ClaimReview ratings when available, otherwise source wording)

## `google_search`

Canonical web search: Google Custom Search API. Use for factual lookups; prefer over browser-scoped search.

## `keyword_extraction`

Extract key terms and topics from text content

## `multi_site_search`

Search across multiple specific websites simultaneously and report a per-site result count

## `news_monitor`

Monitor news and get alerts for specific topics

## `research_assistant`

Multi-angle research assistant: runs several query variants, deduplicates identical results across them, and includes URLs

## `research_brief`

One-call research brief: fans out to Google + Wikipedia in parallel, dedups cross-source overlap, ranks exact matches first. Replaces chaining google_search + wikipedia_search manually.

## `research_session_manager`

Save, load, list, and delete research sessions stored on disk

Actions: `save`, `load`, `list`, `delete`.

## `search_analytics`

Find relevant web sources in a date window and show Google matching page estimates when available

## `search_trends`

Find relevant web and Hacker News evidence in a date window, with Google matching page estimates when available

## `url_metadata_extractor`

Extract metadata from URLs including title, description, and basic info

## `wikipedia_get`

Get Wikipedia content by title, page ID, or multiple titles. Use format=summary for a short extract, format=full for cleaned article text. Exactly one of title, pageId, or titles is required.

## `wikipedia_get_pages_in_category`

Browse pages within a specific Wikipedia category

## `wikipedia_page_languages`

Get the languages a Wikipedia page is available in

## `wikipedia_random`

Get a random Wikipedia page

## `wikipedia_search`

Search Wikipedia by text query, multiple queries, or coordinates. Exactly one of query, queries, or coord is required. Nearby searches honour radius (metres).
