import { Cache } from './cache.ts';
import { costMicro } from './cost.ts';
import type { Db } from './db.ts';
import { flagsFor, expectedTier, median, tierOf } from './flags.ts';
import { modelKey } from './keys.ts';
import { PriceBook } from './prices/book.ts';
import { DEFAULT_SOURCE_ORDER, SOURCES } from './prices/sources.ts';
import { ALL_ACTIVE_SQL, HELD_SQL, LAST_OK_SQL, RECENT_COLLECTIONS_SQL, loadVersions, snapshotMeta } from './prices/store.ts';
import { foldRules, loadRuleRows, type Rules } from './rules.ts';
import { agentsQuery, historyStartQuery, runsQuery, usageQuery } from './sql.ts';
import { resolveRange, type RangeInput, type ResolvedRange } from './time.ts';
import { buildTree, sumRoots } from './tree.ts';
import { addSums, zeroSums, type ActualModel, type AgentDetailData, type DetailBucket, type ModelTotal, type OrgNode, type AgentLedgerData, type PricingStatus, type RangeMeta, type Sums } from './types.ts';

export class BadRequest extends Error {}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireCompany(companyId: unknown): string {
  if (typeof companyId !== 'string' || !UUID.test(companyId)) throw new BadRequest('Agent Ledger needs a company context');
  return companyId;
}
export function parseRange(raw: unknown): RangeInput {
  if (raw === undefined || raw === null) return '7d';
  if (typeof raw === 'string' && ['today', 'yesterday', '7d', '14d', '30d'].includes(raw)) return raw as RangeInput;
  if (typeof raw === 'object' && typeof (raw as any).from === 'string' && typeof (raw as any).to === 'string') return { from: (raw as any).from, to: (raw as any).to };
  throw new BadRequest('Unknown range');
}

export interface Config {
  timezone: string; inclusiveInputProviders: string[]; heavyShareThreshold: number; lowDataRunThreshold: number;
  priceChangeHoldPercent: number; priceStaleAfterDays: number; priceSources: string[];
}
export const DEFAULT_CONFIG: Config = {
  timezone: 'Europe/Amsterdam', inclusiveInputProviders: ['openai'], heavyShareThreshold: 15, lowDataRunThreshold: 10,
  priceChangeHoldPercent: 50, priceStaleAfterDays: 3, priceSources: [...DEFAULT_SOURCE_ORDER],
};
export function readConfig(raw: unknown): Config {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  const sources = Array.isArray(c.priceSources) ? c.priceSources.filter((s): s is string => typeof s === 'string' && SOURCES.some((x) => x.key === s)) : DEFAULT_CONFIG.priceSources;
  return {
    timezone: typeof c.timezone === 'string' && c.timezone ? c.timezone : DEFAULT_CONFIG.timezone,
    inclusiveInputProviders: Array.isArray(c.inclusiveInputProviders) ? c.inclusiveInputProviders.filter((s): s is string => typeof s === 'string').map((s) => s.toLowerCase()) : DEFAULT_CONFIG.inclusiveInputProviders,
    heavyShareThreshold: num(c.heavyShareThreshold, 15, 1, 100), lowDataRunThreshold: num(c.lowDataRunThreshold, 10, 0, 100000),
    priceChangeHoldPercent: num(c.priceChangeHoldPercent, 50, 5, 500), priceStaleAfterDays: num(c.priceStaleAfterDays, 3, 1, 365), priceSources: sources,
  };
}

export interface AgentRow { agent_id: string; name: string; role: string; title: string | null; status: string; reports_to: string | null; adapter_type: string; configured_model: string | null; engine: string | null; last_heartbeat_at: string | Date | null }
export interface UsageRow { agent_id: string; provider: string; model: string; billing_type: string; hour: unknown; input: unknown; cached: unknown; output: unknown; runs: unknown }
export interface RunRow { agent_id: string; runs_total: unknown; runs_failed: unknown; runs_with_usage: unknown }
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const HOUR = 3_600_000;

interface Acc { sums: Sums; models: Map<string, { provider: string; model: string; billing: string; tokens: number; runs: number; cost: number; lastHour: number; priced: boolean; free: boolean; source: string | null }>; providers: Set<string> }

