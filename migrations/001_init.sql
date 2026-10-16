-- Instance-scoped list prices (a list price is not company data) and company-scoped rules.
-- Fully qualified names only. The host forbids triggers and functions; rules is append-only by convention.
CREATE TABLE IF NOT EXISTS plugin_org_usage_15e77c4184.price_versions (
  id uuid PRIMARY KEY,
  provider_key text NOT NULL,
  model_key text NOT NULL,
  input_per_mtok numeric(14,6) NOT NULL,
  cached_input_per_mtok numeric(14,6),
  cache_write_per_mtok numeric(14,6),
  output_per_mtok numeric(14,6) NOT NULL,
  source text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'held', 'rejected')),
  effective_from timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL,
  change_pct numeric(12,3),
  UNIQUE (provider_key, model_key, effective_from)
);
CREATE INDEX IF NOT EXISTS price_versions_lookup ON plugin_org_usage_15e77c4184.price_versions (model_key, provider_key, status, effective_from);

CREATE TABLE IF NOT EXISTS plugin_org_usage_15e77c4184.price_collections (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  http_status integer,
  candidates integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  verified integer NOT NULL DEFAULT 0,
  held integer NOT NULL DEFAULT 0,
  invalid integer NOT NULL DEFAULT 0,
  finding text
);
CREATE INDEX IF NOT EXISTS price_collections_recent ON plugin_org_usage_15e77c4184.price_collections (finished_at);

CREATE TABLE IF NOT EXISTS plugin_org_usage_15e77c4184.collection_lock (
  singleton boolean PRIMARY KEY DEFAULT true,
  lease_until timestamptz NOT NULL
);

-- Current state of a rule = newest row per (company_id, kind, key); active = false deletes it.
CREATE TABLE IF NOT EXISTS plugin_org_usage_15e77c4184.rules (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('price_override', 'model_alias', 'provider_alias', 'provider_free', 'tier_model', 'tier_role')),
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  actor_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rules_lookup ON plugin_org_usage_15e77c4184.rules (company_id, kind, key, id);

-- Scheduled jobs run without a company, but plugin configuration is per company. The job reads the configuration
-- of the company that most recently opened the page.
CREATE TABLE IF NOT EXISTS plugin_org_usage_15e77c4184.company_seen (
  company_id uuid PRIMARY KEY,
  seen_at timestamptz NOT NULL
);
