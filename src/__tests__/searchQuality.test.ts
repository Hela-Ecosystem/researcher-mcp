import { classifyQuery, scoreSearchResult } from "../searchQuality.js";

describe("search quality", () => {
  test("scores title coverage above snippet-only coverage and rewards exact phrases", () => {
    const titleHit = scoreSearchResult("black hole", "Black hole", "An astronomical object.");
    const snippetHit = scoreSearchResult("black hole", "Astronomy", "A black hole is an astronomical object.");
    expect(titleHit).toBeGreaterThan(snippetHit);
    expect(scoreSearchResult("black hole", "Black hole", "")).toBeGreaterThan(0.9);
    expect(scoreSearchResult("to be", "A result", "")).toBe(0);
  });

  test.each([
    ["what is photosynthesis", "definition", "wikipedia"],
    ["OpenAI Model Context Protocol API", "technical", "google"],
    ["latest Python 3.14 release announced", "news", "news_monitor"],
    ["benchmark evaluation methodology for language models", "academic", "academic_search"],
    ["Ada Lovelace", "entity", "wikipedia"],
  ] as const)("routes %s toward %s", (query, queryClass, source) => {
    const result = classifyQuery(query);
    expect(result.queryClass).toBe(queryClass);
    expect(result.multipliers[source]).toBeGreaterThan(1);
  });
});