function accumulate(rows: UsageRow[], book: PriceBook, unmatched: Map<string, { provider: string; model: string; tokens: number }>): Map<string, Acc> {
  const by = new Map<string, Acc>();
  for (const r of rows) {
    let a = by.get(r.agent_id);
    if (!a) by.set(r.agent_id, a = { sums: zeroSums(), models: new Map(), providers: new Set() });
    const input = n(r.input), cached = n(r.cached), output = n(r.output), tokens = input + cached + output, runs = n(r.runs), hour = n(r.hour);
    const s = a.sums;
    s.input += input; s.cached += cached; s.output += output; s.tokens += tokens; s.runs += runs;
    a.providers.add(r.provider);
    const lk = book.lookup(r.provider, r.model, hour * HOUR);
    let cost = 0, priced = false, free = false, source: string | null = null;
    if (lk.kind === 'priced') { cost = costMicro(input, cached, output, lk.price); priced = true; source = lk.price.source; s.costMicro += cost; s.pricedTokens += tokens; }
    else if (lk.kind === 'free') { free = true; s.freeTokens += tokens; }
    else {
      s.unpricedTokens += tokens;
      const k = `${r.provider}|${r.model}`;
      const u = unmatched.get(k);
      if (u) u.tokens += tokens; else unmatched.set(k, { provider: r.provider, model: r.model, tokens });
    }
    const mkey = `${r.provider}|${r.model}`;
    let m = a.models.get(mkey);
    if (!m) a.models.set(mkey, m = { provider: r.provider, model: r.model, billing: r.billing_type, tokens: 0, runs: 0, cost: 0, lastHour: 0, priced: false, free: false, source: null });
    m.tokens += tokens; m.runs += runs; m.cost += cost; m.lastHour = Math.max(m.lastHour, hour);
    m.priced = m.priced || priced; m.free = m.free || free; m.source = m.source ?? source;
  }
  return by;
}

export interface BuildInput {
  agents: AgentRow[]; usage: UsageRow[]; priorUsage: UsageRow[]; runs: RunRow[]; book: PriceBook; rules: Rules; config: Config;
  range: ResolvedRange; firstEpoch: number | null;
}
export type BuildOutput = Omit<AgentLedgerData, 'pricing' | 'generatedAt' | 'pluginVersion' | 'errors'> & { unmatched: Array<{ provider: string; model: string; tokens: number }> };

const iso = (ms: number) => new Date(ms).toISOString();
export function rangeMeta(r: ResolvedRange): RangeMeta {
  return { kind: r.kind, fromDate: r.fromDate, toDate: r.toDate, fromUtc: iso(r.fromUtc), toUtc: iso(r.toUtc), days: r.days, timezone: r.timezone, clamped: r.clamped, priorFromUtc: iso(r.prior.fromUtc), priorToUtc: iso(r.prior.toUtc) };
}

