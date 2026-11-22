import { z } from 'zod';

const STYLES = ['APA', 'MLA', 'Chicago'] as const;
const DOI_PREFIX = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i;

export const citationFormatterTool = {
  name: 'citation_formatter',
  description: 'Format citations in APA, MLA, or Chicago style',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title of the work' },
      authors: {
        type: 'array',
        description: 'List of author names as strings or structured given and family names',
        items: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: { given: { type: 'string' }, family: { type: 'string' } },
              required: ['given', 'family'],
            },
          ],
        },
      },
      year: { type: 'number', description: 'Publication year' },
      source: { type: 'string', description: 'Source (journal, website, etc.)' },
      url: { type: 'string', format: 'uri', description: 'URL if applicable' },
      doi: { type: 'string', description: 'DOI or DOI URL if applicable' },
      style: { type: 'string', enum: STYLES, description: 'Citation style', default: 'APA' },
    },
    required: ['title'],
  },
};

const citationInput = z.object({
  title: z.string(),
  authors: z.array(z.unknown()).default([]),
  year: z.number().optional(),
  source: z.string().optional(),
  url: z.string().optional(),
  doi: z.string().trim().transform(value => value.replace(DOI_PREFIX, ''))
    .pipe(z.string().regex(/^10\.\d+\/\S+$/, 'Expected a DOI or DOI URL.')).optional(),
  style: z.string().default('APA'),
});
const structuredName = z.object({ given: z.string(), family: z.string() });
const namePartPattern = /^\p{L}[\p{L}\p{M}]*(?:['’.]\p{L}[\p{L}\p{M}]*)*\.?$/u;
const suffixPattern = /^(?:[JS]r\.?|II|III|IV|V|VI|VII|VIII|IX|X)$/i;
const particles = new Set([
  'al', 'ap', 'ben', 'bin', 'da', 'das', 'de', 'del', 'della', 'den', 'der', 'des', 'di', 'dos',
  'du', 'el', 'ibn', 'la', 'las', 'le', 'los', 'st.', 'ten', 'ter', 'van', 'von', 'zu', 'zum', 'zur',
]);

type AuthorName = { given: string; family: string; suffix?: string };

function takeSuffix(parts: string[]): string | undefined {
  const last = parts.at(-1);
  if (parts.length > 1 && last && suffixPattern.test(last)) {
    parts.pop();
    if (/^jr\.?$/i.test(last)) return 'Jr.';
    if (/^sr\.?$/i.test(last)) return 'Sr.';
    return last.toUpperCase();
  }
}

function nameFromParts(given: string[], family: string[], suffix?: string): AuthorName | undefined {
  if (!given.length || !family.length || ![...given, ...family].every(word =>
    word.split('-').every(part => namePartPattern.test(part)),
  )) {
    return undefined;
  }
  return { given: given.join(' '), family: family.join(' '), suffix };
}

function parseAuthor(author: unknown): AuthorName | undefined {
  if (typeof author !== 'string') {
    const parsed = structuredName.safeParse(author);
    if (!parsed.success) return undefined;
    const given = parsed.data.given.trim().split(/\s+/u);
    const family = parsed.data.family.trim().split(/\s+/u);
    return nameFromParts(given, family, takeSuffix(family));
  }

  const commaParts = author.trim().split(/\s*,\s*/u);
  const commaSuffix = takeSuffix(commaParts);
  const [first, second] = commaParts;
  if (commaParts.length === 2) {
    const family = first.split(/\s+/u);
    return nameFromParts(second.split(/\s+/u), family, commaSuffix ?? takeSuffix(family));
  }
  if (commaParts.length !== 1) return undefined;

  const parts = first.split(/\s+/u);
  const suffix = commaSuffix ?? takeSuffix(parts);
  let familyStart = parts.length - 1;
  while (familyStart > 1 && particles.has(parts[familyStart - 1].toLowerCase())) {
    familyStart--;
  }
  return nameFromParts(parts.slice(0, familyStart), parts.slice(familyStart), suffix);
}

function initials(given: string): string {
  return given.split(' ').map(word => {
    const groups = word.split('-').map(part => part.split('.')
      .filter(Boolean)
      .map(name => name.replace(/^(\p{L}\p{M}*).*$/u, '$1').toUpperCase() + '.')
      .join(' '));
    return groups.join('-');
  }).join(' ');
}

function endSentence(text: string): string {
  return /[.!?]$/u.test(text.trimEnd()) ? text : text + '.';
}

function joinAuthors(names: string[], conjunction: string, serialComma = false): string {
  if (names.length < 2) return names.join('');
  const separator = serialComma || names.length > 2 ? ', ' : ' ';
  return names.slice(0, -1).join(', ') + separator + conjunction + ' ' + names.at(-1);
}

export function formatCitation(args: unknown): { style: string; citation: string; warnings: string[] } {
  const { title, authors, year, source, url, doi, style } = citationInput.parse(args);
  const warnings: string[] = [];
  const names = authors.map((author, index) => {
    const parsed = parseAuthor(author);
    if (parsed) {
      const { given, family, suffix } = parsed;
      const invertedSuffix = suffix ? ', ' + suffix : '';
      return {
        inverted: family + ', ' + given + invertedSuffix,
        natural: given + ' ' + family + (suffix ? ' ' + suffix : ''),
        apa: family + ', ' + initials(given) + invertedSuffix,
      };
    }
    const verbatim = typeof author === 'string' ? author : JSON.stringify(author) ?? String(author);
    warnings.push('Warning: could not parse author ' + (index + 1) + ': ' + verbatim);
    return { inverted: verbatim, natural: verbatim, apa: verbatim };
  });

  const bibliographyNames = names.map((name, index) => index === 0 ? name.inverted : name.natural);
  const quotedTitle = '"' + endSentence(title) + '"';
  let citation: string;
  switch (style.toUpperCase()) {
    case 'APA': {
      citation = [
        names.length > 0 && endSentence(joinAuthors(names.map(name => name.apa), '&', true)),
        '(' + (year ?? 'n.d.') + ').',
        endSentence(title),
        source && endSentence(source),
        doi ? 'https://doi.org/' + doi : url,
      ].filter(Boolean).join(' ');
      break;
    }
    case 'MLA': {
      const authorBlock = bibliographyNames.length >= 3
        ? bibliographyNames[0] + ', et al.'
        : endSentence(joinAuthors(bibliographyNames, 'and') || 'Unknown Author');
      const publication = [source && '*' + source + '*', year, url]
        .filter(value => value !== undefined && value !== '').join(', ');
      citation = [authorBlock, quotedTitle, publication && endSentence(publication)].filter(Boolean).join(' ');
      break;
    }
    case 'CHICAGO': {
      const authorBlock = endSentence(joinAuthors(bibliographyNames, 'and') || 'Unknown Author');
      const publication = [source, year].filter(value => value !== undefined && value !== '').join(', ');
      citation = [
        authorBlock, quotedTitle, publication && endSentence(publication), url && endSentence(url),
      ].filter(Boolean).join(' ');
      break;
    }
    default:
      throw new Error('Expected APA, MLA, or Chicago citation style.');
  }
  return { style, citation, warnings };
}
