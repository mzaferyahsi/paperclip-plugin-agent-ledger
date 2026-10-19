import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { globMatch, modelKey, providerKey } from '../src/keys.ts';
import { PriceBook } from '../src/prices/book.ts';
import { parseLitellm } from '../src/prices/parse-litellm.ts';
import { parseModelsDev } from '../src/prices/parse-models-dev.ts';
import { parseAnthropicOfficial, parseOpenAiOfficial } from '../src/prices/parse-official.ts';
import { changePct, validateCandidate } from '../src/prices/validate.ts';
import { ALLOWED_HOSTS, SOURCES } from '../src/prices/sources.ts';
import { getSource, isAllowedUrl, MAX_BODY_BYTES } from '../src/prices/fetch.ts';
import { costMicro } from '../src/cost.ts';
import { buildOrg, readConfig, DEFAULT_CONFIG, type AgentRow } from '../src/assemble.ts';
import { foldRules, validateRule } from '../src/rules.ts';
import { resolveRange } from '../src/time.ts';
import { expandedToLevel, fmtCost, fmtTokens, fmtUsd, toCsv, visibleRows, type TableState } from '../src/ui/model.ts';
import snapshot from '../src/prices/snapshot.json' with { type: 'json' };

test('modelKey collapses vendor, region, date and punctuation variants', () => {
  assert.equal(modelKey('us.anthropic.claude-opus-5-5-20260101-v1:0'), 'claude-opus-5-5');
  assert.equal(modelKey('zai-coding-plan/glm-5.3'), 'glm-5-3');
  assert.equal(modelKey('omniroute/lmstudio/qwen/qwen3-coder-next'), 'qwen3-coder-next');
  assert.equal(modelKey('GPT-6.1-Sol'), 'gpt-6-1-sol');
  assert.equal(modelKey('claude-3-5-sonnet-latest'), 'claude-3-5-sonnet');
  assert.equal(modelKey(null), '');
  assert.equal(providerKey('chatgpt'), 'openai');
  assert.equal(providerKey('x', { x: 'y' }), 'y');
  assert.ok(globMatch('claude-opus-*', 'claude-opus-5-5') && !globMatch('claude-opus-*', 'gpt-6'));
});

const entry = (provider: string, i: number, extra = {}) => [`${provider}-m${i}`, { mode: 'chat', litellm_provider: provider, input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 2e-7, ...extra }];
test('litellm parser: per-token to per-MTok, skips resold and non-chat entries, rejects thin files', () => {
  const body = JSON.stringify(Object.fromEntries([['sample_spec', { mode: 'chat' }], ...Array.from({ length: 30 }, (_, i) => entry('anthropic', i)), entry('bedrock_converse', 1), entry('anthropic', 99, { mode: 'embedding' })]));
  const r = parseLitellm(body);
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.candidates.length, 30); assert.deepEqual([r.candidates[0]!.input, r.candidates[0]!.cachedInput, r.candidates[0]!.output], [2, 0.2, 10]); }
  assert.equal(parseLitellm('{"a":1}').ok, false);
  assert.equal(parseLitellm('<html>').ok, false);
});
test('models.dev parser reads per-MTok costs', () => {
  const models = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`m${i}`, { cost: { input: 3, output: 15, cache_read: 0.3 } }]));
  const r = parseModelsDev(JSON.stringify({ acme: { models } }));
  assert.ok(r.ok && r.candidates.length === 30 && r.candidates[0]!.output === 15);
  assert.equal(parseModelsDev('[]').ok, false);
});
test('official page parsers read the live-format tables', () => {
  const a = parseAnthropicOfficial(`## Model pricing\n\n| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |\n|---|---|---|---|---|---|\n| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok |\n`);
  assert.ok(a.ok); if (a.ok) assert.deepEqual([a.candidates[0]!.modelKey, a.candidates[0]!.input, a.candidates[0]!.cachedInput, a.candidates[0]!.output], ['claude-opus-5-5', 4, 0.2, 20]);
  const o = parseOpenAiOfficial(`### Standard\n\n| Model | Input | Cached input | Output |\n|---|---|---|---|\n| gpt-6-luna | $0.10 | $0.01 | $0.50 |\n`);
  assert.ok(o.ok); if (o.ok) assert.equal(o.candidates[0]!.modelKey, 'gpt-6-luna');
  assert.equal(parseAnthropicOfficial('# nothing').ok, false);
});
test('price validation bounds and change percentage', () => {
  const base = { providerKey: 'p', modelKey: 'm', input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10, source: 'litellm' as const };
  assert.equal(validateCandidate(base), null);
  for (const bad of [{ input: -1 }, { input: 5000 }, { cachedInput: 3 }, { output: NaN }, { modelKey: '' }, { input: 0, output: 0 }]) assert.notEqual(validateCandidate({ ...base, ...bad }), null);
  assert.equal(changePct({ input: 2, cachedInput: null, cacheWrite: null, output: 10 }, { input: 3, cachedInput: null, cacheWrite: null, output: 10 }), 50);
  assert.equal(changePct({ input: 2, cachedInput: null, cacheWrite: null, output: 10 }, { input: 2, cachedInput: 0.1, cacheWrite: null, output: 10 }), 100);
});

