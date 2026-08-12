# Market Intelligence: Provider Architecture and Operations

Last updated: 2026-08-02

## Purpose

uLiquid Desk news and economic-calendar reads no longer require Financial
Modeling Prep (FMP). The primary production configuration uses reviewed public
RSS/Atom feeds for news and official schedules for economic events. FMP remains
an optional, disabled legacy adapter for rollback during the measured rollout.

This subsystem is read-only. It can enrich dashboards, Telegram calendar
digests and prediction context, but it has no order, wallet, vault or execution
tool.

## Runtime flow

1. `MarketIntelligenceRefreshJob` refreshes RSS news every 10 minutes and the
   official calendar every six hours by default. Within 24 hours either side of
   a high-impact release it automatically switches the calendar to a 15-minute
   refresh cadence.
2. Provider adapters return provider-neutral contracts with provenance,
   warnings, latency and degraded state.
3. The service normalizes and deduplicates records, upserts them into Postgres,
   and applies a 90-day configurable retention window to news.
4. Existing `/news` and `/economic-calendar` consumers keep their compatible
   response shapes. New context, summary and provider-health routes expose the
   richer contract.
5. The prediction feature snapshot receives at most five source-backed news
   facts and five upcoming high-impact events, including freshness and provider
   state. Missing or stale data is marked degraded.
6. The market summary is deterministic by default. Optional AI generation is
   schema-validated, citation-validated, cached by source-cluster hash and has
   no executable tools.

## Reviewed primary sources

| Source | Transport | Use | Terms status |
| --- | --- | --- | --- |
| Federal Reserve all-press feed | RSS | Macro, policy and regulatory news | `approved`, reviewed 2026-08-12 |
| Federal Reserve speeches feed | RSS | Macro and policy context | `approved`, reviewed 2026-08-12 |
| European Central Bank press feed | RSS/Atom | Macro and policy news | `approved`, reviewed 2026-08-02 |
| U.S. SEC press-release feed | RSS | Regulatory news | `approved`, reviewed 2026-08-02 |
| U.S. SEC speeches and statements feed | RSS | Regulatory and digital-asset context | `approved`, reviewed 2026-08-12 |
| U.S. CFTC general press-release feed | RSS | Derivatives and digital-asset regulation | `approved`, disabled while automated requests receive HTTP 403 |
| Bank for International Settlements press feed | RSS | Global macro, banking and stablecoin context | `approved`, reviewed 2026-08-12 |
| Ethereum Foundation Blog | Atom/RSS | Protocol, ecosystem and security updates | `approved`, reviewed 2026-08-12 |
| Kraken Blog | RSS | Exchange, institutional and crypto-market updates | `approved`, reviewed 2026-08-12 |
| U.S. BLS public release calendar | ICS plus curated official outage fallback | CPI, PPI and employment schedules | official public schedule |
| Eurostat euro-indicator calendar | JSON | Euro-area CPI and GDP schedules | official public schedule |
| Federal Reserve FOMC calendar | curated official dates | FOMC schedules | official public schedule |
| ECB Governing Council calendar | curated official dates | ECB decision schedules | official public schedule |
| U.S. BEA release schedule | curated official dates | GDP, PCE and Core PCE schedules | official public schedule |
| U.S. Census retail schedule | curated official dates | Retail Sales schedules | official public schedule |
| U.S. Department of Labor schedule | generated official weekly cadence | Initial Claims schedules | official public schedule |

The source registry is in
`apps/api/src/services/marketIntelligence/providers/rss/sourceRegistry.ts`.
Production only activates enabled sources with `usageStatus=approved`.
Additional sources require a terms review before being added to
`RSS_SOURCE_REGISTRY_JSON` or the default registry.

## Security boundary

- HTTPS only, exact hostname allowlist and redirect revalidation.
- DNS resolution rejects private, loopback, link-local and reserved addresses.
- Credentials in URLs and non-standard ports are rejected.
- Response size, redirect count and request time are bounded.
- XML declarations with `DOCTYPE` or `ENTITY` are rejected.
- HTML/script content is removed before storage or prompt use.
- Fixtures are sanitized and CI tests never depend on live provider responses.

## Configuration

Recommended FMP-independent configuration:

