import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
/**
 * node:sqlite arrived in Node 22.5, and this package still claims Node 20 — where the
 * priors read degrades to the static table. Gate on the runtime instead of importing
 * the module at file scope, so the suite runs (with the database cases skipped) there.
 */
const sqliteSupported = (() => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 5);
})();

let DatabaseSyncCtor: typeof import("node:sqlite").DatabaseSync | undefined;

const openDb = (path: string, options?: { readOnly?: boolean }) => {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite is unavailable on this runtime");
  return options ? new DatabaseSyncCtor(path, options) : new DatabaseSyncCtor(path);
};
const describeWithSqlite = sqliteSupported ? describe : describe.skip;
import { classifyQuery } from "../searchQuality.js";
import {
  applyLearnedPriors,
  EXPLORATION_BONUS,
  formatPriorsLine,
  MIN_SAMPLES,
  readFeedbackStats,
  resetPriorsCache,
  resolveGenomeDbPath,
  resolveRouting,
  type SourceFeedbackStat,
} from "../sourcePriors.js";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-06-01T00:00:00.000Z");
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString();

const stat = (
  query_class: string,
  source: string,
  samples: number,
  used: number,
  daysAgo = 1,
): SourceFeedbackStat => ({ query_class, source, samples, used, last_recorded_at: iso(daysAgo) });

/** A fake genome database: the same table project-mcp creates, filled by hand. */
function fakeGenome(dbPath: string, rows: Array<{ query_class: string; source: string; used: boolean; daysAgo?: number }>): void {
  const db = openDb(dbPath);
  db.exec(`CREATE TABLE source_feedback (
    id INTEGER PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    query_class TEXT NOT NULL,
    source TEXT NOT NULL,
    used INTEGER NOT NULL,
    query TEXT,
    note TEXT
  )`);
  const insert = db.prepare(
    "INSERT INTO source_feedback (recorded_at, query_class, source, used, query, note) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(iso(row.daysAgo ?? 1), row.query_class, row.source, row.used ? 1 : 0, "probe", null);
  }
  db.close();
}

const repeat = (n: number, row: { query_class: string; source: string; used: boolean; daysAgo?: number }) =>
  Array.from({ length: n }, () => row);

