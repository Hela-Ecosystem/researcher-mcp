jest.mock('axios');
import axios from 'axios';
import { decodeEntities, googleNewsSearch, resolveNewsLink } from '../freeSearchService';
import { searchTimeWindow } from '../searchTimeWindow';

const mockedAxios = axios as jest.Mocked<typeof axios>;

function rss(items: Array<{ title: string; link: string; pubDate: string; source?: string }>): string {
  return `<?xml version="1.0"?><rss><channel>${items.map(item => `
    <item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <pubDate>${item.pubDate}</pubDate>
      <description>&lt;p&gt;Body &amp;nbsp; text&lt;/p&gt;</description>
      <source url="${item.source ?? 'https://example.com'}">Example</source>
    </item>`).join('')}</channel></rss>`;
}

describe('googleNewsSearch window handling', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  test('drops articles outside the window and reports how many', async () => {
    const now = new Date('2026-11-22T00:00:00Z');
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toUTCString();
    mockedAxios.get.mockResolvedValue({
      data: rss([
        { title: 'Two days old', link: 'https://example.com/a', pubDate: daysAgo(2) },
        { title: 'Forty days old', link: 'https://example.com/b', pubDate: daysAgo(40) },
        { title: 'One day old', link: 'https://example.com/c', pubDate: daysAgo(1) },
      ]),
    } as never);

    const stats = { dropped: 0 };
    const window = searchTimeWindow('d7', now);
    const articles = await googleNewsSearch('topic', { maxResults: 5, window, stats });

    expect(articles.map(a => a.title)).toEqual(['Two days old', 'One day old']);
    expect(stats.dropped).toBe(1);
    const params = (mockedAxios.get.mock.calls[0][1] as { params?: Record<string, unknown> } | undefined)?.params;
    expect(String(params?.q)).toContain('after:');
  });

  test('decodes entities that RSS escapes into titles and snippets', async () => {
    mockedAxios.get.mockResolvedValue({
      data: rss([{
        title: 'Caf&eacute; &amp; Bar&#39;s&nbsp;news',
        link: 'https://example.com/d',
        pubDate: new Date().toUTCString(),
      }]),
    } as never);

    const [article] = await googleNewsSearch('topic', { maxResults: 1 });
    expect(article.title).toBe('Café & Bar\'s news');
    expect(article.snippet).not.toContain('&nbsp;');
  });
});

describe('decodeEntities', () => {
  test('handles named entities, decimal and hex escapes', () => {
    expect(decodeEntities('a&nbsp;b &amp; c &#39;d&#39; &#x2014; e')).toBe("a b & c 'd' — e");
  });

  test('leaves unknown entities alone', () => {
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;');
  });
});

describe('resolveNewsLink', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  test('follows a Google News redirect to the publisher', async () => {
    mockedAxios.get.mockResolvedValue({
      data: '',
      request: { res: { responseUrl: 'https://publisher.example/story' } },
    } as never);

    await expect(resolveNewsLink('https://news.google.com/rss/articles/abc')).resolves.toBe(
      'https://publisher.example/story',
    );
  });

  test('falls back to the publisher home when the redirect cannot be followed', async () => {
    mockedAxios.get.mockRejectedValue(new Error('blocked'));

    await expect(
      resolveNewsLink('https://news.google.com/rss/articles/abc', 'https://publisher.example'),
    ).resolves.toBe('https://publisher.example');
  });

  test('leaves a direct link untouched', async () => {
    await expect(resolveNewsLink('https://publisher.example/story')).resolves.toBe(
      'https://publisher.example/story',
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
