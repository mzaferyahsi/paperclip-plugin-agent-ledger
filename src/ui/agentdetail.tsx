import { useHostNavigation, usePluginData } from '@paperclipai/plugin-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentDetailData, AgentLedgerData, DetailBucket, OrgNode } from '../types.ts';
import { agentInsights, modelId } from './insights.ts';
import { ACTIVITY_LABEL, activityOf, fmtAgo, fmtCost, fmtTokens, fmtUsd } from './model.ts';
import { FLAG_HELP } from './flaghelp.ts';

type RangeSel = 'page' | '30d' | '90d';
const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#b07aa1', '#e15759', '#76b7b2'];
const OTHER = '#9aa0a6';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export const detailCss = `
.ad-back{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px}
.ad-panel{width:min(820px,100%);max-height:calc(100vh - 32px);overflow-y:auto;overflow-x:hidden;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-size:13px}
.ad-head{position:sticky;top:0;z-index:2;background:var(--background);padding:14px 20px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:start;flex-wrap:wrap}
.ad-head h2{margin:0;font-size:18px}
.ad-sub{color:var(--muted-foreground);font-size:12.5px;margin-top:2px;display:flex;flex-wrap:wrap;gap:2px 12px}
.ad-body{padding:16px 20px 20px;display:grid;grid-template-columns:minmax(0,1fr);gap:18px;min-width:0}
.ad-body>*,.ad-two>*{min-width:0}
.ad-panel,.ad-panel *{box-sizing:border-box}
.ad-body h3{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground);font-weight:500}
.ad-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.ad-kpi{border:1px solid var(--border);border-radius:8px;padding:8px 12px;display:grid;gap:1px}
.ad-kpi b{font-family:${mono};font-weight:500;font-size:17px;font-variant-numeric:tabular-nums}
.ad-kpi span{color:var(--muted-foreground);font-size:11px}
.ad-kpi i{font-style:normal;font-size:11px;font-family:${mono}}
.ad-seg{display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden}
.ad-seg button{padding:4px 10px;border:0;border-right:1px solid var(--border);background:transparent;color:var(--muted-foreground);cursor:pointer;font:inherit}
.ad-seg button:last-child{border-right:0}.ad-seg button[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground);font-weight:600}
.ad-btn{padding:5px 12px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--foreground);cursor:pointer;font:inherit;text-decoration:none;display:inline-block}
.ad-btn:hover{background:var(--accent)}.ad-btn.p{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary);font-weight:600}
.ad-panel :focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.ad-chart{width:100%;height:auto;display:block;overflow:visible}
.ad-chart text{fill:var(--muted-foreground);font-size:10px}
.ad-chart .hit{fill:transparent}.ad-chart .bar:hover .hit{fill:var(--accent);opacity:.5}
.ad-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;margin-top:6px}
.ad-legend span{display:inline-flex;align-items:center;gap:6px}.ad-legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
.ad-table{width:100%;border-collapse:collapse}.ad-table th,.ad-table td{padding:5px 8px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}
.ad-table th{font-size:11px;font-weight:500;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.05em}.ad-table .n{text-align:right;font-family:${mono};font-variant-numeric:tabular-nums}
.ad-scroll{overflow-x:auto}
.ad-ins{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.ad-ins li{display:flex;gap:8px;align-items:start;line-height:1.4}.ad-ins li:before{content:"";flex:none;width:8px;height:8px;border-radius:50%;margin-top:5px;background:#2563eb}
.ad-ins li.warn:before{background:#d97706}.ad-ins li.good:before{background:#16a34a}
.ad-mix{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--muted)}
.ad-dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0}.ad-dl dt{color:var(--muted-foreground)}.ad-dl dd{margin:0;min-width:0;overflow-wrap:anywhere}
.ad-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:18px}
.ad-foot{position:sticky;bottom:0;background:var(--background);padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.ad-flag{display:inline-block;font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:4px;margin-right:4px;border:1px solid var(--border)}
.ad-flag.crit{color:var(--destructive);border-color:var(--destructive)}.ad-flag.warn{color:#b45309;border-color:#b45309}
.ad-dim{color:var(--muted-foreground)}
`;

