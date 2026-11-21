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
import { appendFeedback } from "./feedbackSpool.js";

export interface BriefUrl {
  url: string;
  source: SearchSource;
}

interface BriefEntry {
  queryClass: QueryClass;
  source: SearchSource;
  rank: number;
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
  urls.forEach(({ url, source }, index) => {
    if (!url) return;
    recent.delete(url);
    recent.set(url, { queryClass, source, rank: index + 1, recordedAt: now });
  });
}

/**
 * Observe a follow-up on a URL a brief returned: append one used-signal to the spool
 * genome drains, and return a line saying so. The entry is consumed so a URL is
 * recorded once, not on every read.
 */
export function feedbackHintForUrl(url: string): string | null {
  const entry = recent.get(url);
  if (!entry) return null;
  if (Date.now() - entry.recordedAt > TTL_MS) {
    recent.delete(url);
    return null;
  }
  recent.delete(url);
  const queued = appendFeedback({
    query_class: entry.queryClass,
    source: entry.source,
    used: true,
    query: undefined,
    note: `implicit follow-up; display rank ${entry.rank}`,
  });
  return (
    `feedback: this URL came from a recent research_brief (query_class=${entry.queryClass}, source=${entry.source}, rank ${entry.rank}). ` +
    (queued
      ? 'Recorded a used=true signal for genome; it is applied on the next search_priors/search_feedback call.'
      : 'Could not write the signal; record it manually: genome search_feedback(query_class="' + entry.queryClass + '", source="' + entry.source + '", used=true)')
  );
}

export function resetBriefMemoryForTests(): void {
  recent.clear();
}
