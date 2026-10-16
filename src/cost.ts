import type { Resolved } from './prices/book.ts';

/** Micro-USD = tokens x USD per MTok. Cached tokens fall back to the input price when a source lists no cache price. */
export function costMicro(uncachedInput: number, cached: number, output: number, p: Resolved): number {
  return Math.round(uncachedInput * p.input + cached * (p.cachedInput ?? p.input) + output * p.output);
}
