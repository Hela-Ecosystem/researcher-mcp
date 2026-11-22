import { analyzeSentiment } from '../sentiment';

describe('content_sentiment_analysis negation (researcher-mcp#37)', () => {
  test('"not good" is negative', () => {
    const result = analyzeSentiment('This product is not good at all.');
    expect(result.score).toBeLessThan(0);
    expect(result.negated.map(n => n.token)).toContain('good');
  });

  test('"never recommend" no longer scores as praise', () => {
    const result = analyzeSentiment('I would never recommend this. It was never worth the money and I never enjoyed it.');
    expect(result.score).toBeLessThan(0);
    for (const token of ['recommend', 'worth', 'enjoyed']) {
      expect(result.negated.map(n => n.token)).toContain(token);
    }
  });

  test('"nobody loved it / hardly a success" is not neutral-praise', () => {
    const result = analyzeSentiment("I don't like it. It isn't good. Nobody loved it. Hardly a success.");
    expect(result.score).toBeLessThan(0);
    expect(result.negated.map(n => n.token)).toEqual(expect.arrayContaining(['loved', 'success']));
  });

  test('negation does not cross a clause boundary', () => {
    const result = analyzeSentiment('It is not reliable. The design is good.');
    expect(result.negated.map(n => n.token)).toContain('reliable');
    expect(result.negated.map(n => n.token)).not.toContain('good');
  });

  test('plain positive text stays positive', () => {
    const result = analyzeSentiment('A wonderful, reliable product. I love it.');
    expect(result.score).toBeGreaterThan(0);
    expect(result.negated).toEqual([]);
  });

  test('the method is disclosed', () => {
    const result = analyzeSentiment('fine');
    expect(result.method).toMatch(/lexicon-based/);
    expect(result.method).toMatch(/weak signal/);
  });
});
