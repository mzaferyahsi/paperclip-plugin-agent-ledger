# Privacy

## What the plugin sends out

Once a day (and when a board member presses "Refresh now") the worker makes plain HTTPS GET requests to exactly these hosts:

- `platform.claude.com` (Anthropic pricing page)
- `developers.openai.com` (OpenAI pricing page)
- `raw.githubusercontent.com` (LiteLLM price list)
- `models.dev` (models.dev price list)

Each request carries the URL, a fixed `User-Agent` of `paperclip-plugin-agent-ledger/<version>` and an `Accept` header. No cookies, no credentials, no query string, no body. Nothing about your installation, companies, agents, issues or usage is sent. The remote servers see your host's IP address and that this plugin is installed.

The allowlist is enforced in code (`src/prices/fetch.ts`, `src/prices/sources.ts`): a request to any other host, over plain HTTP, with credentials, a port or a query string is refused, redirects off the allowlist are refused, and bodies over 12 MB are refused. A build test fails if any other file makes or names an outbound request. Paperclip itself does not sandbox outbound domains, so this is a control inside the plugin, and approving the `http.outbound` capability approves requests to these four hosts.

Set `priceSources` to an empty list to turn all outbound requests off.

## What the plugin reads and stores

Reads (read-only, scoped to the active company): agent name, role, title, status, reporting line, adapter type, last heartbeat, and the two keys `model` and `engine` of the adapter configuration (never the rest, which can hold secret references); token counts, provider, model and timestamps of cost events; status, start time and whether usage was recorded for heartbeat runs.

Stores, in the plugin's own database schema: public list prices and fetch history, your override, alias, free-provider and tier rules with the id of the board member who made each change, and the id of the company that last opened the page. Nothing is sent anywhere.