export function buildOrg(inp: BuildInput): BuildOutput {
  const unmatched = new Map<string, { provider: string; model: string; tokens: number }>();
  const cur = accumulate(inp.usage, inp.book, unmatched);
  const prior = accumulate(inp.priorUsage, inp.book, new Map());
  const runsBy = new Map(inp.runs.map((r) => [r.agent_id, r]));
  const withRuns = (id: string, base: Sums): Sums => {
    const r = runsBy.get(id);
    return r ? { ...base, runsTotal: n(r.runs_total), runsFailed: n(r.runs_failed), runsWithUsage: n(r.runs_with_usage) } : base;
  };
  const inclusive = new Set(inp.config.inclusiveInputProviders);
  const assumed = new Set<string>();
  for (const a of cur.values()) for (const p of a.providers) if (!inclusive.has(p) && p !== 'anthropic') assumed.add(p);

  const nodes: Record<string, OrgNode> = {};
  const live = inp.agents.filter((a) => a.status !== 'terminated');
  const liveIds = new Set(live.map((a) => a.agent_id));
  const tiersConfigured = inp.rules.tierModels.length > 0;
  for (const a of live) {
    const acc = cur.get(a.agent_id);
    const own = withRuns(a.agent_id, acc?.sums ?? zeroSums());
    const tokens = own.tokens;
    const actualModels: ActualModel[] = acc ? [...acc.models.values()].map((m) => {
      const mk = modelKey(inp.book.resolveKeys(m.provider, m.model).model);
      return { provider: m.provider, model: m.model, modelKey: mk, billingType: m.billing, tokens: m.tokens, runs: m.runs, share: tokens ? m.tokens / tokens : 0,
        lastAt: iso(m.lastHour * HOUR), matchesConfigured: false, costMicro: m.cost, priced: m.priced, free: m.free, priceSource: m.source };
    }).sort((x, y) => y.tokens - x.tokens) : [];
    const cfgKey = a.configured_model ? modelKey(inp.book.resolveKeys('', a.configured_model).model) : null;
    for (const m of actualModels) m.matchesConfigured = !!cfgKey && m.modelKey === cfgKey;
    const priorAcc = prior.get(a.agent_id)?.sums ?? zeroSums();
    nodes[a.agent_id] = {
      agentId: a.agent_id, name: a.name, role: a.role, title: a.title, status: a.status, reportsTo: a.reports_to && liveIds.has(a.reports_to) ? a.reports_to : a.reports_to, depth: 0, children: [],
      adapterType: a.adapter_type, configuredModel: a.configured_model, configuredModelKey: cfgKey, engine: a.engine,
      lastHeartbeatAt: a.last_heartbeat_at ? new Date(a.last_heartbeat_at as string).toISOString() : null,
      providersInRange: acc ? [...acc.providers].sort() : [], actualModels, own, subtree: own, prior: { own: priorAcc, subtree: priorAcc }, flags: [],
      tier: tiersConfigured ? { configured: tierOf(cfgKey, inp.rules), expected: expectedTier({ role: a.role, title: a.title }, inp.rules) } : null,
    };
  }
  const { roots, unattached } = buildTree(nodes);

  // Everything that is not a live agent (terminated agents, ids with no agent row) rolls up into one row.
  const termAgents = inp.agents.filter((a) => a.status === 'terminated');
  const names = new Map(inp.agents.map((a) => [a.agent_id, a.name]));
  let termOwn = zeroSums(), termPrior = zeroSums();
  const termList: Array<{ agentId: string; name: string; tokens: number; runs: number; costMicro: number }> = [];
  for (const [id, a] of cur) {
    if (liveIds.has(id)) continue;
    termOwn = addSums(termOwn, a.sums);
    termList.push({ agentId: id, name: names.get(id) ?? 'Unknown agent', tokens: a.sums.tokens, runs: a.sums.runs, costMicro: a.sums.costMicro });
  }
  for (const [id, a] of prior) if (!liveIds.has(id)) termPrior = addSums(termPrior, a.sums);
  termList.sort((x, y) => y.tokens - x.tokens);
  for (const a of termAgents) { const r = runsBy.get(a.agent_id); if (r) termOwn = { ...termOwn, runsTotal: termOwn.runsTotal + n(r.runs_total), runsFailed: termOwn.runsFailed + n(r.runs_failed), runsWithUsage: termOwn.runsWithUsage + n(r.runs_with_usage) }; }

  const byModel = new Map<string, ModelTotal>();
  for (const acc of cur.values()) for (const m of acc.models.values()) {
    const k = `${m.provider}|${m.model}`;
    const t = byModel.get(k) ?? { provider: m.provider, model: m.model, tokens: 0, runs: 0, share: 0, costMicro: 0, priced: false, free: false, agents: 0 };
    t.tokens += m.tokens; t.runs += m.runs; t.costMicro += m.cost; t.priced = t.priced || m.priced; t.free = t.free || m.free; t.agents += 1;
    byModel.set(k, t);
  }
  const grand = [...byModel.values()].reduce((x, m) => x + m.tokens, 0);
  const modelTotals = [...byModel.values()].map((m) => ({ ...m, share: grand ? m.tokens / grand : 0 })).sort((x, y) => y.tokens - x.tokens);

  const totals = sumRoots(nodes, roots, unattached, [termOwn]);
  const priorTotals = sumRoots(Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, { ...v, subtree: v.prior!.subtree }])) as Record<string, OrgNode>, roots, unattached, [termPrior]);
  const med = median(Object.values(nodes).filter((x) => x.own.runs >= inp.config.lowDataRunThreshold).map((x) => x.own.tokens));
  const cfg = { heavyShare: inp.config.heavyShareThreshold, lowDataRuns: inp.config.lowDataRunThreshold };
  for (const node of Object.values(nodes)) node.flags = flagsFor(node, totals, cfg, inp.rules, med);

  return {
    range: rangeMeta(inp.range), roots, nodes, unattached,
    terminated: { count: termAgents.length, withUsage: termList.length, own: termOwn, prior: termPrior, agents: termList.slice(0, 200) },
    totals, modelTotals, priorTotals, coverage: { firstEventAt: inp.firstEpoch ? iso(inp.firstEpoch * 1000) : null, providersAssumedExclusive: [...assumed].sort() },
    tiersConfigured, thresholds: cfg.heavyShare !== undefined ? { heavyShare: cfg.heavyShare, lowDataRuns: cfg.lowDataRuns } : { heavyShare: 15, lowDataRuns: 10 },
    unmatched: [...unmatched.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 50),
  };
}

