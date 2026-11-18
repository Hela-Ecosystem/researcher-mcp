import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnhancedWikipediaService } from "./wikipediaService.js";
import { WikipediaExtendedFeatures } from "./additionalFeatures.js";
import { GoogleSearchService } from "./googleSearchService.js";
import { freeSearch, freeExtract, listFreeEngines, arxivSearch, googleNewsSearch } from "./freeSearchService.js";
import { createWikipediaMcp } from "./mcp.js";
import { registerEnvTool, withEnvelope } from "./envelope.js";
import { googleSearchInput } from "./googleSearchTools.js";
import { formatScore, GOOGLE_RELEVANCE_FLOOR, scoreSearchResult, weightedScore, WIKIPEDIA_RELEVANCE_FLOOR } from "./searchQuality.js";
import { formatPriorsLine, resolveRouting } from "./sourcePriors.js";
import {
  searchProvenance,
  wikipediaSearchUrl,
  formatSourcesFooter,
  type SourceProvenance,
} from "./provenance.js";

function googleSource(query: string): SourceProvenance {
  return {
    source: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    retrieved_at: new Date().toISOString(),
    confidence: 0.85,
    freshness: "fresh",
  };
}

function formatGoogleItems(items: Array<{ title: string; link: string; snippet: string }>, query: string, multiplier = 1): string {
  const ranked = (items ?? []).map((r) => ({ ...r, score: weightedScore(scoreSearchResult(query, r.title, r.snippet ?? ""), multiplier) }))
    .filter((r) => r.score >= GOOGLE_RELEVANCE_FLOOR)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return "No results.";
  return ranked
    .map((r, i) => `${i + 1}. ${r.title} (score: ${formatScore(r.score)})\n   ${r.link}\n   ${r.snippet ?? ""}`)
    .join("\n");
}

/**
 * Build the combined modular server: the 10 Wikipedia tools from mcp.ts
 * plus the Google-backed tools. Google tools are registered only when a
 * GoogleSearchService is provided (API keys present); Wikipedia always is.
 */
