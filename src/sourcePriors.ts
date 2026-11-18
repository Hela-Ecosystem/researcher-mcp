/**
 * Learned search-source priors — read path (Enzyme side).
 *
 * `classifyQuery` in `searchQuality.ts` returns static per-source multipliers.
 * Nothing in this server records which source produced the answer a caller
 * actually used, so those constants could never improve. Genome
 * (project-mcp) owns that record: it writes every caller decision into the
 * `source_feedback` table of its central database. This module reads that
 * table READ-ONLY and turns it into the same multipliers, falling back to the
 * static table whenever the database is absent, unreadable, or too thin.
 *
 * Enzyme never writes to the genome database. The connection is opened with
 * SQLite's read-only flag and closed immediately.
 *
 * The derivation below is duplicated verbatim in project-mcp
 * (`src/source-feedback.ts`). Constants are duplicated rather than imported
 * because each MCP server builds and deploys independently. If you change a
 * constant here, change it there in the same commit.
 */

import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import { classifyQuery, type QueryClass, type QueryRouting, type SearchSource } from "./searchQuality.js";

export const SEARCH_SOURCES: readonly SearchSource[] = ["google", "wikipedia", "news_monitor", "academic_search"];

// ---------------------------------------------------------------------------
// Adaptation constants. Keep in lockstep with project-mcp/src/source-feedback.ts.
// ---------------------------------------------------------------------------

/** Samples needed in a (query_class, source) cell before its static prior is replaced. */
export const MIN_SAMPLES = 5;
/** Slope from Beta-smoothed success rate to multiplier. 1.0 => p in [0,1] maps to [0.5, 1.5]. */
export const PRIOR_GAIN = 1.0;
/** Lift handed to a source the loop has stopped sampling, so it can be picked again. */
export const EXPLORATION_BONUS = 0.15;
/** Hard bounds on any derived multiplier. */
export const MULTIPLIER_FLOOR = 0.5;
export const MULTIPLIER_CEILING = 1.5;
/** A cell whose newest sample is older than this is treated as unexplored. */
export const STALE_SAMPLE_DAYS = 30;
/** How long one read of the genome table is reused, so a brief is not one query per candidate. */
export const PRIORS_CACHE_TTL_MS = 60_000;

const MS_PER_DAY = 86_400_000;
const SOURCE_FEEDBACK_TABLE = "source_feedback";
const NODE_SQLITE_MODULE = "node:sqlite";

/** Minimal read-only surface of node:sqlite's DatabaseSync. */
interface ReadOnlyDatabase {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}
type ReadOnlyDatabaseCtor = new (path: string, options?: { readOnly?: boolean }) => ReadOnlyDatabase;

export type PriorMode = "static" | "learned" | "exploring";
export type PriorsSource = "static" | "learned";

/** One (query_class, source) cell of recorded history. */
export interface SourceFeedbackStat {
  query_class: string;
  source: string;
  samples: number;
  used: number;
  last_recorded_at: string | null;
}

export interface LearnedRouting extends QueryRouting {
  /** Which multiplier table the caller is actually ranking with. */
  priors: PriorsSource;
  /** Samples backing the class, 0 when the static table is in use. */
  samples: number;
  /** Per-source derivation detail, for callers that want to report it. */
  modes: Record<SearchSource, PriorMode>;
}

/**
 * Resolve the genome database the same way project-mcp does:
 * `GUARDIAN_CENTRAL_DB` when it is an absolute path, else `~/memory/memory.db`.
 */
export function resolveGenomeDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GUARDIAN_CENTRAL_DB;
  if (configured && isAbsolute(configured)) return resolve(configured);
  return join(env.HOME || homedir(), "memory", "memory.db");
}

/**
 * Read the aggregated feedback table read-only. Returns null — not an empty
 * list — when the database cannot be read at all, so callers can tell
 * "no genome" from "genome with no samples yet".
 */