export interface Env { db: Db; config: Config; now: () => number; cache: Cache; pluginVersion: string }

export async function getPricingStatus(db: Db, config: Config, nowMs: number, unmatched: PricingStatus['unmatchedModels']): Promise<PricingStatus> {
  const sources = await db.query<Record<string, unknown>>(RECENT_COLLECTIONS_SQL);
  const [lastOk] = await db.query<{ at: string | null }>(LAST_OK_SQL);
  const held = await db.query(HELD_SQL);
  const asOf = lastOk?.at ? new Date(lastOk.at).toISOString() : null;
  const bySrc = new Map(sources.map((r) => [String(r.source), r]));
  return {
    asOf, stale: config.priceSources.length > 0 && (!asOf || nowMs - Date.parse(asOf) > config.priceStaleAfterDays * 86_400_000),
    snapshotOnly: !asOf, snapshotDate: snapshotMeta.date, heldChanges: held.length, refreshing: false,
    sources: SOURCES.map((s) => {
      const r = bySrc.get(s.key);
      return { key: s.key, label: s.label, status: !config.priceSources.includes(s.key) ? 'disabled' : r ? String(r.status) : 'never run', at: r?.finished_at ? new Date(r.finished_at as string).toISOString() : null, detail: r?.finding ? String(r.finding) : null };
    }),
    unmatchedModels: unmatched, currency: 'USD',
  };
}

export async function getAgentLedger(env: Env, companyIdRaw: unknown, rangeRaw: unknown): Promise<AgentLedgerData> {
  const companyId = requireCompany(companyIdRaw);
  const input = parseRange(rangeRaw);
  let range: ResolvedRange;
  try { range = resolveRange(input, env.now(), env.config.timezone); } catch (e) { if (e instanceof RangeError) throw new BadRequest(e.message); throw e; }
  const key = [companyId, range.kind, range.fromUtc, range.toUtc, env.config.timezone, env.config.inclusiveInputProviders.join(',')].join('|');
  return env.cache.get(key, env.now(), async () => {
    const errors: Record<string, string> = {};
    const guard = async <T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { errors[label] = e instanceof Error ? e.message : String(e); return fallback; } };
    const q = (x: { sql: string; params: unknown[] }) => env.db.query<any>(x.sql, x.params);
    const fromIso = iso(range.fromUtc), toIso = iso(range.toUtc);
    const [agents, usage, priorUsage, runs, first, versions, ruleRows] = await Promise.all([
      guard('agents', [] as AgentRow[], () => q(agentsQuery(companyId))),
      guard('usage', [] as UsageRow[], () => q(usageQuery(companyId, fromIso, toIso, env.config.inclusiveInputProviders))),
      guard('priorUsage', [] as UsageRow[], () => q(usageQuery(companyId, iso(range.prior.fromUtc), iso(range.prior.toUtc), env.config.inclusiveInputProviders))),
      guard('runs', [] as RunRow[], () => q(runsQuery(companyId, fromIso, toIso))),
      guard('history', [] as Array<{ first_epoch: unknown }>, () => q(historyStartQuery(companyId))),
      guard('prices', [], () => loadVersions(env.db)),
      guard('rules', [], () => loadRuleRows(env.db, companyId)),
    ]);
    const rules = foldRules(ruleRows);
    const book = new PriceBook({ versions, overrides: rules.overrides, modelAliases: rules.modelAliases, providerAliases: rules.providerAliases, freeProviders: rules.freeProviders });
    const built = buildOrg({ agents, usage, priorUsage, runs, book, rules, config: env.config, range, firstEpoch: first[0]?.first_epoch ? Number(first[0].first_epoch) : null });
    const { unmatched, ...rest } = built;
    const pricing = await guard('pricing', null, () => getPricingStatus(env.db, env.config, env.now(), unmatched));
    return { generatedAt: iso(env.now()), pluginVersion: env.pluginVersion, ...rest, pricing: pricing ?? { asOf: null, stale: true, snapshotOnly: true, snapshotDate: snapshotMeta.date, heldChanges: 0, refreshing: false, sources: [], unmatchedModels: unmatched, currency: 'USD' }, errors };
  });
}

