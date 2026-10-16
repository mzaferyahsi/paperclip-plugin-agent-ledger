# Org usage

A Paperclip plugin that shows every agent in a table, in reporting order, with its configured and actual model, token usage and an API-equivalent cost estimate. Totals roll up the hierarchy, so you can see what a whole branch of the organisation uses.

No agent is involved in running it. The plugin reads Paperclip's own tables, refreshes model prices once a day from public price lists, and needs nobody to maintain anything.

## What you get

- **One table, hierarchy inside it.** One row per agent, indented by depth with expand/collapse. Manager rows show their own usage and the usage of everyone below them (switch between Own, Subtree and Both).
- **Model.** The model each agent is configured with. Hover to see every model it actually ran in the selected range, with its share of tokens.
- **Tokens.** Input (uncached), cached, output and total, plus run counts.
- **Cost estimate.** Tokens multiplied by public list prices, in USD. A model without a price shows "—", never $0.
- **Flags.** Heavy spender, configured model differs from the model actually run, drift between several models, low data, unpriced usage, failed runs, and (optional) tier mismatch.
- **Time range and delta.** Today, yesterday, 7, 14 and 30 days or a custom range, with the change against the previous period.
- **Sorting, filters, search, column menu, CSV copy.** Sorting by any column other than Name flattens the rows. "Hierarchy order" restores the tree.
- **Terminated agents** are folded into one row so the total matches the company total.

## Install

Requires Paperclip 2026.1012.0 or newer and Node 24.

```sh
npm install
npm run build
paperclipai plugin install --local /path/to/paperclip-plugin-org-usage
```

The page appears in the sidebar as "Org usage" and at `/<company prefix>/org-usage`. Settings are under Company settings, "Org usage settings".

Uninstall with `paperclipai plugin uninstall mzaferyahsi.org-usage` (add `--force` to also delete the plugin's tables).

## Capabilities and why

| Capability | Why |
|---|---|
| `database.namespace.read` / `.write` / `.migrate` | Reads `agents`, `cost_events` and `heartbeat_runs`; stores prices and your rules in the plugin's own schema. |
| `jobs.schedule` | The daily price refresh. |
| `http.outbound` | The daily price refresh only. See [PRIVACY.md](PRIVACY.md). |
| `ui.page.register`, `ui.sidebar.register`, `instance.settings.register` | The page, the sidebar link and the settings page. |

The plugin never writes to Paperclip's tables, never wakes or assigns agents, and never posts comments.

## Prices

Prices refresh daily at 04:23 (host time) and when a board member presses "Refresh now". Sources, in default precedence order:

1. Anthropic's official pricing page
2. OpenAI's official pricing page
3. The LiteLLM price list on GitHub
4. models.dev

A bundled snapshot (dated in the page header and in settings) covers first run and offline use. If a source fails or changes shape it is skipped and logged; the others still apply. Fetched prices must pass sanity checks. A change of more than 50% against the current price is held until a board member accepts it in settings. Prices are effective-dated, so past usage is priced at the price that applied then, and usage before the first known price uses the first known price.

To use your own prices, add an override in settings (`provider/model`, `*` allowed, with optional dates). To stop all outbound requests, set `priceSources` to an empty list in the plugin configuration; the bundled snapshot and your overrides still work.

Limits of the estimate: standard short-context list prices only (no batch, flex, priority or long-context bands); cache-write tokens are priced as normal input because Paperclip does not record them separately; subscription plans bill differently, so the figure is "what this would cost at API prices". USD only.

## Configuration

Set in the plugin configuration (all optional):

| Key | Default | Meaning |
|---|---|---|
| `timezone` | `Europe/Amsterdam` | Day boundaries (whole-hour offsets). |
| `inclusiveInputProviders` | `["openai"]` | Providers whose input tokens already include cached tokens. Others are treated as excluding them. |
| `heavyShareThreshold` | `15` | Percent of all tokens above which an agent is flagged. |
| `lowDataRunThreshold` | `10` | Agents with fewer runs than this are flagged. |
| `priceChangeHoldPercent` | `50` | Price changes above this wait for approval. |
| `priceStaleAfterDays` | `3` | Prices are marked stale after this many days without a successful refresh. |
| `priceSources` | all four | Enabled sources in precedence order. Empty means no outbound requests. |

The scheduled job has no company context, so it uses the configuration of the company that opened the page most recently, and the defaults until someone has.

## Settings page

Board members can refresh prices, accept or reject held price changes, add price overrides, set a price for models no price list has (or mark their provider as free or local, so their usage shows no cost instead of "unpriced"), and define optional tiers. Everyone else can view them.

Tiers are labels you choose. Map model patterns to a tier, and role patterns to the tier that role should use. The Tier column and the tier flag appear once at least one model pattern exists. Nothing is defined by default.

## Troubleshooting

- **"Prices: bundled snapshot"** means no refresh has succeeded yet. Check the source table in settings.
- **A model shows "—" for cost**: it is listed under "Models without a price" in settings. Set a price there or mark its provider as free.
- **"This Paperclip version is not supported"** in the worker log: a host table changed shape. Please open an issue with the version.
- **Totals look too low for a provider** that is not Anthropic or OpenAI: add it to `inclusiveInputProviders` if its input tokens include cached tokens.

## Development

```sh
npm install
npm run typecheck
npm test            # unit tests, SQL guard checks, embedded Postgres integration tests
npm run build
npm run validate:manifest
npm run pack:check
npm run update-snapshot   # regenerate the bundled prices before a release
```

The tests run the real SQL against a throwaway Postgres and pass every statement through the installed Paperclip SQL guard. See [docs/architecture.md](docs/architecture.md).

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY.md](THIRD_PARTY.md).
