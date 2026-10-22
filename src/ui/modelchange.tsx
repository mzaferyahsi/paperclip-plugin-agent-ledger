import { usePluginData } from '@paperclipai/plugin-sdk/ui';
import { useEffect, useMemo, useState } from 'react';
import { MODEL_RE, buildNextConfig, diffConfig, needsSessionReset, type Profiles } from '../provider.ts';
import { getAgent, listAdapters, listModels, patchAgent, resetSession, type HostAgent, type HostModel } from './hostapi.ts';

/** Change one agent's provider and model in a few clicks. Shows exactly what changes before anything is written. */
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

  useEffect(() => {
    let live = true;
    Promise.all([getAgent(agentId), listAdapters()]).then(([a, ads]) => {
      if (!live) return;
      setAgent(a); setAdapters(ads.includes(a.adapterType) ? ads : [a.adapterType, ...ads]); setAdapter(a.adapterType);
      setModel(typeof a.adapterConfig.model === 'string' ? a.adapterConfig.model : '');
    }).catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [agentId]);
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
    if (!MODEL_RE.test(model.trim())) return { error: 'This model name has characters that are not allowed' } as const;
    const next = buildNextConfig(agent.adapterConfig, agent.adapterType, adapter, model.trim(), profile, effort || undefined);
    return { next, changes: diffConfig(agent.adapterConfig, next, agent.adapterType, adapter), reset: needsSessionReset(agent.adapterConfig, agent.adapterType, adapter, model.trim()) } as const;
  }, [agent, adapter, model, effort, profile]);

  const apply = async () => {
    if (!plan || 'error' in plan) return;
    setBusy(true); setErr(null);
    try {
      // Read the agent again: it may have changed or started a run since the dialog opened.
      const fresh = await getAgent(agentId);
      if (fresh.status === 'running') throw new Error(`${name} is running now. Wait for the run to finish, then try again.`);
      const next = buildNextConfig(fresh.adapterConfig, fresh.adapterType, adapter, model.trim(), profile, effort || undefined);
      await patchAgent(agentId, { adapterType: adapter, adapterConfig: next });
      let note = '';
      if (needsSessionReset(fresh.adapterConfig, fresh.adapterType, adapter, model.trim())) {
        try { await resetSession(agentId); } catch (e) { note = ` The saved session was not reset (${e instanceof Error ? e.message : String(e)}); reset it on the agent page.`; }
      }
      const after = await getAgent(agentId);
      if (after.adapterType !== adapter || after.adapterConfig.model !== model.trim()) throw new Error('The host did not keep the change. Check the agent page.');
      onDone(`${name} now uses ${after.adapterType} / ${String(after.adapterConfig.model)}.${note}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const noChange = !!plan && !('error' in plan) && plan.changes.length === 0;
  return <div role="dialog" aria-modal="true" aria-label={`Change model for ${name}`} className="confirm" style={{ position: 'fixed', inset: 'auto 16px 16px auto', zIndex: 50, maxWidth: 'min(520px, calc(100vw - 32px))', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>
    <div><strong>Change model for {name}</strong></div>
    {!agent && !err && <div className="dim" role="status">Loading…</div>}
    {agent && <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <div className="dim">Now: {agent.adapterType} / {String(agent.adapterConfig.model ?? 'none')} ({agent.status})</div>
      <label className="f">Provider <select value={adapter} onChange={(e) => pick(e.target.value)}>{adapters.map((a) => <option key={a} value={a}>{profiles.data?.profiles[a]?.label ?? a}{a === agent.adapterType ? ' (current)' : ''}</option>)}</select></label>
      <label className="f">Model <input list="ml-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={models === null ? 'Loading models…' : 'Pick or type a model'} style={{ minWidth: 240 }} />
        <datalist id="ml-models">{(models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label && m.label !== m.id ? m.label : undefined}</option>)}</datalist></label>
      {models !== null && models.length === 0 && <div className="dim">The host did not list models for this provider. Type the model name.</div>}
      {profile?.reasoning && <label className="f">Reasoning effort <select value={effort} onChange={(e) => setEffort(e.target.value)}><option value="">{same && typeof agent.adapterConfig.modelReasoningEffort === 'string' ? `keep (${agent.adapterConfig.modelReasoningEffort})` : `default (${profile.reasoningDefault})`}</option>{profile.reasoningLevels.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>}
      {!profile && adapter && <div className="dim">No profile for {adapter}: only the model changes. Add a profile in the settings page.</div>}
      {plan && 'error' in plan && <div role="alert">{plan.error}</div>}
      {plan && !('error' in plan) && (noChange ? <div className="dim">Nothing would change.</div> : <div>
        <div className="dim">This changes:</div>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{plan.changes.map((c) => <li key={c.key}><code>{c.key}</code>: {c.from} → {c.to}</li>)}</ul>
        <div className="dim" style={{ marginTop: 4 }}>Instructions, skills, working directory, secrets and heartbeat settings stay as they are.{plan.reset ? ' The saved session is reset, because it belongs to the old provider or model.' : ''}</div></div>)}
    </div>}
    {err && <div role="alert" style={{ marginTop: 8 }}>{err}</div>}
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <button type="button" className="btn" disabled={busy || !agent || !plan || 'error' in plan || noChange || agent.status === 'running'} onClick={apply}>{busy ? 'Applying…' : 'Apply'}</button>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button></div>
  </div>;
}
