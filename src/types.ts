// Payload contract shared by the worker and the UI.
export interface Sums {
  input: number; cached: number; output: number; tokens: number;
  runs: number; runsTotal: number; runsFailed: number; runsWithUsage: number;
  costMicro: number;        // API-equivalent micro-USD of the priced tokens
  pricedTokens: number; unpricedTokens: number; freeTokens: number;
}
export interface ActualModel {
  provider: string; model: string; modelKey: string; billingType: string;
  tokens: number; runs: number; share: number; lastAt: string; matchesConfigured: boolean;
  costMicro: number; priced: boolean; free: boolean; priceSource: string | null;
}
export interface ModelTotal { provider: string; model: string; tokens: number; runs: number; share: number; costMicro: number; priced: boolean; free: boolean; agents: number }
export type FlagCode = 'heavy' | 'drift' | 'cfg_not_actual' | 'low_data' | 'unpriced' | 'errors' | 'tier';
export interface Flag { code: FlagCode; severity: 'info' | 'warn' | 'crit'; detail: string }
export interface OrgNode {
  agentId: string; name: string; role: string; title: string | null; status: string;
  reportsTo: string | null; depth: number; children: string[];
  adapterType: string; configuredModel: string | null; configuredModelKey: string | null; engine: string | null; lastHeartbeatAt: string | null;
  providersInRange: string[]; actualModels: ActualModel[];
  own: Sums; subtree: Sums; prior: { own: Sums; subtree: Sums } | null;
  flags: Flag[]; tier: { configured: string | null; expected: string | null } | null;
}
export interface PricingStatus {
  asOf: string | null; stale: boolean; snapshotOnly: boolean; snapshotDate: string; heldChanges: number; refreshing: boolean;
  sources: Array<{ key: string; label: string; status: string; at: string | null; detail: string | null }>;
  unmatchedModels: Array<{ provider: string; model: string; tokens: number }>; currency: 'USD';
}
export interface RangeMeta {
  kind: string; fromDate: string; toDate: string; fromUtc: string; toUtc: string; days: number; timezone: string; clamped: boolean; priorFromUtc: string; priorToUtc: string;
}
export interface AgentLedgerData {
  generatedAt: string; pluginVersion: string; range: RangeMeta;
  roots: string[]; nodes: Record<string, OrgNode>; unattached: string[];
  terminated: { count: number; withUsage: number; own: Sums; prior: Sums | null; agents: Array<{ agentId: string; name: string; tokens: number; runs: number; costMicro: number }> };
  totals: Sums; modelTotals: ModelTotal[]; priorTotals: Sums | null; pricing: PricingStatus;
  coverage: { firstEventAt: string | null; providersAssumedExclusive: string[] };
  tiersConfigured: boolean; thresholds: { heavyShare: number; lowDataRuns: number };
  errors: Record<string, string>;
}
export const zeroSums = (): Sums => ({ input: 0, cached: 0, output: 0, tokens: 0, runs: 0, runsTotal: 0, runsFailed: 0, runsWithUsage: 0, costMicro: 0, pricedTokens: 0, unpricedTokens: 0, freeTokens: 0 });
export function addSums(a: Sums, b: Sums): Sums {
  const r = { ...a } as Record<string, number>;
  for (const k of Object.keys(b)) r[k] = (r[k] ?? 0) + (b as unknown as Record<string, number>)[k]!;
  return r as unknown as Sums;
}