```env
MARKET_INTELLIGENCE_ENABLED=true
NEWS_PROVIDERS=rss
ECONOMIC_CALENDAR_PROVIDERS=official
RSS_NEWS_ENABLED=true
OFFICIAL_ECONOMIC_CALENDAR_ENABLED=true
AI_MARKET_SUMMARY_ENABLED=false
FMP_LEGACY_ENABLED=false
FMP_LEGACY_FALLBACK_ENABLED=false
```

Operational tuning:

```env
MARKET_INTELLIGENCE_POLL_SECONDS=60
RSS_NEWS_REFRESH_MINUTES=10
ECON_DAILY_TELEGRAM_ENABLED=true
ECON_DAILY_TELEGRAM_INTERVAL_SECONDS=60
OFFICIAL_CALENDAR_REFRESH_MINUTES=360
OFFICIAL_CALENDAR_RELEASE_DAY_REFRESH_MINUTES=15
NEWS_QUERY_CACHE_TTL_SEC=60
NEWS_STALE_TTL_SEC=1800
NEWS_STALE_AFTER_SEC=1800
NEWS_RETENTION_DAYS=90
RSS_USER_AGENT=uLiquid-Desk-MarketIntelligence/1.0 (+https://desk.uliquid.vip; support@uliquid.vip)
```

`AI_MARKET_SUMMARY_ENABLED=false` keeps summaries deterministic and avoids AI
costs. If enabled, set `AI_MARKET_SUMMARY_MODEL` and verify the normal AI
billing/provider configuration first.

## API and UI

- `GET /news` and `GET /news/:id`
- `GET /economic-calendar` and `GET /economic-calendar/next`
- `GET /market-intelligence/context`
- `GET /market-intelligence/summary`
- `GET /market-intelligence/providers`
- `GET /admin/market-intelligence/providers`
- `PUT /admin/market-intelligence/providers/:providerId`
- `POST /admin/market-intelligence/refresh`
- User UI: `/market-intelligence`
- Admin UI: `/admin/providers` (includes refresh and daily Telegram job status)
- User notification UI: manual economic-calendar Telegram send plus the last successful delivery timestamp

Provider enable/disable and usage-status changes are superadmin-only and written
to the admin audit trail. A manual resync is also audited.

## Migration and validation

The migration is
`prisma/migrations/20260802170000_market_intelligence_providers/migration.sql`.
It is backward-compatible: legacy economic rows remain readable and no rollback
requires deleting them. Economic releases keep their current normalized value
on `economic_events` and preserve every numbered release/revision separately in
`economic_event_revisions`.

Curated occurrence IDs are based on the release period or meeting occurrence,
not the scheduled timestamp. Corrected release times therefore update the same
database row. Review the BEA, Census, FOMC and ECB date lists when those agencies
publish a new annual schedule; emergency changes can be supplied through the
server-only `ECONOMIC_CURATED_SCHEDULE_JSON` override.

Before staging:

```bash
npm run db:generate
npm -w apps/api run test:market-intelligence
npm -w apps/api run typecheck
npm -w apps/web run typecheck
npm -w apps/web run i18n:check
```

Apply the migration to staging only inside the normal release process, then
exercise Dashboard News, Calendar, Market Intelligence, Telegram daily digest,
Prediction context, Admin Providers and a forced single-source failure.

## Health, alerts and incident handling

The generic external-health snapshot and Telegram health monitor use
`marketIntelligence`, not FMP, as the active dependency. Inspect provider state,
last success, latency, item count, circuit state, stale age and license status in
Admin Providers.

If one RSS source fails, the response is degraded and remaining sources stay
available. If every news source or the calendar fails, consumers receive empty
or stale data plus an explicit degraded warning; no forecast or news fact is
invented. If BLS blocks or temporarily rejects the live ICS request, the
provider reports degraded status and uses its reviewed 2026 release dates; the
stable period-based IDs reconcile with the live ICS path when it recovers.

Rollback options:

1. Disable a faulty source in Admin Providers.
2. Change `NEWS_PROVIDERS` or `ECONOMIC_CALENDAR_PROVIDERS` to another registered
   provider and restart the API.
3. During the rollout window only, enable `FMP_LEGACY_ENABLED=true` and
   `FMP_LEGACY_FALLBACK_ENABLED=true`. FMP is queried only when the primary
   provider returns no data.
4. Keep the database migration in place; it is compatible with both paths.

Remove the legacy adapter, FMP admin key section and FMP health probe only after
at least seven stable days in the FMP-off phase and confirmation that no consumer
still depends on it.
