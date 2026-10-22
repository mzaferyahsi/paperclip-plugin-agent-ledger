// Calls to the Paperclip host API from the page. They run as the signed-in board member, so the host checks who may
// change an agent; the plugin worker never gets write access to agents.
import type { AdapterConfig } from '../provider.ts';

export interface HostAgent { id: string; name: string; status: string; adapterType: string; adapterConfig: AdapterConfig; runtimeConfig?: Record<string, unknown> }
export interface HostAdapter { type: string; disabled?: boolean }
export interface HostModel { id: string; label?: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new Error(res.status === 403 ? `Not allowed (${msg}). Only board members can change agents.` : msg);
  }
  return body as T;
}

// Providers the tool never offers: they are not model providers an agent can be moved to from here.
const HIDDEN = new Set(['http', 'process', 'paperclip_runner', 'openclaw_gateway', 'hermes_gateway', 'cursor_cloud']);
export async function listAdapters(): Promise<string[]> {
  const r = await call<{ adapters?: HostAdapter[] } | HostAdapter[]>('/api/adapters');
  const list = Array.isArray(r) ? r : r.adapters ?? [];
  return list.filter((a) => !a.disabled && !HIDDEN.has(a.type)).map((a) => a.type);
}
export async function listModels(companyId: string, adapter: string): Promise<HostModel[]> {
  const r = await call<HostModel[] | { models?: HostModel[] }>(`/api/companies/${encodeURIComponent(companyId)}/adapters/${encodeURIComponent(adapter)}/models`);
  return Array.isArray(r) ? r : r.models ?? [];
}
export const getAgent = (id: string) => call<HostAgent>(`/api/agents/${encodeURIComponent(id)}`);
export const patchAgent = (id: string, body: { adapterType: string; adapterConfig: AdapterConfig; runtimeConfig?: Record<string, unknown> }) =>
  call<HostAgent>(`/api/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
export const resetSession = (id: string) => call<unknown>(`/api/agents/${encodeURIComponent(id)}/runtime-state/reset-session`, { method: 'POST', body: '{}' });
