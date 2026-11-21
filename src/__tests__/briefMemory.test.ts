import { feedbackHintForUrl, rememberBrief, resetBriefMemoryForTests } from "../briefMemory.js";

describe("brief memory", () => {
  beforeEach(() => resetBriefMemoryForTests());

  test("a URL from a brief yields the exact feedback call", () => {
    rememberBrief("technical", [{ url: "https://example.test/a", source: "google" }]);
    const hint = feedbackHintForUrl("https://example.test/a");
    expect(hint).toContain('query_class="technical"');
    expect(hint).toContain('source="google"');
    expect(hint).toContain("used=true");
  });

  test("unknown URLs produce no hint", () => {
    expect(feedbackHintForUrl("https://example.test/never-seen")).toBeNull();
  });

  test("later briefs replace an earlier classification for the same URL", () => {
    rememberBrief("technical", [{ url: "https://example.test/b", source: "google" }]);
    rememberBrief("academic", [{ url: "https://example.test/b", source: "academic_search" }]);
    const hint = feedbackHintForUrl("https://example.test/b");
    expect(hint).toContain('query_class="academic"');
    expect(hint).toContain('source="academic_search"');
  });
});
