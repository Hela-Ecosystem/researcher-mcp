import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Shared helpers for the Enzyme roll-up fixes (issue researcher-mcp#43).
 * Kept side-effect free so they can be unit tested without a network or MCP server.
 */

export type SummarySource = 'og:description' | 'description' | 'paragraph' | 'body';

export interface SummaryExtraction {
  title: string;
  summary: string;
  source: SummarySource;
  truncated: boolean;
}

export interface ContentItem {
  title: string;
  url: string;
  snippet: string;
  [key: string]: unknown;
}

export interface MergedRecord {
  title: string;
  url: string;
  snippet: string;
  mergedInto: string;
}

export interface DeduplicationResult {
  unique: ContentItem[];
  mergedFrom: MergedRecord[];
}

export type ClaimStance = 'supports' | 'refutes' | 'mixed' | 'unclear';
export type ClaimVerdict = 'supported' | 'refuted' | 'mixed' | 'insufficient evidence';

export interface FactCheckSourceInput {
  title?: unknown;
  url?: unknown;
  source?: unknown;
  snippet?: unknown;
  rating?: unknown;
  reviewDate?: unknown;
}

export interface FactCheckSource {
  title: string;
  url: string;
  source: string;
  snippet: string;
  stance: ClaimStance;
  rating?: string;
  reviewDate?: string;
}

export interface FactCheckReport {
  claim: string;
  verdict: ClaimVerdict;
  counts: Record<ClaimStance, number>;
  sources: FactCheckSource[];
}

export interface ClaimReviewRecord {
  title: string;
  url: string;
  publisher: string;
  rating: string;
  reviewDate: string;
  snippet: string;
}

export interface ResearchSectionInput {
  query: string;
  results?: Array<Record<string, unknown>>;
}

export interface ResearchSectionItem {
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

export interface ResearchSection {
  query: string;
  items: ResearchSectionItem[];
  duplicatesRemoved: number;
}

export interface ResearchDedupResult {
  sections: ResearchSection[];
  duplicatesRemoved: number;
}

const REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'nav',
  'aside',
  'footer',
  'form',
  '.ad',
  '.ads',
  '.advertisement',
  '.site-header',
  '.global-header',
  '.site-nav',
  '.navbar',
  '.navigation',
  '.menu',
  '.breadcrumb',
  '.breadcrumbs',
  '.skip-link',
  '.skip-to-content',
  '#skip-link',
  '#skip-to-content',
  '[class*="skip-link"]',
  '[id*="skip-link"]',
].join(',');

const MAIN_PARAGRAPH_SELECTORS = [
  'main p',
  'article p',
  '[role="main"] p',
  '.content p',
  '.post p',
  '.entry p',
  '#content p',
  '#main p',
];

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeWhitespace(value: unknown): string {
  return asString(value).replace(/\s+/g, ' ').trim();
}

function stripSkipLinkText(value: string): string {
  return value
    .replace(/skip\s+to\s+(?:main\s+)?content/gi, ' ')
    .replace(/jump\s+to\s+(?:main\s+)?content/gi, ' ')
    .replace(/skip\s+navigation/gi, ' ');
}

function metaContent($: cheerio.CheerioAPI, names: string[]): string {
  for (const name of names) {
    const selector = name.startsWith('og:')
      ? `meta[property="${name}"]`
      : `meta[name="${name}"]`;
    const value = $(selector).first().attr('content');
    const normalized = normalizeWhitespace(value);
    if (normalized) return normalized;
  }
  return '';
}

function truncateSummary(value: string, maxLength: number): { summary: string; truncated: boolean } {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) return { summary: text, truncated: false };

  const hardCut = text.slice(0, maxLength);
  const lastSpace = hardCut.lastIndexOf(' ');
  const softCut = lastSpace > Math.floor(maxLength * 0.6) ? hardCut.slice(0, lastSpace) : hardCut;
  return { summary: `${softCut.trimEnd()}...`, truncated: true };
}

function firstParagraph($: cheerio.CheerioAPI): string {
  for (const selector of MAIN_PARAGRAPH_SELECTORS) {
    const paragraphs = $(selector)
      .toArray()
      .map((element) => normalizeWhitespace($(element).text()))
      .filter((text) => text.length >= 40);
    if (paragraphs.length > 0) return paragraphs[0];
  }

  const fallback = $('p')
    .toArray()
    .map((element) => normalizeWhitespace($(element).text()))
    .filter((text) => text.length >= 40);
  return fallback[0] || '';
}

