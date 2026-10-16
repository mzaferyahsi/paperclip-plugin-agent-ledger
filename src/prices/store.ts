import { NS } from '../namespace.ts';
import type { Db } from '../db.ts';
import type { Candidate } from './candidate.ts';
import type { PriceVersion } from './book.ts';
import snapshot from './snapshot.json' with { type: 'json' };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const ACTIVE_LATEST_SQL = `SELECT DISTINCT ON (v.provider_key, v.model_key) v.provider_key, v.model_key, v.input_per_mtok::float8 AS input, v.cached_input_per_mtok::float8 AS cached,
  v.cache_write_per_mtok::float8 AS cache_write, v.output_per_mtok::float8 AS output, v.source, v.id::text AS id
FROM ${NS}.price_versions v WHERE v.status = 'active' ORDER BY v.provider_key, v.model_key, v.effective_from DESC`;

export const HELD_SQL = `SELECT DISTINCT ON (v.provider_key, v.model_key) v.id::text AS id, v.provider_key, v.model_key, v.input_per_mtok::float8 AS input, v.cached_input_per_mtok::float8 AS cached,
  v.cache_write_per_mtok::float8 AS cache_write, v.output_per_mtok::float8 AS output, v.source, v.change_pct::float8 AS change_pct, v.retrieved_at
FROM ${NS}.price_versions v WHERE v.status = 'held' ORDER BY v.provider_key, v.model_key, v.effective_from DESC`;

export const ALL_ACTIVE_SQL = `SELECT v.provider_key, v.model_key, v.input_per_mtok::float8 AS input, v.cached_input_per_mtok::float8 AS cached, v.cache_write_per_mtok::float8 AS cache_write,
  v.output_per_mtok::float8 AS output, v.source, (floor(date_part('epoch', v.effective_from)) * 1000)::float8 AS eff_ms
FROM ${NS}.price_versions v WHERE v.status = 'active'`;

export const INSERT_VERSIONS_SQL = `INSERT INTO ${NS}.price_versions (id, provider_key, model_key, input_per_mtok, cached_input_per_mtok, cache_write_per_mtok, output_per_mtok, source, status, effective_from, retrieved_at, last_verified_at, change_pct)
SELECT r.id::uuid, r.provider_key, r.model_key, r.input, r.cached, r.cache_write, r.output, r.source, r.status, r.effective_from::timestamptz, $2::timestamptz, $2::timestamptz, r.change_pct
FROM jsonb_to_recordset($1::jsonb) AS r(id text, provider_key text, model_key text, input numeric, cached numeric, cache_write numeric, output numeric, source text, status text, effective_from text, change_pct numeric)
ON CONFLICT (provider_key, model_key, effective_from) DO NOTHING`;

export const VERIFY_SQL = `UPDATE ${NS}.price_versions SET last_verified_at = $2::timestamptz WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)`;
export const COUNT_SQL = `SELECT COUNT(*)::bigint AS n FROM ${NS}.price_versions v`;
export const INSERT_COLLECTION_SQL = `INSERT INTO ${NS}.price_collections (id, source, started_at, finished_at, status, http_status, candidates, inserted, verified, held, invalid, finding)
VALUES ($1::uuid, $2::text, $3::timestamptz, $4::timestamptz, $5::text, $6::integer, $7::integer, $8::integer, $9::integer, $10::integer, $11::integer, $12::text)`;
export const RECENT_COLLECTIONS_SQL = `SELECT DISTINCT ON (c.source) c.source, c.status, c.finished_at, c.candidates, c.inserted, c.held, c.invalid, c.finding
FROM ${NS}.price_collections c ORDER BY c.source, c.finished_at DESC`;
export const LAST_OK_SQL = `SELECT MAX(c.finished_at) AS at FROM ${NS}.price_collections c WHERE c.status = 'ok'`;
export const LEASE_SQL = `INSERT INTO ${NS}.collection_lock (singleton, lease_until) VALUES (true, now() + interval '10 minutes')
ON CONFLICT (singleton) DO UPDATE SET lease_until = EXCLUDED.lease_until WHERE ${NS}.collection_lock.lease_until < now()`;
export const RELEASE_SQL = `UPDATE ${NS}.collection_lock SET lease_until = now() WHERE singleton = true`;
export const DECIDE_HELD_SQL = `UPDATE ${NS}.price_versions SET status = $2::text, effective_from = CASE WHEN $2::text = 'active' THEN $3::timestamptz ELSE effective_from END
WHERE id = $1::uuid AND status = 'held'`;

export interface VersionRow { id: string; provider_key: string; model_key: string; input: number; cached: number | null; cache_write: number | null; output: number; source: string; status: 'active' | 'held'; effective_from: string; change_pct: number | null }
export const CHUNK = 400;

export async function insertVersions(db: Db, rows: VersionRow[], nowIso: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await db.execute(INSERT_VERSIONS_SQL, [JSON.stringify(rows.slice(i, i + CHUNK)), nowIso]);
    n += r.rowCount;
  }
  return n;
}

export function rowFromCandidate(c: Candidate, id: string, status: 'active' | 'held', effectiveFrom: string, changePct: number | null = null): VersionRow {
  return { id, provider_key: c.providerKey, model_key: c.modelKey, input: c.input, cached: c.cachedInput, cache_write: c.cacheWrite, output: c.output, source: c.source, status, effective_from: effectiveFrom, change_pct: changePct };
}

/** Seed the bundled snapshot into an empty price table so history is priced from the first page view. */
export async function ensureSnapshot(db: Db, uuid: () => string, nowIso: string): Promise<number> {
  const [c] = await db.query<{ n: unknown }>(COUNT_SQL);
  if (Number(c?.n ?? 0) > 0) return 0;
  const rows: VersionRow[] = (snapshot.rows as Array<[string, string, number, number | null, number | null, number]>).map(([p, m, i, ca, cw, o]) =>
    ({ id: uuid(), provider_key: p, model_key: m, input: i, cached: ca, cache_write: cw, output: o, source: 'snapshot', status: 'active' as const, effective_from: '1970-01-01T00:00:00Z', change_pct: null }));
  return insertVersions(db, rows, nowIso);
}

export async function loadVersions(db: Db): Promise<PriceVersion[]> {
  const rows = await db.query<Record<string, unknown>>(ALL_ACTIVE_SQL);
  return rows.map((r) => ({ providerKey: String(r.provider_key), modelKey: String(r.model_key), input: Number(r.input), cachedInput: num(r.cached), cacheWrite: num(r.cache_write), output: Number(r.output), source: String(r.source), effectiveFrom: Number(r.eff_ms) }));
}
export const snapshotMeta = { date: snapshot.date as string, rows: snapshot.rows.length };

export const SEEN_UPSERT_SQL = `INSERT INTO ${NS}.company_seen (company_id, seen_at) VALUES ($1::uuid, now())
ON CONFLICT (company_id) DO UPDATE SET seen_at = EXCLUDED.seen_at`;
export const SEEN_LATEST_SQL = `SELECT s.company_id::text AS company_id FROM ${NS}.company_seen s ORDER BY s.seen_at DESC LIMIT 1`;
