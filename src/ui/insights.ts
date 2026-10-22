import type { AgentDetailData, AgentLedgerData, OrgNode } from '../types.ts';
import { fmtTokens, fmtUsd } from './model.ts';

export interface Insight { tone: 'info' | 'warn' | 'good'; text: string }

const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
const sign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
export const modelId = (m: { provider: string; model: string }) => `${m.provider}|${m.model}`;

/** Days (or hours) on which the model with most tokens changed. Empty buckets are skipped. Cost per 1M tokens is compared over the week before and after. */
export function modelSwitches(d: AgentDetailData): Array<{ at: string; from: string; to: string; beforeCostPerM: number | null; afterCostPerM: number | null }> {
  const out: ReturnType<typeof modelSwitches> = [];
  let prev: string | null = null, prevIdx = -1;
  const lead = (b: AgentDetailData['buckets'][number]) => Object.entries(b.byModel).sort((x, y) => y[1].tokens - x[1].tokens)[0]?.[0] ?? null;
  const rate = (from: number, to: number): number | null => {
    let t = 0, c = 0;
    for (const b of d.buckets.slice(from, to)) { t += b.tokens; c += b.costMicro; }
    return t > 0 && c > 0 ? (c / t) * 1e6 : null;
  };
  d.buckets.forEach((b, i) => {
    const l = lead(b);
    if (!l) return;
    if (prev && l !== prev) out.push({ at: b.label, from: prev.split('|')[1]!, to: l.split('|')[1]!, beforeCostPerM: rate(Math.max(0, prevIdx - 6), i), afterCostPerM: rate(i, Math.min(d.buckets.length, i + 7)) });
    prev = l; prevIdx = i;
  });
  return out;
}

export function agentInsights(n: OrgNode, d: AgentDetailData, data: AgentLedgerData, pageRange: boolean): Insight[] {
  const out: Insight[] = [];
  const s = d.sums;
  if (s.tokens === 0) return [{ tone: 'info', text: 'This agent has no recorded usage in this range.' }];
  for (const w of modelSwitches(d).slice(-3)) {
    const cost = w.beforeCostPerM !== null && w.afterCostPerM !== null ? ` Cost per 1M tokens went from ${fmtUsd(w.beforeCostPerM)} to ${fmtUsd(w.afterCostPerM)} (${sign(pct(w.afterCostPerM, w.beforeCostPerM)!)}).` : '';
    out.push({ tone: 'info', text: `Main model changed from ${w.from} to ${w.to} on ${w.at}.${cost}` });
  }
  if (pageRange && data.totals.tokens > 0) {
    const share = (s.tokens / data.totals.tokens) * 100;
    const rank = Object.values(data.nodes).filter((x) => x.own.tokens > s.tokens).length + 1;
    out.push({ tone: share >= data.thresholds.heavyShare ? 'warn' : 'info', text: `Uses ${share < 1 ? '<1' : share.toFixed(0)}% of all tokens in the company (rank ${rank} of ${Object.keys(data.nodes).length} agents).` });
  }
  const dt = pct(s.tokens, d.prior.tokens), dc = pct(s.costMicro, d.prior.costMicro);
  if (dt !== null) out.push({ tone: Math.abs(dt) >= 50 ? 'warn' : 'info', text: `Tokens ${sign(dt)} compared with the period before${dc !== null ? `; cost ${sign(dc)}` : ''}.` });
  const peak = d.buckets.reduce((a, b) => (b.tokens > a.tokens ? b : a), d.buckets[0]!);
  if (d.buckets.length > 2 && peak.tokens / s.tokens >= 0.35) out.push({ tone: 'info', text: `One ${d.granularity === 'day' ? 'day' : 'hour'} (${peak.label}) holds ${Math.round((peak.tokens / s.tokens) * 100)}% of the tokens.` });
  const cacheBase = s.input + s.cached;
  if (cacheBase > 1e6) {
    const rate = (s.cached / cacheBase) * 100;
    out.push({ tone: rate < 30 ? 'warn' : 'good', text: `${rate.toFixed(0)}% of input tokens came from the cache${rate < 30 ? '. Low caching raises the cost.' : '.'}` });
  }
  if (s.runsTotal >= 10 && s.runsFailed / s.runsTotal >= 0.2) out.push({ tone: 'warn', text: `${s.runsFailed} of ${s.runsTotal} runs failed or were cancelled (${Math.round((s.runsFailed / s.runsTotal) * 100)}%).` });
  if (s.unpricedTokens > 0) out.push({ tone: 'warn', text: `${fmtTokens(s.unpricedTokens)} tokens have no price, so the cost is a lower bound.` });
  return out;
}
