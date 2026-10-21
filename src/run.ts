// Manual runs started from the Agent Ledger page. Pure: parsing and planning only, so the rules are unit-tested.
import { BadRequest } from './assemble.ts';

export const MAX_RUN = 10;
export const RUN_REASON = 'agent-ledger manual run';
export const RUN_PROMPT = 'A board member asked for a run from the Agent Ledger page. Check your inbox and your assigned issues, and continue the work that is waiting for you. If nothing is waiting, say so briefly and stop.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRunIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new BadRequest('Choose at least one agent');
  const ids = [...new Set(v.map((x) => (typeof x === 'string' ? x.trim().toLowerCase() : '')))];
  if (ids.some((x) => !UUID_RE.test(x))) throw new BadRequest('Invalid agent');
  if (ids.length > MAX_RUN) throw new BadRequest(`Run at most ${MAX_RUN} agents at once`);
  return ids;
}

export interface RunPlan { id: string; name: string; action: 'run' | 'skip'; reason: string | null }
const SKIP: Record<string, string> = { running: 'Already running', paused: 'Paused', pending_approval: 'Waiting for approval', terminated: 'Terminated' };
/** Decides, for each requested agent, whether to start it. Only agents of this company that are idle or in error are started. */
export function planRuns(ids: string[], agents: Array<{ agent_id: string; name: string; status: string }>): RunPlan[] {
  const by = new Map(agents.map((a) => [a.agent_id.toLowerCase(), a]));
  return ids.map((id) => {
    const a = by.get(id);
    if (!a) return { id, name: id, action: 'skip', reason: 'Agent not found' };
    const reason = SKIP[a.status] ?? null;
    return { id, name: a.name, action: reason ? 'skip' : 'run', reason };
  });
}
