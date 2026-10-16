# Security

## Scope

The plugin runs trusted code inside the Paperclip host (as all Paperclip plugins do). It reads three host tables and writes only to its own schema. Every host query is company-scoped, passes Paperclip's SQL guard and is covered by tests; the adapter configuration is never read as a whole, only its `model` and `engine` keys.

Write actions (refresh prices, accept or reject held prices, add rules) check that the caller is a board member on the server side. Reading is open to any company user.

The only network access is the daily price fetch described in [PRIVACY.md](PRIVACY.md).

## Reporting a vulnerability

Please report privately to the maintainer (mzaferyahsi) through a GitHub security advisory on the repository, not a public issue. Include the plugin version, the Paperclip version and steps to reproduce.
