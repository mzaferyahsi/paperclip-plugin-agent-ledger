// In-memory price lookup: effective-dated list prices plus user overrides, aliases and free providers.
import { globMatch, modelKey, providerKey } from '../keys.ts';

export interface PriceVersion { providerKey: string; modelKey: string; input: number; cachedInput: number | null; cacheWrite: number | null; output: number; source: string; effectiveFrom: number; status?: string }
export interface Override { key: string; input: number; cachedInput: number | null; cacheWrite: number | null; output: number; from: number | null; to: number | null }
export interface BookInput {
  versions: PriceVersion[]; overrides: Override[]; modelAliases: Record<string, string>; providerAliases: Record<string, string>; freeProviders: string[];
}
export interface Resolved { input: number; cachedInput: number | null; cacheWrite: number | null; output: number; source: string; effectiveFrom: number | null }
export type Lookup = { kind: 'priced'; price: Resolved } | { kind: 'free' } | { kind: 'unpriced' };

const PREFERRED = ['anthropic', 'openai', 'google', 'zai', 'deepseek', 'xai', 'mistral'];

export class PriceBook {
  private byModel = new Map<string, Map<string, PriceVersion[]>>();
  private free: Set<string>;
  private d: BookInput;
  constructor(d: BookInput) {
    this.d = d;
    for (const v of d.versions) {
      let m = this.byModel.get(v.modelKey);
      if (!m) this.byModel.set(v.modelKey, m = new Map());
      let l = m.get(v.providerKey);
      if (!l) m.set(v.providerKey, l = []);
      l.push(v);
    }
    for (const m of this.byModel.values()) for (const l of m.values()) l.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    this.free = new Set(d.freeProviders.map((p) => providerKey(p, d.providerAliases)));
  }
  /** Distinct model keys the book can price, for the "unmatched models" list. */
  has(modelKeyValue: string): boolean { return this.byModel.has(modelKeyValue); }

  resolveKeys(rawProvider: string, rawModel: string): { provider: string; model: string } {
    const lowered = rawModel.trim().toLowerCase();
    const alias = this.d.modelAliases[lowered] ?? this.d.modelAliases[modelKey(rawModel)];
    return { provider: providerKey(rawProvider, this.d.providerAliases), model: modelKey(alias ?? rawModel) };
  }

  lookup(rawProvider: string, rawModel: string, atMs: number): Lookup {
    const { provider, model } = this.resolveKeys(rawProvider, rawModel);
    const id = `${provider}/${model}`;
    const rawId = `${rawProvider}/${rawModel}`;   // overrides may be written with the names exactly as they appear in usage
    for (const o of this.d.overrides) {
      if ((o.from !== null && atMs < o.from) || (o.to !== null && atMs >= o.to)) continue;
      if (globMatch(o.key, id) || globMatch(o.key, rawId)) return { kind: 'priced', price: { input: o.input, cachedInput: o.cachedInput, cacheWrite: o.cacheWrite, output: o.output, source: 'override', effectiveFrom: o.from } };
    }
    if (this.free.has(provider)) return { kind: 'free' };
    const m = this.byModel.get(model);
    if (!m) return { kind: 'unpriced' };
    let list = m.get(provider);
    if (!list) {
      const pick = PREFERRED.find((p) => m.has(p)) ?? [...m.keys()].sort()[0]!;
      list = m.get(pick)!;
    }
    // Newest version in force at atMs; before the first known version, the first version applies (back-fill).
    let v = list[0]!;
    for (const x of list) { if (x.effectiveFrom <= atMs) v = x; else break; }
    return { kind: 'priced', price: { input: v.input, cachedInput: v.cachedInput, cacheWrite: v.cacheWrite, output: v.output, source: v.source, effectiveFrom: v.effectiveFrom } };
  }
}
