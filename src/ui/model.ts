// Table logic with no React, so it is unit-tested directly.
import type { OrgNode, AgentLedgerData, Sums } from '../types.ts';

export type Mode = 'own' | 'sub' | 'both';
export type ColumnKey = 'name' | 'role' | 'activity' | 'status' | 'parent' | 'depth' | 'adapter' | 'model' | 'tier' | 'input' | 'cached' | 'output' | 'tokens' | 'cost' | 'runs' | 'flags';
export interface Filters { activity: string; adapter: string; model: string; tier: string; flagsOnly: boolean; q: string }
export interface TableState { expanded: Set<string>; mode: Mode; sort: { key: ColumnKey; dir: 1 | -1 } | null; filters: Filters }
export type Row =
  | { kind: 'node'; node: OrgNode; depth: number; filteredManager: boolean }
  | { kind: 'group'; label: string }
  | { kind: 'terminated' };

export const COLUMNS: Array<{ key: ColumnKey; label: string; numeric: boolean; defaultOn: boolean }> = [
  { key: 'name', label: 'Name', numeric: false, defaultOn: true }, { key: 'role', label: 'Role', numeric: false, defaultOn: true },
  { key: 'activity', label: 'Activity', numeric: false, defaultOn: true }, { key: 'status', label: 'Status', numeric: false, defaultOn: false }, { key: 'parent', label: 'Reports to', numeric: false, defaultOn: false },
  { key: 'depth', label: 'D', numeric: true, defaultOn: false }, { key: 'adapter', label: 'Adapter', numeric: false, defaultOn: true },
  { key: 'model', label: 'Model', numeric: false, defaultOn: true }, { key: 'tier', label: 'Tier', numeric: false, defaultOn: true },
  { key: 'tokens', label: 'Total', numeric: true, defaultOn: true }, { key: 'cost', label: 'Cost est.', numeric: true, defaultOn: true },
  { key: 'runs', label: 'Runs', numeric: true, defaultOn: true }, { key: 'input', label: 'In', numeric: true, defaultOn: true },
  { key: 'cached', label: 'Cached', numeric: true, defaultOn: true }, { key: 'output', label: 'Out', numeric: true, defaultOn: true },
  { key: 'flags', label: 'Flags', numeric: false, defaultOn: true },
];

export type Activity = 'running' | 'active' | 'quiet' | 'paused' | 'error';
export const ACTIVITY_LABEL: Record<Activity, string> = { running: 'Running now', active: 'Active', quiet: 'No runs', paused: 'Paused', error: 'Error' };
export const ACTIVITY_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'live', label: 'Running or active' }, { value: 'running', label: 'Running now' }, { value: 'active', label: 'Active in range' },
  { value: 'quiet', label: 'No runs in range' }, { value: 'paused', label: 'Paused (disabled)' }, { value: 'error', label: 'Error' }];
const ACTIVITY_RANK: Record<Activity, number> = { running: 0, active: 1, quiet: 2, paused: 3, error: 4 };
export function activityOf(n: OrgNode): Activity {
  if (n.status === 'paused' || n.status === 'pending_approval') return 'paused';
  if (n.status === 'error') return 'error';
  if (n.status === 'running') return 'running';
  return n.own.runsTotal > 0 ? 'active' : 'quiet';
}
export const isDisabled = (n: OrgNode) => activityOf(n) === 'paused';
export function fmtAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now'; if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`; return `${Math.round(s / 86400)}d ago`;
}

export const sumsFor = (n: OrgNode, mode: Mode): Sums => (mode === 'own' || n.children.length === 0 ? n.own : n.subtree);

export function sortValue(n: OrgNode, key: ColumnKey, mode: Mode, data: AgentLedgerData): number | string {
  const s = sumsFor(n, mode);
  switch (key) {
    case 'name': return n.name.toLowerCase();
    case 'role': return (n.title ?? n.role).toLowerCase();
    case 'activity': return ACTIVITY_RANK[activityOf(n)];
    case 'status': return n.status;
    case 'parent': return n.reportsTo ? (data.nodes[n.reportsTo]?.name ?? '').toLowerCase() : '';
    case 'depth': return n.depth;
    case 'adapter': return n.adapterType;
    case 'model': return (n.configuredModel ?? '').toLowerCase();
    case 'tier': return n.tier?.configured ?? '';
    case 'input': return s.input; case 'cached': return s.cached; case 'output': return s.output; case 'tokens': return s.tokens;
    case 'cost': return s.pricedTokens > 0 ? s.costMicro : -1; case 'runs': return s.runs;
    case 'flags': return n.flags.length;
  }
}

