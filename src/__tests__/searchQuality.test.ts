import { backoffQuery, classifyQuery, foldTerm, queryTerms, scoreSearchResult, termWeights } from "../searchQuality.js";

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

describe("morphological folding and term weighting", () => {
  test("plural and suffix variants collapse to one term", () => {
    expect(queryTerms("tool tools call calls")).toEqual(["tool", "call"]);
    expect(foldTerm("agents")).toBe("agent");
    expect(foldTerm("protocol")).toBe("protocol");
    // Short words are left alone so "api"/"mcp" cannot collide with something else.
    expect(foldTerm("apis")).toBe("api");
  });

  test("a duplicated stem no longer dilutes coverage", () => {
    const folded = scoreSearchResult("tool tools", "Tool", "");
    expect(folded).toBeGreaterThan(0.9);
  });

  test("terms present in every candidate weigh less than a rare one", () => {
    const corpus = [
      { title: "MCP code mode", snippet: "" },
      { title: "MCP server", snippet: "" },
      { title: "MCP tooling", snippet: "" },
      { title: "Unrelated page about sandwiches", snippet: "" },
    ];
    const weights = termWeights(["mcp", "sandwiches"], corpus);
    expect(weights.get("sandwiches")!).toBeGreaterThan(weights.get("mcp")!);
  });

  test("IDF weighting keeps a rare-term match above a common-term match", () => {
    const corpus = [
      { title: "MCP overview", snippet: "" },
      { title: "MCP reference", snippet: "" },
      { title: "MCP changelog", snippet: "" },
    ];
    const common = scoreSearchResult("mcp kubernetes", "MCP overview", "", corpus);
    const rare = scoreSearchResult("mcp kubernetes", "Kubernetes guide", "", corpus);
    expect(rare).toBeGreaterThan(common);
  });
});

describe("query backoff", () => {
  test("a long natural-language question reduces to its longest terms", () => {
    const reduced = backoffQuery("MCP code mode agents write code to call tools instead of direct tool calls");
    expect(reduced).not.toBeNull();
    expect(reduced!.split(" ").length).toBeLessThanOrEqual(5);
    expect(reduced).toContain("instead");
  });

  test("a short query is not reshaped", () => {
    expect(backoffQuery("mcp code mode")).toBeNull();
  });
});
