export type DateRestriction = 'd7' | 'm1' | 'm3' | 'm6' | 'm12' | 'y1' | 'y5';

export interface SearchTimeWindow {
  from: Date;
  to: Date;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function searchTimeWindow(restriction: DateRestriction, to = new Date()): SearchTimeWindow {
  const amount = Number(restriction.slice(1));
  if (restriction === 'd7') return { from: new Date(to.getTime() - amount * DAY_MS), to };

  const from = new Date(to);
  const day = from.getUTCDate();
  const months = restriction.startsWith('y') ? amount * 12 : amount;
  from.setUTCMonth(from.getUTCMonth() - months, 1);
  const lastDay = new Date(from);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  from.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return { from, to };
}

export function inSearchTimeWindow(value: string, { from, to }: SearchTimeWindow): boolean {
  const date = Date.parse(value);
  return date >= from.getTime() && date <= to.getTime();
}

export function matchesSearchPhrase(query: string, ...fields: string[]): boolean {
  const tokens = (value: string) => value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const phrase = tokens(query).join(' ');
  return phrase.length > 0 && fields.some(field => ` ${tokens(field).join(' ')} `.includes(` ${phrase} `));
}
