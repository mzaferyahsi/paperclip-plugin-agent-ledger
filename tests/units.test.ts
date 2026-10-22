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
  const o2 = build([agent('a', 'Alpha', null, 'running'), agent('b', 'Beta', 'a', 'running'), agent('c', 'Gamma', 'b', 'running')], []);
  const d2 = { ...o2, generatedAt: '', pluginVersion: '', pricing: {} as never, errors: {} };
  const act = visibleRows(d2, st({ filters: { activity: 'live', adapter: '', model: '', tier: '', flagsOnly: false, q: '' } })).filter((r) => r.kind === 'node');
  assert.deepEqual(act.map((r) => r.kind === 'node' && r.depth), [0, 1, 2], 'any filter keeps the org tree open, with indentation');
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
    if (f.endsWith('ui/hostapi.ts')) { // the one UI file that calls the host itself: same-origin /api/ paths only, never another host
      const code = text.replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(code, /https?:\/\/|XMLHttpRequest/);
      assert.equal((code.match(/\bfetch\s*\(/g) ?? []).length, 1);
      for (const m of code.matchAll(/call<[^>]*>\(\s*[`'"]([^`'"]*)/g)) assert.match(m[1]!, /^\/api\//, 'host calls must be same-origin /api/ paths');
      continue;
    }
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

test('the page opens on the Running or active filter, and only idle or errored agents can be run', async () => {
  const { INITIAL_FILTERS, isRunnable, matches } = await import('../src/ui/model.ts');
  assert.equal(INITIAL_FILTERS.activity, '', 'every agent is listed by default, including agents with no runs');
  const mk = (status: string, runsTotal: number) => ({ status, own: { runsTotal } }) as never;
  assert.equal(matches(mk('idle', 2), INITIAL_FILTERS), true);
  assert.equal(matches(mk('idle', 0), INITIAL_FILTERS), true, 'agents with no runs are listed');
  assert.equal(matches(mk('idle', 0), { ...INITIAL_FILTERS, activity: 'live' }), false, 'the running or active filter still hides them');
  assert.equal(isRunnable(mk('idle', 0)), true);
  assert.equal(isRunnable(mk('error', 0)), true, 'an agent in error can be retried');
  assert.equal(isRunnable(mk('running', 3)), false);
  assert.equal(isRunnable(mk('paused', 3)), false);
});

test('manual runs: ids are validated and capped, and only idle or errored agents of the company are started', async () => {
  const { parseRunIds, planRuns, MAX_RUN, RUN_PROMPT } = await import('../src/run.ts');
  const { MAX_RUN: UI_MAX } = await import('../src/ui/model.ts');
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  assert.equal(UI_MAX, MAX_RUN, 'the page and the worker agree on the cap');
  assert.deepEqual(parseRunIds([id(1), id(1), id(2).toUpperCase()]), [id(1), id(2)], 'duplicates collapse, case is ignored');
  for (const bad of [undefined, [], 'x', [1], ['not-a-uuid'], Array.from({ length: MAX_RUN + 1 }, (_, i) => id(i + 1))]) assert.throws(() => parseRunIds(bad), /agent|Choose|at most/i);
  const agents = [{ agent_id: id(1), name: 'Idle', status: 'idle' }, { agent_id: id(2), name: 'Busy', status: 'running' }, { agent_id: id(3), name: 'Off', status: 'paused' }, { agent_id: id(4), name: 'Hold', status: 'pending_approval' }, { agent_id: id(5), name: 'Broken', status: 'error' }, { agent_id: id(6), name: 'Gone', status: 'terminated' }];
  const plan = planRuns([id(1), id(2), id(3), id(4), id(5), id(6), id(7)], agents);
  assert.deepEqual(plan.map((p) => [p.name === p.id ? 'unknown' : p.name, p.action, p.reason]), [['Idle', 'run', null], ['Busy', 'skip', 'Already running'], ['Off', 'skip', 'Paused'], ['Hold', 'skip', 'Waiting for approval'], ['Broken', 'run', null], ['Gone', 'skip', 'Terminated'], ['unknown', 'skip', 'Agent not found']]);
  assert.match(RUN_PROMPT, /inbox/);
});

test('capabilities: the only agent capability is invoke, used only by the board-only run action', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as { capabilities: string[] };
  assert.deepEqual(manifest.capabilities.filter((c) => c.startsWith('agents.')), ['agents.invoke']);
  const worker = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
  assert.equal([...worker.matchAll(/ctx\.agents\./g)].length, 1, 'one use of the agents API');
  assert.doesNotMatch(worker, /ctx\.agents\.(pause|resume|list|get)/);
  const i = worker.indexOf("actions.register('agents.run'");
  assert.match(worker.slice(i, i + 400), /requireBoard\(a\.actor, 'run agents'\)/, 'the run action checks the board first');
});

// --- provider profiles and model change (src/provider.ts) ---
import { DEFAULT_PROFILES, buildNextConfig, diffConfig, mergeProfiles, needsSessionReset, validateProfile } from '../src/provider.ts';

const codexCfg = { cwd: '/w', env: { A: { type: 'secret_ref', secretId: 's' } }, 'access.X': { secretId: 'y' }, instructionsFilePath: '/i.md', paperclipSkillSync: { on: true }, model: 'gpt-6.1-sol', engine: 'cli', mode: 'persistent', modelReasoningEffort: 'medium', dangerouslyBypassApprovalsAndSandbox: true };

test('moving codex to claude keeps agent-owned keys and drops provider keys', () => {
  const next = buildNextConfig(codexCfg, 'codex_local', 'claude_local', 'claude-sonnet-5-5', DEFAULT_PROFILES.claude_local);
  assert.deepEqual(next, { cwd: '/w', env: codexCfg.env, 'access.X': codexCfg['access.X'], instructionsFilePath: '/i.md', paperclipSkillSync: { on: true }, engine: 'cli', mode: 'persistent', model: 'claude-sonnet-5-5' });
});
test('same provider keeps every key; reasoning effort is kept or chosen', () => {
  const keep = buildNextConfig(codexCfg, 'codex_local', 'codex_local', 'gpt-6-luna', DEFAULT_PROFILES.codex_local);
  assert.equal(keep.dangerouslyBypassApprovalsAndSandbox, true); assert.equal(keep.modelReasoningEffort, 'medium'); assert.equal(keep.model, 'gpt-6-luna');
  assert.equal(buildNextConfig(codexCfg, 'codex_local', 'codex_local', 'gpt-6-luna', DEFAULT_PROFILES.codex_local, 'high').modelReasoningEffort, 'high');
  assert.equal(buildNextConfig({ model: 'x' }, 'claude_local', 'codex_local', 'gpt-6-luna', DEFAULT_PROFILES.codex_local, 'bogus').modelReasoningEffort, 'medium');
});
test('the diff never shows env or access secrets', () => {
  const next = buildNextConfig(codexCfg, 'codex_local', 'claude_local', 'claude-sonnet-5-5', DEFAULT_PROFILES.claude_local);
  const keys = diffConfig(codexCfg, next, 'codex_local', 'claude_local').map((c) => c.key);
  assert.deepEqual(keys, ['adapterType', 'dangerouslyBypassApprovalsAndSandbox', 'model', 'modelReasoningEffort']);
  assert.equal(needsSessionReset(codexCfg, 'codex_local', 'codex_local', 'gpt-6.1-sol'), false);
  assert.equal(needsSessionReset(codexCfg, 'codex_local', 'codex_local', 'other'), true);
});
test('a model name with shell or path tricks is refused', () => {
  for (const m of ['', 'a;rm -rf', 'a$(b)', 'x'.repeat(130), 'a\nb']) assert.throws(() => buildNextConfig({}, 'a', 'b', m, undefined));
});
test('profiles cannot touch secrets, env, cwd, instructions or the model', () => {
  for (const k of ['env', 'cwd', 'access.K', 'instructionsFilePath', 'apiKey', 'OAUTH_TOKEN', 'model', 'secretRef'])
    assert.throws(() => validateProfile('claude_local', { label: 'x', set: { [k]: 'v' } }), /cannot be set/);
  assert.throws(() => validateProfile('claude_local', { label: 'x', drop: ['env'] }), /cannot be removed/);
  assert.throws(() => validateProfile('Bad-Name', { label: 'x' }));
  assert.throws(() => validateProfile('claude_local', { label: '' }));
  assert.throws(() => validateProfile('claude_local', { label: 'x', set: { engine: { a: 1 } } }));
  const ok = validateProfile('gemini_local', { label: 'Gemini', set: { engine: 'cli', n: 3, b: true }, drop: ['effort'], reasoning: true });
  assert.equal(ok.key, 'gemini_local'); assert.equal(ok.value.reasoningDefault, 'medium');
});
test('saved profiles overlay the standard ones and bad rows are ignored', () => {
  const m = mergeProfiles([{ key: 'claude_local', value: { label: 'Claude custom', set: { engine: 'acp' } } }, { key: 'broken', value: { label: '', set: { env: 1 } } }, { key: 'x_local', value: { label: 'X' } }]);
  assert.equal(m.claude_local!.label, 'Claude custom'); assert.equal(m.codex_local!.label, DEFAULT_PROFILES.codex_local!.label);
  assert.ok(m.x_local); assert.equal(m.broken, undefined);
});

import { planAiBinding } from '../src/provider.ts';
test('the AI connection binding moves with the provider', () => {
  const openai = { mode: 'responsible_user', provider: 'openai', method: 'subscription' };
  assert.deepEqual(planAiBinding(openai, 'codex_local', 'gpt-6-luna'), { action: 'keep' });
  assert.deepEqual(planAiBinding(undefined, 'claude_local', 'x'), { action: 'keep' });
  const p = planAiBinding(openai, 'claude_local', 'claude-sonnet-5-5');
  assert.equal(p.action, 'set'); if (p.action === 'set') assert.deepEqual(p.binding, { mode: 'responsible_user', provider: 'anthropic', method: 'subscription' });
  const api = planAiBinding({ mode: 'responsible_user', provider: 'anthropic', method: 'api_key' }, 'codex_local', 'gpt-6-luna');
  if (api.action === 'set') assert.deepEqual(api.binding, { mode: 'responsible_user', provider: 'openai', method: 'api_key' }); else assert.fail('expected set');
  assert.equal(planAiBinding(openai, 'opencode_local', 'omniroute/at-developer').action, 'blocked');
  assert.equal(planAiBinding(openai, 'opencode_local', 'openrouter/x').action, 'set');
  // a shared connection is replaced by the user's own sign-in, and the preview says so
  const sh = planAiBinding({ mode: 'shared', provider: 'openai', method: 'api_key', connectionId: 'c', grantId: 'g' }, 'claude_local', 'm');
  assert.equal(sh.action, 'set'); if (sh.action === 'set') assert.match(sh.from, /shared/);
});

import { agentInsights, modelSwitches } from '../src/ui/insights.ts';
import { zeroSums, type AgentDetailData } from '../src/types.ts';
test('model switches are found from the leading model per day', () => {
  const b = (label: string, byModel: Record<string, number>): AgentDetailData['buckets'][number] => {
    const tokens = Object.values(byModel).reduce((a, v) => a + v, 0);
    return { key: label, label, tokens, input: tokens, cached: 0, output: 0, costMicro: tokens, runs: 1, byModel: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { tokens: v, costMicro: v }])) };
  };
  const d = { agentId: 'x', granularity: 'day', timezone: 'UTC', range: {} as never, models: [], sums: { ...zeroSums(), tokens: 600 }, prior: zeroSums(),
    buckets: [b('2026-10-01', { 'a|m1': 100 }), b('2026-10-02', {}), b('2026-10-03', { 'a|m1': 100, 'a|m2': 300 }), b('2026-10-04', { 'a|m2': 100 })] } as AgentDetailData;
  const sw = modelSwitches(d);
  assert.equal(sw.length, 1);
  assert.deepEqual([sw[0]!.from, sw[0]!.to, sw[0]!.at], ['m1', 'm2', '2026-10-03']);
  assert.equal(agentInsights({} as never, { ...d, sums: zeroSums() }, {} as never, false)[0]!.text.includes('no recorded usage'), true);
});
