// The single outbound code path of the plugin. A build test (tests/outbound.test.ts) fails if any other
// file under src/ performs or references an outbound request. This is a plugin-level control, not a
// host-enforced sandbox: the host checks the http.outbound capability and private IPs only.
import { ALLOWED_HOSTS, SOURCES, USER_AGENT, type Source } from './sources.ts';
import type { SourceKey } from './candidate.ts';

export const TIMEOUT_MS = 20_000;
export const MAX_BODY_BYTES = 12 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface HttpHost { http: { fetch: HttpFetch } }

export type FetchResult =
  | { ok: true; status: number; body: string; finalUrl: string }
  | { ok: false; status: number | null; error: 'http' | 'timeout' | 'too_large' | 'redirect' | 'network' };

/** True only for an https URL on an allowlisted host with no credentials, port or query string. */
export function isAllowedUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.search === '' && ALLOWED_HOSTS.includes(u.host);
}

async function readCapped(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) { await res.body?.cancel(); return null; }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** GET one allowlisted source. The caller passes a source key, never a URL. */
export async function getSource(http: HttpFetch, key: SourceKey): Promise<FetchResult> {
  const source: Source | undefined = SOURCES.find((s) => s.key === key);
  if (!source || !isAllowedUrl(source.url)) throw new Error(`Unknown source ${String(key)}`);
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (source.accept) headers.Accept = source.accept;
  let url = source.url;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await http(url, { method: 'GET', headers, redirect: 'manual', credentials: 'omit', signal });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const loc = res.headers.get('location');
        let next: string | null = null;
        try { next = loc ? new URL(loc, url).toString() : null; } catch { next = null; }
        if (!next || !isAllowedUrl(next) || hop === MAX_REDIRECTS) return { ok: false, status: res.status, error: 'redirect' };
        url = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300) { await res.body?.cancel(); return { ok: false, status: res.status, error: 'http' }; }
      const body = await readCapped(res);
      if (body === null) return { ok: false, status: res.status, error: 'too_large' };
      return { ok: true, status: res.status, body, finalUrl: url };
    }
    return { ok: false, status: null, error: 'redirect' };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { ok: false, status: null, error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }
}

/** The only place that touches the host client. Everything else receives the bound function. */
export function httpOf(host: HttpHost): HttpFetch {
  return (url, init) => host.http.fetch(url, init);
}
