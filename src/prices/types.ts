export type Provider = 'anthropic' | 'openai';

/** One parsed table row, before validation. Missing cells are null. */
export interface RawPrice {
  model: string; // normalised display name, matches a listing key
  input: number | null; cachedInput: number | null; output: number | null;
  cacheWrite5m: number | null; cacheWrite1h: number | null;
  tier: 'base' | 'standard';
}

export interface Price {
  input: number; cachedInput: number; output: number; cacheWrite5m: number | null; cacheWrite1h: number | null;
}

export interface ParseResult { ok: true; rows: Map<string, RawPrice> } 
export interface ParseFailure { ok: false; reason: string }