test('price book: effective dating back-fills, prefers exact provider, overrides, aliases, free', () => {
  const v = (eff: number, input: number, provider = 'openai') => ({ providerKey: provider, modelKey: 'gpt-x', input, cachedInput: null, cacheWrite: null, output: input * 2, source: 'litellm', effectiveFrom: eff });
  const book = new PriceBook({ versions: [v(1000, 5), v(2000, 10), v(1500, 7, 'azure'), { ...v(0, 1, 'zai'), modelKey: 'glm-5-3' }], overrides: [{ key: '*/gpt-x', input: 99, output: 99, cachedInput: null, cacheWrite: null, from: 5000, to: 6000 }],
    modelAliases: { 'my/gpt': 'gpt-x' }, providerAliases: { chatgpt: 'openai' }, freeProviders: ['lmstudio'] });
  const at = (t: number, p = 'openai', m = 'gpt-x') => { const r = book.lookup(p, m, t); return r.kind === 'priced' ? r.price.input : r.kind; };
  assert.equal(at(0), 5, 'before the first version the first version applies');
  assert.equal(at(1999), 5); assert.equal(at(2000), 10);
  assert.equal(at(5500), 99, 'override window'); assert.equal(at(6000), 10);
  assert.equal(at(3000, 'chatgpt'), 10); assert.equal(at(3000, 'x', 'my/gpt'), 10);
  assert.equal(at(3000, 'unknown-provider'), 10, 'falls back to a preferred provider for the same model');
  assert.equal(at(1, 'lmstudio', 'whatever'), 'free'); assert.equal(at(1, 'openai', 'nope'), 'unpriced');
  assert.equal(at(1, 'zai-coding-plan', 'zai-coding-plan/glm-5.3'), 1);
});
test('override keys match the model name exactly as seen in usage', () => {
  const book = new PriceBook({ versions: [], overrides: [{ key: 'acme-local/acme-local/tiny-9b', input: 1, output: 2, cachedInput: null, cacheWrite: null, from: null, to: null }], modelAliases: {}, providerAliases: {}, freeProviders: [] });
  assert.equal(book.lookup('acme-local', 'acme-local/tiny-9b', 0).kind, 'priced');
  assert.equal(book.lookup('acme-local', 'other', 0).kind, 'unpriced');
});
test('cost arithmetic', () => {
  assert.equal(costMicro(1_000_000, 0, 0, { input: 2, cachedInput: null, cacheWrite: null, output: 10, source: 's', effectiveFrom: null }), 2_000_000);
  assert.equal(costMicro(0, 1_000_000, 0, { input: 2, cachedInput: 0.2, cacheWrite: null, output: 10, source: 's', effectiveFrom: null }), 200_000);
  assert.equal(costMicro(0, 1_000_000, 0, { input: 2, cachedInput: null, cacheWrite: null, output: 10, source: 's', effectiveFrom: null }), 2_000_000, 'missing cache price falls back to input');
});

const agent = (id: string, name: string, parent: string | null, status = 'idle', model = 'claude-opus-5-5'): AgentRow =>
  ({ agent_id: id, name, role: 'general', title: null, status, reports_to: parent, adapter_type: 'claude_local', configured_model: model, engine: null, last_heartbeat_at: null });
const usage = (agent_id: string, tokens: number, model = 'claude-opus-5-5', hour = 480000) => ({ agent_id, provider: 'anthropic', model, billing_type: 'sub', hour, input: tokens, cached: 0, output: 0, runs: 20 });
const range = resolveRange('7d', Date.parse('2026-10-16T12:00:00Z'), 'Europe/Amsterdam');
const book = new PriceBook({ versions: [{ providerKey: 'anthropic', modelKey: 'claude-opus-5-5', input: 4, cachedInput: 0.2, cacheWrite: null, output: 20, source: 'litellm', effectiveFrom: 0 }], overrides: [], modelAliases: {}, providerAliases: {}, freeProviders: [] });
const rules = foldRules([]);
const build = (agents: AgentRow[], u: ReturnType<typeof usage>[]) => buildOrg({ agents, usage: u, priorUsage: [], runs: [], book, rules, config: DEFAULT_CONFIG, range, firstEpoch: null });

