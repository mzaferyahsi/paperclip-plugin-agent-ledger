import { usePluginAction, usePluginData } from '@paperclipai/plugin-sdk/ui';
import type { PluginCompanySettingsPageProps } from '@paperclipai/plugin-sdk/ui';
import { useState } from 'react';

interface Held { id: string; provider_key: string; model_key: string; input: number; cached: number | null; output: number; source: string; change_pct: number | null }
interface RuleRow { kind: string; key: string; value: Record<string, unknown> }
interface Pricing { asOf: string | null; stale: boolean; snapshotOnly: boolean; snapshotDate: string; unmatchedModels: Array<{ provider: string; model: string; tokens: number }>; sources: Array<{ key: string; label: string; status: string; at: string | null; detail: string | null }> }
interface SettingsData { rules: RuleRow[]; held: Held[]; pricing: Pricing; config: { priceSources: string[]; priceChangeHoldPercent: number; priceStaleAfterDays: number } }

const panel = { border: '1px solid var(--border)', borderRadius: 8, padding: 16, display: 'grid', gap: 10, minWidth: 0 } as const;
const btn = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--foreground)', cursor: 'pointer' } as const;
const input = { padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--foreground)', minWidth: 0 } as const;
const th = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted-foreground)' } as const;
const td = { padding: '6px 8px', borderBottom: '1px solid var(--border)' } as const;

function RuleForm({ kind, fields, onSave, busy }: { kind: string; fields: Array<{ name: string; label: string; placeholder?: string; type?: string }>; onSave: (key: string, value: Record<string, unknown>) => void; busy: boolean }) {
  const [v, setV] = useState<Record<string, string>>({});
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { key = '', ...rest } = v;
    const value: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(rest)) value[k] = ['input', 'output', 'cachedInput', 'cacheWrite'].includes(k) ? (x === '' ? null : Number(x)) : x;
    onSave(key, value); setV({});
  };
  return <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }} aria-label={`Add ${kind}`}>
    {fields.map((f) => <label key={f.name} style={{ display: 'grid', gap: 2, fontSize: 12 }}>{f.label}
      <input style={input} type={f.type ?? 'text'} step={f.type === 'number' ? 'any' : undefined} placeholder={f.placeholder} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} required={f.name === 'key' || f.name === 'label' || f.name === 'target' || f.name === 'input' || f.name === 'output'} /></label>)}
    <button style={btn} type="submit" disabled={busy}>Add</button></form>;
}


interface ProfileValue { label?: string; set?: Record<string, string | number | boolean>; drop?: string[]; reasoning?: boolean; reasoningLevels?: string[]; reasoningDefault?: string }
const parseSet = (t: string): Record<string, string | number | boolean> => {
  const out: Record<string, string | number | boolean> = {};
  for (const line of t.split('\n')) {
    const i = line.indexOf('='); if (i < 1) continue;
    const k = line.slice(0, i).trim(), x = line.slice(i + 1).trim();
    out[k] = x === 'true' ? true : x === 'false' ? false : x !== '' && Number.isFinite(Number(x)) ? Number(x) : x;
  }
  return out;
};
/** One provider profile: the base settings an agent gets when it moves to this provider. */
function ProfileEditor({ adapter, value, isDefault, canEdit, busy, onSave, onReset }: { adapter: string; value: ProfileValue; isDefault: boolean; canEdit: boolean; busy: boolean; onSave: (adapter: string, v: ProfileValue) => void; onReset: () => void }) {
  const [label, setLabel] = useState(value.label ?? adapter);
  const [set, setSet] = useState(Object.entries(value.set ?? {}).map(([k, x]) => `${k}=${x}`).join('\n'));
  const [drop, setDrop] = useState((value.drop ?? []).join(', '));
  const [reasoning, setReasoning] = useState(!!value.reasoning);
  const [levels, setLevels] = useState((value.reasoningLevels ?? []).join(', '));
  const [def, setDef] = useState(value.reasoningDefault ?? 'medium');
  const save = (e: React.FormEvent) => { e.preventDefault(); onSave(adapter, { label, set: parseSet(set), drop: drop.split(',').map((x) => x.trim()).filter(Boolean), reasoning, reasoningLevels: levels.split(',').map((x) => x.trim()).filter(Boolean), reasoningDefault: def }); };
  return <form onSubmit={save} style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }} aria-label={`Profile ${adapter}`}>
    <div><code>{adapter}</code> <span style={{ color: 'var(--muted-foreground)' }}>{isDefault ? '(standard)' : '(your settings)'}</span></div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Label<input style={input} value={label} onChange={(e) => setLabel(e.target.value)} disabled={!canEdit} required /></label>
      <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Keys to remove (comma separated)<input style={{ ...input, minWidth: 260 }} value={drop} onChange={(e) => setDrop(e.target.value)} disabled={!canEdit} /></label></div>
    <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Keys to set, one <code>key=value</code> per line<textarea style={{ ...input, fontFamily: 'monospace' }} rows={3} value={set} onChange={(e) => setSet(e.target.value)} disabled={!canEdit} /></label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} disabled={!canEdit} />Offers a reasoning effort</label>
      {reasoning && <><label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Levels<input style={input} value={levels} onChange={(e) => setLevels(e.target.value)} disabled={!canEdit} /></label>
        <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Default<input style={{ ...input, width: 90 }} value={def} onChange={(e) => setDef(e.target.value)} disabled={!canEdit} /></label></>}
      {canEdit && <><button style={btn} type="submit" disabled={busy}>Save</button>{!isDefault && <button style={btn} type="button" disabled={busy} onClick={onReset}>Back to standard</button>}</>}</div>
  </form>;
}

