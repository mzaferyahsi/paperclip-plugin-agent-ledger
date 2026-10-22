# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog; versions follow semver, with breaking changes bumping the minor version while the plugin runtime is still marked early (0.y.z).

## 0.4.0

- Change model: board members get a Model column with a Change button (and Change model in the phone detail). Pick the provider and the model (the host lists the models of each provider, or type one), see exactly which keys change, then Apply. The agent keeps its instructions, skills, working directory, secrets and heartbeat settings; its saved session is reset when the provider or model changes; an agent that is running is refused. The change is made through the Paperclip API as the signed-in board member, so the host decides who may do it. No new capability.
- Provider profiles in the settings page: the base settings used when an agent moves to a provider (keys to set, keys to remove, whether it takes a reasoning effort). Standard profiles for Codex, Claude and OpenCode are built in; you can change them or add a provider. A profile cannot touch env, secrets, working directory, instructions or the model. Database migration 002 adds the profile rule kind.
- Settings button on the Agent Ledger page.
- Picking both custom dates now selects the Custom range by itself.

## 0.3.0

- The page opens with the Running or active filter on, so idle agents with no runs in the range are hidden until you set Activity back to all.
- Run button: board members get a Run column (and a Run button in the phone detail) to start one agent, and Run Agents Shown to start up to 10 of the idle agents in the table. A confirm step names them and says each run spends tokens. Agents that are running, paused, waiting for approval or terminated are skipped and listed. This adds the `agents.invoke` capability. A manual run has no assigned task, so the agent only checks its inbox.

## 0.2.5

- Fix: older OpenAI usage records (before about 10 Oct 2026, from Codex and OpenCode) report input tokens without the cached part, newer ones with it. The plugin treated all as including it and subtracted the cached part, which zeroed the input of the older ones (about 2.8 million input tokens in October). An event whose cached tokens exceed its input is now kept as reported.

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