function bodyBlockText($: cheerio.CheerioAPI): string {
  const leafTexts = $('body')
    .find('*')
    .toArray()
    .filter((element) => $(element).children().length === 0)
    .map((element) => normalizeWhitespace($(element).text()))
    .filter(Boolean);
  if (leafTexts.length > 0) return normalizeWhitespace(leafTexts.join(' '));
  return normalizeWhitespace($('body').text());
}

/**
 * Extract a summary from an HTML document. Page chrome is stripped, blocks are
 * joined with spaces, and og:description / the first main-content paragraph is
 * preferred over raw body text.
 */
export function extractSummaryFromHtml(html: string, maxLength = 200): SummaryExtraction {
  const $ = cheerio.load(html);
  const title =
    metaContent($, ['og:title']) ||
    normalizeWhitespace($('title').first().text()) ||
    normalizeWhitespace($('h1').first().text());

  $(REMOVE_SELECTORS).remove();

  const ogDescription = metaContent($, ['og:description']);
  const metaDescription = metaContent($, ['description']);
  const paragraph = firstParagraph($);

  let text = '';
  let source: SummarySource = 'body';
  if (ogDescription.length >= 24) {
    text = ogDescription;
    source = 'og:description';
  } else if (metaDescription.length >= 24) {
    text = metaDescription;
    source = 'description';
  } else if (paragraph) {
    text = paragraph;
    source = 'paragraph';
  } else {
    text = bodyBlockText($);
    source = 'body';
  }

  text = stripSkipLinkText(text);
  const { summary, truncated } = truncateSummary(text, maxLength);
  return { title, summary, source, truncated };
}

/** Clean and truncate already-extracted plain text (e.g. the Jina fallback). */
export function summarizePlainText(text: string, maxLength = 200): SummaryExtraction {
  const clean = stripSkipLinkText(normalizeWhitespace(text));
  const { summary, truncated } = truncateSummary(clean, maxLength);
  return { title: '', summary, source: 'body', truncated };
}

/**
 * Canonical form used only for comparison: drops utm_* parameters, fragments,
 * trailing slashes, default ports, and sorts remaining query parameters.
 */