function UnpricedRow({ m, canEdit, busy, onPrice, onFree }: { m: { provider: string; model: string; tokens: number }; canEdit: boolean; busy: boolean; onPrice: (input: number, output: number) => void; onFree: () => void }) {
  const [i, setI] = useState(''); const [o, setO] = useState('');
  const ok = i !== '' && o !== '' && Number(i) >= 0 && Number(o) >= 0;
  return <tr><td style={td}><code>{m.provider}/{m.model}</code><div style={{ color: 'var(--muted-foreground)', fontSize: 12 }}>{m.tokens.toLocaleString('en-US')} tokens</div></td>
    <td style={{ ...td, textAlign: 'right' }}>{canEdit && <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
      <input style={{ ...input, width: 80 }} type="number" step="any" min="0" placeholder="Input $" aria-label={`Input price for ${m.model}`} value={i} onChange={(e) => setI(e.target.value)} />
      <input style={{ ...input, width: 80 }} type="number" step="any" min="0" placeholder="Output $" aria-label={`Output price for ${m.model}`} value={o} onChange={(e) => setO(e.target.value)} />
      <button style={btn} disabled={busy || !ok} onClick={() => onPrice(Number(i), Number(o))}>Set price</button>
      <button style={btn} disabled={busy} onClick={onFree}>{m.provider} is free</button></span>}</td></tr>;
}

