// All SQL that reads host tables. Rules (enforced by tests/sql-lint.test.ts and the host's own validator):
//  - $1 is always the host-injected companyId and every core-table reference carries `<alias>.company_id = $1`.
//  - core tables are schema-qualified, every value is a bind parameter, one statement per call.
//  - only adapter_config->>'model' and ->>'engine' are ever read from adapter_config (it also holds secret references).
//  - no `extract(... FROM x.y)`: the host validator mistakes it for a table reference. Use date_part.
export interface Query { sql: string; params: unknown[] }

export function agentsQuery(companyId: string): Query {
  return {
    sql: `SELECT a.id::text AS agent_id, a.name, a.role, a.title, a.status, a.reports_to::text AS reports_to, a.adapter_type,
  a.adapter_config->>'model' AS configured_model, a.adapter_config->>'engine' AS engine, a.last_heartbeat_at
FROM public.agents a
WHERE a.company_id = $1`,
    params: [companyId],
  };
}

/** Per agent, provider, model and UTC hour. Input is normalised to uncached input; $4 lists providers whose input includes cached tokens. */
export function usageQuery(companyId: string, fromIso: string, toIso: string, inclusiveProviders: string[]): Query {
  return {
    sql: `SELECT ce.agent_id::text AS agent_id, ce.provider, ce.model, ce.billing_type,
  floor(date_part('epoch', ce.occurred_at) / 3600)::bigint AS hour,
  SUM(CASE WHEN ce.provider = ANY(ARRAY(SELECT jsonb_array_elements_text($4::jsonb))) THEN CASE WHEN ce.cached_input_tokens <= ce.input_tokens THEN ce.input_tokens - ce.cached_input_tokens ELSE ce.input_tokens END ELSE ce.input_tokens END)::bigint AS input,
  SUM(ce.cached_input_tokens)::bigint AS cached,
  SUM(ce.output_tokens)::bigint AS output,
  COUNT(DISTINCT ce.heartbeat_run_id)::bigint AS runs
FROM public.cost_events ce
WHERE ce.company_id = $1 AND ce.occurred_at >= $2::timestamptz AND ce.occurred_at < $3::timestamptz
GROUP BY ce.agent_id, ce.provider, ce.model, ce.billing_type, floor(date_part('epoch', ce.occurred_at) / 3600)`,
    params: [companyId, fromIso, toIso, JSON.stringify(inclusiveProviders)],
  };
}

export function runsQuery(companyId: string, fromIso: string, toIso: string): Query {
  return {
    sql: `SELECT hr.agent_id::text AS agent_id,
  COUNT(*)::bigint AS runs_total,
  COUNT(*) FILTER (WHERE hr.status IN ('failed', 'cancelled', 'timed_out', 'interrupted'))::bigint AS runs_failed,
  COUNT(*) FILTER (WHERE hr.usage_json IS NOT NULL)::bigint AS runs_with_usage
FROM public.heartbeat_runs hr
WHERE hr.company_id = $1 AND hr.started_at >= $2::timestamptz AND hr.started_at < $3::timestamptz
GROUP BY hr.agent_id`,
    params: [companyId, fromIso, toIso],
  };
}

export function historyStartQuery(companyId: string): Query {
  return {
    sql: `SELECT floor(date_part('epoch', MIN(ce.occurred_at)))::bigint AS first_epoch
FROM public.cost_events ce
WHERE ce.company_id = $1`,
    params: [companyId],
  };
}

/** Startup probe: fails with a clear Postgres error if a host table changed shape. */
export function schemaProbeQueries(): Query[] {
  const z = ['00000000-0000-0000-0000-000000000000'];
  return [
    { sql: `SELECT ce.agent_id, ce.heartbeat_run_id, ce.provider, ce.billing_type, ce.model, ce.input_tokens, ce.cached_input_tokens, ce.output_tokens, ce.occurred_at FROM public.cost_events ce WHERE ce.company_id = $1 LIMIT 0`, params: z },
    { sql: `SELECT a.id, a.name, a.role, a.title, a.status, a.reports_to, a.adapter_type, a.adapter_config, a.last_heartbeat_at FROM public.agents a WHERE a.company_id = $1 LIMIT 0`, params: z },
    { sql: `SELECT hr.agent_id, hr.status, hr.started_at, hr.usage_json FROM public.heartbeat_runs hr WHERE hr.company_id = $1 LIMIT 0`, params: z },
  ];
}
