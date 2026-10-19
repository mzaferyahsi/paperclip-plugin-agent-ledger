# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog; versions follow semver, with breaking changes bumping the minor version while the plugin runtime is still marked early (0.y.z).

## 0.2.4

- Agent names link to the agent settings page; the phone detail view has an Open agent settings link.
- Any filter keeps the org tree open and indented, so the structure above each match stays visible.

## 0.2.3

- Activity column and filter (running now, active in range, no runs, paused, error), sortable, with last heartbeat.
- Names of paused (disabled) agents are shown in a muted colour.

## 0.2.2

- Names use title case like the rest of Paperclip: "Agent Ledger" in the sidebar, page title and settings.

## 0.2.1

- Phone layout (below 720 px): the wide table becomes a compact list with the name, role, model and flags on the left and tokens and cost on the right. Tap a row for the full details and the written meaning of each flag. Time range is a dropdown, and filters, sort and search sit behind a Filters button. No sideways scrolling.

## 0.2.0

- Renamed from "Org usage" to "Agent Ledger" (plugin id `mzaferyahsi.agent-ledger`, package `paperclip-plugin-agent-ledger`, page route `agent-ledger`). Installs of the old name must be uninstalled first.
- Sidebar link matches the host items (colour, spacing, hover). Visible headings on the time range and totals groups. Instant flag tooltips.

## 0.1.4

- Sidebar link now matches the host's own items (colour, spacing, hover).
- Flags show an instant tooltip with their meaning on hover or keyboard focus, and use the help cursor.

## 0.1.3

- Visible headings "Time range" and "Totals" on the two button groups.

## 0.1.2

- Long role titles are shortened so the token and cost columns stay in view.

## 0.1.1

- Simpler model column: the current model, with every model used shown on hover.
- Hover text on every flag, selector, filter and column header.
- Settings: one "Models without a price" section replaces the alias forms.
- Price overrides match model names exactly as they appear in usage.

## 0.1.0

- Table of agents in reporting order with expand/collapse, own and subtree totals, configured and actual models, tokens, runs and flags.
- API-equivalent cost estimate from public list prices, refreshed daily from four sources with a bundled snapshot, effective-dated prices, change hold, overrides, aliases and free-provider rules.
- Optional user-defined tiers.
- Settings page for prices, overrides, names and tiers.
