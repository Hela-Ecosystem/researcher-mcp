import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import {
  buildFactCheckReport,
  canonicalizeUrl,
  classifyClaimStance,
  countResultsBySite,
  dedupeResearchSections,
  deduplicateContentItems,
  deriveClaimVerdict,
  extractSummaryFromHtml,
  fetchClaimReviews,
  stanceFromRating,
} from '../contentTools.js';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const fixtureHtml = readFileSync(
  join(process.cwd(), 'src', '__tests__', 'fixtures', 'summarizer-page.html'),
  'utf8'
);

describe('content_summarizer extraction', () => {
  test('prefers og:description and strips skip links, nav, and unspaced blocks', () => {
    const result = extractSummaryFromHtml(fixtureHtml, 80);

    expect(result.source).toBe('og:description');
    expect(result.summary).toContain('code execution with MCP');
    expect(result.summary).not.toContain('Skip to main content');
    expect(result.summary).not.toContain('Research Engineering');
    expect(result.summary).not.toContain('01');
    expect(result.summary.length).toBeLessThanOrEqual(83);
  });

  test('falls back to the first main paragraph when no social description exists', () => {
    const html = `
      <html>
        <head><title>HeLa</title></head>
        <body>
          <a href="#main">Skip to main content</a>
          <nav><a href="/a">Menu</a><a href="/b">Login</a></nav>
          <main>
            <p>The HeLa cell line is an immortalised cell line used in research.</p>
            <p>A second paragraph should not win over the first.</p>
          </main>
        </body>
      </html>`;

    const result = extractSummaryFromHtml(html, 200);
    expect(result.source).toBe('paragraph');
    expect(result.summary).toBe(
      'The HeLa cell line is an immortalised cell line used in research.'
    );
    expect(result.summary).not.toContain('Menu');
  });

  test('joins body blocks with spaces when there is no paragraph to prefer', () => {
    const html = `
      <html>
        <head><title>Token use</title></head>
        <body>
          <a class="skip-link" href="#main">Skip to main content</a>
          <nav><a href="/a">Research</a></nav>
          <div><span>Excessive token consumption</span><span>makes agents less effective.</span></div>
          <div>Code execution keeps intermediate results out of context.</div>
        </body>
      </html>`;

    const result = extractSummaryFromHtml(html, 200);
    expect(result.source).toBe('body');
    expect(result.summary).toBe(
      'Excessive token consumption makes agents less effective. Code execution keeps intermediate results out of context.'
    );
  });
});

