export const GOOGLE_RELEVANCE_FLOOR = 0.16;
// Wikipedia search OR-matches terms, so its floor is higher to suppress cheap term scatter.
export const WIKIPEDIA_RELEVANCE_FLOOR = 0.4;
const EXACT_PHRASE_BONUS = 0.2;
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in",
  "is", "it", "of", "on", "or", "that", "the", "this", "to", "what", "when", "where",
  "which", "who", "why", "with",
]);

/**
 * Collapse light morphological variants so `tool`/`tools` and `call`/`calls` count
 * once. Full stemming is overkill here; trailing s/es/ed/ing on words over four
 * characters covers the cases that actually inflate the coverage denominator
 * (terminal-mcp#36).
 */
export function foldTerm(term: string): string {
  if (term.length <= 3) return term;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    // Keep at least three characters: "apis" -> "api" is wanted, "used" -> "us" is not.
    if (term.endsWith(suffix) && term.length - suffix.length >= 3) {
      return term.slice(0, -suffix.length);
    }
  }
  return term;
}

export function queryTerms(query: string): string[] {
  const raw = (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter((term) => term.length > 2 && !STOPWORDS.has(term));
  return [...new Set(raw.map(foldTerm))];
}

/**
 * A reduced query for the one retry after every source returns zero. Longer terms
 * are rarer and carry the query; short ones are usually noise (researcher-mcp#34).
 */
export function backoffQuery(query: string, limit = 5): string | null {
  const terms = queryTerms(query);
  // Only reshape a genuinely long query; a three-word query is already tight.
  if (terms.length < 4) return null;
  const keep = new Set([...terms].sort((a, b) => b.length - a.length).slice(0, limit));
  const ordered = terms.filter((term) => keep.has(term));
  if (ordered.length >= terms.length) return null;
  // Preserve the original word order: it reads better to a search engine.
  return ordered.join(" ");
}

/**
 * Weight terms by how much they discriminate *among the candidates in hand*.
 * A term present in every title/snippet tells us nothing for this query; one that
 * appears in a few carries it. Weights are normalised to a mean of 1 so the
 * relevance floors keep their meaning.
 */
export function termWeights(terms: string[], corpus: Array<{ title: string; snippet?: string }> = []): Map<string, number> {
  const weights = new Map<string, number>();
  if (!terms.length) return weights;
  if (!corpus.length) {
    for (const term of terms) weights.set(term, 1);
    return weights;
  }
  const documents = corpus.map((doc) => `${doc.title} ${doc.snippet ?? ""}`.toLowerCase());
  const total = documents.length;
  let sum = 0;
  for (const term of terms) {
    const df = documents.filter((doc) => doc.includes(term)).length;
    const idf = Math.log((total + 1) / (df + 0.5));
    const weight = Math.min(2, Math.max(0.35, idf));
    weights.set(term, weight);
    sum += weight;
  }
  const mean = sum / terms.length;
  if (mean > 0) for (const [term, weight] of weights) weights.set(term, weight / mean);
  return weights;
}

export function scoreSearchResult(
  query: string,
  title = "",
  snippet = "",
  corpus: Array<{ title: string; snippet?: string }> = [],
): number {
  const terms = queryTerms(query);
  if (!terms.length) return 0;
  const titleText = title.toLowerCase();
  const snippetText = snippet.toLowerCase();
  const weights = termWeights(terms, corpus);
  const totalWeight = terms.reduce((sum, term) => sum + (weights.get(term) ?? 1), 0);
  const coverage = terms.reduce((sum, term) => {
    const weight = weights.get(term) ?? 1;
    if (titleText.includes(term)) return sum + weight;
    if (snippetText.includes(term)) return sum + 0.45 * weight;
    return sum;
  }, 0) / (totalWeight || 1);
  const phrase = query.trim().length > 2 &&
    `${title} ${snippet}`.toLowerCase().includes(query.trim().toLowerCase());
  return Math.min(1, coverage + (phrase ? EXACT_PHRASE_BONUS : 0));
}

export type QueryClass = "news" | "academic" | "technical" | "definition" | "entity" | "general";
export type SearchSource = "google" | "wikipedia" | "news_monitor" | "academic_search";
export interface QueryRouting {
  queryClass: QueryClass;
  multipliers: Record<SearchSource, number>;
}

export function classifyQuery(query: string): QueryRouting {
  const text = query.trim();
  const lower = text.toLowerCase();
  let queryClass: QueryClass = "general";
  let multipliers: Record<SearchSource, number> = {
    google: 1, wikipedia: 1, news_monitor: 0.65, academic_search: 0.65,
  };

  if (/\b(latest|release|released|announced|announcement|breaking|today)\b/i.test(text)) {
    queryClass = "news";
    multipliers = { google: 0.75, wikipedia: 0.4, news_monitor: 1.5, academic_search: 0.5 };
  } else if (/\b(benchmark|evaluation|survey|method|methodology)\b/i.test(text)) {
    queryClass = "academic";
    multipliers = { google: 0.75, wikipedia: 0.45, news_monitor: 0.4, academic_search: 1.5 };
  } else if (/\b\d+\.\d+(?:\.\d+)?\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b(?:api|protocol|sdk|mcp|http|grpc)\b/i.test(text)) {
    queryClass = "technical";
    multipliers = { google: 1.4, wikipedia: 0.45, news_monitor: 0.5, academic_search: 0.8 };
  } else if (/^\s*what\s+is\b/i.test(text)) {
    queryClass = "definition";
    multipliers = { google: 0.8, wikipedia: 1.5, news_monitor: 0.4, academic_search: 0.55 };
  } else if (/(?:^|\s)[A-Z][\p{L}\p{N}'-]*(?:\s+[A-Z][\p{L}\p{N}'-]*)+/u.test(text)) {
    queryClass = "entity";
    multipliers = { google: 0.8, wikipedia: 1.35, news_monitor: 0.6, academic_search: 0.6 };
  }
  return { queryClass, multipliers };
}

export function weightedScore(score: number, multiplier: number): number {
  return Math.min(1, score * multiplier);
}

export function formatScore(score: number): string {
  return score.toFixed(2);
}
