import { column, parseMoney, parseTables } from './markdown-table.ts';
import { modelOfCell } from './model-name.ts';
import type { ParseFailure, ParseResult, RawPrice } from './types.ts';

/** Section "Model pricing"; columns by name: Model, Base input, Cache hits and refreshes, Output, 5m/1h cache writes. */
export function parseAnthropic(md: string): ParseResult | ParseFailure {
  const table = parseTables(md).find((t) => /model pricing/i.test(t.heading)
    && column(t, ['model']) >= 0 && column(t, ['base input', 'base input tokens']) >= 0
    && column(t, ['cache hits and refreshes']) >= 0 && column(t, ['output', 'output tokens']) >= 0);
  if (!table) return { ok: false, reason: 'Model pricing table not found' };
  const c = {
    model: column(table, ['model']), input: column(table, ['base input', 'base input tokens']),
    cached: column(table, ['cache hits and refreshes']), output: column(table, ['output', 'output tokens']),
    w5: column(table, ['5m cache writes']), w1: column(table, ['1h cache writes']),
  };
  const rows = new Map<string, RawPrice>();
  for (const r of table.rows) {
    const model = modelOfCell(r[c.model] ?? '');
    if (!model || rows.has(model)) continue;
    rows.set(model, {
      model, tier: 'base', input: parseMoney(r[c.input]), cachedInput: parseMoney(r[c.cached]), output: parseMoney(r[c.output]),
      cacheWrite5m: c.w5 >= 0 ? parseMoney(r[c.w5]) : null, cacheWrite1h: c.w1 >= 0 ? parseMoney(r[c.w1]) : null,
    });
  }
  return { ok: true, rows };
}
