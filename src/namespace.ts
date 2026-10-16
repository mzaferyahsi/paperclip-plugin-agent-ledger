// Single place that derives the plugin's SQL schema. Mirrors the host's derivePluginDatabaseNamespace
// (sha256(manifest.id)[:10] + manifest.database.namespaceSlug), so a manifest change cannot leave stale literals behind.
// The SQL migrations are static files and must name this schema too; tests/namespace.test.ts enforces they do.
import { createHash } from 'node:crypto';
import manifest from '../manifest.json' with { type: 'json' };

export function deriveNamespace(pluginKey: string, slug: string): string {
  const hash = createHash('sha256').update(pluginKey).digest('hex').slice(0, 10);
  const s = slug.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_').slice(0, 36) || 'plugin';
  return `plugin_${s}_${hash}`.slice(0, 63);
}

export const NS = deriveNamespace(manifest.id, manifest.database.namespaceSlug);