describe('content_deduplication canonical URLs and mergedFrom', () => {
  test('canonicalises utm parameters, fragments, and trailing slashes', () => {
    expect(
      canonicalizeUrl('https://www.anthropic.com/research/code-mode/?utm_source=x&utm_medium=y#section')
    ).toBe('https://www.anthropic.com/research/code-mode');
    expect(canonicalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    expect(canonicalizeUrl('https://example.com/path?b=2&a=1')).toBe(
      'https://example.com/path?a=1&b=2'
    );
  });

  test('returns survivors with title, url, snippet plus what merged into them', () => {
    const result = deduplicateContentItems([
      {
        title: 'Code Mode',
        url: 'https://www.anthropic.com/research/code-mode/?utm_source=x#top',
        snippet: 'Original snippet',
      },
      {
        title: 'A different headline',
        url: 'https://www.anthropic.com/research/code-mode',
        snippet: 'Same page under a different title',
      },
      {
        title: 'Code Mode',
        url: 'https://example.com/other-page',
        snippet: 'Same title, different URL',
      },
    ]);

    expect(result.unique).toHaveLength(1);
    expect(result.unique[0]).toMatchObject({
      title: 'Code Mode',
      url: 'https://www.anthropic.com/research/code-mode/?utm_source=x#top',
      snippet: 'Original snippet',
    });
    expect(result.mergedFrom).toHaveLength(2);
    expect(result.mergedFrom[0]).toMatchObject({
      title: 'A different headline',
      url: 'https://www.anthropic.com/research/code-mode',
      snippet: 'Same page under a different title',
      mergedInto: 'https://www.anthropic.com/research/code-mode',
    });
    expect(result.mergedFrom[1].mergedInto).toBe(
      'https://www.anthropic.com/research/code-mode'
    );
  });

  test('keeps the similarity threshold behaviour', () => {
    const items = [
      { title: 'Code mode tools', url: 'https://example.com/a', snippet: 'a' },
      { title: 'Code mode tool', url: 'https://example.com/b', snippet: 'b' },
    ];

    expect(deduplicateContentItems(items, 0.4).unique).toHaveLength(1);
    expect(deduplicateContentItems(items, 0.8).unique).toHaveLength(2);
  });
});

describe('fact_checker stances and verdict', () => {
  test('classifies a snippet that refutes a myth restated in its title', () => {
    const stance = classifyClaimStance(
      'Vitamin C cures cancer',
      'This claim is false; there is no evidence that vitamin C cures cancer.'
    );
    expect(stance).toBe('refutes');
  });

  test('derives an overall verdict and keeps per-source stances', () => {
    const report = buildFactCheckReport('Vitamin C cures cancer', [
      {
        title: 'Vitamin C cures cancer',
        url: 'https://www.snopes.com/fact-check/vitamin-c-cancer',
        source: 'snopes.com',
        snippet: 'False. There is no evidence that vitamin C cures cancer.',
      },
      {
        title: 'Vitamin C and cancer',
        url: 'https://www.cancer.gov/vitamin-c',
        source: 'cancer.gov',
        snippet: 'Studies found no evidence that vitamin C cures cancer.',
      },
      {
        title: 'Vitamin C is a nutrient',
        url: 'https://example.com/vitamin-c',
        source: 'example.com',
        snippet: 'Vitamin C is a nutrient found in citrus fruit.',
      },
    ]);

    expect(report.sources[0].stance).toBe('refutes');
    expect(report.sources[1].stance).toBe('refutes');
    expect(report.sources[2].stance).toBe('unclear');
    expect(report.counts).toEqual({ supports: 0, refutes: 2, mixed: 0, unclear: 1 });
    expect(report.verdict).toBe('refuted');
  });

  test('maps ClaimReview ratings and uses them for the verdict', () => {
    expect(stanceFromRating('Mostly true')).toBe('supports');
    expect(stanceFromRating('False')).toBe('refutes');
    expect(stanceFromRating('Half true')).toBe('mixed');

    const report = buildFactCheckReport('A claim', [
      { title: 'Check', url: 'https://example.com', source: 'publisher', rating: 'False' },
      { title: 'Check 2', url: 'https://example.com/2', source: 'publisher', rating: 'Mostly true' },
    ]);
    expect(report.sources.map((source) => source.stance)).toEqual(['refutes', 'supports']);
    expect(report.verdict).toBe('mixed');
    expect(deriveClaimVerdict(['unclear', 'unclear'])).toBe('insufficient evidence');
  });

  test('parses a ClaimReview API response fixture', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        claims: [
          {
            text: 'Vitamin C cures cancer',
            claimReview: [
              {
                title: 'Vitamin C cures cancer',
                url: 'https://www.snopes.com/fact-check/vitamin-c-cancer',
                textualRating: 'False',
                reviewDate: '2020-01-01',
                publisher: { name: 'Snopes' },
              },
            ],
          },
        ],
      },
    });

    const reviews = await fetchClaimReviews('Vitamin C cures cancer', 'test-key');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      publisher: 'Snopes',
      rating: 'False',
      url: 'https://www.snopes.com/fact-check/vitamin-c-cancer',
    });

    const report = buildFactCheckReport(
      'Vitamin C cures cancer',
      reviews.map((review) => ({
        title: review.title,
        url: review.url,
        source: review.publisher,
        snippet: review.snippet,
        rating: review.rating,
      }))
    );
    expect(report.sources[0].stance).toBe('refutes');
    expect(report.verdict).toBe('refuted');
  });
});

describe('research_assistant cross-query deduplication', () => {
  test('keeps the first occurrence, removes repeats, and preserves URLs', () => {
    const result = dedupeResearchSections([
      {
        query: 'mcp code mode',
        results: [
          { title: 'Code Mode', link: 'https://example.com/a?utm_source=x', snippet: 'a' },
          { title: 'Beta result', link: 'https://example.com/b' },
        ],
      },
      {
        query: 'mcp code mode overview',
        results: [
          { title: 'Code Mode again', url: 'https://example.com/a#fragment' },
          { title: 'Gamma result', link: 'https://example.com/c' },
        ],
      },
      {
        query: 'mcp code mode key facts',
        results: [{ title: 'Beta result', link: 'https://example.com/b/' }],
      },
    ]);

    expect(result.sections[0].items).toHaveLength(2);
    expect(result.sections[0].items[0].url).toBe('https://example.com/a?utm_source=x');
    expect(result.sections[1].items.map((item) => item.title)).toEqual(['Gamma result']);
    expect(result.sections[2].items).toHaveLength(0);
    expect(result.sections[2].duplicatesRemoved).toBe(1);
    expect(result.duplicatesRemoved).toBe(2);
  });
});

describe('multi_site_search per-site counts', () => {
  test('reports zero for a site that contributed nothing', () => {
    const counts = countResultsBySite(
      [
        { link: 'https://github.com/org/repo', displayLink: 'github.com' },
        { link: 'https://gist.github.com/example', displayLink: 'gist.github.com' },
        { link: 'https://docs.python.org/3/', displayLink: 'docs.python.org' },
      ],
      ['github.com', 'nonexistent.example.invalid', 'https://www.docs.python.org/']
    );

    expect(counts).toEqual([
      { site: 'github.com', count: 2 },
      { site: 'nonexistent.example.invalid', count: 0 },
      { site: 'docs.python.org', count: 1 },
    ]);
  });
});
