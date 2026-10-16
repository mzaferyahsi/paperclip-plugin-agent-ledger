// Daily price refresh. Pure orchestration over injected dependencies so tests run offline.
// It only reads public price lists; nothing about the installation or its usage leaves the host.
import { randomUUID } from 'node:crypto';
import type { Db } from '../db.ts';
import type { Candidate, SourceKey } from './candidate.ts';
import { getSource, type HttpFetch } from './fetch.ts';
import { SOURCES } from './sources.ts';
import { changePct, sameprice, validateCandidate } from './validate.ts';
import { ACTIVE_LATEST_SQL, HELD_SQL, INSERT_COLLECTION_SQL, LEASE_SQL, RELEASE_SQL, VERIFY_SQL, ensureSnapshot, insertVersions, rowFromCandidate, type VersionRow, CHUNK } from './store.ts';

export interface RefreshConfig { sources: SourceKey[]; holdPercent: number }
export interface RefreshDeps {
  db: Db; http: HttpFetch; now: () => Date; config: RefreshConfig; uuid?: () => string; log?: (msg: string, meta?: Record<string, unknown>) => void;
}
export interface RefreshSummary {
  ran: boolean; reason?: string; sources: Record<string, string>; inserted: number; verified: number; held: number; invalid: number;
}

interface Active { id: string; provider_key: string; model_key: string; input: number; cached: number | null; cache_write: number | null; output: number }

export async function refreshPrices(deps: RefreshDeps): Promise<RefreshSummary> {
  const uuid = deps.uuid ?? randomUUID;
  const log = deps.log ?? (() => {});
  const summary: RefreshSummary = { ran: false, sources: {}, inserted: 0, verified: 0, held: 0, invalid: 0 };
  const startedAll = deps.now();
  await ensureSnapshot(deps.db, uuid, startedAll.toISOString());
  const enabled = deps.config.sources.filter((k) => SOURCES.some((s) => s.key === k));
  if (!enabled.length) { summary.reason = 'no sources enabled'; return summary; }

  const lease = await deps.db.execute(LEASE_SQL);
  if (lease.rowCount !== 1) { summary.reason = 'another refresh is running'; return summary; }
  summary.ran = true;
  try {
    const winners = new Map<string, Candidate>();
    for (const key of enabled) {
      const source = SOURCES.find((s) => s.key === key)!;
      const started = deps.now();
      const record = (status: 'ok' | 'failed', httpStatus: number | null, candidates: number, invalid: number, finding: string | null) =>
        deps.db.execute(INSERT_COLLECTION_SQL, [uuid(), key, started.toISOString(), deps.now().toISOString(), status, httpStatus, candidates, 0, 0, 0, invalid, finding]);
      const res = await getSource(deps.http, key);
      if (!res.ok) { summary.sources[key] = `failed (${res.error}${res.status ? ' ' + res.status : ''})`; await record('failed', res.status, 0, 0, res.error); continue; }
      const parsed = source.parse(res.body);
      if (!parsed.ok) { summary.sources[key] = `failed (${parsed.reason})`; await record('failed', res.status, 0, 0, `parse: ${parsed.reason}`); continue; }
      let invalid = 0;
      for (const c of parsed.candidates) {
        const problem = validateCandidate(c);
        if (problem) { invalid++; continue; }
        const id = `${c.providerKey}|${c.modelKey}`;
        if (!winners.has(id)) winners.set(id, c);
      }
      summary.invalid += invalid;
      summary.sources[key] = `ok (${parsed.candidates.length} prices, ${invalid} rejected)`;
      await record('ok', res.status, parsed.candidates.length, invalid, null);
    }
    if (!winners.size) return summary;

    const active = new Map((await deps.db.query<Active>(ACTIVE_LATEST_SQL)).map((r) => [`${r.provider_key}|${r.model_key}`, r]));
    const held = new Map((await deps.db.query<Active>(HELD_SQL)).map((r) => [`${r.provider_key}|${r.model_key}`, r]));
    const nowIso = deps.now().toISOString();
    const toInsert: VersionRow[] = [];
    const verifyIds: string[] = [];
    for (const [id, c] of winners) {
      const cur = active.get(id);
      const next = { input: c.input, cachedInput: c.cachedInput, cacheWrite: c.cacheWrite, output: c.output };
      if (!cur) { toInsert.push(rowFromCandidate(c, uuid(), 'active', nowIso)); continue; }
      const prev = { input: Number(cur.input), cachedInput: cur.cached === null ? null : Number(cur.cached), cacheWrite: cur.cache_write === null ? null : Number(cur.cache_write), output: Number(cur.output) };
      if (sameprice(prev, next)) { verifyIds.push(cur.id); continue; }
      const pct = changePct(prev, next);
      if (pct > deps.config.holdPercent) {
        const h = held.get(id);
        if (h && sameprice({ input: Number(h.input), cachedInput: h.cached === null ? null : Number(h.cached), cacheWrite: h.cache_write === null ? null : Number(h.cache_write), output: Number(h.output) }, next)) continue;
        toInsert.push(rowFromCandidate(c, uuid(), 'held', nowIso, pct));
        summary.held++;
      } else {
        toInsert.push(rowFromCandidate(c, uuid(), 'active', nowIso, pct));
      }
    }
    summary.inserted = await insertVersions(deps.db, toInsert.filter((r) => r.status === 'active'), nowIso);
    await insertVersions(deps.db, toInsert.filter((r) => r.status === 'held'), nowIso);
    for (let i = 0; i < verifyIds.length; i += CHUNK) await deps.db.execute(VERIFY_SQL, [JSON.stringify(verifyIds.slice(i, i + CHUNK)), nowIso]);
    summary.verified = verifyIds.length;
    log('price refresh finished', { ...summary });
    return summary;
  } finally {
    await deps.db.execute(RELEASE_SQL).catch(() => {});
  }
}
