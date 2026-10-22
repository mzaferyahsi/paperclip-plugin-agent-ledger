// Provider profiles and the pure rules for changing an agent's provider and model. Used by the settings page, the
// model-change dialog and the tests. No I/O here: the dialog reads and writes the agent through the host API as the
// signed-in board member, so the host decides who may do it.

export type Scalar = string | number | boolean;
export interface Profile {
  label: string;
  /** Adapter keys set on every agent moved to this provider (engine, mode, ...). */
  set: Record<string, Scalar>;
  /** Adapter keys removed first, because they belong to another provider (effort, variant, ...). */
  drop: string[];
  /** The provider takes a reasoning effort. Stored as modelReasoningEffort. */
  reasoning: boolean;
  reasoningLevels: string[];
  reasoningDefault: string;
}
export type Profiles = Record<string, Profile>;

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Standard profiles, the same as the pc-agent-model host tool. Settings can replace any of them. */
export const DEFAULT_PROFILES: Profiles = {
  codex_local: { label: 'Codex (ChatGPT login)', set: { engine: 'cli', mode: 'persistent' }, drop: ['effort', 'variant'], reasoning: true, reasoningLevels: LEVELS, reasoningDefault: 'medium' },
  // engine "acp" is broken on this install (old claude-agent-sdk); "cli" works.
  claude_local: { label: 'Claude (subscription)', set: { engine: 'cli', mode: 'persistent' }, drop: ['effort', 'variant', 'modelReasoningEffort'], reasoning: false, reasoningLevels: LEVELS, reasoningDefault: 'medium' },
  opencode_local: { label: 'OpenCode (z.ai GLM, opencode, omniroute)', set: {}, drop: ['engine', 'mode', 'effort', 'variant', 'modelReasoningEffort'], reasoning: false, reasoningLevels: LEVELS, reasoningDefault: 'medium' },
};

/** Keys that belong to the agent, never to the provider. They are always carried over and a profile may not touch them. */
const AGENT_KEYS = ['cwd', 'paperclipSkillSync', 'env', 'instructionsFilePath', 'instructionsRootPath', 'instructionsEntryFile', 'instructionsBundleMode'];
export const isAgentKey = (k: string) => AGENT_KEYS.includes(k) || k.startsWith('access.');
const SECRET_LIKE = /key|token|secret|password|credential/i;
const PROFILE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const ADAPTER_RE = /^[a-z][a-z0-9_]{1,40}$/;
export const MODEL_RE = /^[\w.:/@+\[\] -]{1,120}$/;
const badKey = (k: string) => !PROFILE_KEY.test(k) || isAgentKey(k) || SECRET_LIKE.test(k) || k === 'model';

/** Validates a profile written from the settings page. Throws a short message on bad input. */
export function validateProfile(adapter: unknown, value: unknown): { key: string; value: Profile } {
  if (typeof adapter !== 'string' || !ADAPTER_RE.test(adapter.trim())) throw new Error('The adapter type must be lower case letters, digits and underscores, for example claude_local');
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const label = typeof v.label === 'string' ? v.label.trim() : '';
  if (!label || label.length > 60) throw new Error('A label is required (60 characters at most)');
  const set: Record<string, Scalar> = {};
  if (v.set !== undefined && (typeof v.set !== 'object' || v.set === null || Array.isArray(v.set))) throw new Error('Keys to set must be an object');
  for (const [k, x] of Object.entries((v.set ?? {}) as Record<string, unknown>)) {
    if (badKey(k)) throw new Error(`The key "${k}" cannot be set by a profile (agent-owned, secret-like or the model)`);
    if (typeof x === 'string' ? x.length > 60 : typeof x !== 'number' && typeof x !== 'boolean') throw new Error(`The value of "${k}" must be short text, a number or true/false`);
    set[k] = x as Scalar;
  }
  if (v.drop !== undefined && !Array.isArray(v.drop)) throw new Error('Keys to remove must be a list');
  const drop = [...new Set(((v.drop ?? []) as unknown[]).map((k) => (typeof k === 'string' ? k.trim() : '')).filter(Boolean))];
  for (const k of drop) if (!PROFILE_KEY.test(k) || isAgentKey(k) || k === 'model') throw new Error(`The key "${k}" cannot be removed by a profile`);
  if (drop.length > 20 || Object.keys(set).length > 20) throw new Error('Too many keys');
  const levels = Array.isArray(v.reasoningLevels) && v.reasoningLevels.length ? v.reasoningLevels.map((l) => String(l).trim()).filter((l) => /^[a-z]{2,12}$/.test(l)) : LEVELS;
  const def = typeof v.reasoningDefault === 'string' && levels.includes(v.reasoningDefault) ? v.reasoningDefault : levels.includes('medium') ? 'medium' : levels[0]!;
  return { key: adapter.trim(), value: { label, set, drop, reasoning: v.reasoning === true, reasoningLevels: levels, reasoningDefault: def } };
}

/** Defaults overlaid with the saved profiles (one per adapter type). A bad saved row is ignored, never fatal. */
export function mergeProfiles(saved: Array<{ key: string; value: unknown }>): Profiles {
  const out: Profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
  for (const r of saved) { try { const p = validateProfile(r.key, r.value); out[p.key] = p.value; } catch { /* ignore */ } }
  return out;
}

