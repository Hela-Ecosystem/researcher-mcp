/**
 * Feedback spool — the write Enzyme is allowed to do.
 *
 * Genome owns the `source_feedback` table and keeps a single writer. Enzyme only
 * appends one JSON line per observed decision; genome drains the file the next time
 * it reads priors or records feedback. This closes the loop described in
 * researcher-mcp#35 without two processes writing one SQLite table.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SpoolFeedback {
  query_class: string;
  source: string;
  used: boolean;
  query?: string;
  note?: string;
}

export function feedbackSpoolPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.HELA_SEARCH_FEEDBACK_SPOOL
    || join(env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state"), "hela", "search-feedback.jsonl");
}

/** Append one observation. Never throws: a full disk must not break a tool call. */
export function appendFeedback(record: SpoolFeedback, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = feedbackSpoolPath(env);
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    appendFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 });
    return true;
  } catch (error) {
    // A failed append must not break a tool call; the caller falls back to telling
    // the operator to record the signal manually.
    console.error(`feedback spool append failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
