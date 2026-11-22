import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import ResearchMCPServer from '../../research-server';

const authors = [
  'Jane Marie Smith', 'John Doe', 'Ana García', 'Adele Brown', 'Ben Clark', 'Cora Davis',
  'Dina Evans', 'Eli Ford', 'Faye Green', 'Glen Hall', 'Hope Irwin', 'Ira Jones',
  'Jude King', 'Kara Lane', 'Liam Moore', 'Maya Nash', 'Nora Owen', 'Omar Pike',
  'Pia Quinn', 'Rita Reed', 'Sam Stone',
];
const paper = {
  title: 'Lazy loading',
  year: 2024,
  source: 'Journal of Agent Systems',
  url: 'https://example.com/lazy-loading',
};
const apa = '(2024). Lazy loading. Journal of Agent Systems. https://example.com/lazy-loading';
const mla = '"Lazy loading." *Journal of Agent Systems*, 2024, https://example.com/lazy-loading.';
const chicago = '"Lazy loading." Journal of Agent Systems, 2024. https://example.com/lazy-loading.';

describe('citation_formatter MCP contract', () => {
  let client: Client;

  beforeAll(async () => {
    const app = new ResearchMCPServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'citation-formatter-test', version: '1.0.0' });
    await app['server'].connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  function cite(args: Record<string, unknown>) {
    return client.callTool({ name: 'citation_formatter', arguments: { ...paper, ...args } });
  }

  test.each([
    ['APA', 1, `Smith, J. M. ${apa}`],
    ['APA', 2, `Smith, J. M., & Doe, J. ${apa}`],
    ['APA', 3, `Smith, J. M., Doe, J., & García, A. ${apa}`],
    ['APA', 21, 'Smith, J. M., Doe, J., García, A., Brown, A., Clark, B., Davis, C., Evans, D., Ford, E., ' +
      'Green, F., Hall, G., Irwin, H., Jones, I., King, J., Lane, K., Moore, L., Nash, M., Owen, N., ' +
      `Pike, O., Quinn, P., Reed, R., & Stone, S. ${apa}`],
    ['MLA', 1, `Smith, Jane Marie. ${mla}`],
    ['MLA', 2, `Smith, Jane Marie and John Doe. ${mla}`],
    ['MLA', 3, `Smith, Jane Marie, et al. ${mla}`],
    ['MLA', 21, `Smith, Jane Marie, et al. ${mla}`],
    ['Chicago', 1, `Smith, Jane Marie. ${chicago}`],
    ['Chicago', 2, `Smith, Jane Marie and John Doe. ${chicago}`],
    ['Chicago', 3, `Smith, Jane Marie, John Doe, and Ana García. ${chicago}`],
    ['Chicago', 21, 'Smith, Jane Marie, John Doe, Ana García, Adele Brown, Ben Clark, Cora Davis, Dina Evans, ' +
      'Eli Ford, Faye Green, Glen Hall, Hope Irwin, Ira Jones, Jude King, Kara Lane, Liam Moore, ' +
      `Maya Nash, Nora Owen, Omar Pike, Pia Quinn, Rita Reed, and Sam Stone. ${chicago}`],
  ])('%s formats %i authors', async (style, count, expected) => {
    const result = await cite({ authors: authors.slice(0, count), style });
    expect(result.content).toEqual([{ type: 'text', text: `${style} Citation:\n\n${expected}` }]);
  });

  test('advertises both author forms and DOI input', async () => {
    const { tools } = await client.listTools();
    const schema = tools.find(tool => tool.name === 'citation_formatter')?.inputSchema;
    expect(schema?.properties?.authors).toMatchObject({ items: { anyOf: [
      { type: 'string' },
      { type: 'object', required: ['given', 'family'] },
    ] } });
    expect(schema?.properties?.doi).toMatchObject({ type: 'string' });
  });

  test('keeps particles and suffixes, preserves hyphenated initials, and prefers DOI in APA', async () => {
    const result = await cite({
      authors: [
        'Joaquín de la Cruz, Jr', 'van der Waals, Johannes Diderik', 'Abu Nasr al-Farabi',
        { given: 'Jean-Luc J.M.', family: 'Picard III' },
      ],
      doi: '10.1234/lazy-loading',
    });
    expect(result.content).toEqual([{ type: 'text', text: 'APA Citation:\n\n' +
      'de la Cruz, J., Jr., van der Waals, J. D., al-Farabi, A. N., & Picard, J.-L. J. M., III. ' +
      '(2024). Lazy loading. Journal of Agent Systems. https://doi.org/10.1234/lazy-loading' }]);
  });

  test('keeps the suffix after the given name and family in Chicago', async () => {
    const result = await cite({
      authors: ['King, Martin Luther, Jr.', { given: 'J.-L.', family: 'Picard III' }],
      style: 'Chicago',
    });
    expect(result.content).toEqual([{
      type: 'text', text: 'Chicago Citation:\n\nKing, Martin Luther, Jr. and J.-L. Picard III. ' + chicago,
    }]);
  });

  test('preserves an unparsed name verbatim and reports the warning', async () => {
    const name = '  @research-team  ';
    const result = await cite({ authors: ['Jane Marie Smith', name], style: 'Chicago' });
    expect(result.content).toEqual([
      { type: 'text', text: `Chicago Citation:\n\nSmith, Jane Marie and ${name}. ${chicago}` },
      { type: 'text', text: `Warning: could not parse author 2: ${name}` },
    ]);
  });

  test('reports even an unparsed name inside the MLA abbreviation', async () => {
    const result = await cite({ authors: ['Jane Marie Smith', 'John Doe', 'Madonna'], style: 'MLA' });
    expect(result.content).toEqual([
      { type: 'text', text: `MLA Citation:\n\nSmith, Jane Marie, et al. ${mla}` },
      { type: 'text', text: 'Warning: could not parse author 3: Madonna' },
    ]);
  });
});
