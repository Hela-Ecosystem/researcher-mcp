import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fs from 'node:fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ResearchMCPServer from '../../research-server';

describe('research_session_manager MCP contract', () => {
  const clients = new Set<Client>();
  const originalDir = process.env.HELA_RESEARCH_SESSION_DIR;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'research-sessions-'));
    process.env.HELA_RESEARCH_SESSION_DIR = directory;
  });

  afterEach(async () => {
    await Promise.all([...clients].map(client => client.close()));
    clients.clear();
    if (originalDir === undefined) delete process.env.HELA_RESEARCH_SESSION_DIR;
    else process.env.HELA_RESEARCH_SESSION_DIR = originalDir;
    await rm(directory, { recursive: true, force: true });
  });

  async function startServer() {
    const app = new ResearchMCPServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'research-sessions-test', version: '1.0.0' });
    clients.add(client);
    await app['server'].connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  function call(client: Client, action: string, sessionName?: string, content?: string) {
    return client.callTool({ name: 'research_session_manager', arguments: { action, sessionName, content } });
  }

  function expectText(result: Awaited<ReturnType<typeof call>>, text: string) {
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text }]);
  }

  function expectFailure(result: Awaited<ReturnType<typeof call>>, reason: string) {
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ ok: false, reason: expect.stringContaining(reason) });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  }

  test('restores saved content and persists deletions across server restarts', async () => {
    const first = await startServer();
    const content = 'A finding with "quotes", Unicode 🧪, and\nmultiple lines.';
    expectText(await call(first, 'save', 'notes.v1', content), 'Research session "notes.v1" saved successfully.');
    await first.close();
    clients.delete(first);

    const second = await startServer();
    expectText(await call(second, 'list'), 'Available research sessions:\n- notes.v1');
    expectText(await call(second, 'load', 'notes.v1'), `Research session "notes.v1" loaded:\n\n${content}`);
    expectText(await call(second, 'delete', 'notes.v1'), 'Research session "notes.v1" deleted successfully.');
    await second.close();
    clients.delete(second);

    const third = await startServer();
    expectText(await call(third, 'list'), 'Available research sessions:\nNo sessions found.');
    expectFailure(await call(third, 'load', 'notes.v1'), 'not found');
  });

  test('reports a write failure without making a phantom session visible', async () => {
    const blockedDirectory = join(directory, 'not-a-directory');
    await writeFile(blockedDirectory, 'sentinel');
    process.env.HELA_RESEARCH_SESSION_DIR = join(blockedDirectory, 'sessions');
    const client = await startServer();

    expectFailure(await call(client, 'save', 'unsaved', 'notes'), 'ENOTDIR');
    await rm(blockedDirectory);
    expectText(await call(client, 'list'), 'Available research sessions:\nNo sessions found.');
  });

  test('preserves a corrupt store and reports the error', async () => {
    const storePath = join(directory, 'sessions.json');
    await writeFile(storePath, '{}');
    const client = await startServer();

    expectFailure(await call(client, 'save', 'notes', 'findings'), 'Invalid research session store');
    expect(await readFile(storePath, 'utf8')).toBe('{}');
  });

  test('keeps the committed data if replacing the store fails', async () => {
    const client = await startServer();
    await call(client, 'save', 'notes', 'original');
    const storePath = join(directory, 'sessions.json');
    const original = await readFile(storePath, 'utf8');
    await writeFile(`${storePath}.tmp`, 'interrupted write');

    const rename = jest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Could not replace session file'));
    try {
      expectFailure(await call(client, 'save', 'notes', 'replacement'), 'Could not replace session file');
      expect(rename).toHaveBeenCalledWith(`${storePath}.tmp`, storePath);
    } finally {
      rename.mockRestore();
    }

    expect(await readFile(storePath, 'utf8')).toBe(original);
    expectText(await call(await startServer(), 'load', 'notes'), 'Research session "notes" loaded:\n\noriginal');
  });

  test('rejects traversal names at the tool boundary', async () => {
    const client = await startServer();
    expectFailure(await call(client, 'save', '../escape', 'notes'), 'Session name');
    expectText(await call(client, 'list'), 'Available research sessions:\nNo sessions found.');
  });

  test('keeps concurrent saves from separate server instances', async () => {
    const first = await startServer();
    const second = await startServer();
    const writes = await Promise.all([
      call(first, 'save', 'one', 'first'),
      call(second, 'save', 'two', 'second'),
    ]);
    expectText(writes[0], 'Research session "one" saved successfully.');
    expectText(writes[1], 'Research session "two" saved successfully.');
    expectText(await call(first, 'load', 'two'), 'Research session "two" loaded:\n\nsecond');
    expectText(await call(second, 'load', 'one'), 'Research session "one" loaded:\n\nfirst');
  });

  test('caps the number of sessions while allowing existing sessions to be updated', async () => {
    const client = await startServer();
    for (let index = 0; index < 100; index++) {
      const name = `session-${index}`;
      expectText(await call(client, 'save', name, 'notes'), `Research session "${name}" saved successfully.`);
    }
    expectFailure(await call(client, 'save', 'overflow', 'notes'), '100 sessions');
    expectText(await call(client, 'save', 'session-0', 'updated'), 'Research session "session-0" saved successfully.');
    expectText(await call(await startServer(), 'load', 'session-0'), 'Research session "session-0" loaded:\n\nupdated');
  });

  test('caps the encoded store size', async () => {
    const client = await startServer();
    const content = '🧪'.repeat(2 * 1024 * 1024);
    expectFailure(await call(client, 'save', 'oversized', content), '8 MiB');
    expectText(await call(client, 'list'), 'Available research sessions:\nNo sessions found.');
  });
});