export function createCombinedMcp(
  wikipediaService: EnhancedWikipediaService,
  extendedFeatures: WikipediaExtendedFeatures,
  googleSearchService: GoogleSearchService | null
): McpServer {
  // Bare "search" is the global web tool (registered below); Wikipedia's
  // search keeps working in the combined server as "wikipedia_search".
  const server = createWikipediaMcp(wikipediaService, extendedFeatures, {
    wikipediaSearchName: "wikipedia_search",
  });

  registerEnvTool(
    server,
    "free_search",
    {
      title: "Free Search",
      description:
        "Keyless web search: fans out to Mojeek + DuckDuckGo + Yep + Bing in parallel, no API keys needed. Dedups overlap by URL.",
      inputSchema: {
        query: z.string().describe("The search query."),
        maxResults: z.number().min(1).max(20).optional().describe("Max results total."),
        engines: z
          .array(z.string())
          .optional()
          .describe("Subset of engines, default all: " + listFreeEngines().join(", ")),      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const r = await freeSearch(args.query, {
        maxResults: args.maxResults ?? 10,
        engines: args.engines,
      });
      const body =
        r.items.length === 0
          ? "No results from keyless engines."
          : r.items
              .map(
                (it, i) =>
                  `${i + 1}. ${it.title} [${it.engine}]\n   ${it.link}\n   ${it.snippet ?? ""}`
              )
              .join("\n");
      const footer = formatSourcesFooter([
        {
          source: `free-search:${r.enginesUsed.join("+") || "none"}:${encodeURIComponent(args.query)}`,
          retrieved_at: new Date().toISOString(),
          confidence: 0.8,
          freshness: "fresh",
        },
        searchProvenance(args.query),
      ]);
      const coverage =
        r.enginesFailed.length > 0
          ? `\n\n(engines failed this call: ${r.enginesFailed.join(", ")})`
          : "";
      return `${body}\n\n${footer}${coverage}`;
    }
  );

  // Global search: always registered (before the Google early-return below).
  // Fans out to Google (when keys are set) + keyless engines in parallel,
  // dedupes by URL, Google hits first. Never fails hard: a Google error
  // just degrades to keyless results.
  registerEnvTool(
    server,
    "search",
    {
      title: "Search",
      description:
        "Global web search: Google (when API keys are set) plus keyless engines (Mojeek, DuckDuckGo, Yep, Bing) in parallel, deduped by URL. Works with zero API keys.",
      inputSchema: {
        query: z.string().describe("The search query."),
        maxResults: z.number().min(1).max(20).optional().describe("Max results total."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const n = args.maxResults ?? 10;
      const [free, g] = await Promise.all([
        freeSearch(args.query, { maxResults: n }),
        googleSearchService
          ? googleSearchService
              .search({ q: args.query, num: Math.min(n, 10) })
              .catch((e) => {
                console.error("search: google failed, keyless only:", (e as Error)?.message ?? e);
                return null;
              })
          : Promise.resolve(null),
      ]);
      const seen = new Set<string>();
      const merged: Array<{ title: string; link: string; snippet: string; via: string }> = [];
      for (const it of g?.items ?? []) {
        if (it.link && !seen.has(it.link)) {
          seen.add(it.link);
          merged.push({ title: it.title, link: it.link, snippet: it.snippet ?? "", via: "google" });
        }
      }
      for (const it of free.items) {
        if (it.link && !seen.has(it.link)) {
          seen.add(it.link);
          merged.push({ title: it.title, link: it.link, snippet: it.snippet ?? "", via: it.engine });
        }
      }
      const body =
        merged.length === 0
          ? "No results."
          : merged
              .slice(0, n)
              .map((r, i) => `${i + 1}. ${r.title} [${r.via}]\n   ${r.link}\n   ${r.snippet}`)
              .join("\n");
      const provs: SourceProvenance[] = [
        {
          source: `free-search:${free.enginesUsed.join("+") || "none"}:${encodeURIComponent(args.query)}`,
          retrieved_at: new Date().toISOString(),
          confidence: 0.8,
          freshness: "fresh",
        },
        searchProvenance(args.query),
      ];
      if (g) provs.unshift(googleSource(args.query));
      const footer = formatSourcesFooter(provs);
      const coverage =
        free.enginesFailed.length > 0
          ? `\n\n(keyless engines failed this call: ${free.enginesFailed.join(", ")})`
          : "";
      return `${body}\n\n${footer}${coverage}`;
    }
  );

  if (!googleSearchService) {
    console.error("Google tools skipped: GOOGLE_API_KEY / GOOGLE_CSE_ID not set");
    registerEnvTool(
      server,
      "extract_content",
      {
        title: "Extract Content",
        description:
          "Canonical content extraction: fetch a URL and extract its main content via HTTP/Readability (keyless Jina reader fallback; set JINA_API_KEY for higher quota). Use hela-cytosol browser_get_content (format=markdown) only when client-side JavaScript is required.",
        inputSchema: {
          url: z.string().describe("The URL to extract."),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (args) => {
        const a = await freeExtract(args.url);
        const footer = formatSourcesFooter([
          {
            source: args.url,
            retrieved_at: new Date().toISOString(),
            confidence: 0.85,
            freshness: "fresh",
          },
        ]);
        return [`# ${a.title}`, ``, a.content.slice(0, 8000), ``, `(${a.wordCount} words)`, ``, footer].join("\n");
      }
    );
    return server;
  }
  const google = googleSearchService;

  server.registerTool(
    "google_search",
    {
      title: "Google Search",
      description: "Canonical web search: Google Custom Search with keyless multi-engine fallback. Use for factual lookups; prefer over browser-scoped search.",
      inputSchema: googleSearchInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await google.search({ q: args.query, num: args.num ?? 5 });
      const items = data.items ?? [];
      const footer = formatSourcesFooter([
        googleSource(args.query),
        searchProvenance(args.query),
      ]);
      return withEnvelope("google_search", { content: [{ type: "text", text: `${formatGoogleItems(items, args.query)}\n\n${footer}` }] });
    }
  );

  registerEnvTool(
    server,
    "academic_search",
    {
      title: "Academic Search",
      description: "Search academic papers. arXiv answers first with its publication date enforced; Google Scholar and ResearchGate are used when arXiv has no match.",
      inputSchema: {
        query: z.string().describe("The research query."),
        sites: z.array(z.string()).optional().describe("Academic sites to restrict to."),
        maxResults: z.number().min(1).max(10).optional().describe("Max results."),
        dateRange: z.enum(["d1", "d7", "m1", "m6", "y1", "y2"]).optional().default("y1").describe("Publication date range, enforced on arXiv and passed to Google as a restriction."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const papers = await arxivSearch(args.query, args.maxResults ?? 5, args.dateRange ?? "y1");
      if (papers.length) {
        return papers.map((paper, index) =>
          `${index + 1}. ${paper.title} (score: ${formatScore(scoreSearchResult(args.query, paper.title, paper.summary))}; ${paper.published.slice(0, 10)})\n   ${paper.link}\n   ${paper.summary.slice(0, 300)}`
        ).join("\n\n");
      }
      const data = await google.searchAcademic(args.query, {
        sites: args.sites,
        maxResults: args.maxResults ?? 5,
        dateRange: args.dateRange,
      });
      const footer = formatSourcesFooter([
        googleSource(args.query),
        searchProvenance(args.query),
      ]);
      return `${formatGoogleItems(data.items ?? [], args.query)}\n\n${footer}`;
    }
  );

  registerEnvTool(
    server,
    "news_search",
    {
      title: "News Search",
      description: "Search recent news on a topic.",
      inputSchema: {
        topic: z.string().describe("The news topic."),
        language: z.string().optional().describe("Language code, e.g. en."),
        maxResults: z.number().min(1).max(10).optional().describe("Max results."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await google.searchNews(args.topic, {
        language: args.language,
        maxResults: args.maxResults ?? 5,
      });
      const footer = formatSourcesFooter([
        googleSource(args.topic),
        searchProvenance(args.topic),
      ]);
      return `${formatGoogleItems(data.items ?? [], args.topic)}\n\n${footer}`;
    }
  );

  registerEnvTool(
    server,
    "multi_site_search",
    {
      title: "Multi-site Search",
      description: "Search one query across several specific sites.",
      inputSchema: {
        query: z.string().describe("The search query."),
        sites: z.array(z.string()).describe("Sites to search, e.g. [\"arxiv.org\"]."),
        maxResults: z.number().min(1).max(10).optional().describe("Max results per site."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await google.searchMultipleSites(args.query, args.sites, {
        maxResults: args.maxResults ?? 5,
      });
      const footer = formatSourcesFooter([
        googleSource(`site:${args.sites.join(" OR site:")} ${args.query}`),
        searchProvenance(args.query),
      ]);
      const routing = await resolveRouting(args.query);
      return `${formatPriorsLine(routing)}\n\n${formatGoogleItems(data.items ?? [], args.query, routing.multipliers.google)}\n\n${footer}`;
    }
  );

  registerEnvTool(
    server,
    "extract_content",
    {
      title: "Extract Content",
      description: "Canonical content extraction: fetch a URL and extract/analyze its main content via HTTP/Readability. Use hela-cytosol browser_get_content (format=markdown) only when client-side JavaScript is required.",
      inputSchema: {
        url: z.string().describe("The URL to extract."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const a = await google.extractContent(args.url);
      const footer = formatSourcesFooter([
        {
          source: args.url,
          retrieved_at: new Date().toISOString(),
          confidence: 0.9,
          freshness: "fresh",
        },
      ]);
      return [
        `# ${a.title}`,
        ``,
        a.content.slice(0, 8000),
        ``,
        `(${a.wordCount} words, sentiment ${a.sentiment.score})`,
        ``,
        footer,
      ].join("\n");
    }
  );

  registerEnvTool(
    server,
    "research_brief",
    {
      title: "Research Brief",
      description:
        "One-call brief: fans out to Google + Wikipedia in parallel, dedups overlap, exact matches first.",
      inputSchema: {
        query: z.string().describe("The research question."),
        maxResults: z.number().min(1).max(10).optional().describe("Max results per source."),
        lang: z.string().optional().describe("Wikipedia language, default en."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const n = args.maxResults ?? 5;
      const lang = args.lang ?? "en";
      const routing = await resolveRouting(args.query);
      const [g, w, academic, news] = await Promise.all([
        google.search({ q: args.query, num: n }),
        wikipediaService.search(args.query, { limit: n, lang }),
        routing.queryClass === "academic" ? arxivSearch(args.query, n, "y1") : Promise.resolve([]),
        routing.queryClass === "news" ? googleNewsSearch(args.query, { maxResults: n }) : Promise.resolve([]),
      ]);
      const gItems: Array<{ title: string; link: string; snippet: string }> = g.items ?? [];
      const seen = new Set(gItems.map((r) => r.link));
      const wikiUrl = (title: string) =>
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      const wItems: Array<{ title: string; link: string; snippet: string; score: number }> = (w ?? [])
        .filter((p: any) => !seen.has(wikiUrl(p.title ?? "")))
        .map((p: any) => {
          const title = p.title ?? "";
          const snippet = p.snippet ?? p.description ?? "";
          return {
            title,
            link: wikiUrl(title),
            snippet,
            score: weightedScore(scoreSearchResult(args.query, title, snippet), routing.multipliers.wikipedia),
          };
        })
        .filter((p: { score: number }) => p.score >= WIKIPEDIA_RELEVANCE_FLOOR)
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
      const footer = formatSourcesFooter([
        googleSource(args.query),
        searchProvenance(args.query, lang),
        {
          source: wikipediaSearchUrl(args.query, lang),
          retrieved_at: new Date().toISOString(),
          confidence: 0.85,
          freshness: "fresh",
        },
      ]);
      return [
        `# Research brief: ${args.query}`,
        ``,
        formatPriorsLine(routing),
        ``,
        `## Google`,
        formatGoogleItems(gItems, args.query, routing.multipliers.google),
        ``,
        `## Wikipedia`,
        wItems.length ? wItems.map((p, i) => `${i + 1}. ${p.title} (score: ${formatScore(p.score)})\n   ${p.link}\n   ${p.snippet}`).join("\n") : "No results.",
        ...(academic.length ? ["", "## Academic Search", ...academic.map((p, i) => `${i + 1}. ${p.title} (score: ${formatScore(weightedScore(scoreSearchResult(args.query, p.title, p.summary), routing.multipliers.academic_search))}; ${p.published.slice(0, 10)})\n   ${p.link}`)] : []),
        ...(news.length ? ["", "## News Monitor", ...news.map((p, i) => `${i + 1}. ${p.title} (score: ${formatScore(weightedScore(scoreSearchResult(args.query, p.title, p.snippet ?? ""), routing.multipliers.news_monitor))})\n   ${p.link}`)] : []),
        ``,
        footer,
      ].join("\n");
    }
  );

  return server;
}
