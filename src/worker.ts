import { definePlugin, runWorker, type PluginContext } from '@paperclipai/plugin-sdk';
import { BadRequest, getAgentDetail, getAgentLedger, readConfig, requireCompany, type Config, type Env } from './assemble.ts';
import { Cache } from './cache.ts';
import { validateTimezone } from './time.ts';
import { agentsQuery, schemaProbeQueries } from './sql.ts';
import { RUN_PROMPT, RUN_REASON, parseRunIds, planRuns } from './run.ts';
import { NS } from './namespace.ts';
import { INSERT_RULE_SQL, foldRules, loadRuleRows, validateRule } from './rules.ts';
import { refreshPrices } from './prices/refresh.ts';
import { httpOf } from './prices/fetch.ts';
import { DECIDE_HELD_SQL, HELD_SQL, SEEN_LATEST_SQL, SEEN_UPSERT_SQL, ensureSnapshot } from './prices/store.ts';
import { randomUUID } from 'node:crypto';
import manifest from '../manifest.json' with { type: 'json' };

interface Actor { type?: string; userId?: string | null; companyId?: string | null }
export const isBoard = (a: Actor | null | undefined): a is Actor & { userId: string } => !!a && a.type === 'user' && typeof a.userId === 'string' && a.userId.length > 0;
class Forbidden extends Error {}
function requireBoard(a: Actor | null | undefined, what = 'change agent ledger settings'): string {
  if (!isBoard(a)) throw new Forbidden(`Only board members can ${what}`);
  return a.userId;
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const cache = new Cache();
    for (const p of schemaProbeQueries()) {
      ctx.db.query(p.sql, p.params).catch((e: unknown) =>
        ctx.logger.error('This Paperclip version is not supported by agent-ledger: a host table changed shape', { error: String(e) }));
    }
    if (ctx.db.namespace !== NS) ctx.logger.error('plugin schema differs from the derived namespace; SQL will fail', { host: ctx.db.namespace, derived: NS });
    // Seed the bundled price snapshot so history is priced before the first refresh.
    ensureSnapshot(ctx.db, randomUUID, new Date().toISOString())
      .catch((e: unknown) => ctx.logger.error('could not seed the bundled price snapshot', { error: String(e) }));

    const config = async (companyId?: unknown): Promise<Config> => {
      const cfg = readConfig(await ctx.config.get(typeof companyId === 'string' ? companyId : undefined));
      const problem = validateTimezone(cfg.timezone);
      if (problem) throw new BadRequest(problem);
      return cfg;
    };
    const env = async (p: Record<string, unknown>): Promise<Env> =>
      ({ db: ctx.db, config: await config(p.companyId), now: () => Date.now(), cache, pluginVersion: manifest.version });

    ctx.data.register('agent-ledger', async (p) => {
      const companyId = requireCompany(p.companyId);
      ctx.db.execute(SEEN_UPSERT_SQL, [companyId]).catch(() => {});
      return getAgentLedger(await env(p), companyId, p.range);
    });

    ctx.data.register('agent-detail', async (p) => getAgentDetail(await env(p), requireCompany(p.companyId), p.agentId, p.range));

    ctx.data.register('settings', async (p) => {
      const companyId = requireCompany(p.companyId);
      const cfg = await config(companyId);
      const rules = await loadRuleRows(ctx.db, companyId);
      const held = await ctx.db.query(HELD_SQL);
      const usage = await getAgentLedger(await env({ companyId }), companyId, '30d');
      return { rules, held, pricing: usage.pricing, config: cfg, folded: foldRules(rules) };
    });

    // Provider profiles for the model-change dialog: the standard ones overlaid with the saved ones. Readable by everyone; changing an agent is checked by the host.
    ctx.data.register('provider-profiles', async (p) => {
      const companyId = requireCompany(p.companyId);
      return { profiles: foldRules(await loadRuleRows(ctx.db, companyId)).providerProfiles };
    });

    // Jobs have no company context, so they use the configuration of the company that last opened the page, else the defaults.
    const jobConfig = async (companyId?: string | null): Promise<Config> => {
      try {
        const id = companyId ?? (await ctx.db.query<{ company_id: string }>(SEEN_LATEST_SQL))[0]?.company_id;
        return id ? await config(id) : readConfig(undefined);
      } catch { return readConfig(undefined); }
    };
    const runRefresh = async (trigger: string, companyId?: string | null) => {
      const cfg = await jobConfig(companyId);
      const summary = await refreshPrices({
        db: ctx.db, http: httpOf(ctx), now: () => new Date(),
        config: { sources: cfg.priceSources as never, holdPercent: cfg.priceChangeHoldPercent },
        log: (m, meta) => ctx.logger.info(m, meta),
      });
      cache.clear();
      ctx.logger.info('price refresh', { trigger, summary });
      return summary;
    };
    ctx.jobs.register('price-refresh', async () => { await runRefresh('schedule'); });

    // Writes: board members only. getData handlers carry no actor, so every write action checks the host-verified actor itself.
    ctx.actions.register('viewer', async (_p, a) => ({ isBoard: isBoard(a.actor) }));
    // Manual run: starts a heartbeat run for up to ten agents. Board members only; paused, running, terminated and unknown agents are skipped and said so.
    ctx.actions.register('agents.run', async (p, a) => {
      const userId = requireBoard(a.actor, 'run agents');
      const companyId = requireCompany(a.companyId ?? a.actor.companyId ?? p.companyId);
      const ids = parseRunIds(p.agentIds);
      const agents = await ctx.db.query<{ agent_id: string; name: string; status: string }>(agentsQuery(companyId).sql, agentsQuery(companyId).params);
      const results: Array<{ id: string; name: string; started: boolean; reason: string | null; runId: string | null }> = [];
      for (const plan of planRuns(ids, agents)) {
        if (plan.action === 'skip') { results.push({ id: plan.id, name: plan.name, started: false, reason: plan.reason, runId: null }); continue; }
        try {
          const r = await ctx.agents.invoke(plan.id, companyId, { prompt: RUN_PROMPT, reason: RUN_REASON });
          ctx.logger.info('agent run started from the ledger', { agentId: plan.id, userId, runId: r.runId });
          results.push({ id: plan.id, name: plan.name, started: true, reason: null, runId: r.runId });
        } catch (e) { results.push({ id: plan.id, name: plan.name, started: false, reason: e instanceof Error ? e.message.slice(0, 200) : 'Could not start', runId: null }); }
      }
      cache.clear();
      return { results };
    });
    ctx.actions.register('cache.clear', async (_p, a) => { requireBoard(a.actor, 'refresh the ledger'); cache.clear(); return { ok: true }; });
    ctx.actions.register('prices.refresh', async (_p, a) => { requireBoard(a.actor); return runRefresh('manual', a.companyId ?? a.actor.companyId ?? null); });
    ctx.actions.register('prices.decide', async (p, a) => {
      requireBoard(a.actor);
      if (typeof p.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.id) || (p.decision !== 'active' && p.decision !== 'rejected')) throw new BadRequest('Invalid decision');
      const r = await ctx.db.execute(DECIDE_HELD_SQL, [p.id, p.decision, new Date().toISOString()]);
      cache.clear();
      return { changed: r.rowCount };
    });
    ctx.actions.register('rules.put', async (p, a) => {
      const userId = requireBoard(a.actor);
      const companyId = requireCompany(a.companyId ?? a.actor.companyId);
      let rule;
      try { rule = validateRule(p.kind, p.key, p.value); } catch (e) { throw new BadRequest(e instanceof Error ? e.message : 'Invalid rule'); }
      await ctx.db.execute(INSERT_RULE_SQL, [companyId, rule.kind, rule.key, JSON.stringify(rule.value), p.active === false ? false : true, userId]);
      cache.clear();
      return { ok: true };
    });
  },
  async onHealth() { return { status: 'ok' }; },
});
export default plugin;
runWorker(plugin, import.meta.url);
