import type { Candidate } from './candidate.ts';

const fin = (v: number | null) => v === null || Number.isFinite(v);

/** USD per MTok sanity bounds. A candidate failing any check is dropped and counted, never stored. */
export function validateCandidate(c: Candidate): string | null {
  if (!c.providerKey || !c.modelKey) return 'empty key';
  if (!Number.isFinite(c.input) || !Number.isFinite(c.output) || !fin(c.cachedInput) || !fin(c.cacheWrite)) return 'non-finite price';
  if (c.input < 0 || c.output < 0 || c.input > 1000 || c.output > 5000) return 'price out of bounds';
  if (c.input === 0 && c.output === 0) return 'zero price';
  if (c.cachedInput !== null && (c.cachedInput < 0 || c.cachedInput > c.input)) return 'cached price above input';
  if (c.cacheWrite !== null && (c.cacheWrite < 0 || c.cacheWrite > c.input * 3 + 1e-9)) return 'cache write out of bounds';
  return null;
}

export interface Priced { input: number; cachedInput: number | null; cacheWrite: number | null; output: number }
const FIELDS = ['input', 'cachedInput', 'cacheWrite', 'output'] as const;

/** Largest percent change across fields; a field appearing or disappearing counts as 100 %. */
export function changePct(a: Priced, b: Priced): number {
  let max = 0;
  for (const f of FIELDS) {
    const x = a[f], y = b[f];
    if (x === y) continue;
    const pct = x === null || y === null || x === 0 ? 100 : Math.abs(y - x) / x * 100;
    if (pct > max) max = pct;
  }
  return Math.round(max * 1000) / 1000;
}
export const sameprice = (a: Priced, b: Priced) => FIELDS.every((f) => a[f] === b[f]);
