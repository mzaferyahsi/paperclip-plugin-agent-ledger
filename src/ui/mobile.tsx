// Phone layout: a compact list instead of the wide table, so a name and its numbers are always on screen together.
import { useHostNavigation } from '@paperclipai/plugin-sdk/ui';
import { useEffect, useState } from 'react';
import type { AgentLedgerData, OrgNode } from '../types.ts';
import { FLAG_HELP } from './flaghelp.ts';
import { ACTIVITY_FILTERS, isOpen, ACTIVITY_LABEL, activityOf, fmtAgo, isDisabled, isRunnable, fmtCost, fmtTokens, modelBreakdownTip, sumsFor, type Filters, type Mode, type Row, type TableState } from './model.ts';

export function useNarrow(maxPx = 720): boolean {
  const query = `(max-width: ${maxPx}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    on(); m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

export const mobileCss = `
.ou .m-bar{display:grid;gap:8px}
.ou .m-bar select,.ou .m-bar input[type=search],.ou .m-bar input[type=date]{width:100%;min-height:40px;font-size:15px}
.ou .m-two{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center}
.ou .m-bar .seg{display:flex}.ou .m-bar .seg button{flex:1;min-height:40px}
.ou .m-bar .btn{min-height:40px}
.ou a.alink{display:inline-flex;align-items:center;min-height:44px;font-weight:600;color:var(--foreground);text-decoration:underline;text-underline-offset:3px}
.ou .m-filters{display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:8px}
.ou .m-filters label.f{display:grid;gap:4px}
.ou .m-filters label.chk{display:flex;align-items:center;gap:8px;min-height:32px;font-size:14px;color:var(--foreground)}
.ou .mlist{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.ou .mrow{border-bottom:1px solid var(--border)}.ou .mrow:last-child{border-bottom:0}
.ou .mhead{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:start;column-gap:4px;padding:6px 10px 6px 4px}
.ou .mchev{width:36px;height:36px;border:0;background:none;color:var(--foreground);font-size:11px;cursor:pointer;border-radius:6px}
.ou .mchev.e{visibility:hidden}
.ou .mmain{text-align:left;background:none;border:0;color:inherit;min-width:0;padding:6px 2px;cursor:pointer;display:grid;gap:2px;font-size:14px}
.ou .mname{font-weight:600;overflow-wrap:anywhere}
.ou .msub{color:var(--muted-foreground);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou .mflags{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.ou .mflags .flag{cursor:default;margin:0}
.ou .mnum{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:grid;padding-top:6px;font-variant-numeric:tabular-nums}
.ou .mnum b{font-size:14px;font-weight:600}.ou .mnum span{font-size:11px;color:var(--muted-foreground)}
.ou .mdet{display:grid;gap:12px;padding:6px 12px 14px 44px;background:color-mix(in srgb,var(--muted) 55%,var(--background));font-size:13px}
.ou .mdet h3{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground);font-weight:500}
.ou .mdet dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0}
.ou .mdet dt{color:var(--muted-foreground)}.ou .mdet dd{margin:0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.ou .mdet ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.ou .mdet li .dim{display:block;font-size:12px}
.ou .msum{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px}
.ou .msum p{grid-column:1/-1;margin:0;color:var(--muted-foreground);font-size:11.5px}
.ou .msum b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500;font-size:16px;display:block}
.ou .msum span{color:var(--muted-foreground);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
`;

const SORTS: Array<[string, string, TableState['sort']]> = [
  ['hier', 'Organisation order', null], ['tokens', 'Most tokens', { key: 'tokens', dir: -1 }], ['cost', 'Highest cost', { key: 'cost', dir: -1 }],
  ['runs', 'Most runs', { key: 'runs', dir: -1 }], ['name', 'Name A to Z', { key: 'name', dir: 1 }],
];
const PRESETS: Array<[string, string]> = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['14d', 'Last 14 days'], ['30d', 'Last 30 days'], ['custom', 'Custom dates…']];

export interface MobileControlsProps {
  range: string | { from: string; to: string }; setRange: (r: string | { from: string; to: string }) => void;
  custom: { from: string; to: string }; setCustom: (c: { from: string; to: string }) => void;
  mode: Mode; setMode: (m: Mode) => void; filters: Filters; setFilters: (f: Filters) => void;
  sort: TableState['sort']; setSort: (s: TableState['sort']) => void;
  adapters: string[]; models: string[]; tiers: string[]; onExpandAll: () => void; onCollapse: () => void; onCsv: () => void;
}

export function MobileControls(p: MobileControlsProps) {
  const [open, setOpen] = useState(false);
  const [pickCustom, setPickCustom] = useState(typeof p.range === 'object');
  const rangeValue = pickCustom || typeof p.range === 'object' ? 'custom' : p.range;
  const sortValue = SORTS.find(([, , s]) => (s === null ? p.sort === null : p.sort?.key === s.key && p.sort.dir === s.dir))?.[0] ?? 'hier';
  const active = [p.filters.activity, p.filters.adapter, p.filters.model, p.filters.tier, p.filters.flagsOnly, p.filters.q].filter(Boolean).length;
  return <div className="m-bar">
    <div className="m-two">
      <select aria-label="Time range" value={rangeValue} onChange={(e) => { if (e.target.value === 'custom') setPickCustom(true); else { setPickCustom(false); p.setRange(e.target.value); } }}>
        {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>Filters{active ? ` (${active})` : ''} {open ? '▴' : '▾'}</button>
    </div>
    {rangeValue === 'custom' && <div className="m-two">
      <label className="f">From <input type="date" value={p.custom.from} onChange={(e) => p.setCustom({ ...p.custom, from: e.target.value })} /></label>
      <label className="f">To <input type="date" value={p.custom.to} onChange={(e) => p.setCustom({ ...p.custom, to: e.target.value })} /></label>
      <button type="button" className="btn" disabled={!p.custom.from || !p.custom.to} onClick={() => p.setRange({ from: p.custom.from, to: p.custom.to })}>Apply dates</button></div>}
    <div className="seg" role="group" aria-label="Totals shown">{(['own', 'sub', 'both'] as const).map((m) =>
      <button key={m} type="button" aria-pressed={p.mode === m} onClick={() => p.setMode(m)}>{m === 'own' ? 'Own' : m === 'sub' ? 'Subtree' : 'Both'}</button>)}</div>
    {open && <div className="m-filters">
      <label className="f">Sort by <select value={sortValue} onChange={(e) => p.setSort(SORTS.find(([v]) => v === e.target.value)?.[2] ?? null)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="f">Search <input type="search" value={p.filters.q} placeholder="agent name" onChange={(e) => p.setFilters({ ...p.filters, q: e.target.value })} /></label>
      <label className="f">Activity <select value={p.filters.activity} onChange={(e) => p.setFilters({ ...p.filters, activity: e.target.value })}><option value="">all</option>{ACTIVITY_FILTERS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
      <label className="f">Adapter <select value={p.filters.adapter} onChange={(e) => p.setFilters({ ...p.filters, adapter: e.target.value })}><option value="">all</option>{p.adapters.map((a) => <option key={a}>{a}</option>)}</select></label>
      <label className="f">Model <select value={p.filters.model} onChange={(e) => p.setFilters({ ...p.filters, model: e.target.value })}><option value="">all</option>{p.models.map((a) => <option key={a}>{a}</option>)}</select></label>
      {p.tiers.length > 0 && <label className="f">Tier <select value={p.filters.tier} onChange={(e) => p.setFilters({ ...p.filters, tier: e.target.value })}><option value="">all</option>{p.tiers.map((a) => <option key={a}>{a}</option>)}</select></label>}
      <label className="chk"><input type="checkbox" checked={p.filters.flagsOnly} onChange={(e) => p.setFilters({ ...p.filters, flagsOnly: e.target.checked })} />Only agents with flags</label>
      <div className="m-two"><button type="button" className="btn" onClick={p.onExpandAll}>Expand all</button><button type="button" className="btn" onClick={p.onCollapse}>Collapse to level 2</button></div>
      <button type="button" className="btn" onClick={p.onCsv}>Copy as CSV</button>
    </div>}
  </div>;
}

export function MobileSummary({ data, delta }: { data: AgentLedgerData; delta: number | null }) {
  return <div className="msum">
    <div title={modelBreakdownTip(data, 'tokens')}><b>{fmtTokens(data.totals.tokens)}</b><span>Tokens</span></div>
    <div title={modelBreakdownTip(data, 'cost')}><b>{fmtCost(data.totals).text}</b><span>Cost est.</span></div>
    <div><b>{Math.round(data.totals.runs).toLocaleString('en-US')}</b><span>Runs</span></div>
    <p>{Object.keys(data.nodes).length} live agents · {data.terminated.count} terminated · {data.range.fromDate} to {data.range.toDate}{delta !== null ? ` · ${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs prior period` : ''}</p>
  </div>;
}

function Detail({ n, data, onRun, onChange, onDetails }: { onDetails: () => void; n: OrgNode; data: AgentLedgerData; onRun: (() => void) | null; onChange: (() => void) | null }) {
  const mgr = n.children.length > 0;
  const own = n.own, sub = n.subtree;
  const cost = (s: typeof own) => fmtCost(s).text;
  const nav = useHostNavigation();
  return <div className="mdet">
    {(onRun || onChange) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{onRun && <button type="button" className="btn" onClick={onRun}>Run {n.name} now</button>}{onChange && <button type="button" className="btn" onClick={onChange}>Change model</button>}</div>}
    <div><h3>Usage</h3><dl>
      <dt>{mgr ? 'Tokens (own)' : 'Tokens'}</dt><dd>{fmtTokens(own.tokens)}</dd>
      {mgr && <><dt>Tokens (with reports)</dt><dd>{fmtTokens(sub.tokens)}</dd></>}
      <dt>{mgr ? 'Cost est. (own)' : 'Cost est.'}</dt><dd>{cost(own)}</dd>
      {mgr && <><dt>Cost est. (with reports)</dt><dd>{cost(sub)}</dd></>}
      <dt>Input / cached / output</dt><dd>{fmtTokens(own.input)} / {fmtTokens(own.cached)} / {fmtTokens(own.output)}</dd>
      <dt>Runs</dt><dd>{Math.round(own.runs).toLocaleString('en-US')}</dd></dl></div>
    <div><h3>Agent</h3><p><button type="button" className="btn" onClick={onDetails}>Details and graphs ›</button> <a className="alink" {...nav.linkProps(`/agents/${n.agentId}/configuration`)}>Open agent settings ›</a></p><dl>
      <dt>Status</dt><dd>{n.status}</dd><dt>Activity</dt><dd>{ACTIVITY_LABEL[activityOf(n)]}, last heartbeat {fmtAgo(n.lastHeartbeatAt)}</dd><dt>Adapter</dt><dd>{n.adapterType}</dd>
      <dt>Reports to</dt><dd>{n.reportsTo ? data.nodes[n.reportsTo]?.name ?? 'terminated agent' : '—'}</dd>
      <dt>Configured model</dt><dd>{n.configuredModel ?? 'none'}</dd>
      {n.tier?.configured && <><dt>Tier</dt><dd>{n.tier.configured}</dd></>}</dl></div>
    <div><h3>Models used in this range</h3>{n.actualModels.length === 0 ? <span className="dim">No usage</span> :
      <ul>{n.actualModels.map((m) => <li key={m.provider + m.model}><span className="mo">{m.model}</span> · {Math.round(m.share * 100)}% of tokens{m.priced ? ` · ${fmtCost({ ...own, costMicro: m.costMicro, pricedTokens: 1, unpricedTokens: 0 }).text}` : m.free ? ' · free' : ' · no price'}</li>)}</ul>}</div>
    {n.flags.length > 0 && <div><h3>Flags</h3><ul>{n.flags.map((f) => <li key={f.code}><span className={`flag ${f.severity}`}>{FLAG_HELP[f.code]?.label ?? f.code}</span>
      <span className="dim">{FLAG_HELP[f.code]?.meaning}</span><span className="dim">This agent: {f.detail}</span></li>)}</ul></div>}
  </div>;
}

export function MobileList({ data, rows, st, flat, toggleTree, canRun, onRun, onChange, onDetails }: { onDetails: (n: OrgNode) => void; data: AgentLedgerData; rows: Row[]; st: TableState; flat: boolean; toggleTree: (id: string) => void; canRun: boolean; onRun: (n: OrgNode) => void; onChange: (n: OrgNode) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const flip = (id: string) => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  if (rows.length === 0) return <p className="dim">{Object.keys(data.nodes).length === 0 ? 'No agents found for this company.' : 'No agents match the filters.'}</p>;
  return <ul className="mlist">
    {rows.map((r, i) => {
      if (r.kind === 'group') return <li key={`g${i}`} className="mrow"><div className="mdet" style={{ paddingLeft: 12 }}><h3>{r.label}</h3></div></li>;
      if (r.kind === 'terminated') return <li key="term" className="mrow"><div className="mhead"><span /><div className="mmain" style={{ cursor: 'default' }}><span className="mname">Terminated agents ({data.terminated.count})</span><span className="msub">{data.terminated.withUsage} with usage</span></div>
        <span className="mnum"><b>{fmtTokens(data.terminated.own.tokens)}</b><span>{fmtCost(data.terminated.own).text}</span></span></div></li>;
      const n = r.node, mgr = n.children.length > 0, s = sumsFor(n, st.mode), c = fmtCost(s), detailOpen = open.has(n.agentId);
      const model = n.configuredModel ?? n.actualModels[0]?.model ?? 'no model';
      return <li key={n.agentId} className="mrow">
        <div className="mhead" style={{ paddingLeft: 4 + (flat ? 0 : Math.min(r.depth, 5) * 10) }}>
          {mgr && !flat ? <button type="button" className="mchev" aria-expanded={isOpen(st, n.agentId)} aria-label={`${isOpen(st, n.agentId) ? 'Collapse' : 'Expand'} ${n.name}`} onClick={() => toggleTree(n.agentId)}>{isOpen(st, n.agentId) ? '▼' : '▶'}</button> : <span className="mchev e" />}
          <button type="button" className="mmain" aria-expanded={detailOpen} onClick={() => flip(n.agentId)}>
            <span className={`mname${isDisabled(n) ? ' off' : ''}`}>{n.name}</span>
            <span className="msub">{n.title ?? n.role} · {model}</span>
            {n.flags.length > 0 && <span className="mflags">{n.flags.map((f) => <span key={f.code} className={`flag ${f.severity}`}>{FLAG_HELP[f.code]?.label ?? f.code}</span>)}</span>}
          </button>
          <span className="mnum"><b>{fmtTokens(s.tokens)}</b><span>{c.text}</span></span>
        </div>
        {detailOpen && <Detail n={n} data={data} onDetails={() => onDetails(n)} onRun={canRun && isRunnable(n) ? () => onRun(n) : null} onChange={canRun && n.status !== 'running' ? () => onChange(n) : null} />}
      </li>;
    })}
  </ul>;
}
