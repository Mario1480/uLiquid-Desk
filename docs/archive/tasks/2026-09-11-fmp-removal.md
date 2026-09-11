# Retired paid-provider removal — 2026-09-11

Status: `COMPLETE / DEPLOYED AND VERIFIED`.

## Authorization and decision

Mario confirmed that the retired paid market-data provider has no active
subscription and has not been used for a long time. He authorized its complete
removal. This owner decision supersedes the earlier seven-day fallback
observation gate because there is no supported subscription or intended
rollback path to preserve.

The removal is limited to the obsolete provider integration. It does not
authorize trading, wallet, vault, contract, migration, or other capital-moving
actions.

## Removed application surfaces

- News and economic-calendar legacy adapters and fallback branches.
- Provider-registry feature flags and fallback selection.
- Encrypted API-key parsing, masking, update fields, and the dedicated admin
  status endpoint.
- Dedicated external-health and Telegram-monitor compatibility paths.
- Example environment variables and provider-specific tests and fixtures.

News now delegates only to the provider-neutral Market Intelligence service.
Economic-calendar refreshes use the official provider registry. The generic
`marketIntelligence` health result remains the monitored dependency.

## Preserved history

Applied Prisma migrations and historical provider rows are retained. They are
immutable release and audit evidence and remain readable through the
provider-neutral data model. No current registry, refresh job, admin endpoint,
health probe, or environment setting can reactivate the retired provider.

## Local verification

- API typecheck: passed.
- Focused Market Intelligence tests: 59/59 passed with the test runner forced
  to exit after completion because the calendar module retains a Redis client
  handle when a configured development Redis endpoint is unavailable.
- Repository whitespace validation: passed.
- Active runtime and configuration reference scan: no provider-specific
  reference remains outside applied migrations and archived historical records.
- Documentation link validation: 320 Markdown files checked, zero broken local
  links.

## Production verification

Commit `19a11ed95` (`refactor(api): remove retired FMP integration`) was pushed
to `main` and `codex/docs-cleanup`. The production checkout fast-forwarded from
`61833487b` to that exact commit and `scripts/deploy_prod.sh api` completed its
production build and restart successfully.

Before configuration cleanup, a root-only environment copy and full custom-
format PostgreSQL dump were written to
`/root/uliquid-config-backups/fmp-removal-20260911T152330Z`. The database dump
passed an archive-list validation inside the PostgreSQL container. Its SHA-256
is `4f34bca8e7e77d9d360988486bd951aef971fca581936ca3ed7f35467b7bf9c4`.

Post-cleanup checks confirmed:

- zero retired-provider variables in `/opt/uliquid-desk/.env.prod`;
- zero `fmpApiKeyEnc` properties in the `admin.apiKeys` setting;
- zero open or acknowledged legacy provider health incidents;
- zero provider-specific references in the built API runtime;
- the removed legacy health endpoint returns `404`;
- API, Postgres, Redis, runner, Python strategy service, web, and Salad proxy
  are healthy;
- the public API health endpoint returns `200`.

The first startup refresh was transiently degraded while external services
warmed up. A first immediate manual refresh then timed out all RSS requests.
Direct server probes returned HTTP `200` for every one of the eight active feed
URLs, and a second controlled refresh completed with 8/8 RSS sources healthy,
183 unique news items, and 102 official or curated calendar events. The
authenticated Chrome Admin Providers page showed every active source healthy.
The Admin API Keys page contained only the AI provider section and no retired-
provider key or status controls.

The obsolete `Market Intelligence 7-day observation` automation was deleted.
Telegram Daily Calendar delivery remains a routine operational observation; it
is not a dependency or removal gate for the retired provider.
