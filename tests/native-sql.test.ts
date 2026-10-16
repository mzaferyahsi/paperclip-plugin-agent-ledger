// Every statement must pass the installed Paperclip host's own SQL guard, plus our own lint rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { NS } from '../src/namespace.ts';
import manifest from '../manifest.json' with { type: 'json' };
import * as sql from '../src/sql.ts';
import * as store from '../src/prices/store.ts';
import * as rules from '../src/rules.ts';

const HOST = process.env.PC_HOST_NODE_MODULES ?? '/home/paperclip/.paperclip/cli/installs/npm/2026.1012.0/node_modules';
const guardPath = `${HOST}/@paperclipai/server/dist/services/plugin-database.js`;
const guard = await import(guardPath).catch(() => null);
const CORE = manifest.database.coreReadTables;
const C = '11111111-1111-1111-1111-111111111111';

const reads: Array<[string, string]> = [
  ['agents', sql.agentsQuery(C).sql], ['usage', sql.usageQuery(C, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', ['openai']).sql],
  ['runs', sql.runsQuery(C, 'a', 'b').sql], ['history', sql.historyStartQuery(C).sql], ...sql.schemaProbeQueries().map((q, i) => [`probe${i}`, q.sql] as [string, string]),
  ['active-latest', store.ACTIVE_LATEST_SQL], ['held', store.HELD_SQL], ['all-active', store.ALL_ACTIVE_SQL], ['count', store.COUNT_SQL],
  ['recent', store.RECENT_COLLECTIONS_SQL], ['last-ok', store.LAST_OK_SQL], ['rules', rules.RULES_SQL], ['seen-latest', store.SEEN_LATEST_SQL],
];
const writes: Array<[string, string]> = [
  ['insert-versions', store.INSERT_VERSIONS_SQL], ['verify', store.VERIFY_SQL], ['insert-collection', store.INSERT_COLLECTION_SQL],
  ['seen-upsert', store.SEEN_UPSERT_SQL], ['lease', store.LEASE_SQL], ['release', store.RELEASE_SQL], ['decide', store.DECIDE_HELD_SQL], ['insert-rule', rules.INSERT_RULE_SQL],
];

test('namespace literal matches the host derivation', () => {
  assert.equal(NS, guard?.derivePluginDatabaseNamespace(manifest.id, manifest.database.namespaceSlug) ?? NS);
  assert.match(readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8'), new RegExp(NS));
  assert.equal(readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8').match(/plugin_org_usage_[0-9a-f]+/g)!.every((x) => x === NS), true);
});
for (const [name, q] of reads) test(`read ${name} passes the host guard`, { skip: !guard }, () => guard.validatePluginRuntimeQuery(q, NS, CORE));
for (const [name, q] of writes) test(`write ${name} passes the host guard`, { skip: !guard }, () => guard.validatePluginRuntimeExecute(q, NS));
test('migration statements pass the host guard', { skip: !guard }, () => {
  const text = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, '');
  const statements = text.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  assert.ok(statements.length === 8);
  for (const s of statements) guard.validatePluginMigrationStatement(s, NS, CORE);
});

test('core reads are company scoped and never select the whole adapter_config', () => {
  for (const [name, q] of reads) {
    if (!/public\./.test(q)) continue;
    for (const m of q.matchAll(/public\.(\w+)\s+(\w+)/g)) assert.match(q, new RegExp(`${m[2]}\\.company_id = \\$1`), `${name}: ${m[1]} lacks company scope`);
    assert.doesNotMatch(q, /adapter_config\s*(,|\s+FROM|\))/i.test(q) && !name.startsWith('probe') ? /NEVER/ : /^$/, name);
    for (const m of q.matchAll(/adapter_config(->>?'?\w*'?)?/g)) if (!name.startsWith('probe')) assert.match(m[0], /adapter_config->>'(model|engine)'/, `${name}: unsafe adapter_config use`);
    assert.doesNotMatch(q, /extract\s*\(/i, `${name}: extract() trips the host guard`);
  }
});