export async function readFeedbackStats(dbPath: string): Promise<SourceFeedbackStat[] | null> {
  let DatabaseSync: ReadOnlyDatabaseCtor;
  try {
    // node:sqlite ships with the runtime (Node >= 22.5), so this adds no
    // dependency. The specifier is a variable so the build does not need
    // @types/node to declare the module; an older runtime without it simply
    // throws here and ranking falls back to the static table.
    const sqlite = (await import(NODE_SQLITE_MODULE)) as { DatabaseSync?: ReadOnlyDatabaseCtor };
    if (!sqlite.DatabaseSync) return null;
    DatabaseSync = sqlite.DatabaseSync;
  } catch {
    return null;
  }

  let db: ReadOnlyDatabase | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT query_class, source,
                COUNT(*) AS samples,
                SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) AS used,
                MAX(recorded_at) AS last_recorded_at
         FROM ${SOURCE_FEEDBACK_TABLE}
         GROUP BY query_class, source`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      query_class: String(row.query_class ?? ""),
      source: String(row.source ?? ""),
      samples: Number(row.samples ?? 0),
      used: Number(row.used ?? 0),
      last_recorded_at: row.last_recorded_at == null ? null : String(row.last_recorded_at),
    }));
  } catch {
    // Missing file, missing table, corrupt page, no permission — all mean
    // "no learned priors"; ranking carries on with the static table.
    return null;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

function clampMultiplier(value: number): number {
  return Math.min(MULTIPLIER_CEILING, Math.max(MULTIPLIER_FLOOR, value));
}

/**
 * Overlay recorded history onto one class's static multipliers.
 *
 * Per source:
 *   - Collapse guard first. A source with no samples at all while the class has
 *     already reached MIN_SAMPLES, or whose newest sample is older than
 *     STALE_SAMPLE_DAYS, is treated as unexplored: its multiplier is floored at
 *     1.0 and lifted by EXPLORATION_BONUS. Without this, one bad run drives a
 *     source's multiplier down, it stops being ranked high enough to be used,
 *     it therefore stops collecting samples, and the low multiplier becomes
 *     permanent — feedback collapse. The bonus guarantees every source stays
 *     reachable and can recover.
 *   - Otherwise, once samples >= MIN_SAMPLES, a Beta(1,1)-smoothed success rate
 *     p = (used + 1) / (samples + 2) maps to 1 + PRIOR_GAIN * (p - 0.5),
 *     clamped to [MULTIPLIER_FLOOR, MULTIPLIER_CEILING].
 *   - Below MIN_SAMPLES the static multiplier stands: too little evidence to move.
 */
export function applyLearnedPriors(
  routing: QueryRouting,
  stats: SourceFeedbackStat[],
  now: Date = new Date(),
): LearnedRouting {
  const cells = new Map<string, SourceFeedbackStat>();
  for (const stat of stats) {
    if (stat.query_class === routing.queryClass) cells.set(stat.source, stat);
  }
  const classTotal = [...cells.values()].reduce((sum, stat) => sum + stat.samples, 0);

  const multipliers = { ...routing.multipliers };
  const modes = {} as Record<SearchSource, PriorMode>;
  let learned = false;

  for (const source of SEARCH_SOURCES) {
    const cell = cells.get(source);
    const samples = cell?.samples ?? 0;
    const used = cell?.used ?? 0;
    const staticPrior = routing.multipliers[source];

    const lastMs = cell?.last_recorded_at ? Date.parse(cell.last_recorded_at) : NaN;
    const isStale = Number.isFinite(lastMs) && now.getTime() - lastMs > STALE_SAMPLE_DAYS * MS_PER_DAY;
    const isStarved = samples === 0 && classTotal >= MIN_SAMPLES;

    if (isStarved || isStale) {
      multipliers[source] = clampMultiplier(Math.max(staticPrior, 1) + EXPLORATION_BONUS);
      modes[source] = "exploring";
      learned = true;
    } else if (samples >= MIN_SAMPLES) {
      const p = (used + 1) / (samples + 2);
      multipliers[source] = clampMultiplier(1 + PRIOR_GAIN * (p - 0.5));
      modes[source] = "learned";
      learned = true;
    } else {
      multipliers[source] = staticPrior;
      modes[source] = "static";
    }
  }

  return {
    queryClass: routing.queryClass,
    multipliers,
    priors: learned ? "learned" : "static",
    samples: learned ? classTotal : 0,
    modes,
  };
}

interface CacheEntry { stats: SourceFeedbackStat[] | null; readAt: number }
let cache: CacheEntry | null = null;

/** Drop the cached read. Tests call this; production relies on the TTL. */
export function resetPriorsCache(): void {
  cache = null;
}

async function cachedStats(dbPath: string, nowMs: number): Promise<SourceFeedbackStat[] | null> {
  if (cache && nowMs - cache.readAt < PRIORS_CACHE_TTL_MS) return cache.stats;
  const stats = await readFeedbackStats(dbPath);
  cache = { stats, readAt: nowMs };
  return stats;
}

/**
 * Classify the query, then overlay whatever the genome database has learned.
 * Never throws: an unreadable database silently yields the static table, and
 * the returned `priors` field says which one was used.
 */
export async function resolveRouting(
  query: string,
  options: { dbPath?: string; now?: Date } = {},
): Promise<LearnedRouting> {
  const routing = classifyQuery(query);
  const now = options.now ?? new Date();
  try {
    const dbPath = options.dbPath ?? resolveGenomeDbPath();
    const stats = await cachedStats(dbPath, now.getTime());
    if (!stats || !stats.length) return staticRouting(routing);
    return applyLearnedPriors(routing, stats, now);
  } catch {
    return staticRouting(routing);
  }
}

function staticRouting(routing: QueryRouting): LearnedRouting {
  const modes = {} as Record<SearchSource, PriorMode>;
  for (const source of SEARCH_SOURCES) modes[source] = "static";
  return { ...routing, priors: "static", samples: 0, modes };
}

/** One short line for tool output, e.g. `priors: learned (12 samples)`. */
export function formatPriorsLine(routing: LearnedRouting): string {
  return routing.priors === "learned"
    ? `priors: learned (${routing.samples} sample${routing.samples === 1 ? "" : "s"})`
    : "priors: static";
}

export type { QueryClass, SearchSource };
