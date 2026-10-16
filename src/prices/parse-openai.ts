import { column, parseMoney, parseTables } from './markdown-table.ts';
import { modelOfCell } from './model-name.ts';
import type { ParseFailure, ParseResult, RawPrice } from './types.ts';

/**
 * The first table under a "Standard" heading with Model, Input, Cached input and Output columns.
 * The live page prefixes the names with "Short context"; both spellings are accepted. Long-context
 * columns and the Batch, Flex, Fast and Ultrafast tables are never read.
 */
export function parseOpenAi(md: string): ParseResult | ParseFailure {
  const table = parseTables(md).find((t) => /^standard\b/i.test(t.heading)
    && column(t, ['model']) >= 0 && column(t, ['input', 'short context input']) >= 0
    && column(t, ['cached input', 'short context cached input']) >= 0 && column(t, ['output', 'short context output']) >= 0);
  if (!table) return { ok: false, reason: 'Standard pricing table not found' };
  const c = {
    model: column(table, ['model']), input: column(table, ['input', 'short context input']),
    cached: column(table, ['cached input', 'short context cached input']), output: column(table, ['output', 'short context output']),
  };
  const rows = new Map<string, RawPrice>();
  for (const r of table.rows) {
    const model = modelOfCell(r[c.model] ?? '');
    if (!model || rows.has(model)) continue;
    rows.set(model, { model, tier: 'standard', input: parseMoney(r[c.input]), cachedInput: parseMoney(r[c.cached]), output: parseMoney(r[c.output]), cacheWrite5m: null, cacheWrite1h: null });
  }
  return { ok: true, rows };
}
