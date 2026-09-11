# Retired paid-provider removal — 2026-09-11

Status: `IMPLEMENTED / PRODUCTION VERIFICATION PENDING`.

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

Pending deployment, environment cleanup, stored-key cleanup, service health,
and authenticated browser acceptance.
