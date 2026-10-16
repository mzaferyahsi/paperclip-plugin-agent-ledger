import { useHostNavigation, usePluginData } from '@paperclipai/plugin-sdk/ui';
import type { PluginPageProps, PluginSidebarProps } from '@paperclipai/plugin-sdk/ui';
import { useMemo, useState } from 'react';
import type { OrgNode, AgentLedgerData } from '../types.ts';
import { COLUMNS, expandedToLevel, fmtCost, fmtTokens, sumsFor, toCsv, visibleRows, type ColumnKey, type Filters, type Mode, type Row, type TableState } from './model.ts';
import { AgentLedgerSettingsPage } from './settings.tsx';
import { FLAG_HELP } from './flaghelp.ts';
import { MobileControls, MobileList, MobileSummary, mobileCss, useNarrow } from './mobile.tsx';

export { AgentLedgerSettingsPage };
const PRESETS = ['today', 'yesterday', '7d', '14d', '30d'] as const;
const LABEL: Record<string, string> = { today: 'Today', yesterday: 'Yesterday', '7d': '7 days', '14d': '14 days', '30d': '30 days' };
const RANGE_TIP: Record<string, string> = { today: 'Usage since midnight today', yesterday: 'Usage during yesterday only', '7d': 'The last 7 days, including today', '14d': 'The last 14 days, including today', '30d': 'The last 30 days, including today' };
const COLUMN_TIP: Record<string, string> = { name: 'Click to sort by name', role: 'Click to sort by role', status: 'Click to sort by status', parent: 'Who the agent reports to', depth: 'Level in the organisation, 0 is the top',
  adapter: 'How the agent runs', model: 'The model the agent is configured with. Hover a row to see every model it used.', tier: 'Tier of the agent model, as you defined it in settings',
  tokens: 'Input, cached and output tokens together', cost: 'Estimated cost at public API list prices', runs: 'Runs with recorded usage', input: 'Input tokens, not counting cached tokens', cached: 'Input tokens served from the cache', output: 'Output tokens', flags: 'Things worth a look. Hover a flag for its meaning.' };
const MODE_TIP: Record<Mode, string> = { own: 'Each row shows only what that agent used itself', sub: 'Manager rows show their own usage plus everyone who reports to them', both: 'Manager rows show the subtree total, with their own usage underneath' };
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const css = mobileCss + `
.ou{display:grid;gap:12px;min-width:0;font-size:13px}
.ou *{box-sizing:border-box}
.ou button,.ou select,.ou input{font:inherit}
.ou .bar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
.ou .grp{display:inline-flex;align-items:center;gap:8px}
.ou .gl{color:var(--muted-foreground);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.ou .seg{display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden}
.ou .seg button{padding:5px 10px;border:0;border-right:1px solid var(--border);background:transparent;color:var(--muted-foreground);cursor:pointer}
.ou .seg button:last-child{border-right:0}
.ou .seg button[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground);font-weight:600}
.ou .btn{padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--foreground);cursor:pointer}
.ou .btn:hover,.ou .seg button:hover{background:var(--accent)}
.ou label.f{display:inline-flex;align-items:center;gap:6px;color:var(--muted-foreground);font-size:12px}
.ou select,.ou input[type=search],.ou input[type=date]{padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--foreground)}
.ou :focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.ou .sum{display:flex;flex-wrap:wrap;gap:6px 28px;padding:10px 14px;border:1px solid var(--border);border-radius:8px}
.ou .sum div{display:grid}
.ou .sum b{font-family:${mono};font-weight:500;font-size:17px;font-variant-numeric:tabular-nums}
.ou .sum span{color:var(--muted-foreground);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.ou .wrap{overflow:auto;border:1px solid var(--border);border-radius:8px;max-height:72vh}
.ou table{border-collapse:separate;border-spacing:0;width:100%;min-width:1000px}
.ou th,.ou td{padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap;text-align:left;vertical-align:middle}
.ou thead th{position:sticky;top:0;z-index:2;background:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground);cursor:pointer;user-select:none}
.ou thead th[aria-sort=ascending]::after{content:" ▲"}.ou thead th[aria-sort=descending]::after{content:" ▼"}
.ou .n{text-align:right;font-family:${mono};font-variant-numeric:tabular-nums}
.ou .nc{position:sticky;left:0;z-index:1;background:var(--background);border-right:1px solid var(--border);min-width:170px}
.ou thead .nc{z-index:3;background:var(--muted)}
.ou tr.m td{background:color-mix(in srgb,var(--muted) 55%,var(--background))}
.ou tr:hover td{background:var(--accent)!important}
.ou .chev{display:inline-block;width:20px;border:0;background:none;color:var(--foreground);cursor:pointer;padding:0;font-size:10px}
.ou .chev.e{visibility:hidden;cursor:default}
.ou .own{display:block;color:var(--muted-foreground);font-size:10.5px}
.ou .dim{color:var(--muted-foreground)}
.ou .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;background:var(--muted-foreground)}
.ou .dot.running{background:#16a34a}.ou .dot.paused{background:#d97706}.ou .dot.error{background:var(--destructive)}
.ou .mo{font-family:${mono};font-size:12px}
.ou .rc{display:inline-block;max-width:170px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;white-space:nowrap}
.ou .mc{display:inline-block;max-width:330px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}
.ou .flag{cursor:help;display:inline-block;font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:4px;margin-right:4px;border:1px solid var(--border)}
.ou .flag.crit{color:var(--destructive);border-color:var(--destructive)}.ou .flag.warn{color:#b45309;border-color:#b45309}
.ou .tb{height:3px;background:var(--muted-foreground);opacity:.5;border-radius:2px;margin:3px 0 0 auto}
.ou .note{color:var(--muted-foreground);font-size:11.5px;display:flex;flex-wrap:wrap;gap:4px 18px}
.ou .badge{display:inline-block;padding:1px 8px;border-radius:999px;border:1px solid var(--border);font-size:11px}
.ou .badge.warn{color:#b45309;border-color:#b45309}
.ou .grp td{background:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground)}
`;