function colorsFor(d: AgentDetailData): { color: (id: string) => string; legend: Array<{ id: string; label: string; color: string }> } {
  const ids = d.models.map(modelId);
  const map = new Map(ids.slice(0, PALETTE.length).map((id, i) => [id, PALETTE[i]!]));
  const legend = d.models.slice(0, PALETTE.length).map((m) => ({ id: modelId(m), label: m.model, color: map.get(modelId(m))! }));
  if (ids.length > PALETTE.length) legend.push({ id: 'other', label: `${ids.length - PALETTE.length} other model${ids.length - PALETTE.length === 1 ? '' : 's'}`, color: OTHER });
  return { color: (id) => map.get(id) ?? OTHER, legend };
}

/** Stacked bars per day (or hour), one segment per model. The hover title of a bar lists its models. */
function Chart({ d, metric, color, label }: { d: AgentDetailData; metric: 'tokens' | 'cost'; color: (id: string) => string; label: string }) {
  const W = 720, H = 170, L = 44, B = 20, T = 8, R = 4;
  const val = (m: { tokens: number; costMicro: number }) => (metric === 'tokens' ? m.tokens : m.costMicro);
  const bt = (b: DetailBucket) => (metric === 'tokens' ? b.tokens : b.costMicro);
  const max = Math.max(1, ...d.buckets.map(bt));
  const step = (W - L - R) / Math.max(1, d.buckets.length), bw = Math.max(2, step * 0.72);
  const fmtV = (v: number) => (metric === 'tokens' ? fmtTokens(v) : fmtUsd(v));
  const every = Math.ceil(d.buckets.length / 8);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  return <svg className="ad-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
    {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeWidth="1" /><text x={L - 6} y={y(max * f) + 3} textAnchor="end">{fmtV(max * f)}</text></g>)}
    {d.buckets.map((b, i) => {
      const x = L + i * step + (step - bw) / 2;
      let acc = 0;
      const parts = Object.entries(b.byModel).sort((p, q) => val(q[1]) - val(p[1]));
      const tip = [`${b.label}: ${fmtV(bt(b))}`, ...parts.map(([k, m]) => `  ${k.split('|')[1]}: ${fmtV(val(m))}`)].join('\n');
      return <g key={b.key} className="bar"><title>{tip}</title>
        <rect className="hit" x={L + i * step} y={T} width={step} height={H - T - B} />
        {parts.map(([k, m]) => { const h = (val(m) / max) * (H - T - B); const yy = y(0) - acc - h; acc += h; return h > 0 ? <rect key={k} x={x} y={yy} width={bw} height={h} fill={color(k)} /> : null; })}
        {i % every === 0 && <text x={x + bw / 2} y={H - 5} textAnchor="middle">{d.granularity === 'day' ? b.label.slice(5) : b.label}</text>}
      </g>;
    })}
  </svg>;
}

