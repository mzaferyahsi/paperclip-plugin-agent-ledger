import { providerKey, modelKey, RESELLER_PROVIDER } from '../keys.ts';
import type { Candidate, ParseOutcome } from './candidate.ts';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const perMtok = (v: number | null) => (v === null ? null : Math.round(v * 1e6 * 1e6) / 1e6);

/** LiteLLM model_prices_and_context_window.json: per-token USD. Chat models of direct providers only; resold entries (bedrock, vertex, ...) are skipped. */
export function parseLitellm(text: string): ParseOutcome {
  let data: Record<string, any>;
  try { data = JSON.parse(text); } catch { return { ok: false, reason: 'not JSON' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'unexpected shape' };
  const out = new Map<string, Candidate>();
  let skipped = 0, seen = 0;
  for (const [key, e] of Object.entries(data)) {
    if (key === 'sample_spec' || !e || typeof e !== 'object') continue;
    seen++;
    const provider = typeof e.litellm_provider === 'string' ? e.litellm_provider : '';
    const input = perMtok(num(e.input_cost_per_token)), output = perMtok(num(e.output_cost_per_token));
    if (e.mode !== 'chat' || !provider || RESELLER_PROVIDER.test(provider) || input === null || output === null) { skipped++; continue; }
    const mk = modelKey(key);
    if (!mk) { skipped++; continue; }
    const c: Candidate = { providerKey: providerKey(provider), modelKey: mk, input, output, cachedInput: perMtok(num(e.cache_read_input_token_cost)),
      cacheWrite: perMtok(num(e.cache_creation_input_token_cost)), source: 'litellm', deprecationDate: typeof e.deprecation_date === 'string' ? e.deprecation_date : null };
    const id = `${c.providerKey}|${c.modelKey}`;
    if (!out.has(id)) out.set(id, c);
  }
  if (seen < 20 || out.size < 10) return { ok: false, reason: `only ${out.size} usable of ${seen} entries` };
  return { ok: true, candidates: [...out.values()], skipped };
}