const initialFilters: Filters = { adapter: '', model: '', tier: '', flagsOnly: false, q: '' };

function loadCols(): Set<ColumnKey> {
  try { const raw = localStorage.getItem('agent-ledger.columns.v2'); if (raw) return new Set(JSON.parse(raw) as ColumnKey[]); } catch { /* storage unavailable */ }
  return new Set(COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));
}
function saveCols(s: Set<ColumnKey>) { try { localStorage.setItem('agent-ledger.columns.v2', JSON.stringify([...s])); } catch { /* storage unavailable */ } }

function Cell({ n, col, data, mode, maxTokens, depth, flat, open, toggle }: { n: OrgNode; col: ColumnKey; data: AgentLedgerData; mode: Mode; maxTokens: number; depth: number; flat: boolean; open: boolean; toggle: () => void }) {
  const mgr = n.children.length > 0;
  const num = (get: (s: typeof n.own) => number, fmt: (v: number) => string) => {
    const main = fmt(get(sumsFor(n, mode)));
    return <>{main}{mode === 'both' && mgr && <span className="own">own {fmt(get(n.own))}</span>}</>;
  };
  switch (col) {
    case 'name': return <span style={{ paddingLeft: flat ? 0 : depth * 18 }}>
      {!flat && mgr ? <button type="button" className="chev" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${n.name}`} onClick={toggle}>{open ? '▼' : '▶'}</button> : <span className="chev e">▶</span>}
      <strong>{n.name}</strong></span>;
    case 'role': return <span className="dim rc" title={n.title ?? n.role}>{n.title ?? n.role}</span>;
    case 'status': return <><span className={`dot ${n.status}`} />{n.status}</>;
    case 'parent': return n.reportsTo ? <>{data.nodes[n.reportsTo]?.name ?? <span className="dim">terminated</span>}</> : <span className="dim">—</span>;
    case 'depth': return <span className="mo">{n.depth}</span>;
    case 'adapter': return <span className="mo">{n.adapterType}</span>;
    case 'model': {
      const current = n.configuredModel ?? n.actualModels[0]?.model ?? null;
      const tip = [n.configuredModel ? `Configured: ${n.configuredModel}` : 'No model configured', n.actualModels.length ? 'Used in this range:' : 'No usage in this range',
        ...n.actualModels.map((m) => `  ${m.model}: ${Math.round(m.share * 100)}% of tokens`)].join('\n');
      return <span className="mo mc" title={tip}>{current ?? <span className="dim">none</span>}</span>;
    }
    case 'tier': return n.tier?.configured ? <span className="badge">{n.tier.configured}</span> : <span className="dim">—</span>;
    case 'input': return <span className="n">{num((s) => s.input, fmtTokens)}</span>;
    case 'cached': return <span className="n">{num((s) => s.cached, fmtTokens)}</span>;
    case 'output': return <span className="n">{num((s) => s.output, fmtTokens)}</span>;
    case 'tokens': { const t = sumsFor(n, mode).tokens; return <span className="n">{num((s) => s.tokens, fmtTokens)}<span className="tb" style={{ width: `${Math.max(2, (t / maxTokens) * 100)}%`, maxWidth: 90 }} /></span>; }
    case 'cost': {
      const c = fmtCost(sumsFor(n, mode));
      const title = c.none ? (sumsFor(n, mode).freeTokens > 0 ? 'Free or local provider' : sumsFor(n, mode).tokens > 0 ? 'No price for these models' : 'No usage') : c.partial ? 'Part of the tokens have no price' : 'API-equivalent estimate';
      return <span className="n" title={title}>{c.text}{mode === 'both' && mgr && <span className="own">own {fmtCost(n.own).text}</span>}</span>;
    }
    case 'runs': return <span className="n">{num((s) => s.runs, (v) => Math.round(v).toLocaleString('en-US'))}</span>;
    case 'flags': return <>{n.flags.map((f) => <FlagChip key={f.code} code={f.code} severity={f.severity} detail={f.detail} />)}</>;
  }
}


// Instant tooltip for a flag (native title text is slow to appear and easy to miss).
function FlagChip({ code, severity, detail }: { code: string; severity: string; detail: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const help = FLAG_HELP[code];
  const show = (el: HTMLElement) => { const r = el.getBoundingClientRect(); setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 340)), y: r.bottom + 6 }); };
  return <span className={`flag ${severity}`} tabIndex={0} role="note" aria-label={`${help?.label ?? code}: ${help?.meaning ?? ''} This agent: ${detail}`}
    onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setPos(null)} onFocus={(e) => show(e.currentTarget)} onBlur={() => setPos(null)}>
    {help?.label ?? code}
    {pos && <span role="tooltip" style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 100, width: 320, padding: '8px 10px', borderRadius: 6, background: 'var(--popover, var(--background))', color: 'var(--popover-foreground, var(--foreground))', border: '1px solid var(--border)', boxShadow: '0 4px 14px rgba(0,0,0,.25)', fontSize: 12, fontWeight: 400, lineHeight: 1.4, whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0, pointerEvents: 'none', textAlign: 'left' }}>
      {help?.meaning}<span style={{ display: 'block', marginTop: 6, color: 'var(--muted-foreground)' }}>This agent: {detail}</span></span>}
  </span>;
}

function PriceBadge({ data }: { data: AgentLedgerData }) {
  const p = data.pricing;
  if (p.snapshotOnly) return <span className="badge warn" title="No successful refresh yet">Prices: bundled snapshot of {p.snapshotDate}</span>;
  return <span className={`badge${p.stale ? ' warn' : ''}`} title={p.sources.map((s) => `${s.label}: ${s.status}`).join('\n')}>Prices as of {new Date(p.asOf!).toLocaleString()}{p.stale ? ' (stale)' : ''}</span>;
}

export function AgentLedgerPage({ context }: PluginPageProps) {
  const [range, setRange] = useState<string | { from: string; to: string }>('7d');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const result = usePluginData<AgentLedgerData>('agent-ledger', { companyId: context.companyId, range });
  const [mode, setMode] = useState<Mode>('both');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState<TableState['sort']>(null);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [cols, setCols] = useState<Set<ColumnKey>>(loadCols);
  const [menu, setMenu] = useState(false);
  const narrow = useNarrow(720);
  const data = result.data;
  const st = useMemo<TableState | null>(() => data ? { expanded: expanded ?? expandedToLevel(data, 3), mode, sort, filters } : null, [data, expanded, mode, sort, filters]);
  const rows: Row[] = useMemo(() => (data && st ? visibleRows(data, st) : []), [data, st]);
  const visibleCols = COLUMNS.filter((c) => cols.has(c.key) && (c.key !== 'tier' || data?.tiersConfigured));
  const maxTokens = Math.max(1, ...Object.values(data?.nodes ?? {}).map((n) => sumsFor(n, mode).tokens));
  const adapters = [...new Set(Object.values(data?.nodes ?? {}).map((n) => n.adapterType))].sort();
  const models = [...new Set(Object.values(data?.nodes ?? {}).flatMap((n) => [n.configuredModel, ...n.actualModels.map((m) => m.model)]).filter((x): x is string => !!x))].sort();
  const tiers = [...new Set(Object.values(data?.nodes ?? {}).map((n) => n.tier?.configured).filter((x): x is string => !!x))].sort();
  const flat = !!sort;
  const toggle = (id: string) => { const next = new Set(st!.expanded); if (next.has(id)) next.delete(id); else next.add(id); setExpanded(next); };
  const header = (key: ColumnKey) => { setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : s.dir === 1 && key === 'name' ? null : { key, dir: -1 }) : { key, dir: COLUMNS.find((c) => c.key === key)!.numeric ? -1 : 1 })); };
  const exportCsv = async () => {
    if (!data || !st) return;
    const text = toCsv(data, rows, mode);
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard refused */ }
  };
  const delta = data?.priorTotals && data.priorTotals.tokens > 0 ? ((data.totals.tokens - data.priorTotals.tokens) / data.priorTotals.tokens) * 100 : null;

  return <div className="ou"><style>{css}</style>
    <div className="bar"><h1 style={{ fontSize: 20, margin: 0 }}>Agent ledger</h1>{data && <PriceBadge data={data} />}</div>
    {narrow ? <MobileControls range={range} setRange={setRange} custom={custom} setCustom={setCustom} mode={mode} setMode={setMode} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort}
      adapters={adapters} models={models} tiers={tiers} onExpandAll={() => data && setExpanded(new Set(Object.values(data.nodes).filter((n) => n.children.length).map((n) => n.agentId)))} onCollapse={() => data && setExpanded(expandedToLevel(data, 1))} onCsv={exportCsv} /> : <>
    <div className="bar">
      <div className="grp"><span className="gl" id="ou-range-label">Time range</span><div className="seg" role="group" aria-labelledby="ou-range-label">{PRESETS.map((p) => <button key={p} type="button" title={RANGE_TIP[p]} aria-pressed={range === p} onClick={() => setRange(p)}>{LABEL[p]}</button>)}
        <button type="button" title="Use the From and To dates. Pick both dates first." aria-pressed={typeof range === 'object'} onClick={() => custom.from && custom.to && setRange({ from: custom.from, to: custom.to })}>Custom</button></div></div>
      <label className="f" title="First day of a custom range">From <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
      <label className="f" title="Last day of a custom range">To <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
      <div className="grp"><span className="gl" id="ou-mode-label">Totals</span><div className="seg" role="group" aria-labelledby="ou-mode-label">{(['own', 'sub', 'both'] as const).map((m) => <button key={m} type="button" title={MODE_TIP[m]} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'own' ? 'Own' : m === 'sub' ? 'Subtree' : 'Both'}</button>)}</div></div>
      <button type="button" className="btn" title="Open every manager to show all agents" onClick={() => data && setExpanded(new Set(Object.values(data.nodes).filter((n) => n.children.length).map((n) => n.agentId)))}>Expand all</button>
      <button type="button" className="btn" title="Show the top two levels of the organisation only" onClick={() => data && setExpanded(expandedToLevel(data, 1))}>Collapse to level 2</button>
      <button type="button" className="btn" title="Go back to the organisation tree after sorting by a column" disabled={!sort} onClick={() => setSort(null)}>Hierarchy order</button>
      <span style={{ position: 'relative' }}><button type="button" className="btn" title="Choose which columns to show" aria-expanded={menu} onClick={() => setMenu(!menu)}>Columns ▾</button>
        {menu && <div role="group" aria-label="Columns" style={{ position: 'absolute', zIndex: 5, top: '110%', left: 0, background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, display: 'grid', gap: 4, minWidth: 190 }}>
          {COLUMNS.filter((c) => c.key !== 'name').map((c) => <label key={c.key} className="f" style={{ color: 'var(--foreground)' }}><input type="checkbox" checked={cols.has(c.key)} onChange={() => { const next = new Set(cols); if (next.has(c.key)) next.delete(c.key); else next.add(c.key); setCols(next); saveCols(next); }} />{c.label}</label>)}</div>}</span>
      <button type="button" className="btn" onClick={exportCsv} title="Copies the visible rows as CSV">Copy CSV</button>
    </div>
    <div className="bar">
      <label className="f" title="Only agents that run on this adapter">Adapter <select value={filters.adapter} onChange={(e) => setFilters({ ...filters, adapter: e.target.value })}><option value="">all</option>{adapters.map((a) => <option key={a}>{a}</option>)}</select></label>
      <label className="f" title="Only agents configured with, or that ran, this model">Model <select value={filters.model} onChange={(e) => setFilters({ ...filters, model: e.target.value })}><option value="">all</option>{models.map((a) => <option key={a}>{a}</option>)}</select></label>
      {tiers.length > 0 && <label className="f" title="Only agents whose model has this tier">Tier <select value={filters.tier} onChange={(e) => setFilters({ ...filters, tier: e.target.value })}><option value="">all</option>{tiers.map((a) => <option key={a}>{a}</option>)}</select></label>}
      <label className="f" title="Only agents that have at least one flag"><input type="checkbox" checked={filters.flagsOnly} onChange={(e) => setFilters({ ...filters, flagsOnly: e.target.checked })} />Anomalies only</label>
      <label className="f" title="Find agents by name; matching agents are shown with their managers">Search <input type="search" value={filters.q} placeholder="agent name" onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></label>
    </div></>}
    {result.loading && !data && <p role="status">Loading agent ledger…</p>}
    {result.error && <div role="alert">Agent ledger could not be loaded: {String(result.error.message ?? result.error)} <button type="button" className="btn" onClick={result.refresh}>Retry</button></div>}
    {data && st && <>
      {Object.keys(data.errors).length > 0 && <div role="alert" className="badge warn">Some data could not be read: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join('; ')}</div>}
      {narrow ? <MobileSummary data={data} delta={delta} /> : <div className="sum">
        <div><b>{fmtTokens(data.totals.tokens)}</b><span>Tokens, {data.range.fromDate} to {data.range.toDate}</span></div>
        <div><b>{fmtCost(data.totals).text}</b><span>API-equivalent cost</span></div>
        <div><b>{Math.round(data.totals.runs).toLocaleString('en-US')}</b><span>Runs</span></div>
        <div><b>{Object.keys(data.nodes).length}</b><span>Live agents · {data.terminated.count} terminated</span></div>
        {delta !== null && <div><b>{delta >= 0 ? '+' : ''}{delta.toFixed(0)}%</b><span>Tokens vs prior period</span></div>}
      </div>}
      {narrow ? <MobileList data={data} rows={rows} st={st} flat={flat} toggleTree={toggle} /> : <div className="wrap"><table>
        <thead><tr>{visibleCols.map((c) => <th key={c.key} className={`${c.numeric ? 'n' : ''}${c.key === 'name' ? ' nc' : ''}`} tabIndex={0} title={COLUMN_TIP[c.key]} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
          onClick={() => header(c.key)} onKeyDown={(e) => { if (e.key === 'Enter') header(c.key); }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={visibleCols.length} className="dim">{Object.keys(data.nodes).length === 0 ? 'No agents found for this company.' : 'No agents match the filters.'}</td></tr>}
          {rows.map((r, i) => {
            if (r.kind === 'group') return <tr key={`g${i}`} className="grp"><td colSpan={visibleCols.length}>{r.label}</td></tr>;
            if (r.kind === 'terminated') return <tr key="term">{visibleCols.map((c) => <td key={c.key} className={`${c.numeric ? 'n' : ''}${c.key === 'name' ? ' nc' : ''}`}>
              {c.key === 'name' ? <span style={{ paddingLeft: 20 }}><strong>Terminated agents ({data.terminated.count})</strong></span>
                : c.key === 'role' ? <span className="dim">{data.terminated.withUsage} with usage</span>
                : c.key === 'tokens' ? fmtTokens(data.terminated.own.tokens) : c.key === 'input' ? fmtTokens(data.terminated.own.input) : c.key === 'cached' ? fmtTokens(data.terminated.own.cached)
                : c.key === 'output' ? fmtTokens(data.terminated.own.output) : c.key === 'runs' ? Math.round(data.terminated.own.runs).toLocaleString('en-US') : c.key === 'cost' ? fmtCost(data.terminated.own).text : null}</td>)}</tr>;
            const n = r.node;
            return <tr key={n.agentId} className={n.children.length && !flat ? 'm' : ''}>{visibleCols.map((c) => <td key={c.key} className={`${c.numeric ? 'n' : ''}${c.key === 'name' ? ' nc' : ''}`}>
              <Cell n={n} col={c.key} data={data} mode={mode} maxTokens={maxTokens} depth={r.depth} flat={flat} open={st.expanded.has(n.agentId)} toggle={() => toggle(n.agentId)} />
              {c.key === 'name' && r.filteredManager && <span className="dim" style={{ marginLeft: 6, fontSize: 10 }}>(filtered: totals include the full subtree)</span>}</td>)}</tr>;
          })}
          {!isFilteringNow(filters) && <tr><td className="nc"><strong>Total</strong></td>{visibleCols.slice(1).map((c) => <td key={c.key} className={c.numeric ? 'n' : ''}>
            {c.key === 'tokens' ? fmtTokens(data.totals.tokens) : c.key === 'input' ? fmtTokens(data.totals.input) : c.key === 'cached' ? fmtTokens(data.totals.cached) : c.key === 'output' ? fmtTokens(data.totals.output)
              : c.key === 'cost' ? fmtCost(data.totals).text : c.key === 'runs' ? Math.round(data.totals.runs).toLocaleString('en-US') : null}</td>)}</tr>}
        </tbody></table></div>}
      <div className="note">
        <span>Cost is an API-equivalent estimate in USD at list prices. Subscription plans bill differently, and Paperclip itself records $0.</span>
        <span>Usage rolls up under each agent's current manager.</span>
        <span>Input excludes cached tokens{data.coverage.providersAssumedExclusive.length ? `; assumed for providers: ${data.coverage.providersAssumedExclusive.join(', ')}` : ''}.</span>
        {data.range.clamped && <span>Range clamped to the available history{data.coverage.firstEventAt ? ` (since ${data.coverage.firstEventAt.slice(0, 10)})` : ''}.</span>}
        {data.pricing.unmatchedModels.length > 0 && <span>{data.pricing.unmatchedModels.length} models have no price; set one in the settings page.</span>}
        {data.pricing.heldChanges > 0 && <span>{data.pricing.heldChanges} price changes are waiting for approval in the settings page.</span>}
      </div></>}
  </div>;
}
const isFilteringNow = (f: Filters) => !!(f.adapter || f.model || f.tier || f.flagsOnly || f.q);

// Matches the host's own sidebar items: 80% foreground, 6px 8px padding, 10px gap, rounded, accent background on hover.
export function AgentLedgerSidebarItem(_props: PluginSidebarProps) {
  const navigation = useHostNavigation();
  const [hover, setHover] = useState(false);
  return <a {...navigation.linkProps('/agent-ledger')} aria-label="Agent ledger" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 8px', padding: '6px 8px', borderRadius: 8, fontSize: 13, fontWeight: 500, textDecoration: 'none',
      color: 'color-mix(in srgb, var(--foreground) 80%, transparent)', background: hover ? 'var(--accent)' : 'transparent', transition: 'background-color .15s' }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="3" y="3" width="18" height="5" rx="1" /><rect x="7" y="10" width="14" height="5" rx="1" /><rect x="11" y="17" width="10" height="4" rx="1" /></svg>Agent ledger</a>;
}