export function AgentDetailDialog({ node, data, companyId, page, canChange, onChange, onClose }: { node: OrgNode; data: AgentLedgerData; companyId: string; page: unknown; canChange: boolean; onChange: () => void; onClose: () => void }) {
  const nav = useHostNavigation();
  const [sel, setSel] = useState<RangeSel>('page');
  const range = useMemo(() => {
    if (sel === 'page') return page;
    if (sel === '30d') return '30d';
    const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { from: ymd(new Date(Date.now() - 89 * 86_400_000)), to: ymd(new Date()) };
  }, [sel, page]);
  const res = usePluginData<AgentDetailData>('agent-detail', { companyId, agentId: node.agentId, range });
  const d = res.data;
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const closeRef = useRef(onClose); closeRef.current = onClose;

  // Modal behaviour: Escape closes, Tab stays inside, the page behind does not scroll, focus returns to where it was.
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>('button, select, input, [href], summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !(x as HTMLButtonElement).disabled);
      if (!f.length) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { document.removeEventListener('keydown', key, true); document.body.style.overflow = prev; (opener.current as HTMLElement | null)?.focus?.(); };
  }, []);

  const settings = nav.linkProps(`/agents/${node.agentId}/configuration`);
  const act = activityOf(node);
  const cols = useMemo(() => (d ? colorsFor(d) : null), [d]);
  const insights = useMemo(() => (d ? agentInsights(node, d, data, sel === 'page') : []), [d, node, data, sel]);
  const s = d?.sums;
  const cost = s ? fmtCost(s) : null;
  const dpct = (a: number, b: number) => (b > 0 ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(0)}%` : null);
  const mix = s && s.tokens > 0 ? ([['Input', s.input, '#4e79a7'], ['Cached input', s.cached, '#76b7b2'], ['Output', s.output, '#f28e2b']] as const) : null;
  const parent = node.reportsTo ? data.nodes[node.reportsTo]?.name ?? 'terminated agent' : null;

  return <div className="ad-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} className="ad-panel" role="dialog" aria-modal="true" aria-labelledby="ad-title">
      <div className="ad-head">
        <div style={{ flex: 1, minWidth: 180 }}>
          <h2 id="ad-title">{node.name}</h2>
          <div className="ad-sub"><span>{node.title ?? node.role}</span><span>{ACTIVITY_LABEL[act]} · last heartbeat {fmtAgo(node.lastHeartbeatAt)}</span>{parent && <span>Reports to {parent}</span>}</div>
        </div>
        <div className="ad-seg" role="group" aria-label="Time range of this dialog">
          {([['page', 'Page range'], ['30d', '30 days'], ['90d', '90 days']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={sel === k} onClick={() => setSel(k)} title={k === 'page' ? 'The range selected on the page' : `Last ${k === '30d' ? 30 : 90} days`}>{l}</button>)}
        </div>
        <button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: 'transparent', color: 'var(--muted-foreground)', fontSize: 22, lineHeight: 1, cursor: 'pointer' }}>×</button>
      </div>
      <div className="ad-body">
        {res.loading && !d && <div role="status" className="ad-dim">Loading usage…</div>}
        {res.error && <div role="alert" style={{ color: 'var(--destructive, #e5484d)' }}>Could not load the usage of this agent: {String(res.error.message ?? res.error)}</div>}
        {d && s && cols && <>
          <div className="ad-dim" style={{ marginTop: -8 }}>{d.range.fromDate} to {d.range.toDate} · {d.timezone}</div>
          <div className="ad-kpis">
            <div className="ad-kpi" title="Input, cached and output tokens together"><b>{fmtTokens(s.tokens)}</b><span>Tokens</span>{dpct(s.tokens, d.prior.tokens) && <i>{dpct(s.tokens, d.prior.tokens)} vs prior</i>}</div>
            <div className="ad-kpi" title="Estimated cost at public API list prices"><b>{cost!.text}</b><span>API-equivalent cost</span>{d.prior.costMicro > 0 && <i>{dpct(s.costMicro, d.prior.costMicro)} vs prior</i>}</div>
            <div className="ad-kpi"><b>{Math.round(s.runsTotal || s.runs).toLocaleString('en-US')}</b><span>Runs{s.runsFailed ? ` · ${s.runsFailed} failed` : ''}</span></div>
            <div className="ad-kpi" title="Tokens divided by runs with usage"><b>{s.runs > 0 ? fmtTokens(s.tokens / s.runs) : '—'}</b><span>Tokens per run</span></div>
            <div className="ad-kpi" title="Cost divided by runs with usage"><b>{s.runs > 0 && !cost!.none ? fmtUsd(s.costMicro / s.runs) : '—'}</b><span>Cost per run</span></div>
          </div>

          <section><h3>Insights</h3>
            <ul className="ad-ins">{insights.map((i, k) => <li key={k} className={i.tone}>{i.text}</li>)}</ul></section>

          {s.tokens > 0 && <>
            <section><h3>Tokens per {d.granularity === 'day' ? 'day' : 'hour'}, by model</h3>
              <Chart d={d} metric="tokens" color={cols.color} label="Tokens by model" />
              <div className="ad-legend">{cols.legend.map((l) => <span key={l.id}><i style={{ background: l.color }} />{l.label}</span>)}</div></section>
            <section><h3>Cost per {d.granularity === 'day' ? 'day' : 'hour'}, by model</h3>
              <Chart d={d} metric="cost" color={cols.color} label="Estimated cost by model" /></section>
            <section><h3>Models used in this range</h3>
              <div className="ad-scroll"><table className="ad-table"><thead><tr><th>Model</th><th>First used</th><th>Last used</th><th className="n">Tokens</th><th className="n">Share</th><th className="n">Runs</th><th className="n">Cost</th></tr></thead>
                <tbody>{d.models.map((m) => <tr key={modelId(m)}>
                  <td><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 6, background: cols.color(modelId(m)) }} /><span style={{ fontFamily: mono, fontSize: 12 }}>{m.model}</span>{node.configuredModel && m.model === node.configuredModel && <span className="ad-dim"> · configured</span>}</td>
                  <td className="ad-dim">{m.firstAt.slice(0, 10)}</td><td className="ad-dim">{m.lastAt.slice(0, 10)}</td>
                  <td className="n">{fmtTokens(m.tokens)}</td><td className="n">{Math.round(m.share * 100)}%</td><td className="n">{Math.round(m.runs).toLocaleString('en-US')}</td>
                  <td className="n">{m.priced ? fmtUsd(m.costMicro) : m.free ? 'free' : 'no price'}</td></tr>)}</tbody></table></div></section>
            {mix && <section><h3>Token mix</h3>
              <div className="ad-mix" role="img" aria-label="Input, cached and output tokens">{mix.map(([l, v, c]) => <div key={l} title={`${l}: ${fmtTokens(v)} (${Math.round((v / s.tokens) * 100)}%)`} style={{ width: `${(v / s.tokens) * 100}%`, background: c }} />)}</div>
              <div className="ad-legend">{mix.map(([l, v, c]) => <span key={l}><i style={{ background: c }} />{l} {fmtTokens(v)} ({Math.round((v / s.tokens) * 100)}%)</span>)}</div></section>}
            <details><summary style={{ cursor: 'pointer', color: 'var(--muted-foreground)' }}>Show the chart data as a table</summary>
              <div className="ad-scroll"><table className="ad-table"><thead><tr><th>{d.granularity === 'day' ? 'Day' : 'Hour'}</th><th className="n">Tokens</th><th className="n">Cost</th><th className="n">Runs</th></tr></thead>
                <tbody>{d.buckets.map((b) => <tr key={b.key}><td>{b.label}</td><td className="n">{fmtTokens(b.tokens)}</td><td className="n">{b.costMicro > 0 ? fmtUsd(b.costMicro) : '—'}</td><td className="n">{Math.round(b.runs)}</td></tr>)}</tbody></table></div></details>
          </>}
        </>}

        <div className="ad-two">
          <section><h3>Agent</h3><dl className="ad-dl">
            <dt>Status</dt><dd>{node.status}</dd>
            <dt>Adapter</dt><dd style={{ fontFamily: mono }}>{node.adapterType}</dd>
            <dt>Configured model</dt><dd style={{ fontFamily: mono }}>{node.configuredModel ?? 'none'}</dd>
            {node.tier?.configured && <><dt>Tier</dt><dd>{node.tier.configured}</dd></>}
            <dt>Level</dt><dd>{node.depth} in the organisation</dd>
            {node.children.length > 0 && <><dt>Direct reports</dt><dd>{node.children.map((c) => data.nodes[c]?.name).filter(Boolean).join(', ')}</dd>
              <dt>With reports</dt><dd>{fmtTokens(node.subtree.tokens)} tokens · {fmtCost(node.subtree).text} (page range)</dd></>}</dl></section>
          <section><h3>Flags (page range)</h3>{node.flags.length === 0 ? <span className="ad-dim">No flags</span> :
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>{node.flags.map((f) => <li key={f.code}><span className={`ad-flag ${f.severity}`}>{FLAG_HELP[f.code]?.label ?? f.code}</span><span className="ad-dim">{f.detail}</span></li>)}</ul>}</section>
        </div>
      </div>
      <div className="ad-foot">
        {canChange && <button type="button" className="ad-btn" onClick={onChange} title={`Change the provider or model of ${node.name}`}>Change model</button>}
        <a className="ad-btn p" {...settings}>Open agent settings ›</a>
        <button type="button" className="ad-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}
