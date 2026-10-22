import { usePluginData } from '@paperclipai/plugin-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MODEL_RE, buildNextConfig, diffConfig, needsSessionReset, planAiBinding, type AiBinding, type AiPlan, type Profiles } from '../provider.ts';
import { getAgent, listAdapters, listModels, patchAgent, resetSession, type HostAgent, type HostModel } from './hostapi.ts';

const field = { display: 'grid', gap: 4, fontSize: 12, color: 'var(--muted-foreground)', minWidth: 0 } as const;
const control = { padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--background)', color: 'var(--foreground)', fontSize: 14, width: '100%', minWidth: 0, boxSizing: 'border-box' } as const;
const aiOf = (a: HostAgent | null) => (a?.runtimeConfig?.aiConnection ?? undefined) as AiBinding | undefined;

/** Change one agent's provider and model in a modal. Shows exactly what changes before anything is written. */
export function ModelChangeDialog({ agentId, name, companyId, onClose, onDone }: { agentId: string; name: string; companyId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const profiles = usePluginData<{ profiles: Profiles }>('provider-profiles', { companyId });
  const [agent, setAgent] = useState<HostAgent | null>(null);
  const [adapters, setAdapters] = useState<string[]>([]);
  const [adapter, setAdapter] = useState('');
  const [models, setModels] = useState<HostModel[] | null>(null);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const live = useRef({ busy, onClose }); live.current = { busy, onClose };
  const close = () => { if (!busy) onClose(); };

  // Modal behaviour: Escape closes, Tab stays inside, the page behind does not scroll, focus returns to the button.
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !live.current.busy) { e.stopPropagation(); live.current.onClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>('button, select, input, [href], [tabindex]:not([tabindex="-1"])')].filter((x) => !(x as HTMLButtonElement).disabled);
      if (!f.length) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); document.body.style.overflow = prev; (opener.current as HTMLElement | null)?.focus?.(); };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([getAgent(agentId), listAdapters()]).then(([a, ads]) => {
      if (!live) return;
      setAgent(a); setAdapters(ads.includes(a.adapterType) ? ads : [a.adapterType, ...ads]); setAdapter(a.adapterType);
      setModel(typeof a.adapterConfig.model === 'string' ? a.adapterConfig.model : '');
    }).catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [agentId]);
  useEffect(() => { if (agent) panel.current?.querySelector<HTMLElement>('select')?.focus(); }, [agent]);
  useEffect(() => {
    if (!adapter) return;
    let live = true; setModels(null);
    listModels(companyId, adapter).then((m) => live && setModels(m)).catch(() => live && setModels([]));
    return () => { live = false; };
  }, [adapter, companyId]);

  const profile = profiles.data?.profiles[adapter];
  const same = !!agent && adapter === agent.adapterType;
  const pick = (a: string) => { setAdapter(a); setModel(agent && a === agent.adapterType && typeof agent.adapterConfig.model === 'string' ? agent.adapterConfig.model : ''); setEffort(''); };
  const plan = useMemo(() => {
    if (!agent || !adapter || !model.trim()) return null;
    if (!MODEL_RE.test(model.trim())) return { error: 'This model name has characters that are not allowed.' } as const;
    const next = buildNextConfig(agent.adapterConfig, agent.adapterType, adapter, model.trim(), profile, effort || undefined);
    const ai: AiPlan = planAiBinding(aiOf(agent), adapter, model.trim());
    if (ai.action === 'blocked') return { error: `This agent signs in with ${ai.from}, and no AI connection fits ${adapter} with this model. Change the connection on the agent page first.` } as const;
    const changes = diffConfig(agent.adapterConfig, next, agent.adapterType, adapter);
    if (ai.action === 'set') changes.push({ key: 'AI connection', from: ai.from, to: ai.to });
    return { next, ai, changes, reset: needsSessionReset(agent.adapterConfig, agent.adapterType, adapter, model.trim()) } as const;
  }, [agent, adapter, model, effort, profile]);

  const apply = async () => {
    if (!plan || 'error' in plan) return;
    setBusy(true); setErr(null);
    try {
      // Read the agent again: it may have changed or started a run since the dialog opened.
      const fresh = await getAgent(agentId);
      if (fresh.status === 'running') throw new Error(`${name} is running now. Wait for the run to finish, then try again.`);
      const m = model.trim();
      const next = buildNextConfig(fresh.adapterConfig, fresh.adapterType, adapter, m, profile, effort || undefined);
      const ai = planAiBinding(aiOf(fresh), adapter, m);
      if (ai.action === 'blocked') throw new Error(`No AI connection fits ${adapter} with this model. Change the connection on the agent page first.`);
      await patchAgent(agentId, { adapterType: adapter, adapterConfig: next, ...(ai.action === 'set' ? { runtimeConfig: { ...(fresh.runtimeConfig ?? {}), aiConnection: ai.binding } } : {}) });
      let note = '';
      if (needsSessionReset(fresh.adapterConfig, fresh.adapterType, adapter, m)) {
        try { await resetSession(agentId); } catch (e) { note = ` The saved session was not reset (${e instanceof Error ? e.message : String(e)}); reset it on the agent page.`; }
      }
      const after = await getAgent(agentId);
      if (after.adapterType !== adapter || after.adapterConfig.model !== m) throw new Error('The host did not keep the change. Check the agent page.');
      onDone(`${name} now uses ${after.adapterType} / ${String(after.adapterConfig.model)}.${note}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const ready = !!plan && !('error' in plan);
  const noChange = ready && plan.changes.length === 0;
  return <div onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', padding: 16 }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="ml-title" style={{ width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', overflowX: 'hidden', background: 'var(--card, var(--background))', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,.45)', boxSizing: 'border-box' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="ml-title" style={{ margin: 0, fontSize: 17 }}>Change model</h2>
          <div style={{ color: 'var(--muted-foreground)', fontSize: 13, marginTop: 2 }}>{name}{agent ? ` · now ${agent.adapterType} / ${String(agent.adapterConfig.model ?? 'no model')}` : ''}</div>
        </div>
        <button type="button" aria-label="Close" disabled={busy} onClick={close} style={{ border: 0, background: 'transparent', color: 'var(--muted-foreground)', fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 2 }}>×</button>
      </div>
      <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
        {!agent && !err && <div style={{ color: 'var(--muted-foreground)' }} role="status">Loading…</div>}
        {agent && <>
          <label style={field}>Provider
            <select style={control} value={adapter} onChange={(e) => pick(e.target.value)}>{adapters.map((a) => <option key={a} value={a}>{profiles.data?.profiles[a]?.label ?? a}{a === agent.adapterType ? ' (current)' : ''}</option>)}</select></label>
          <label style={field}>Model
            <input style={control} list="ml-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={models === null ? 'Loading models…' : 'Pick or type a model'} autoComplete="off" spellCheck={false} />
            <datalist id="ml-models">{(models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label && m.label !== m.id ? m.label : undefined}</option>)}</datalist>
            {models !== null && models.length === 0 && <span>The host did not list models for this provider. Type the model name.</span>}</label>
          {profile?.reasoning && <label style={field}>Reasoning effort
            <select style={control} value={effort} onChange={(e) => setEffort(e.target.value)}><option value="">{same && typeof agent.adapterConfig.modelReasoningEffort === 'string' ? `Keep (${agent.adapterConfig.modelReasoningEffort})` : `Default (${profile.reasoningDefault})`}</option>{profile.reasoningLevels.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>}
          {!profile && adapter && <div style={{ color: 'var(--muted-foreground)', fontSize: 12 }}>No profile for {adapter}, so only the model changes. Add a profile in the Agent Ledger settings.</div>}
          {plan && 'error' in plan && <div role="alert" style={{ fontSize: 13, color: 'var(--destructive, #e5484d)' }}>{plan.error}</div>}
          {ready && (noChange ? <div style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>Nothing would change.</div> : <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', background: 'var(--muted)', fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>What changes</div>
            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}><tbody>{plan.changes.map((c) => <tr key={c.key}><td style={{ border: 0, padding: '2px 8px 2px 0', color: 'var(--muted-foreground)', verticalAlign: 'top', width: 150, overflowWrap: 'anywhere' }}>{c.key}</td><td style={{ border: 0, padding: '2px 0', overflowWrap: 'anywhere' }}>{c.from} <span style={{ color: 'var(--muted-foreground)' }}>→</span> <strong>{c.to}</strong></td></tr>)}</tbody></table>
            <div style={{ color: 'var(--muted-foreground)', fontSize: 12, marginTop: 8 }}>Instructions, skills, working directory, secrets and heartbeat settings stay as they are.{plan.reset ? ' The saved session is reset, because it belongs to the old provider or model.' : ''}</div></div>)}
        </>}
        {err && <div role="alert" style={{ fontSize: 13, color: 'var(--destructive, #e5484d)' }}>{err}</div>}
      </div>
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn" disabled={busy} onClick={close}>Cancel</button>
        <button type="button" className="btn" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)', borderColor: 'var(--primary)', fontWeight: 600, opacity: busy || !agent || !ready || noChange || agent.status === 'running' ? 0.5 : 1 }}
          disabled={busy || !agent || !ready || noChange || agent.status === 'running'} onClick={apply}>{busy ? 'Applying…' : 'Apply'}</button>
      </div>
    </div>
  </div>;
}
