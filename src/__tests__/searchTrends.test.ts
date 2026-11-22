import axios from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const googleUrl = 'https://www.googleapis.com/customsearch/v1';
const hnUrl = 'https://hn.algolia.com/api/v1/search';
const newsUrl = 'https://news.google.com/rss/search';
const now = '2026-11-22T12:00:00Z';
const topic = 'Model Context Protocol';
const nonsense = 'zqxv hela probe nonsense 8817';

let ResearchMCPServer: typeof import('../../research-server').default;
let client: Client;
let server: Server;
let get: jest.SpyInstance;

beforeAll(async () => {
  const env = jest.replaceProperty(process, 'env', {
    ...process.env,
    GOOGLE_API_KEY: 'test-key',
    GOOGLE_CSE_ID: 'test-cse',
  });
  try {
    ResearchMCPServer = (await import('../../research-server')).default;
  } finally {
    env.restore();
  }
});

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date(now) });
  get = jest.spyOn(axios, 'get').mockImplementation(async (url) => {
    throw new Error(`Unexpected provider: ${url}`);
  });
  jest.spyOn(axios, 'post').mockRejectedValue(new Error('Unexpected POST request'));
  const app = new ResearchMCPServer() as unknown as { server: Server };
  server = app.server;
  client = new Client({ name: 'trend-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await server.close();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function callTool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return (result.content as Array<{ text: string }>)[0].text;
}

test.each([
  ['1M', 'm1', '2026-10-22'],
  ['3M', 'm3', '2026-08-22'],
  ['6M', 'm6', '2026-05-22'],
  ['12M', 'm12', '2025-11-22'],
  ['1Y', 'y1', '2025-11-22'],
  ['5Y', 'y5', '2021-11-22'],
])('applies timeframe %s to both trend providers', async (timeframe, restriction, start) => {
  get.mockResolvedValue({ data: { items: [], hits: [] } });
  const output = await callTool('search_trends', { topics: [topic], timeframe });
  const from = Date.parse(`${start}T12:00:00Z`) / 1000;
  const to = Date.parse(now) / 1000;
  expect(get).toHaveBeenCalledWith(googleUrl, expect.objectContaining({
    params: expect.objectContaining({ q: topic, dateRestrict: restriction }),
  }));
  expect(get).toHaveBeenCalledWith(hnUrl, expect.objectContaining({
    params: expect.objectContaining({ numericFilters: `created_at_i>=${from},created_at_i<=${to}` }),
  }));
  expect(output).toContain(`${start}T12:00:00.000Z to 2026-11-22T12:00:00.000Z`);
});

test('shows only relevant in-window HN evidence and withholds an uncorroborated web estimate', async () => {
  get.mockImplementation(async (url, { params }) => {
    if (url === googleUrl) {
      return { data: { items: [{ title: 'Unrelated Hela probe documentation' }], searchInformation: { totalResults: '190' } } };
    }
    if (url !== hnUrl) throw new Error(`Unexpected provider: ${url}`);
    return { data: { nbHits: 81, hits: [
      { title: 'Unrelated HN story', created_at: '2026-11-20T00:00:00Z' },
      { title: `${topic} archived story`, created_at: '2025-10-01T00:00:00Z' },
      { title: `${topic} future story`, created_at: '2026-11-23T00:00:00Z' },
      { title: `${topic} undated story` },
      { title: `${topic} discussion`, created_at: '2026-11-20T00:00:00Z' },
    ].slice(0, params.hitsPerPage) } };
  });

  const output = await callTool('search_trends', { topics: [topic, nonsense], timeframe: '1M' });
  expect(output).toContain('Search interest series unavailable');
  expect(output).toContain(`${topic} discussion`);
  expect(output).not.toMatch(/Unrelated|archived story|future story|undated story|\b(?:190|81)\b|\d+ mentions/);
  expect(output.split(`**${nonsense}**`)[1]).toContain('No relevant sources found');
});

test.each([
  ['week', 'd7', '2026-11-15'],
  ['month', 'm1', '2026-10-22'],
  ['year', 'y1', '2025-11-22'],
])('applies analytics range %s independently of maxResults', async (timeRange, restriction, start) => {
  get.mockImplementation(async (_url, { params }) => ({ data: {
    searchInformation: { totalResults: '4321' },
    items: Array.from({ length: params.num }, (_, i) => ({
      title: `${topic} article`, link: `https://example${i}.test/`,
    })),
  } }));

  const short = await callTool('search_analytics', { queries: [topic], timeRange, maxResults: 1 });
  const long = await callTool('search_analytics', { queries: [topic], timeRange, maxResults: 3 });
  expect(get).toHaveBeenCalledWith(googleUrl, expect.objectContaining({
    params: expect.objectContaining({ dateRestrict: restriction, exactTerms: topic }),
  }));
  for (const output of [short, long]) {
    expect(output).toContain(`${start}T12:00:00.000Z to 2026-11-22T12:00:00.000Z`);
    expect(output).toContain('Google estimated matching pages: 4321');
    expect(output).toContain('Search interest series unavailable');
    expect(output).not.toMatch(/: [13] results\b/);
  }
  expect(short).not.toContain('example2.test');
  expect(long).toContain('example2.test');
});

test('uses calendar month boundaries and preserves the default trend timeframe', async () => {
  jest.setSystemTime(new Date('2026-08-31T10:00:00Z'));
  get.mockResolvedValue({ data: { items: [], hits: [] } });
  const output = await callTool('search_trends', { topics: [topic] });
  expect(output).toContain('Search Trends (6M)');
  expect(output).toContain('2026-02-28T10:00:00.000Z to 2026-08-31T10:00:00.000Z');
});

test('rejects unsupported windows before querying providers', async () => {
  const output = await client.callTool({ name: 'search_trends', arguments: { topics: [topic], timeframe: '2D' } });
  expect(output.isError).toBe(true);
  expect(get).not.toHaveBeenCalled();
});

test('uses dated RSS evidence after CSE failure and never infers a total from the sample', async () => {
  const entry = (title: string, host: string, date: string) =>
    `<item><title>${title}</title><link>https://${host}/</link><pubDate>${date}</pubDate></item>`;
  get.mockImplementation(async (url) => {
    if (url === googleUrl) throw new Error('CSE unavailable');
    if (url !== newsUrl) throw new Error(`Unexpected provider: ${url}`);
    return { data: `<rss><channel>${[
      entry(`${topic} old`, 'old.test', 'Sat, 14 Nov 2026 08:00:00 GMT'),
      entry(`${topic} undated`, 'undated.test', ''),
      entry('Unrelated news', 'noise.test', 'Thu, 19 Nov 2026 08:00:00 GMT'),
      entry(`${topic} news`, 'current.test', 'Thu, 19 Nov 2026 08:00:00 GMT'),
    ].join('')}</channel></rss>` };
  });

  const output = await callTool('search_analytics', { queries: [topic, nonsense], timeRange: 'week', maxResults: 1 });
  expect(get).toHaveBeenCalledWith(newsUrl, expect.objectContaining({
    params: expect.objectContaining({ q: expect.stringMatching(/after:2026-11-15 before:2026-11-23/) }),
  }));
  expect(output).toContain('Google News RSS');
  expect(output).toContain('Matching page total unavailable');
  expect(output).toContain('current.test');
  expect(output).not.toMatch(/old\.test|undated\.test|noise\.test|: 1 results\b/);
  expect(output.split(`"${nonsense}"`)[1]).toContain('No relevant sources found');
});
