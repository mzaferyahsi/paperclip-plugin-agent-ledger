import { definePlugin, runWorker, type PluginContext } from '@paperclipai/plugin-sdk';
import { BadRequest, getOrgUsage, readConfig, requireCompany, type Config, type Env } from './assemble.ts';
import { Cache } from './cache.ts';
import { validateTimezone } from './time.ts';
import { schemaProbeQueries } from './sql.ts';
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
function requireBoard(a: Actor | null | undefined): string {
  if (!isBoard(a)) throw new Forbidden('Only board members can change org usage settings');
  return a.userId;
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const cache = new Cache();
    for (const p of schemaProbeQueries()) {
      ctx.db.query(p.sql, p.params).catch((e: unknown) =>
        ctx.logger.error('This Paperclip version is not supported by org-usage: a host table changed shape', { error: String(e) }));
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

    ctx.data.register('org-usage', async (p) => {
      const companyId = requireCompany(p.companyId);
      ctx.db.execute(SEEN_UPSERT_SQL, [companyId]).catch(() => {});
      return getOrgUsage(await env(p), companyId, p.range);
    });

    ctx.data.register('settings', async (p) => {
      const companyId = requireCompany(p.companyId);
      const cfg = await config(companyId);
      const rules = await loadRuleRows(ctx.db, companyId);
      const held = await ctx.db.query(HELD_SQL);
      const usage = await getOrgUsage(await env({ companyId }), companyId, '30d');
      return { rules, held, pricing: usage.pricing, config: cfg, folded: foldRules(rules) };
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
