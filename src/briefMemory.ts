/**
 * Short-lived brief → URL → source memory.
 *
 * Genome can only learn which source produced an answer if something records the
 * decision. Asking a caller to re-derive the query class and remember which source
 * supplied a URL is enough friction that nobody does it (researcher-mcp#35).
 *
 * This module remembers the URLs a recent research_brief returned, with the class
 * and source that produced them, so a follow-up tool can say exactly what to record
 * at the moment the follow-up happens. It deliberately does not write to the genome
 * database: the priors table is owned by genome, and this server opens it read-only.
 */

import type { QueryClass, SearchSource } from "./searchQuality.js";

export interface BriefUrl {
  url: string;
  source: SearchSource;
}

interface BriefEntry {
  queryClass: QueryClass;
  source: SearchSource;
  recordedAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 200;
const recent = new Map<string, BriefEntry>();

function prune(now: number): void {
  for (const [url, entry] of recent) {
    if (now - entry.recordedAt > TTL_MS) recent.delete(url);
  }
  for (const url of recent.keys()) {
    if (recent.size <= MAX_ENTRIES) break;
    recent.delete(url);
  }
}

export function rememberBrief(queryClass: QueryClass, urls: BriefUrl[]): void {
  const now = Date.now();
  prune(now);
  for (const { url, source } of urls) {
    if (!url) continue;
    recent.delete(url);
    recent.set(url, { queryClass, source, recordedAt: now });
  }
}

/** The exact call to make, for a URL a brief returned, or null when it is unknown. */
export function feedbackHintForUrl(url: string): string | null {
  const entry = recent.get(url);
  if (!entry) return null;
  if (Date.now() - entry.recordedAt > TTL_MS) {
    recent.delete(url);
    return null;
  }
  return (
    `feedback: this URL came from a recent research_brief (query_class=${entry.queryClass}, source=${entry.source}). ` +
    `Record the follow-up: genome search_feedback(query_class="${entry.queryClass}", source="${entry.source}", used=true)`
  );
}

export function resetBriefMemoryForTests(): void {
  recent.clear();
}