/** Daily (or hourly) usage of one agent, split by model, for the detail dialog. */
export async function getAgentDetail(env: Env, companyIdRaw: unknown, agentIdRaw: unknown, rangeRaw: unknown): Promise<AgentDetailData> {
  const companyId = requireCompany(companyIdRaw);
  if (typeof agentIdRaw !== 'string' || !UUID.test(agentIdRaw)) throw new BadRequest('Unknown agent');
  const agentId = agentIdRaw;
  const input = parseRange(rangeRaw);
  let range: ResolvedRange;
  try { range = resolveRange(input, env.now(), env.config.timezone); } catch (e) { if (e instanceof RangeError) throw new BadRequest(e.message); throw e; }
  const key = ['detail', agentId, companyId, range.kind, range.fromUtc, range.toUtc, env.config.timezone, env.config.inclusiveInputProviders.join(',')].join('|');
  return env.cache.get(key, env.now(), async () => {
    const q = (x: { sql: string; params: unknown[] }) => env.db.query<any>(x.sql, x.params);
    const inc = env.config.inclusiveInputProviders;
    const [usage, priorUsage, runs, versions, ruleRows] = await Promise.all([
      q(usageQuery(companyId, iso(range.fromUtc), iso(range.toUtc), inc, agentId)) as Promise<UsageRow[]>,
      q(usageQuery(companyId, iso(range.prior.fromUtc), iso(range.prior.toUtc), inc, agentId)) as Promise<UsageRow[]>,
      q(runsQuery(companyId, iso(range.fromUtc), iso(range.toUtc))) as Promise<RunRow[]>,
      loadVersions(env.db), loadRuleRows(env.db, companyId),
    ]);
    const rules = foldRules(ruleRows);
    const book = new PriceBook({ versions, overrides: rules.overrides, modelAliases: rules.modelAliases, providerAliases: rules.providerAliases, freeProviders: rules.freeProviders });
    const sink = new Map<string, { provider: string; model: string; tokens: number }>();
    const whole = accumulate(usage, book, sink).get(agentId);
    const priorSums = accumulate(priorUsage, book, new Map()).get(agentId)?.sums ?? zeroSums();
    // Put each hourly row in its bucket (a day, or an hour for today and yesterday) and price it there.
    const slot = (hourStart: number): number => { let lo = 0, hi = range.buckets.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; const b = range.buckets[mid]!; if (hourStart < b.startUtc) hi = mid - 1; else if (hourStart >= b.endUtc) lo = mid + 1; else return mid; } return -1; };
    const rowsBy: UsageRow[][] = range.buckets.map(() => []);
    for (const r of usage) { const i = slot(n(r.hour) * HOUR); if (i >= 0) rowsBy[i]!.push(r); }
    const buckets: DetailBucket[] = range.buckets.map((b, i) => {
      const acc = accumulate(rowsBy[i]!, book, new Map()).get(agentId);
      const byModel: DetailBucket['byModel'] = {};
      if (acc) for (const [k, m] of acc.models) byModel[k] = { tokens: m.tokens, costMicro: m.cost };
      const s = acc?.sums ?? zeroSums();
      return { key: b.key, label: b.label, tokens: s.tokens, input: s.input, cached: s.cached, output: s.output, costMicro: s.costMicro, runs: s.runs, byModel };
    });
    const total = whole?.sums.tokens ?? 0;
    const models = whole ? [...whole.models.values()].map((m) => ({ provider: m.provider, model: m.model, tokens: m.tokens, runs: m.runs, share: total ? m.tokens / total : 0, costMicro: m.cost, priced: m.priced, free: m.free, lastAt: iso(m.lastHour * HOUR),
      firstAt: iso(Math.min(...usage.filter((r) => r.provider === m.provider && r.model === m.model).map((r) => n(r.hour))) * HOUR) })).sort((x, y) => y.tokens - x.tokens) : [];
    const sums = { ...(whole?.sums ?? zeroSums()) };
    const rr = runs.find((r) => r.agent_id === agentId);
    if (rr) { sums.runsTotal = n(rr.runs_total); sums.runsFailed = n(rr.runs_failed); sums.runsWithUsage = n(rr.runs_with_usage); }
    return { agentId, range: rangeMeta(range), granularity: range.granularity, timezone: range.timezone, buckets, models, sums, prior: priorSums };
  });
}