export function AgentLedgerSettingsPage({ context }: PluginCompanySettingsPageProps) {
  const result = usePluginData<SettingsData>('settings', { companyId: context.companyId });
  const prof = usePluginData<{ profiles: Record<string, ProfileValue> }>('provider-profiles', { companyId: context.companyId });
  const [newAdapter, setNewAdapter] = useState('');
  const put = usePluginAction('rules.put');
  const decide = usePluginAction('prices.decide');
  const refresh = usePluginAction('prices.refresh');
  const whoami = usePluginAction('viewer');
  const [isBoard, setIsBoard] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (isBoard === null) whoami({}).then((r) => setIsBoard(!!(r as { isBoard?: boolean })?.isBoard)).catch(() => setIsBoard(false));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); result.refresh(); prof.refresh(); } catch (e) { setMsg(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  const d = result.data;
  const rules = (kind: string) => (d?.rules ?? []).filter((r) => r.kind === kind);
  const del = (r: RuleRow) => run(() => put({ kind: r.kind, key: r.key, value: r.value, active: false }), 'Removed');
  const save = (kind: string) => (key: string, value: Record<string, unknown>) => run(() => put({ kind, key, value }), 'Saved');
  const list = (kind: string, show: (r: RuleRow) => string) => rules(kind).length === 0 ? <p style={{ color: 'var(--muted-foreground)', margin: 0 }}>None yet.</p> :
    <table style={{ borderCollapse: 'collapse', width: '100%' }}><tbody>{rules(kind).map((r) => <tr key={r.key}><td style={td}>{show(r)}</td><td style={{ ...td, textAlign: 'right' }}>{isBoard && <button style={btn} disabled={busy} onClick={() => del(r)}>Remove</button>}</td></tr>)}</tbody></table>;

  return <div style={{ display: 'grid', gap: 14, fontSize: 13 }}>
    <h1 style={{ fontSize: 20, margin: 0 }}>Agent Ledger Settings</h1>
    {msg && <div role="status">{msg}</div>}
    {result.loading && !d && <p role="status">Loading…</p>}
    {result.error && <div role="alert">Could not load settings. <button style={btn} onClick={result.refresh}>Retry</button></div>}
    {isBoard === false && <p style={{ color: 'var(--muted-foreground)' }}>You can view these settings. Only board members can change them.</p>}
    {d && <>
      <section style={panel} aria-labelledby="ou-prices"><h2 id="ou-prices" style={{ fontSize: 15, margin: 0 }}>Prices</h2>
        <p style={{ margin: 0 }}>{d.pricing.snapshotOnly ? `Using the bundled snapshot of ${d.pricing.snapshotDate}; no refresh has succeeded yet.` : `Last successful refresh: ${new Date(d.pricing.asOf!).toLocaleString()}${d.pricing.stale ? ' (stale)' : ''}.`} Prices refresh daily. Changes larger than {d.config.priceChangeHoldPercent}% wait for approval below.</p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}><thead><tr><th style={th}>Source</th><th style={th}>Status</th><th style={th}>Last run</th></tr></thead>
          <tbody>{d.pricing.sources.map((s) => <tr key={s.key}><td style={td}>{s.label}</td><td style={td}>{s.status}{s.detail ? ` (${s.detail})` : ''}</td><td style={td}>{s.at ? new Date(s.at).toLocaleString() : '—'}</td></tr>)}</tbody></table>
        {isBoard && <div><button style={btn} disabled={busy} onClick={() => run(() => refresh({}), 'Refresh finished')}>Refresh now</button></div>}
      </section>

      <section style={panel} aria-labelledby="ou-held"><h2 id="ou-held" style={{ fontSize: 15, margin: 0 }}>Held price changes</h2>
        {d.held.length === 0 ? <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>Nothing is waiting for approval.</p> :
          <table style={{ borderCollapse: 'collapse', width: '100%' }}><thead><tr><th style={th}>Model</th><th style={th}>New price in / cached / out ($ per MTok)</th><th style={th}>Change</th><th style={th}>Source</th><th style={th} /></tr></thead>
            <tbody>{d.held.map((h) => <tr key={h.id}><td style={td}>{h.provider_key}/{h.model_key}</td><td style={td}>{h.input} / {h.cached ?? '—'} / {h.output}</td><td style={td}>{h.change_pct}%</td><td style={td}>{h.source}</td>
              <td style={{ ...td, textAlign: 'right' }}>{isBoard && <><button style={btn} disabled={busy} onClick={() => run(() => decide({ id: h.id, decision: 'active' }), 'Accepted')}>Accept</button> <button style={btn} disabled={busy} onClick={() => run(() => decide({ id: h.id, decision: 'rejected' }), 'Rejected')}>Reject</button></>}</td></tr>)}</tbody></table>}
      </section>

      <section style={panel} aria-labelledby="ou-ov"><h2 id="ou-ov" style={{ fontSize: 15, margin: 0 }}>Price overrides</h2>
        <p style={{ margin: 0 }}>Use your own price for a model. The key is <code>provider/model</code> and may contain *, for example <code>anthropic/claude-opus-5-5</code> or <code>*/glm-5-3</code>. Prices are USD per million tokens.</p>
        {list('price_override', (r) => `${r.key}: in ${r.value.input} / cached ${r.value.cachedInput ?? '—'} / out ${r.value.output}${r.value.from ? ` from ${r.value.from}` : ''}${r.value.to ? ` to ${r.value.to}` : ''}`)}
        {isBoard && <RuleForm kind="price override" busy={busy} onSave={save('price_override')} fields={[{ name: 'key', label: 'provider/model', placeholder: 'openai/gpt-6-luna' }, { name: 'input', label: 'Input', type: 'number' }, { name: 'cachedInput', label: 'Cached input', type: 'number' }, { name: 'output', label: 'Output', type: 'number' }, { name: 'from', label: 'From (optional)', type: 'date' }, { name: 'to', label: 'To (optional)', type: 'date' }]} />}
      </section>

      <section style={panel} aria-labelledby="ou-models"><h2 id="ou-models" style={{ fontSize: 15, margin: 0 }}>Models without a price</h2>
        {d.pricing.unmatchedModels.length === 0 ? <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>Every model used in the last 30 days has a price.</p> : <>
          <p style={{ margin: 0 }}>These models were used in the last 30 days but no price list has them. Enter a price in USD per million tokens, or mark the provider as free or local.</p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}><tbody>{d.pricing.unmatchedModels.map((m) => <UnpricedRow key={m.provider + m.model} m={m} canEdit={!!isBoard} busy={busy}
            onPrice={(input, output) => run(() => put({ kind: 'price_override', key: `${m.provider}/${m.model}`, value: { input, output } }), 'Price saved')}
            onFree={() => run(() => put({ kind: 'provider_free', key: m.provider, value: {} }), `${m.provider} marked as free`)} />)}</tbody></table></>}
        {rules('provider_free').length > 0 && <><h3 style={{ fontSize: 13, margin: 0 }}>Free or local providers</h3>{list('provider_free', (r) => r.key)}</>}
      </section>

      <section style={panel} aria-labelledby="ou-prov"><h2 id="ou-prov" style={{ fontSize: 15, margin: 0 }}>Provider profiles</h2>
        <p style={{ margin: 0 }}>The base settings an agent gets when you change its provider from the Model column. The agent keeps its instructions, skills, working directory, secrets and heartbeat settings; only the keys below are removed or set, and the model is the one you pick. Profiles cannot touch secrets or the working directory. The standard profiles match the <code>pc-agent-model</code> tool.</p>
        {prof.data && Object.entries(prof.data.profiles).map(([a, v]) => <ProfileEditor key={a + JSON.stringify(v)} adapter={a} value={v} isDefault={!rules('provider_profile').some((r) => r.key === a)} canEdit={!!isBoard} busy={busy}
          onSave={(adapter, value) => run(() => put({ kind: 'provider_profile', key: adapter, value }), `Saved the ${adapter} profile`)}
          onReset={() => run(() => put({ kind: 'provider_profile', key: a, value: rules('provider_profile').find((r) => r.key === a)?.value ?? v, active: false }), `${a} is back to the standard profile`)} />)}
        {isBoard && <form style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }} aria-label="Add provider profile" onSubmit={(e) => { e.preventDefault(); const k = newAdapter.trim(); if (k) run(() => put({ kind: 'provider_profile', key: k, value: { label: k, set: {}, drop: [] } }), `Added ${k}; edit it above`).then(() => setNewAdapter('')); }}>
          <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Add a provider<input style={input} placeholder="adapter type, e.g. gemini_local" value={newAdapter} onChange={(e) => setNewAdapter(e.target.value)} /></label><button style={btn} type="submit" disabled={busy}>Add</button></form>}
      </section>

      <section style={panel} aria-labelledby="ou-tiers"><h2 id="ou-tiers" style={{ fontSize: 15, margin: 0 }}>Tiers (optional)</h2>
        <p style={{ margin: 0 }}>Label models with a tier of your choice, then say which tier each role should use. The page shows a Tier column and flags agents whose model tier differs from the role's tier. Patterns may contain *.</p>
        <h3 style={{ fontSize: 13, margin: 0 }}>Model tiers</h3>
        {list('tier_model', (r) => `${r.key} → ${r.value.label}`)}
        {isBoard && <RuleForm kind="model tier" busy={busy} onSave={save('tier_model')} fields={[{ name: 'key', label: 'Model pattern', placeholder: 'claude-opus-*' }, { name: 'label', label: 'Tier', placeholder: 'A' }]} />}
        <h3 style={{ fontSize: 13, margin: 0 }}>Role tiers</h3>
        {list('tier_role', (r) => `${r.key} → ${r.value.label}`)}
        {isBoard && <RuleForm kind="role tier" busy={busy} onSave={save('tier_role')} fields={[{ name: 'key', label: 'Role or title pattern', placeholder: 'engineer' }, { name: 'label', label: 'Expected tier', placeholder: 'B' }]} />}
      </section>
    </>}
  </div>;
}