export function matches(n: OrgNode, f: Filters): boolean {
  if (f.activity) { const a = activityOf(n); if (f.activity === 'live' ? a !== 'running' && a !== 'active' : a !== f.activity) return false; }
  if (f.adapter && n.adapterType !== f.adapter) return false;
  if (f.model && n.configuredModel !== f.model && !n.actualModels.some((m) => m.model === f.model)) return false;
  if (f.tier && n.tier?.configured !== f.tier) return false;
  if (f.flagsOnly && n.flags.length === 0) return false;
  if (f.q && !n.name.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}
export const isFiltering = (f: Filters) => !!(f.activity || f.adapter || f.model || f.tier || f.flagsOnly || f.q);

/** A manager is open when the user expanded it, or when any filter is on (so the org structure above every match stays visible). */
export const isOpen = (st: TableState, id: string) => st.expanded.has(id) || isFiltering(st.filters);

export function visibleRows(data: AgentLedgerData, st: TableState): Row[] {
  const rows: Row[] = [];
  const all = Object.values(data.nodes);
  const filtering = isFiltering(st.filters);
  if (st.sort) {
    const { key, dir } = st.sort;
    const sorted = all.filter((n) => matches(n, st.filters)).sort((a, b) => {
      const x = sortValue(a, key, st.mode, data), y = sortValue(b, key, st.mode, data);
      return (x > y ? 1 : x < y ? -1 : a.name.localeCompare(b.name)) * dir;
    });
    for (const node of sorted) rows.push({ kind: 'node', node, depth: 0, filteredManager: false });
    if (!filtering && data.terminated.count > 0) rows.push({ kind: 'terminated' });
    return rows;
  }
  const hasMatch = (id: string): boolean => matches(data.nodes[id]!, st.filters) || data.nodes[id]!.children.some(hasMatch);
  const walk = (id: string, depth: number) => {
    const n = data.nodes[id]!;
    if (filtering && !hasMatch(id)) return;
    rows.push({ kind: 'node', node: n, depth, filteredManager: filtering && !matches(n, st.filters) });
    if (isOpen(st, id)) for (const c of n.children) walk(c, depth + 1);
  };
  for (const id of data.roots) walk(id, 0);
  if (data.unattached.length) {
    const vis = data.unattached.filter((id) => !filtering || hasMatch(id));
    if (vis.length) { rows.push({ kind: 'group', label: `Unattached (${vis.length}): manager missing or terminated` }); for (const id of vis) walk(id, 0); }
  }
  if (!filtering && data.terminated.count > 0) rows.push({ kind: 'terminated' });
  return rows;
}

export function expandedToLevel(data: AgentLedgerData, levels: number): Set<string> {
  return new Set(Object.values(data.nodes).filter((n) => n.depth < levels && n.children.length).map((n) => n.agentId));
}

// Formatting
export function fmtTokens(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e8) return `${Math.round(v / 1e6)}M`;
  if (v >= 1e7) return `${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}
export function fmtUsd(micro: number): string {
  const usd = micro / 1e6;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 10) return `$${Math.round(usd)}`;
  if (usd >= 0.1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}
/** Cost cell text: "—" when nothing in the row could be priced (free or unknown), "≥" when part of it could not. */
export function fmtCost(s: Sums): { text: string; partial: boolean; none: boolean } {
  if (s.pricedTokens === 0) return { text: '—', partial: false, none: true };
  return { text: (s.unpricedTokens > 0 ? '≥ ' : '') + fmtUsd(s.costMicro), partial: s.unpricedTokens > 0, none: false };
}

export function toCsv(data: AgentLedgerData, rows: Row[], mode: Mode): string {
  const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['name', 'role', 'status', 'activity', 'last_heartbeat', 'reports_to', 'depth', 'adapter', 'configured_model', 'actual_models', 'input', 'cached', 'output', 'total', 'cost_usd_est', 'runs', 'flags'];
  const lines = [`# range ${data.range.fromDate}..${data.range.toDate} ${data.range.timezone}; cost is an API-equivalent estimate in USD; totals shown: ${mode}`, head.join(',')];
  for (const r of rows) {
    if (r.kind !== 'node') continue;
    const n = r.node, s = sumsFor(n, mode);
    lines.push([n.name, n.title ?? n.role, n.status, ACTIVITY_LABEL[activityOf(n)], n.lastHeartbeatAt ?? '', n.reportsTo ? data.nodes[n.reportsTo]?.name ?? '' : '', n.depth, n.adapterType, n.configuredModel ?? '',
      n.actualModels.map((m) => `${m.model} ${Math.round(m.share * 100)}%`).join('; '), s.input, s.cached, s.output, s.tokens,
      s.pricedTokens > 0 ? (s.costMicro / 1e6).toFixed(4) : '', s.runs, n.flags.map((f) => f.code).join(' ')].map(q).join(','));
  }
  return lines.join('\n');
}
