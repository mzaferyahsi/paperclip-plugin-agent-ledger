// Regenerates src/prices/snapshot.json from the live public price lists. Run at release time (needs network).
import { writeFileSync } from 'node:fs';
import { SOURCES, DEFAULT_SOURCE_ORDER } from '../src/prices/sources.ts';
import { getSource } from '../src/prices/fetch.ts';
import { validateCandidate } from '../src/prices/validate.ts';

const http = (url, init) => fetch(url, init);
const merged = new Map();
for (const key of DEFAULT_SOURCE_ORDER) {
  const src = SOURCES.find((s) => s.key === key);
  const res = await getSource(http, key);
  if (!res.ok) { console.error(`${key}: fetch failed (${res.error})`); continue; }
  const parsed = src.parse(res.body);
  if (!parsed.ok) { console.error(`${key}: parse failed (${parsed.reason})`); continue; }
  let added = 0;
  for (const c of parsed.candidates) {
    if (validateCandidate(c)) continue;
    const id = `${c.providerKey}|${c.modelKey}`;
    if (!merged.has(id)) { merged.set(id, c); added++; }
  }
  console.error(`${key}: ${parsed.candidates.length} parsed, ${added} new`);
}
if (merged.size < 500) { console.error(`refusing to write a snapshot with only ${merged.size} rows`); process.exit(1); }
const rows = [...merged.values()].sort((a, b) => (a.providerKey + a.modelKey).localeCompare(b.providerKey + b.modelKey))
  .map((c) => [c.providerKey, c.modelKey, c.input, c.cachedInput, c.cacheWrite, c.output]);
writeFileSync(new URL('../src/prices/snapshot.json', import.meta.url), JSON.stringify({ date: new Date().toISOString().slice(0, 10), rows }));
console.error(`wrote ${rows.length} rows`);
