import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { feedbackHintForUrl, rememberBrief, resetBriefMemoryForTests } from "../briefMemory.js";

describe("brief memory", () => {
  let directory: string;
  let spool: string;

  beforeEach(() => {
    resetBriefMemoryForTests();
    directory = mkdtempSync(join(tmpdir(), "hela-spool-"));
    spool = join(directory, "search-feedback.jsonl");
    process.env.HELA_SEARCH_FEEDBACK_SPOOL = spool;
  });

  afterEach(() => {
    delete process.env.HELA_SEARCH_FEEDBACK_SPOOL;
    rmSync(directory, { recursive: true, force: true });
  });

  test("a follow-up records a used signal and reports it", () => {
    rememberBrief("technical", [{ url: "https://example.test/a", source: "google" }]);
    const hint = feedbackHintForUrl("https://example.test/a");
    expect(hint).toContain("query_class=technical");
    expect(hint).toContain("source=google");
    expect(hint).toContain("Recorded a used=true signal");

    const lines = readFileSync(spool, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({ query_class: "technical", source: "google", used: true });
    expect(record.note).toContain("rank 1");
  });

  test("a URL is recorded once, not on every read", () => {
    rememberBrief("technical", [{ url: "https://example.test/once", source: "google" }]);
    expect(feedbackHintForUrl("https://example.test/once")).not.toBeNull();
    expect(feedbackHintForUrl("https://example.test/once")).toBeNull();
    expect(readFileSync(spool, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("unknown URLs produce no hint", () => {
    expect(feedbackHintForUrl("https://example.test/never-seen")).toBeNull();
  });

  test("later briefs replace an earlier classification for the same URL", () => {
    rememberBrief("technical", [{ url: "https://example.test/b", source: "google" }]);
    rememberBrief("academic", [{ url: "https://example.test/b", source: "academic_search" }]);
    const hint = feedbackHintForUrl("https://example.test/b");
    expect(hint).toContain("query_class=academic");
    expect(hint).toContain("source=academic_search");
  });
});
