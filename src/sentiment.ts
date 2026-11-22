import Sentiment from 'sentiment';

/**
 * AFINN-165 scoring with a negation window.
 *
 * The `sentiment` package flips only the single token after a short negator
 * list, so "never recommend" counts as praise and "hardly a success" as praise
 * (researcher-mcp#37). This wrapper looks back over a short window, stops at a
 * clause boundary, and reverses the score of the token being negated.
 */

const NEGATORS = new Set([
  'not', 'no', 'never', 'none', 'nobody', 'nothing', 'neither', 'nor', 'without',
  'hardly', 'barely', 'scarcely', 'cannot', 'cant', 'wont', 'dont', 'doesnt',
  'didnt', 'isnt', 'arent', 'wasnt', 'werent', 'wouldnt', 'shouldnt', 'couldnt',
  'aint', 'nowhere', 'nope',
]);

const CLAUSE_BOUNDARY = new Set(['.', ',', ';', ':', '!', '?', '—', '–', '...', 'but', 'however', 'although', 'though']);
const WINDOW = 3;

/**
 * Negators the `sentiment` package already applies to the immediately following
 * token. Re-flipping those would turn a correct negative back into a positive,
 * so the wider window only covers the rest (and the gaps the library leaves).
 */
const LIBRARY_NEGATORS = new Set([
  'cant', 'dont', 'doesnt', 'isnt', 'not', 'non', 'wont', 'wouldnt', 'shouldnt',
  'wasnt', 'werent', 'aint', 'arent', 'couldnt',
]);

export interface NegationNote {
  token: string;
  original: number;
  final: number;
  negator: string;
}

export interface SentimentAnalysis {
  score: number;
  comparative: number;
  positive: string[];
  negative: string[];
  tokens: string[];
  words: string[];
  negated: NegationNote[];
  method: string;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+|[.,;:!?]|—|–/gu) ?? []).filter(Boolean);
}

function findNegator(words: string[], tokenIndex: number): { word: string; distance: number; handledByLibrary: boolean } | undefined {
  for (let offset = 1; offset <= WINDOW && tokenIndex - offset >= 0; offset++) {
    const candidate = words[tokenIndex - offset];
    if (CLAUSE_BOUNDARY.has(candidate)) return undefined;
    if (!NEGATORS.has(candidate)) continue;
    // An immediate library negator is already reflected in the score; note it so
    // the caller can see the negation without flipping it twice.
    if (offset === 1 && LIBRARY_NEGATORS.has(candidate)) {
      return { word: candidate, distance: offset, handledByLibrary: true };
    }
    return { word: candidate, distance: offset, handledByLibrary: false };
  }
  return undefined;
}

export function analyzeSentiment(text: string): SentimentAnalysis {
  const base = new Sentiment();
  const raw = base.analyze(String(text ?? ''));
  const words = tokenize(String(text ?? ''));
  const notes: NegationNote[] = [];

  // `calculation` preserves token order, so the token list can be walked in step.
  let cursor = 0;
  let score = 0;
  const positive: string[] = [];
  const negative: string[] = [];

  // Each calculation entry is a single { token: score } record, in text order.
  for (const entry of raw.calculation ?? []) {
    for (const [rawToken, rawScore] of Object.entries(entry as Record<string, number>)) {
      const token = String(rawToken).toLowerCase();
      const original = Number(rawScore);
      let index = words.indexOf(token, cursor);
      if (index === -1) index = words.indexOf(token);
      if (index !== -1) cursor = index;

      const negator = index === -1 ? undefined : findNegator(words, index);
      const value = negator && !negator.handledByLibrary ? -original : original;
      score += value;
      if (value > 0) positive.push(token);
      else if (value < 0) negative.push(token);
      if (negator) notes.push({ token, original, final: value, negator: negator.word });
    }
  }

  const countable = words.filter(word => !CLAUSE_BOUNDARY.has(word)).length || 1;
  return {
    score,
    comparative: score / countable,
    positive,
    negative,
    tokens: raw.tokens ?? [],
    words: raw.words ?? [],
    negated: notes,
    method: 'lexicon-based (AFINN-165) with a negation window; comparative is a weak signal, not a calibrated probability',
  };
}
