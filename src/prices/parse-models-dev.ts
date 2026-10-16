import { providerKey, modelKey, RESELLER_PROVIDER } from '../keys.ts';
import type { Candidate, ParseOutcome } from './candidate.ts';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** models.dev api.json: { provider: { models: { id: { cost: { input, output, cache_read, cache_write } } } } }, USD per MTok. */
export function parseModelsDev(text: string): ParseOutcome {
  let data: Record<string, any>;
  try { data = JSON.parse(text); } catch { return { ok: false, reason: 'not JSON' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'unexpected shape' };
  const out = new Map<string, Candidate>();
  let skipped = 0, seen = 0;
  for (const [prov, p] of Object.entries(data)) {
    if (!p || typeof p !== 'object' || typeof p.models !== 'object' || RESELLER_PROVIDER.test(prov)) continue;
    for (const [id, m] of Object.entries<any>(p.models ?? {})) {
      seen++;
      const cost = m?.cost;
      const input = num(cost?.input), output = num(cost?.output);
      const mk = modelKey(id);
      if (input === null || output === null || !mk) { skipped++; continue; }
      const c: Candidate = { providerKey: providerKey(prov), modelKey: mk, input, output, cachedInput: num(cost.cache_read), cacheWrite: num(cost.cache_write), source: 'models-dev' };
      const k = `${c.providerKey}|${c.modelKey}`;
      if (!out.has(k)) out.set(k, c);
    }
  }
  if (seen < 20 || out.size < 10) return { ok: false, reason: `only ${out.size} usable of ${seen} entries` };
  return { ok: true, candidates: [...out.values()], skipped };
}
