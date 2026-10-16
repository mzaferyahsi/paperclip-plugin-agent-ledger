// Minimal markdown pipe-table reader. Tables are selected by header names, never by position.
export interface MdTable { heading: string; headers: string[]; rows: string[][] }

export const normHeader = (s: string) => stripMarkup(s).toLowerCase().replace(/\s+/g, ' ').trim();

export function stripMarkup(s: string): string {
  return s.replace(/<sup>[\s\S]*?<\/sup>/gi, '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++; } else if (t[i] === '|') { cells.push(cur.trim()); cur = ''; } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseTables(md: string): MdTable[] {
  const lines = md.split(/\r?\n/);
  const tables: MdTable[] = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { heading = stripMarkup(h[1]!); continue; }
    if (line.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1]!)) {
      const headers = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && lines[j]!.includes('|') && lines[j]!.trim() !== ''; j++) rows.push(splitRow(lines[j]!));
      tables.push({ heading, headers, rows });
      i = j - 1;
    }
  }
  return tables;
}

/** Index of the first header equal to one of `names` (normalised), or -1. */
export function column(table: MdTable, names: string[]): number {
  const wanted = names.map(normHeader);
  return table.headers.findIndex((h) => wanted.includes(normHeader(h)));
}

/** `$2`, `$2.00 / MTok`, `$0.10<sup>1</sup>` -> number. Anything else -> null. */
export function parseMoney(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const m = /^\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*MTok)?$/i.exec(stripMarkup(cell));
  return m ? Number(m[1]) : null;
}