test('tree: subtree equals own plus descendants; orphans and cycles stay visible and totals reconcile', () => {
  const o = build([agent('a', 'A', null), agent('b', 'B', 'a'), agent('c', 'C', 'b'), agent('x', 'X', 'dead'), agent('p', 'P', 'q'), agent('q', 'Q', 'p'), agent('t', 'T', 'a', 'terminated')],
    [usage('a', 100), usage('b', 200), usage('c', 300), usage('x', 40), usage('p', 5), usage('q', 6), usage('t', 7), usage('ghost', 9)]);
  assert.equal(o.nodes.a!.subtree.tokens, 600);
  assert.equal(o.nodes.b!.subtree.tokens, 500);
  assert.deepEqual(o.nodes.a!.children, ['b']);
  assert.deepEqual([o.nodes.a!.depth, o.nodes.b!.depth, o.nodes.c!.depth], [0, 1, 2]);
  assert.ok(o.unattached.includes('x') && o.unattached.includes('p') && o.unattached.includes('q'));
  assert.equal(o.terminated.own.tokens, 16, 'terminated agent and unknown agent id roll into one bucket');
  assert.equal(o.totals.tokens, 100 + 200 + 300 + 40 + 5 + 6 + 16);
});
test('flags: heavy, config mismatch, drift, low data, unpriced', () => {
  const agents = [agent('a', 'A', null), agent('b', 'B', 'a', 'idle', 'claude-fable-5-1'), agent('c', 'C', 'a')];
  const o = build(agents, [usage('a', 10), usage('b', 1000, 'claude-opus-5-5'), usage('c', 5), usage('c', 5, 'unknown-model-1', 479999)]);
  const codes = (id: string) => o.nodes[id]!.flags.map((f) => f.code);
  assert.ok(codes('b').includes('heavy') && codes('b').includes('cfg_not_actual'));
  assert.ok(codes('c').includes('drift') && codes('c').includes('unpriced'));
  assert.ok(codes('a').includes('cfg_not_actual') === false);
  assert.ok(codes('c').includes('low_data') === false, '20 runs per row is above the default threshold');
});
test('config and rules are validated, defaults are generic', () => {
  assert.deepEqual(readConfig(undefined).priceSources, ['anthropic-official', 'openai-official', 'litellm', 'models-dev']);
  assert.equal(readConfig({ heavyShareThreshold: 9999 }).heavyShareThreshold, 15);
  assert.deepEqual(readConfig({ priceSources: [] }).priceSources, []);
  assert.deepEqual(readConfig({ priceSources: ['evil.example', 'litellm'] }).priceSources, ['litellm']);
  assert.throws(() => validateRule('price_override', 'a/b', { input: -1, output: 1 }));
  assert.throws(() => validateRule('nope', 'a', {}));
  assert.throws(() => validateRule('tier_model', 'a;drop', { label: 'A' }));
  assert.equal(validateRule('provider_free', 'LMStudio', {}).key, 'lmstudio');
});

