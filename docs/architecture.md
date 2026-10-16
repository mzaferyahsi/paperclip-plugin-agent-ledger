# Architecture

```
UI (React, host-provided)               Worker (Paperclip plugin host)
  OrgUsagePage  ── usePluginData ──▶   data 'org-usage'  → assemble.getOrgUsage
  Settings page ── usePluginAction ─▶   actions (board only), data 'settings'
                                         job 'price-refresh' → prices/refresh
```

- `src/sql.ts`: every query that reads host tables. Company scoped, bind parameters only, `adapter_config` limited to `model` and `engine`, hourly grouping by `floor(epoch / 3600)` so results never depend on the session time zone. Input tokens are normalised in SQL (`inclusiveInputProviders`).
- `src/assemble.ts`: runs the queries, prices each (agent, provider, model, hour) row with `PriceBook`, builds the payload with `buildOrg`, and caches it for 60 seconds. A failing query leaves a partial payload with an entry in `errors`.
- `src/tree.ts`: builds the tree from `reports_to`, folds subtree sums, keeps nodes whose manager is missing or terminated (and cycle members) in `unattached`, and reconciles `totals = roots + unattached + terminated`.
- `src/prices/`: sources, fetch (allowlist), parsers, validation, `refresh` (lease lock, change hold, effective-dated inserts), `book` (lookup: override, free provider, exact provider, preferred provider, back-fill) and the bundled snapshot.
- `src/rules.ts`: append-only rules (overrides, aliases, free providers, tiers); current state is the newest row per key.
- `src/ui/model.ts`: React-free table logic (visible rows, filters, sort, CSV) with unit tests.

Storage (`migrations/001_init.sql`, schema `plugin_org_usage_<hash>`): `price_versions`, `price_collections`, `collection_lock`, `rules`, `company_seen`.

Payload contract: `src/types.ts`.
