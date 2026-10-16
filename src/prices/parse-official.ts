import { modelKey } from '../keys.ts';
import { parseAnthropic } from './parse-anthropic.ts';
import { parseOpenAi } from './parse-openai.ts';
import type { Candidate, ParseOutcome } from './candidate.ts';

function convert(res: ReturnType<typeof parseAnthropic>, provider: string, source: Candidate['source']): ParseOutcome {
  if (!res.ok) return { ok: false, reason: res.reason };
  const candidates: Candidate[] = [];
  let skipped = 0;
  for (const r of res.rows.values()) {
    if (r.input === null || r.output === null) { skipped++; continue; }
    const mk = modelKey(r.model.replace(/\s+/g, '-'));
    if (!mk) { skipped++; continue; }
    candidates.push({ providerKey: provider, modelKey: mk, input: r.input, cachedInput: r.cachedInput, cacheWrite: r.cacheWrite5m, output: r.output, source });
  }
  return candidates.length ? { ok: true, candidates, skipped } : { ok: false, reason: 'no priced rows' };
}
export const parseAnthropicOfficial = (md: string): ParseOutcome => convert(parseAnthropic(md), 'anthropic', 'anthropic-official');
export const parseOpenAiOfficial = (md: string): ParseOutcome => convert(parseOpenAi(md), 'openai', 'openai-official');