describe("resolveGenomeDbPath", () => {
  it("honours GUARDIAN_CENTRAL_DB when absolute", () => {
    expect(resolveGenomeDbPath({ GUARDIAN_CENTRAL_DB: "/srv/hela/central.db" } as NodeJS.ProcessEnv))
      .toBe("/srv/hela/central.db");
  });

  it("ignores a relative GUARDIAN_CENTRAL_DB and falls back to the genome default", () => {
    expect(resolveGenomeDbPath({ GUARDIAN_CENTRAL_DB: "central.db", HOME: "/home/tester" } as NodeJS.ProcessEnv))
      .toBe("/home/tester/memory/memory.db");
  });

  it("defaults to ~/memory/memory.db", () => {
    expect(resolveGenomeDbPath({ HOME: "/home/tester" } as NodeJS.ProcessEnv))
      .toBe("/home/tester/memory/memory.db");
  });

  it("follows genome to the legacy ~/memory.db when the migrated path is absent", () => {
    const home = mkdtempSync(join(tmpdir(), "enzyme-home-legacy-"));
    try {
      writeFileSync(join(home, "memory.db"), "");
      expect(resolveGenomeDbPath({ HOME: home } as NodeJS.ProcessEnv)).toBe(join(home, "memory.db"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("prefers ~/memory/memory.db when both the migrated and legacy files exist", () => {
    const home = mkdtempSync(join(tmpdir(), "enzyme-home-both-"));
    try {
      writeFileSync(join(home, "memory.db"), "");
      mkdirSync(join(home, "memory"), { recursive: true });
      writeFileSync(join(home, "memory", "memory.db"), "");
      expect(resolveGenomeDbPath({ HOME: home } as NodeJS.ProcessEnv)).toBe(join(home, "memory", "memory.db"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describeWithSqlite("reading a fake genome database", () => {
  let directory: string;

  beforeAll(async () => {
    DatabaseSyncCtor = (await import("node:sqlite")).DatabaseSync;
  });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "enzyme-priors-"));
    resetPriorsCache();
  });

  afterEach(() => {
    resetPriorsCache();
    rmSync(directory, { recursive: true, force: true });
  });

  it("drives a consistently-used source up and a consistently-ignored one down", async () => {
    const dbPath = join(directory, "memory.db");
    fakeGenome(dbPath, [
      ...repeat(20, { query_class: "general", source: "google", used: true }),
      ...repeat(20, { query_class: "general", source: "wikipedia", used: false }),
      ...repeat(20, { query_class: "general", source: "news_monitor", used: false }),
      ...repeat(20, { query_class: "general", source: "academic_search", used: false }),
    ]);

    const routing = await resolveRouting("how do widgets work", { dbPath, now: NOW });
    const base = classifyQuery("how do widgets work").multipliers;

    expect(routing.priors).toBe("learned");
    expect(routing.samples).toBe(80);
    expect(routing.multipliers.google).toBeGreaterThan(base.google);
    expect(routing.multipliers.google).toBeCloseTo(1.4545, 3); // p = 21/22
    expect(routing.multipliers.wikipedia).toBeLessThan(base.wikipedia);
    expect(routing.multipliers.wikipedia).toBeCloseTo(0.5454, 3); // p = 1/22
    expect(formatPriorsLine(routing)).toBe("priors: learned (80 samples)");
  });

  it("keeps the static prior below MIN_SAMPLES", async () => {
    const dbPath = join(directory, "memory.db");
    fakeGenome(dbPath, repeat(MIN_SAMPLES - 1, { query_class: "general", source: "google", used: true }));

    const routing = await resolveRouting("how do widgets work", { dbPath, now: NOW });
    const base = classifyQuery("how do widgets work").multipliers;

    expect(routing.priors).toBe("static");
    expect(routing.modes.google).toBe("static");
    expect(routing.multipliers).toEqual(base);
    expect(formatPriorsLine(routing)).toBe("priors: static");
  });

  it("falls back to static without throwing when the database is missing", async () => {
    const routing = await resolveRouting("how do widgets work", {
      dbPath: join(directory, "does-not-exist.db"),
      now: NOW,
    });
    expect(routing.priors).toBe("static");
    expect(routing.multipliers).toEqual(classifyQuery("how do widgets work").multipliers);
    expect(formatPriorsLine(routing)).toBe("priors: static");
  });

  it("falls back to static when the file is not a database", async () => {
    const dbPath = join(directory, "garbage.db");
    writeFileSync(dbPath, "this is not sqlite");
    await expect(readFeedbackStats(dbPath)).resolves.toBeNull();
    const routing = await resolveRouting("how do widgets work", { dbPath, now: NOW });
    expect(routing.priors).toBe("static");
  });

  it("falls back to static when the table has not been created yet", async () => {
    const dbPath = join(directory, "empty.db");
    const db = openDb(dbPath);
    db.exec("CREATE TABLE entities (name TEXT)");
    db.close();
    await expect(readFeedbackStats(dbPath)).resolves.toBeNull();
  });

  it("never writes to the genome database", async () => {
    const dbPath = join(directory, "memory.db");
    fakeGenome(dbPath, repeat(MIN_SAMPLES, { query_class: "general", source: "google", used: true }));
    const before = statSync(dbPath).mtimeMs;
    const rowsBefore = countRows(dbPath);
    await resolveRouting("how do widgets work", { dbPath, now: NOW });
    expect(countRows(dbPath)).toBe(rowsBefore);
    expect(statSync(dbPath).mtimeMs).toBe(before);
  });

  it("reuses one read inside the cache window and re-reads after it", async () => {
    const dbPath = join(directory, "memory.db");
    fakeGenome(dbPath, repeat(MIN_SAMPLES, { query_class: "general", source: "google", used: true }));

    const first = await resolveRouting("alpha", { dbPath, now: NOW });
    expect(first.samples).toBe(MIN_SAMPLES);

    // More feedback lands, but a call inside the 60s window still sees the cached read.
    const db = openDb(dbPath);
    for (let i = 0; i < 10; i++) {
      db.prepare("INSERT INTO source_feedback (recorded_at, query_class, source, used) VALUES (?, ?, ?, ?)")
        .run(iso(1), "general", "google", 1);
    }
    db.close();

    const cached = await resolveRouting("alpha", { dbPath, now: new Date(NOW.getTime() + 30_000) });
    expect(cached.samples).toBe(MIN_SAMPLES);

    const refreshed = await resolveRouting("alpha", { dbPath, now: new Date(NOW.getTime() + 61_000) });
    expect(refreshed.samples).toBe(MIN_SAMPLES + 10);
  });
});

function countRows(dbPath: string): number {
  const db = openDb(dbPath, { readOnly: true });
  const row = db.prepare("SELECT COUNT(*) AS n FROM source_feedback").get() as { n: number };
  db.close();
  return Number(row.n);
}

describe("collapse guard", () => {
  // Removing the `isStarved || isStale` branch in applyLearnedPriors makes
  // each of the three tests below fail.

  it("COLLAPSE GUARD: a source with zero samples still gets the exploration bonus", () => {
    const routing = applyLearnedPriors(
      classifyQuery("latest widget release"), // news class: wikipedia static prior is 0.4
      [stat("news", "news_monitor", MIN_SAMPLES, MIN_SAMPLES)],
      NOW,
    );
    expect(routing.queryClass).toBe("news");
    expect(routing.modes.wikipedia).toBe("exploring");
    expect(routing.multipliers.wikipedia).toBeCloseTo(1 + EXPLORATION_BONUS);
    expect(routing.multipliers.wikipedia).toBeGreaterThan(0.4);
  });

  it("COLLAPSE GUARD: a stale source returns to exploring instead of staying collapsed", () => {
    const fresh = applyLearnedPriors(
      classifyQuery("how do widgets work"),
      [stat("general", "google", 50, 50, 1), stat("general", "wikipedia", 50, 0, 29)],
      NOW,
    );
    expect(fresh.modes.wikipedia).toBe("learned");
    expect(fresh.multipliers.wikipedia).toBeLessThan(1);

    const stale = applyLearnedPriors(
      classifyQuery("how do widgets work"),
      [stat("general", "google", 50, 50, 1), stat("general", "wikipedia", 50, 0, 31)],
      NOW,
    );
    expect(stale.modes.wikipedia).toBe("exploring");
    expect(stale.multipliers.wikipedia).toBeCloseTo(1 + EXPLORATION_BONUS);
  });

  it("COLLAPSE GUARD: an ignored source can win again once it goes stale", () => {
    // google used 28 of 50 times => p 0.558 => multiplier 1.058.
    const collapsed = applyLearnedPriors(
      classifyQuery("how do widgets work"),
      [stat("general", "google", 50, 28, 1), stat("general", "wikipedia", 50, 0, 1)],
      NOW,
    );
    expect(collapsed.multipliers.wikipedia).toBeLessThan(collapsed.multipliers.google);

    const recovered = applyLearnedPriors(
      classifyQuery("how do widgets work"),
      [stat("general", "google", 50, 28, 1), stat("general", "wikipedia", 50, 0, 45)],
      NOW,
    );
    expect(recovered.multipliers.wikipedia).toBeCloseTo(1 + EXPLORATION_BONUS);
    expect(recovered.multipliers.wikipedia).toBeGreaterThan(recovered.multipliers.google);
  });

  it("clamps every derived multiplier to [0.5, 1.5]", () => {
    const routing = applyLearnedPriors(
      classifyQuery("how do widgets work"),
      [stat("general", "google", 100_000, 100_000), stat("general", "wikipedia", 100_000, 0)],
      NOW,
    );
    expect(routing.multipliers.google).toBeLessThanOrEqual(1.5);
    expect(routing.multipliers.wikipedia).toBeGreaterThanOrEqual(0.5);
  });

  it("ignores feedback recorded for a different query class", () => {
    const routing = applyLearnedPriors(
      classifyQuery("how do widgets work"), // general
      [stat("news", "google", 50, 0)],
      NOW,
    );
    expect(routing.priors).toBe("static");
    expect(routing.multipliers).toEqual(classifyQuery("how do widgets work").multipliers);
  });
});
