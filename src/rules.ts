import { NS } from './namespace.ts';
import type { Db } from './db.ts';
import type { Override } from './prices/book.ts';
import { mergeProfiles, validateProfile, type Profiles } from './provider.ts';

export const RULES_SQL = `SELECT DISTINCT ON (r.kind, r.key) r.kind, r.key, r.value, r.active FROM ${NS}.rules r WHERE r.company_id = $1::uuid ORDER BY r.kind, r.key, r.id DESC`;
export const INSERT_RULE_SQL = `INSERT INTO ${NS}.rules (company_id, kind, key, value, active, actor_user_id) VALUES ($1::uuid, $2::text, $3::text, $4::jsonb, $5::boolean, $6::text)`;

export interface Rules {
  overrides: Override[]; modelAliases: Record<string, string>; providerAliases: Record<string, string>; freeProviders: string[];
  tierModels: Array<{ pattern: string; label: string }>; tierRoles: Array<{ pattern: string; label: string }>;
  providerProfiles: Profiles;
}
export const KINDS = ['price_override', 'model_alias', 'provider_alias', 'provider_free', 'tier_model', 'tier_role', 'provider_profile'] as const;
export type RuleKind = (typeof KINDS)[number];
export interface RuleRow { kind: RuleKind; key: string; value: Record<string, unknown> }

const nz = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (v: unknown): number | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

export async function loadRuleRows(db: Db, companyId: string): Promise<RuleRow[]> {
  const rows = await db.query<{ kind: RuleKind; key: string; value: Record<string, unknown>; active: boolean }>(RULES_SQL, [companyId]);
  return rows.filter((r) => r.active).map((r) => ({ kind: r.kind, key: r.key, value: r.value ?? {} }));
}

export function foldRules(rows: RuleRow[]): Rules {
  const out: Rules = { overrides: [], modelAliases: {}, providerAliases: {}, freeProviders: [], tierModels: [], tierRoles: [], providerProfiles: mergeProfiles(rows.filter((r) => r.kind === 'provider_profile')) };
  for (const r of rows) {
    const v = r.value;
    if (r.kind === 'price_override') {
      const input = nz(v.input), output = nz(v.output);
      if (input !== null && output !== null) out.overrides.push({ key: r.key, input, output, cachedInput: nz(v.cachedInput), cacheWrite: nz(v.cacheWrite), from: ms(v.from), to: ms(v.to) });
    } else if (r.kind === 'model_alias' && typeof v.target === 'string') out.modelAliases[r.key.toLowerCase()] = v.target;
    else if (r.kind === 'provider_alias' && typeof v.target === 'string') out.providerAliases[r.key.toLowerCase()] = v.target.toLowerCase();
    else if (r.kind === 'provider_free') out.freeProviders.push(r.key.toLowerCase());
    else if (r.kind === 'tier_model' && typeof v.label === 'string') out.tierModels.push({ pattern: r.key, label: v.label });
    else if (r.kind === 'tier_role' && typeof v.label === 'string') out.tierRoles.push({ pattern: r.key, label: v.label });
  }
  return out;
}

const KEY_RE = /^[\w.*:/@ -]{1,120}$/;
/** Validates a rule written from the settings page. Throws a short message on bad input. */
export function validateRule(kind: unknown, key: unknown, value: unknown): { kind: RuleKind; key: string; value: Record<string, unknown> } {
  if (!KINDS.includes(kind as RuleKind)) throw new Error('Unknown rule type');
  if (typeof key !== 'string' || !KEY_RE.test(key.trim())) throw new Error('Invalid rule key');
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const k = key.trim();
  if (kind === 'price_override') {
    const input = nz(v.input), output = nz(v.output);
    if (input === null || output === null || input < 0 || output < 0 || input > 1000 || output > 5000) throw new Error('Input and output prices must be numbers between 0 and the allowed maximum');
    const cached = v.cachedInput === undefined || v.cachedInput === null || v.cachedInput === '' ? null : nz(v.cachedInput);
    const write = v.cacheWrite === undefined || v.cacheWrite === null || v.cacheWrite === '' ? null : nz(v.cacheWrite);
    if (cached !== null && (cached < 0 || cached > input)) throw new Error('Cached price must be between 0 and the input price');
    return { kind, key: k, value: { input, output, cachedInput: cached, cacheWrite: write, from: typeof v.from === 'string' && v.from ? v.from : null, to: typeof v.to === 'string' && v.to ? v.to : null } };
  }
  if (kind === 'model_alias' || kind === 'provider_alias') {
    if (typeof v.target !== 'string' || !KEY_RE.test(v.target.trim())) throw new Error('Target is required');
    return { kind, key: k, value: { target: v.target.trim() } };
  }
  if (kind === 'provider_profile') { const p = validateProfile(key, value); return { kind, key: p.key, value: p.value as unknown as Record<string, unknown> }; }
  if (kind === 'provider_free') return { kind, key: k.toLowerCase(), value: {} };
  if (typeof v.label !== 'string' || !v.label.trim() || v.label.length > 40) throw new Error('Tier label is required (40 characters at most)');
  return { kind: kind as RuleKind, key: k, value: { label: v.label.trim() } };
}