export type AdapterConfig = Record<string, unknown>;
/**
 * The adapter config an agent gets when it moves to `adapter`/`model`. Agent-owned keys (cwd, env, instructions, access.*)
 * are always kept. When the adapter stays the same every other key is kept too; otherwise they are rebuilt from the profile.
 */
export function buildNextConfig(cur: AdapterConfig, curAdapter: string, adapter: string, model: string, profile: Profile | undefined, reasoning?: string): AdapterConfig {
  if (!MODEL_RE.test(model)) throw new Error('Invalid model');
  const p = profile ?? { set: {}, drop: [], reasoning: false, reasoningLevels: LEVELS, reasoningDefault: 'medium', label: adapter };
  const same = adapter === curAdapter;
  const next: AdapterConfig = {};
  for (const [k, v] of Object.entries(cur)) if (same || isAgentKey(k)) next[k] = v;
  for (const k of p.drop) delete next[k];
  Object.assign(next, p.set, { model });
  if (p.reasoning) {
    const keep = same && typeof cur.modelReasoningEffort === 'string' && p.reasoningLevels.includes(cur.modelReasoningEffort) ? cur.modelReasoningEffort : p.reasoningDefault;
    next.modelReasoningEffort = reasoning && p.reasoningLevels.includes(reasoning) ? reasoning : keep;
  }
  return next;
}

export interface Change { key: string; from: string; to: string }
/** What changes, for the confirm step. The env map and access.* secret references are agent-owned, so they never appear. */
export function diffConfig(cur: AdapterConfig, next: AdapterConfig, curAdapter: string, adapter: string): Change[] {
  const show = (v: unknown) => (v === undefined ? '(none)' : typeof v === 'string' ? v : JSON.stringify(v));
  const out: Change[] = [];
  if (curAdapter !== adapter) out.push({ key: 'adapterType', from: curAdapter, to: adapter });
  for (const k of [...new Set([...Object.keys(cur), ...Object.keys(next)])].sort()) {
    if (k === 'env' || k.startsWith('access.')) continue;
    if (JSON.stringify(cur[k]) !== JSON.stringify(next[k])) out.push({ key: k, from: show(cur[k]), to: show(next[k]) });
  }
  return out;
}
/** A saved session belongs to the old provider and model, so it is reset when either changes. */
export const needsSessionReset = (cur: AdapterConfig, curAdapter: string, adapter: string, model: string) => curAdapter !== adapter || cur.model !== model;

// --- AI connection binding -------------------------------------------------------------------------------
// Some agents carry runtimeConfig.aiConnection (which provider account they sign in with). The host refuses an adapter or
// model change when the binding no longer fits ("Select an AI connection compatible with the new harness and model"), so the
// binding moves with the provider. This table mirrors the host's AI_CONNECTION_CAPABILITIES (compatibility only).
export interface AiBinding { mode: string; provider: string; method: string; connectionId?: string; grantId?: string }
const AI_ADAPTERS: Record<string, Record<string, string[]>> = {
  anthropic: { subscription: ['claude_local'], api_key: ['claude_local'] },
  openai: { subscription: ['codex_local'], api_key: ['codex_local'] },
  xai: { subscription: ['grok_local'], api_key: ['grok_local'] },
  openrouter: { api_key: ['opencode_local'] },
};
const AI_ORDER = ['anthropic', 'openai', 'xai', 'openrouter'];
const fits = (provider: string, method: string, adapter: string, model: string) =>
  !!AI_ADAPTERS[provider]?.[method]?.includes(adapter) && (provider !== 'openrouter' || model.startsWith('openrouter/'));
export function aiCompatible(b: AiBinding, adapter: string, model: string): boolean {
  const methods = Object.keys(AI_ADAPTERS[b.provider] ?? {});
  return (b.mode === 'responsible_user' ? methods : methods.filter((m) => m === b.method)).some((m) => fits(b.provider, m, adapter, model));
}
export type AiPlan = { action: 'keep' } | { action: 'set'; binding: AiBinding; from: string; to: string } | { action: 'blocked'; from: string };
const label = (b: AiBinding) => `${b.provider} ${b.method}${b.mode === 'responsible_user' ? '' : ` (${b.mode})`}`;
/** What to do with the agent's AI connection binding when it moves to adapter/model. */
export function planAiBinding(cur: AiBinding | undefined | null, adapter: string, model: string): AiPlan {
  if (!cur || typeof cur.provider !== 'string') return { action: 'keep' };
  if (aiCompatible(cur, adapter, model)) return { action: 'keep' };
  for (const provider of AI_ORDER) {
    const methods = Object.keys(AI_ADAPTERS[provider]!);
    const method = [cur.method, 'subscription', 'api_key'].find((m) => m && methods.includes(m) && fits(provider, m, adapter, model));
    if (method) { const binding: AiBinding = { mode: 'responsible_user', provider, method }; return { action: 'set', binding, from: label(cur), to: label(binding) }; }
  }
  return { action: 'blocked', from: label(cur) };
}