test('ui model: expand/collapse, filters keep ancestors, sort flattens, csv', () => {
  const o = build([agent('a', 'Alpha', null), agent('b', 'Beta', 'a'), agent('c', 'Gamma', 'b')], [usage('a', 1), usage('b', 2), usage('c', 30)]);
  const data = { ...o, generatedAt: '', pluginVersion: '', pricing: {} as never, errors: {} };
  const st = (over: Partial<TableState>): TableState => ({ expanded: new Set(), mode: 'both', sort: null, filters: { activity: '', adapter: '', model: '', tier: '', flagsOnly: false, q: '' }, ...over });
  assert.equal(visibleRows(data, st({})).filter((r) => r.kind === 'node').length, 1);
  assert.equal(visibleRows(data, st({ expanded: expandedToLevel(data, 3) })).filter((r) => r.kind === 'node').length, 3);
  const found = visibleRows(data, st({ filters: { activity: '', adapter: '', model: '', tier: '', flagsOnly: false, q: 'gamma' } })).filter((r) => r.kind === 'node');
  assert.equal(found.length, 3, 'search auto-expands the ancestors of a match');
  assert.equal(found.filter((r) => r.kind === 'node' && r.filteredManager).length, 2);
  const flat = visibleRows(data, st({ sort: { key: 'tokens', dir: -1 } })).filter((r) => r.kind === 'node');
  assert.deepEqual(flat.map((r) => r.kind === 'node' && r.node.name), ['Alpha', 'Beta', 'Gamma'], 'subtree totals sort managers first');
  assert.equal(visibleRows(data, st({ sort: { key: 'tokens', dir: -1 }, mode: 'own' })).filter((r) => r.kind === 'node').map((r) => r.kind === 'node' && r.node.name)[0], 'Gamma');
  const csv = toCsv(data, visibleRows(data, st({ expanded: expandedToLevel(data, 3) })), 'sub');
  assert.equal(csv.split('\n').length, 5);
  assert.deepEqual([fmtTokens(1_234_000_000), fmtTokens(5_400_000), fmtTokens(950), fmtUsd(1_500_000), fmtUsd(1_234_000_000)], ['1.23B', '5.4M', '950', '$1.50', '$1.2k']);
  assert.equal(fmtCost({ ...o.totals, pricedTokens: 0 }).text, '—');
});

test('outbound: only the four allowlisted hosts, only through prices/fetch.ts', async () => {
  assert.deepEqual([...ALLOWED_HOSTS].sort(), ['developers.openai.com', 'models.dev', 'platform.claude.com', 'raw.githubusercontent.com']);
  for (const s of SOURCES) assert.ok(isAllowedUrl(s.url));
  for (const bad of ['http://models.dev/api.json', 'https://evil.example/x', 'https://models.dev:8443/api.json', 'https://models.dev/api.json?x=1', 'https://u:p@models.dev/api.json']) assert.equal(isAllowedUrl(bad), false, bad);
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []; });
  for (const f of walk(new URL('../src', import.meta.url).pathname)) {
    if (f.endsWith('prices/fetch.ts') || f.endsWith('prices/sources.ts')) continue;
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text.replace(/\/\/.*$/gm, ''), /\bfetch\s*\(|XMLHttpRequest|https?:\/\/(?!www\.w3\.org)/, `${f} must not make or name outbound requests`);
  }
  // redirects off the allowlist and oversized bodies are refused
  const redirect = await getSource(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }), 'litellm');
  assert.deepEqual(redirect.ok ? null : redirect.error, 'redirect');
  const big = await getSource(async () => new Response('x', { status: 200, headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }), 'litellm');
  assert.deepEqual(big.ok ? null : big.error, 'too_large');
  const seen: string[] = [];
  await getSource(async (u, init) => { seen.push(u + JSON.stringify(init?.headers) + init?.credentials); return new Response('{}'); }, 'litellm');
  assert.match(seen[0]!, /omit/); assert.doesNotMatch(seen[0]!, /cookie|authorization/i);
});

test('bundled snapshot is present, sane and recent', () => {
  assert.ok(snapshot.rows.length > 1000);
  const age = (Date.now() - Date.parse(snapshot.date)) / 86_400_000;
  assert.ok(age < 120, `snapshot is ${Math.round(age)} days old; run npm run update-snapshot before releasing`);
  for (const r of snapshot.rows as unknown[][]) assert.ok(typeof r[0] === 'string' && typeof r[1] === 'string' && Number.isFinite(r[2] as number) && Number.isFinite(r[5] as number));
});

test('activity states, filter and sort rank', async () => {
  const { activityOf, matches, isDisabled, fmtAgo } = await import('../src/ui/model.ts');
  const mk = (status: string, runsTotal: number) => ({ status, own: { runsTotal } }) as never;
  assert.equal(activityOf(mk('running', 0)), 'running');
  assert.equal(activityOf(mk('idle', 3)), 'active');
  assert.equal(activityOf(mk('idle', 0)), 'quiet');
  assert.equal(activityOf(mk('paused', 9)), 'paused');
  assert.equal(isDisabled(mk('paused', 0)), true);
  assert.equal(isDisabled(mk('idle', 0)), false);
  const f = { activity: 'live', adapter: '', model: '', tier: '', flagsOnly: false, q: '' };
  assert.equal(matches(mk('idle', 2), f), true);
  assert.equal(matches(mk('idle', 0), f), false);
  assert.equal(matches(mk('paused', 2), f), false);
  assert.equal(fmtAgo(null), 'never');
});
