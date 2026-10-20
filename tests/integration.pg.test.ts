// Runs the real SQL against a throwaway Postgres with minimal host tables: aggregation, normalisation, bigint sums, pricing,
// terminated agents, the refresh job with a fake HTTP client, held changes and idempotence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startPg, type TestPg } from './pg-helper.ts';
import { NS } from '../src/namespace.ts';
import { Cache } from '../src/cache.ts';
import { DEFAULT_CONFIG, getAgentLedger } from '../src/assemble.ts';
import { refreshPrices } from '../src/prices/refresh.ts';
import { ensureSnapshot, loadVersions, HELD_SQL, DECIDE_HELD_SQL } from '../src/prices/store.ts';
import { INSERT_RULE_SQL } from '../src/rules.ts';

const C = '11111111-1111-1111-1111-111111111111';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-10-16T12:00:00Z');
let pg: TestPg | null = null;
let seq = 0;
const uuid = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

test.before(async () => {
  pg = await startPg();
  if (!pg) return;
  await pg.query(`CREATE TABLE public.agents (id uuid PRIMARY KEY, company_id uuid NOT NULL, name text NOT NULL, role text NOT NULL, title text, status text NOT NULL, reports_to uuid, adapter_type text NOT NULL, adapter_config jsonb NOT NULL DEFAULT '{}', last_heartbeat_at timestamptz)`);
  await pg.query(`CREATE TABLE public.cost_events (id bigserial PRIMARY KEY, company_id uuid NOT NULL, agent_id uuid NOT NULL, heartbeat_run_id uuid, provider text NOT NULL, biller text, billing_type text NOT NULL DEFAULT 'subscription_included', model text NOT NULL, input_tokens integer NOT NULL, cached_input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL, occurred_at timestamptz NOT NULL)`);
  await pg.query(`CREATE TABLE public.heartbeat_runs (id uuid PRIMARY KEY, company_id uuid NOT NULL, agent_id uuid NOT NULL, status text NOT NULL, started_at timestamptz NOT NULL, usage_json jsonb)`);
  await pg.query(`CREATE SCHEMA ${NS}`);
  const mig = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
  await pg.query(mig);
  const agent = (n: number, name: string, role: string, status: string, parent: number | null, adapter: string, model: string | null) =>
    pg!.query(`INSERT INTO public.agents VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8::jsonb,NULL)`, [id(n), C, name, role, status, parent ? id(parent) : null, adapter, JSON.stringify(model ? { model, engine: 'cli', access: { SECRET: 'must-not-leak' } } : {})]);
  await agent(1, 'Root', 'ceo', 'idle', null, 'claude_local', 'claude-opus-5-5');
  await agent(2, 'Mid', 'cto', 'idle', 1, 'claude_local', 'claude-sonnet-5-5');
  await agent(3, 'Leaf', 'engineer', 'running', 2, 'codex_local', 'gpt-6-luna');
  await agent(4, 'Gone', 'engineer', 'terminated', 2, 'codex_local', 'gpt-6-luna');
  const ev = (agent: number, provider: string, model: string, input: number, cached: number, output: number, at: string) =>
    pg!.query(`INSERT INTO public.cost_events (company_id, agent_id, heartbeat_run_id, provider, model, input_tokens, cached_input_tokens, output_tokens, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [C, id(agent), uuid(), provider, model, input, cached, output, at]);
  await ev(1, 'anthropic', 'claude-opus-5-5', 1000, 5000, 200, '2026-10-15T10:00:00Z');
  await ev(2, 'anthropic', 'claude-sonnet-5-5', 2000, 10000, 400, '2026-10-15T11:00:00Z');
  await ev(3, 'openai', 'gpt-6-luna', 3000, 2000, 100, '2026-10-15T12:00:00Z');       // OpenAI input includes cached: uncached = 1000
  await ev(3, 'openai', 'gpt-6-luna', 2_000_000_000, 0, 0, '2026-10-15T13:00:00Z');   // proves bigint sums past 2^31
  await ev(3, 'openai', 'gpt-6-luna', 2_000_000_000, 0, 0, '2026-10-15T14:00:00Z');
  await ev(4, 'openai', 'mystery-model-9', 500, 0, 50, '2026-10-15T15:00:00Z');
  await pg.query(`INSERT INTO public.heartbeat_runs VALUES ($1,$2,$3,'failed','2026-10-15T10:00:00Z',NULL)`, [uuid(), C, id(3)]);
  await ensureSnapshot(pg, uuid, new Date(NOW).toISOString());
});
test.after(async () => { await pg?.stop(); });

const env = () => ({ db: pg!, config: DEFAULT_CONFIG, now: () => NOW, cache: new Cache(), pluginVersion: 'test' });

test('org tree sums, normalisation, bigint and pricing reconcile', { skip: process.env.SKIP_PG === '1' }, async (t) => {
  if (!pg) return t.skip('embedded postgres not available');
  const d = await getAgentLedger(env(), C, { from: '2026-10-14', to: '2026-10-16' });
  assert.deepEqual(d.errors, {});
  assert.deepEqual(d.roots, [id(1)]);
  const leaf = d.nodes[id(3)]!, mid = d.nodes[id(2)]!, root = d.nodes[id(1)]!;
  assert.equal(leaf.own.input, 1000 + 4_000_000_000);          // OpenAI uncached input, summed as bigint
  assert.equal(leaf.own.cached, 2000);
  assert.equal(mid.own.input, 2000);                           // Anthropic input is already exclusive
  assert.equal(root.subtree.tokens, root.own.tokens + mid.own.tokens + leaf.own.tokens);
  assert.equal(d.terminated.count, 1);
  assert.equal(d.terminated.withUsage, 1);
  assert.equal(d.totals.tokens, root.subtree.tokens + d.terminated.own.tokens);   // terminated rolls into totals
  assert.equal(leaf.own.runsTotal, 1);
  assert.equal(leaf.own.runsFailed, 1);
  assert.ok(leaf.own.pricedTokens === leaf.own.tokens && leaf.own.costMicro > 0, 'snapshot prices gpt-6-luna');
  assert.equal(d.terminated.own.unpricedTokens, 550, 'unknown model is unpriced, never $0');
  assert.ok(d.pricing.unmatchedModels.some((m) => m.model === 'mystery-model-9'));
  assert.equal(JSON.stringify(d).includes('must-not-leak'), false, 'adapter_config secrets never leave the worker');
  assert.equal(leaf.configuredModel, 'gpt-6-luna');
  assert.equal(leaf.flags.some((f) => f.code === 'heavy'), true);
});

test('company scoping: another company sees nothing', async (t) => {
  if (!pg) return t.skip('no pg');
  const d = await getAgentLedger(env(), '22222222-2222-2222-2222-222222222222', '7d');
  assert.equal(Object.keys(d.nodes).length, 0);
  assert.equal(d.totals.tokens, 0);
});

test('rules: override prices win, free providers show no cost, aliases map names', async (t) => {
  if (!pg) return t.skip('no pg');
  await pg.execute(INSERT_RULE_SQL, [C, 'price_override', 'openai/gpt-6-luna', JSON.stringify({ input: 1, output: 1, cachedInput: 1 }), true, 'u1']);
  await pg.execute(INSERT_RULE_SQL, [C, 'provider_free', 'anthropic', '{}', true, 'u1']);
  const d = await getAgentLedger(env(), C, { from: '2026-10-14', to: '2026-10-16' });
  const leaf = d.nodes[id(3)]!;
  assert.equal(leaf.own.costMicro, leaf.own.tokens, '$1 per MTok on every token = tokens micro-USD');
  assert.equal(d.nodes[id(2)]!.own.freeTokens, d.nodes[id(2)]!.own.tokens);
  assert.equal(d.nodes[id(2)]!.own.pricedTokens, 0);
  await pg.execute(INSERT_RULE_SQL, [C, 'price_override', 'openai/gpt-6-luna', '{}', false, 'u1']);
  await pg.execute(INSERT_RULE_SQL, [C, 'provider_free', 'anthropic', '{}', false, 'u1']);
});

const litellm = (price: number) => JSON.stringify(Object.fromEntries([['sample_spec', {}], ...Array.from({ length: 30 }, (_, i) => [`m-${i}`, { mode: 'chat', litellm_provider: 'acme', input_cost_per_token: price * 1e-6, output_cost_per_token: price * 2e-6 }])]));
const httpFor = (bodies: Record<string, string | number>) => async (url: string): Promise<Response> => {
  const hit = Object.entries(bodies).find(([host]) => url.includes(host));
  if (!hit) return new Response('nope', { status: 404 });
  return typeof hit[1] === 'number' ? new Response('err', { status: hit[1] }) : new Response(hit[1], { status: 200 });
};

test('refresh: inserts, is idempotent, holds big changes, survives a failing source', async (t) => {
  if (!pg) return t.skip('no pg');
  const cfg = { sources: ['litellm', 'models-dev', 'anthropic-official'] as never, holdPercent: 50 };
  const base = { db: pg, config: cfg, uuid, log: () => {} };
  const r1 = await refreshPrices({ ...base, http: httpFor({ 'raw.githubusercontent.com': litellm(10), 'models.dev': 500, 'platform.claude.com': 'not a table' }), now: () => new Date(NOW) });
  assert.equal(r1.ran, true);
  assert.match(r1.sources['litellm']!, /^ok/);
  assert.match(r1.sources['models-dev']!, /^failed/);
  assert.match(r1.sources['anthropic-official']!, /^failed/);
  assert.equal(r1.inserted, 30);
  const r2 = await refreshPrices({ ...base, http: httpFor({ 'raw.githubusercontent.com': litellm(10) }), now: () => new Date(NOW + 86_400_000) });
  assert.equal(r2.inserted, 0, 'same prices again create no new versions');
  assert.equal(r2.verified, 30);
  const r3 = await refreshPrices({ ...base, http: httpFor({ 'raw.githubusercontent.com': litellm(11) }), now: () => new Date(NOW + 2 * 86_400_000) });
  assert.equal(r3.inserted, 30, 'a 10% change is applied');
  const r4 = await refreshPrices({ ...base, http: httpFor({ 'raw.githubusercontent.com': litellm(100) }), now: () => new Date(NOW + 3 * 86_400_000) });
  assert.equal(r4.held, 30, 'a 900% change is held, not applied');
  const active = (await loadVersions(pg)).filter((v) => v.modelKey === 'm-0');
  assert.equal(active.length, 2);
  assert.equal(Math.max(...active.map((v) => v.input)), 11, 'held price is not in force');
  const held = await pg.query<{ id: string }>(HELD_SQL);
  assert.equal(held.length, 30);
  await pg.execute(DECIDE_HELD_SQL, [held[0]!.id, 'active', new Date(NOW + 4 * 86_400_000).toISOString()]);
  assert.equal((await loadVersions(pg)).filter((v) => v.input === 100).length, 1);
  const none = await refreshPrices({ ...base, config: { ...cfg, sources: [] }, http: httpFor({}), now: () => new Date(NOW) });
  assert.equal(none.ran, false);
});

test('refresh: concurrent runs are blocked by the lease', async (t) => {
  if (!pg) return t.skip('no pg');
  const mk = (n: number) => refreshPrices({ db: pg!, config: { sources: ['litellm'] as never, holdPercent: 50 }, uuid, http: httpFor({ 'raw.githubusercontent.com': litellm(10) }), now: () => new Date(NOW + 9e9 + n) });
  const [a, b] = await Promise.all([mk(1), mk(2)]);
  assert.equal([a, b].filter((r) => r.ran).length >= 1, true);
});test('inclusive providers: input already without the cached part (cached > input) is kept, not zeroed', async (t) => {
  if (!pg) return t.skip('no postgres');
  const { usageQuery } = await import('../src/sql.ts');
  const ins = (model: string, input: number, cached: number) => pg!.query(`INSERT INTO public.cost_events (company_id, agent_id, heartbeat_run_id, provider, model, input_tokens, cached_input_tokens, output_tokens, occurred_at) VALUES ($1,$2,$3,'openai',$4,$5,$6,1,'2026-09-01T10:00:00Z')`, [C, id(3), uuid(), model, input, cached]);
  await ins('incl-model', 3000, 2000);   // newer Codex runs: input includes cached, uncached = 1000
  await ins('excl-model', 1000, 5000);   // older Codex and OpenCode runs: input already uncached
  const q = usageQuery(C, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', ['openai']);
  const rows = await pg!.query<{ model: string; input: string }>(q.sql, q.params);
  assert.equal(Number(rows.find((r) => r.model === 'incl-model')!.input), 1000);
  assert.equal(Number(rows.find((r) => r.model === 'excl-model')!.input), 1000);
  await pg!.query("DELETE FROM public.cost_events WHERE occurred_at < '2026-09-02'");
});


