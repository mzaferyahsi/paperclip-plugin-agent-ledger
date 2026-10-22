-- Provider profiles (the base settings used when an agent changes provider) are stored as a new rule kind.
-- Re-runnable: the constraint is dropped if present and added again with the extra kind.
ALTER TABLE plugin_agent_ledger_d6bdbef9cb.rules DROP CONSTRAINT IF EXISTS rules_kind_check;
ALTER TABLE plugin_agent_ledger_d6bdbef9cb.rules ADD CONSTRAINT rules_kind_check
  CHECK (kind IN ('price_override', 'model_alias', 'provider_alias', 'provider_free', 'tier_model', 'tier_role', 'provider_profile'));
