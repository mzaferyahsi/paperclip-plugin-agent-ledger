import { globMatch } from './keys.ts';
import type { Rules } from './rules.ts';
import type { Flag, OrgNode, Sums } from './types.ts';

export interface FlagConfig { heavyShare: number; lowDataRuns: number }

export function tierOf(modelKeyValue: string | null, rules: Rules): string | null {
  if (!modelKeyValue) return null;
  return rules.tierModels.find((r) => globMatch(r.pattern, modelKeyValue))?.label ?? null;
}
export function expectedTier(node: Pick<OrgNode, 'role' | 'title'>, rules: Rules): string | null {
  for (const r of rules.tierRoles) if (globMatch(r.pattern, node.role) || (node.title && globMatch(r.pattern, node.title))) return r.label;
  return null;
}

export function flagsFor(n: OrgNode, totals: Sums, cfg: FlagConfig, rules: Rules, medianTokens: number): Flag[] {
  const f: Flag[] = [];
  const share = totals.tokens > 0 ? (n.own.tokens / totals.tokens) * 100 : 0;
  if (share > cfg.heavyShare) f.push({ code: 'heavy', severity: 'crit', detail: `${share.toFixed(1)}% of all tokens in this range (limit ${cfg.heavyShare}%)` });
  else if (medianTokens > 0 && n.own.tokens > 2 * medianTokens && n.own.tokens > 0 && share > cfg.heavyShare / 3) f.push({ code: 'heavy', severity: 'warn', detail: 'More than twice the median agent' });

  const keys = new Set(n.actualModels.map((m) => m.modelKey));
  if (n.configuredModelKey && n.actualModels.length) {
    const newest = [...n.actualModels].sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0]!;
    if (!keys.has(n.configuredModelKey) || newest.modelKey !== n.configuredModelKey) {
      f.push({ code: 'cfg_not_actual', severity: 'warn', detail: `Configured ${n.configuredModel}, most recent run on ${newest.model}` });
    } else if (keys.size > 1) {
      f.push({ code: 'drift', severity: 'info', detail: `Also ran ${[...keys].filter((k) => k !== n.configuredModelKey).join(', ')} in this range` });
    }
  } else if (keys.size > 1) f.push({ code: 'drift', severity: 'info', detail: `Ran ${keys.size} different models in this range` });

  if (n.status !== 'terminated' && n.own.runs < cfg.lowDataRuns) f.push({ code: 'low_data', severity: 'info', detail: `${n.own.runs} runs with usage in this range` });
  if (n.own.unpricedTokens > 0) f.push({ code: 'unpriced', severity: 'info', detail: `${n.own.unpricedTokens.toLocaleString('en-US')} tokens have no price` });
  const failedShare = n.own.runsTotal >= 4 ? n.own.runsFailed / n.own.runsTotal : 0;
  if (n.status === 'error' || failedShare > 0.25) f.push({ code: 'errors', severity: 'warn', detail: n.status === 'error' ? 'Agent status is error' : `${Math.round(failedShare * 100)}% of runs failed or were cancelled` });

  if (n.tier?.configured && n.tier.expected && n.tier.configured !== n.tier.expected) f.push({ code: 'tier', severity: 'warn', detail: `Model tier ${n.tier.configured}, role expects ${n.tier.expected}` });
  return f;
}

export function median(values: number[]): number {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}