export function canonicalizeUrl(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    url.hash = '';
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !/^utm_/i.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = new URLSearchParams(params).toString();
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ''}`;
  } catch {
    return raw.replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

function normalizeTitle(value: unknown): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[_–—]/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(item1: ContentItem, item2: ContentItem): number {
  const text1 = normalizeTitle(item1.title);
  const text2 = normalizeTitle(item2.title);
  if (!text1 || !text2) return 0;

  const words1 = new Set(text1.split(' '));
  const words2 = new Set(text2.split(' '));
  const intersection = new Set([...words1].filter((word) => words2.has(word)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

function toContentItem(value: unknown): ContentItem {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const item: ContentItem = {
    ...raw,
    title: normalizeWhitespace(raw.title ?? raw.text),
    url: asString(raw.url ?? raw.link).trim(),
    snippet: normalizeWhitespace(raw.snippet ?? raw.description),
  };
  return item;
}

/**
 * Deduplicate structured content items by canonical URL and title similarity.
 * Returns the surviving objects (title/url/snippet) plus a mergedFrom list so a
 * pipe step can see exactly what collapsed into what.
 */
export function deduplicateContentItems(content: unknown[], threshold = 0.8): DeduplicationResult {
  const unique: ContentItem[] = [];
  const mergedFrom: MergedRecord[] = [];

  for (const raw of content) {
    const item = toContentItem(raw);
    const canonical = canonicalizeUrl(item.url);
    const survivor = unique.find((existing) => {
      const existingCanonical = canonicalizeUrl(existing.url);
      if (canonical && existingCanonical && canonical === existingCanonical) return true;
      return similarity(item, existing) > threshold;
    });

    if (survivor) {
      mergedFrom.push({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        mergedInto: canonicalizeUrl(survivor.url) || survivor.title,
      });
    } else {
      unique.push(item);
    }
  }

  return { unique, mergedFrom };
}

const REFUTE_CUES = /\b(?:false|fake|hoax|debunk(?:ed|s)?|misleading|misinformation|disinformation|incorrect|untrue|not\s+true|no\s+evidence|myth|fabricated|baseless|refut(?:e|es|ed)|contradict(?:s|ed)?|denied|wrong|does\s+not|do\s+not|did\s+not|is\s+not|isn't|are\s+not|aren't)\b/i;
const SUPPORT_CUES = /\b(?:true|confirmed|accurate|correct|verified|support(?:s|ed)?|factual|legitimate|real)\b/i;
const MIXED_CUES = /\b(?:mixed|half[- ]true|partly\s+(?:true|false)|partially\s+(?:true|false)|true\s+and\s+false)\b/i;

const CLAIM_STOPWORDS = new Set([
  'the', 'and', 'for', 'was', 'were', 'are', 'but', 'that', 'this', 'with', 'from', 'her', 'his', 'its',
  'their', 'has', 'have', 'had', 'been', 'not', 'any', 'all', 'can', 'will', 'who', 'what', 'when', 'than',
]);

const stemOf = (word: string): string => word.slice(0, Math.max(4, word.length - 3));

function claimKeyTerms(claim: string): string[] {
  const words = normalizeWhitespace(claim).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length > 2 && !CLAIM_STOPWORDS.has(word)))];
}

/** True when the text carries at least half of the claim's key terms (prefix-stemmed). */
export function mentionsClaim(claim: string, text: string): boolean {
  const terms = claimKeyTerms(claim);
  if (terms.length === 0) return false;
  const haystack = normalizeWhitespace(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const matched = terms.filter((term) => {
    const stem = stemOf(term);
    return haystack.some((word) => (term.length < 4 ? word === term : word.startsWith(stem)));
  });
  return matched.length >= Math.min(2, terms.length) && matched.length / terms.length >= 0.5;
}

/**
 * Heuristic stance from a result's own wording (used when ClaimReview has no rating).
 * With `claim`, a source that never mentions the claim is `unclear`; one that does is
 * `supports` unless it also carries denial wording (`refutes`) or both (`mixed`).
 */
export function classifyClaimStance(title: string, snippet = '', claim = ''): ClaimStance {
  const text = normalizeWhitespace(`${title} ${snippet}`);
  if (!text) return 'unclear';

  const claimed = normalizeWhitespace(claim) !== '';
  const mentioned = claimed && mentionsClaim(claim, text);
  if (claimed && !mentioned) return 'unclear';

  const mixed = MIXED_CUES.test(text);
  const refutes = REFUTE_CUES.test(text);
  const supports = SUPPORT_CUES.test(text) || (mentioned && !refutes && !mixed);

  if (mixed && !refutes && !supports) return 'mixed';
  if (refutes && supports) return SUPPORT_CUES.test(text) ? 'mixed' : 'refutes';
  if (refutes) return 'refutes';
  if (supports) return 'supports';
  return 'unclear';
}

/** Map a ClaimReview textual rating (e.g. "False", "Mostly true", "Half true"). */
export function stanceFromRating(rating: string): ClaimStance {
  const text = normalizeWhitespace(rating).toLowerCase();
  if (!text) return 'unclear';
  if (/\b(?:mixed|half|partly|partially)\b/.test(text)) return 'mixed';
  if (/\b(?:false|fake|incorrect|wrong|misleading|no evidence|pants on fire|debunk)\b/.test(text)) {
    return 'refutes';
  }
  if (/\b(?:true|correct|accurate|verified|legitimate)\b/.test(text)) return 'supports';
  return 'unclear';
}

export function deriveClaimVerdict(stances: ClaimStance[]): ClaimVerdict {
  const supports = stances.filter((stance) => stance === 'supports').length;
  const refutes = stances.filter((stance) => stance === 'refutes').length;
  const mixed = stances.filter((stance) => stance === 'mixed').length;

  if (supports > 0 && refutes > 0) return 'mixed';
  if (refutes > 0 && mixed === 0) return 'refuted';
  if (supports > 0 && mixed === 0) return 'supported';
  if (refutes > 0 || supports > 0 || mixed > 0) return 'mixed';
  return 'insufficient evidence';
}

/** Turn search/fact-check rows into a report with per-source stance and overall verdict. */
export function buildFactCheckReport(
  claim: string,
  sources: FactCheckSourceInput[]
): FactCheckReport {
  const normalized: FactCheckSource[] = sources.map((source) => {
    const rating = normalizeWhitespace(source.rating);
    const title = normalizeWhitespace(source.title);
    const snippet = normalizeWhitespace(source.snippet);
    const stance = rating ? stanceFromRating(rating) : classifyClaimStance(title, snippet, claim);
    const result: FactCheckSource = {
      title: title || 'Untitled source',
      url: asString(source.url).trim(),
      source: normalizeWhitespace(source.source) || 'web',
      snippet,
      stance,
    };
    if (rating) result.rating = rating;
    const reviewDate = normalizeWhitespace(source.reviewDate);
    if (reviewDate) result.reviewDate = reviewDate;
    return result;
  });

  const counts: Record<ClaimStance, number> = {
    supports: normalized.filter((source) => source.stance === 'supports').length,
    refutes: normalized.filter((source) => source.stance === 'refutes').length,
    mixed: normalized.filter((source) => source.stance === 'mixed').length,
    unclear: normalized.filter((source) => source.stance === 'unclear').length,
  };

  return {
    claim,
    verdict: deriveClaimVerdict(normalized.map((source) => source.stance)),
    counts,
    sources: normalized,
  };
}

/**
 * Query Google's Fact Check Tools ClaimReview API. Returns [] when the response
 * has no claims; callers are expected to catch auth/network failures and fall
 * back to search-derived stances.
 */
export async function fetchClaimReviews(
  claim: string,
  apiKey: string,
  timeoutMs = 8000
): Promise<ClaimReviewRecord[]> {
  const response = await axios.get('https://factchecktools.googleapis.com/v1alpha1/claims:search', {
    params: { query: claim, key: apiKey, pageSize: 10 },
    timeout: timeoutMs,
  });

  const claims = Array.isArray(response.data?.claims) ? response.data.claims : [];
  const records: ClaimReviewRecord[] = [];
  for (const entry of claims) {
    const reviews = Array.isArray(entry?.claimReview) ? entry.claimReview : [];
    for (const review of reviews) {
      const url = asString(review?.url).trim();
      const rating = normalizeWhitespace(review?.textualRating);
      if (!url && !rating) continue;
      records.push({
        title: normalizeWhitespace(review?.title) || normalizeWhitespace(entry?.text) || 'Untitled fact check',
        url,
        publisher: normalizeWhitespace(review?.publisher?.name) || 'unknown publisher',
        rating,
        reviewDate: normalizeWhitespace(review?.reviewDate),
        snippet: normalizeWhitespace(entry?.text),
      });
    }
  }
  return records;
}

function domainOf(url: string, displayLink: string): string {
  const explicit = displayLink.trim().replace(/^www\./i, '');
  if (explicit) return explicit;
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'unknown';
  }
}

function toResearchItem(value: unknown): ResearchSectionItem {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const url = asString(raw.url ?? raw.link).trim();
  return {
    title: normalizeWhitespace(raw.title) || 'Untitled result',
    url,
    domain: domainOf(url, asString(raw.displayLink)),
    snippet: normalizeWhitespace(raw.snippet),
  };
}

/**
 * Deduplicate results across sub-queries. The first occurrence wins; later
 * sections keep only new URLs/titles so identical hits are not printed twice.
 */
export function dedupeResearchSections(sections: ResearchSectionInput[]): ResearchDedupResult {
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  const deduped = sections.map((section) => {
    const items: ResearchSectionItem[] = [];
    let removed = 0;

    for (const raw of section.results || []) {
      const item = toResearchItem(raw);
      const key = canonicalizeUrl(item.url) || normalizeTitle(item.title);
      if (key && seen.has(key)) {
        removed += 1;
        duplicatesRemoved += 1;
        continue;
      }
      if (key) seen.add(key);
      items.push(item);
    }

    return { query: section.query, items, duplicatesRemoved: removed };
  });

  return { sections: deduped, duplicatesRemoved };
}

export function normalizeSite(site: unknown): string {
  const raw = asString(site).trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return raw.replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  }
}

function itemHost(item: Record<string, unknown>): string {
  const link = asString(item.url ?? item.link).trim();
  if (link) {
    try {
      return new URL(link).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      /* fall through to displayLink */
    }
  }
  return asString(item.displayLink).replace(/^www\./i, '').toLowerCase();
}

function hostMatchesSite(host: string, site: string): boolean {
  if (!host || !site) return false;
  return host === site || host.endsWith(`.${site}`);
}

/** Per-site counts for multi-site search; zero-count sites stay visible. */
export function countResultsBySite(
  items: Array<Record<string, unknown>>,
  sites: unknown[]
): Array<{ site: string; count: number }> {
  const normalizedSites = [...new Set(sites.map(normalizeSite).filter(Boolean))];
  return normalizedSites.map((site) => ({
    site,
    count: items.reduce((count, item) => (hostMatchesSite(itemHost(item), site) ? count + 1 : count), 0),
  }));
}
