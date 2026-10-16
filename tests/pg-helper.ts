// Throwaway local Postgres for SQL tests, using the embedded-postgres binaries shipped with the
// host install. Returns null (tests skip) when they are not available.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST_MODULES = process.env.PC_HOST_NODE_MODULES ?? '/home/paperclip/.paperclip/cli/installs/npm/2026.1012.0/node_modules';

export interface TestPg { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>; execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>; stop(): Promise<void> }

export async function startPg(sessionTimeZone = 'America/Los_Angeles'): Promise<TestPg | null> {
  const bin = join(HOST_MODULES, '@embedded-postgres/linux-x64/native/bin');
  if (!existsSync(join(bin, 'initdb')) || !existsSync(join(HOST_MODULES, 'pg'))) return null;
  const require = createRequire(join(HOST_MODULES, 'x.js'));
  const { Client } = require('pg');
  const dir = mkdtempSync(join(tmpdir(), 'tu-pg-'));
  const data = join(dir, 'data');
  const env = { ...process.env, LC_ALL: 'C' };
  execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-sync'], { env, stdio: 'ignore' });
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-w', '-l', join(dir, 'log'), '-o', `-c listen_addresses= -k ${dir} -c fsync=off`, 'start'], { env, stdio: 'ignore' });
  const client = new Client({ host: dir, user: 'postgres', database: 'postgres' });
  await client.connect();
  // A hostile session timezone proves results do not depend on it.
  await client.query(`SET TimeZone = '${sessionTimeZone}'`);
  return {
    async query(sql, params) { return (await client.query(sql, params)).rows; },
    async execute(sql, params) { const r = await client.query(sql, params); return { rowCount: r.rowCount ?? 0 }; },
    async stop() {
      await client.end();
      try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { env, stdio: 'ignore' }); } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}
