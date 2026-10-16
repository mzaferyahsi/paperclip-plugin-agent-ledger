import { stripMarkup } from './markdown-table.ts';

export const normModel = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Qualifiers that mean a non-default band (long context, batch, ...). Such rows are ignored. */
const OTHER_BAND = /\b(over|above|greater|longer|long context|batch|flex|priority|fast)\b|>/i;

/** "Claude Opus 4.1 ([retired ...](url))" -> "claude opus 4.1". Null when the row is another context band. */
export function modelOfCell(cell: string): string | null {
  const text = stripMarkup(cell);
  const i = text.indexOf(' (');
  const name = i >= 0 ? text.slice(0, i) : text;
  const qualifier = i >= 0 ? text.slice(i) : '';
  if (!name || OTHER_BAND.test(qualifier)) return null;
  return normModel(name);
}
