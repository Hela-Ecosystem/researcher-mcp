import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import ResearchMCPServer from '../../research-server';

describe('data_export MCP contract', () => {
  let client: Client;

  beforeEach(async () => {
    const app = new ResearchMCPServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'data-export-test', version: '1.0.0' });
    await app['server'].connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  async function expectExport(data: unknown, format: string, expected: string) {
    const result = await client.callTool({ name: 'data_export', arguments: { data, format } });
    expect(result.content).toEqual([{
      type: 'text',
      text: `Data exported as ${format.toUpperCase()}:\n\n${expected}\n\nSuggested filename: export.${format}`,
    }]);
  }

  test('advertises both CSV input shapes', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(entry => entry.name === 'data_export');
    expect(tool?.inputSchema.required).toContain('data');
    expect(tool?.inputSchema.properties?.data).toMatchObject({
      anyOf: [{ type: 'object' }, { type: 'array' }],
    });
  });

  test('doubles quotes and encloses commas and line breaks in headers and cells', async () => {
    const rows = [{ 'note, "quoted"\nheader': 'she said "hi"', title: 'Comma, inside', lines: 'one\r\ntwo' }];
    await expectExport(rows, 'csv', '"note, ""quoted""\nheader",title,lines\n"she said ""hi""","Comma, inside","one\r\ntwo"');
  });

  test('prefixes formula-like headers and cells with an apostrophe', async () => {
    const rows = [{ '=header': '=1+1', plus: '+1', minus: '-1', at: '@name', tab: '\ttext', cr: '\rtext' }];
    await expectExport(rows, 'csv', `'=header,plus,minus,at,tab,cr\n"'=1+1","'+1","'-1","'@name","'\ttext","'\rtext"`);
  });

  test('does not turn numeric negatives into text', async () => {
    const rows = [{ delta: -5, label: '-5%' }];
    await expectExport(rows, 'csv', 'delta,label\n-5,"\'-5%"');
  });

  test('exports wrapped rows and preserves falsy cell values', async () => {
    const data = { rows: [{ title: 'Paper', count: 0, reviewed: false }, { title: 'Second', count: null }] };
    await expectExport(data, 'csv', 'title,count,reviewed\n"Paper",0,"false"\n"Second","",""');
  });

  test('keeps input column order and leaves plain numbers unquoted', async () => {
    await expectExport([{ b: 1, a: 2.5, name: 'x' }], 'csv', 'b,a,name\n1,2.5,"x"');
  });

  test('includes columns that only later rows have, in first-seen order', async () => {
    await expectExport([{ b: 1 }, { b: 2, a: 3 }], 'csv', 'b,a\n1,""\n2,3');
  });

  test('preserves non-CSV serialization', async () => {
    const data = { rows: [{ title: '=1+1' }] };
    await expectExport(data, 'json', JSON.stringify(data, null, 2));
    await expectExport(data, 'txt', JSON.stringify(data, null, 2));
    await expectExport(data.rows, 'markdown', '| title |\n| --- |\n| =1+1 |');
  });
});
