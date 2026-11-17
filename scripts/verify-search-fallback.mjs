#!/usr/bin/env node
/**
 * Verify that web search degrades instead of failing.
 *
 * The server tries Google CSE, then keyless engines, then Wikipedia. This
 * script proves each step of that chain is reachable:
 *
 *   1. no Google keys        -> keyless engines answer
 *   2. invalid Google keys   -> the CSE 400 is swallowed and keyless answers
 *   3. multi_site_search without sites -> a real error, not a fake success
 *
 * It talks to the real network (keyless engines), so it is not part of
 * `npm test`. Usage: npm run test:fallback
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const QUERY = 'python asyncio tutorial';
let failures = 0;

function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function withServer(env, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    cwd: process.cwd(),
    stderr: 'ignore',
    env,
  });
  const client = new Client({ name: 'search-fallback-check', version: '1.0.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !['GOOGLE_API_KEY', 'GOOGLE_CSE_ID'].includes(key))
);

const call = async (client, name, args) => {
  const res = await client.callTool({ name, arguments: args });
  return { isError: Boolean(res.isError), text: res.content?.[0]?.text ?? '' };
};

// 1. Zero keys: keyless engines must answer.
await withServer(baseEnv, async (client) => {
  const search = await call(client, 'google_search', { query: QUERY, num: 3 });
  const numbered = /^1\. /m.test(search.text);
  report('no keys: search returns results', !search.isError && numbered, search.isError ? search.text.slice(0, 80) : `${search.text.split('\n')[0]}`);
});

// 2. Invalid keys: a Google 400 must degrade to keyless, not surface as failure.
await withServer({ ...baseEnv, GOOGLE_API_KEY: 'invalid-key-for-fallback-test', GOOGLE_CSE_ID: 'invalid-cse-id' }, async (client) => {
  const search = await call(client, 'google_search', { query: `${QUERY} ${Date.now().toString(36)}`, num: 3 });
  const numbered = /^1\. /m.test(search.text);
  report('invalid Google key: degrades to keyless', !search.isError && numbered, search.isError ? search.text.slice(0, 80) : `${search.text.split('\n')[0]}`);
});

// 3. Misuse must be an error, not a success with an error-shaped body.
await withServer(baseEnv, async (client) => {
  const misuse = await call(client, 'multi_site_search', { query: QUERY });
  report('multi_site_search without sites is an error', misuse.isError && /site/i.test(misuse.text), misuse.text.slice(0, 90));

  const scoped = await call(client, 'multi_site_search', { query: QUERY, sites: ['docs.python.org'], maxResults: 2 });
  report('multi_site_search with a site returns results', !scoped.isError && /^1\. /m.test(scoped.text), scoped.isError ? scoped.text.slice(0, 80) : scoped.text.split('\n')[0]);
});

console.log(failures === 0 ? '\nall fallback checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
