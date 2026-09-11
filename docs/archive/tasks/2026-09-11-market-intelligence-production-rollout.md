# Market Intelligence production rollout — 2026-09-11

Status: `DEPLOYED / SUPERSEDED BY COMPLETE LEGACY-PROVIDER REMOVAL`.

## Authorization and boundary

Mario authorized the production rollout after the local closeout pass. The
release was limited to Market Intelligence API hardening. No wallet action,
trade, contract call, ULIQ activation, Hummingbot change, or legacy FMP data
deletion was performed.

## Backup and migration evidence

- Production database backup:
  `/var/backups/uliquid-desk/market-intelligence-20260911/marketmaker-20260911T102423Z.dump`
- Size: `102423989` bytes.
- SHA-256:
  `51febe40b66c5671b4f8cb3d39f6b44ed230ecc5fca1ffceb402740cb6584207`.
- The archive listing check passed.
- A full restore into temporary database `mi_restore_probe_20260911_manual`
  completed successfully with 126 public base tables. The restored database
  contained migration `20260802170000_market_intelligence_providers` and the
  four Market Intelligence tables. The temporary database was dropped and its
  absence was verified.
- Production already had migration
  `20260802170000_market_intelligence_providers` applied at
  `2026-08-02 15:33:06 UTC`; Prisma reported 116 applied migrations and no
  pending migration.

## Production configuration

The running API configuration was checked without exposing secret values:

- `MARKET_INTELLIGENCE_ENABLED=true`
- `NEWS_PROVIDERS=rss`
- `ECONOMIC_CALENDAR_PROVIDERS=official`
- `RSS_NEWS_ENABLED=true`
- `OFFICIAL_ECONOMIC_CALENDAR_ENABLED=true`
- `AI_MARKET_SUMMARY_ENABLED=false`
- `FMP_LEGACY_ENABLED=false`
- `FMP_LEGACY_FALLBACK_ENABLED=false`

Historical FMP event rows were retained for rollback and comparison. Their
latest fetch remains `2026-08-02 15:33:06 UTC`; they are not an active source.

## Runtime finding and release

The pre-release API process had a Market Intelligence startup cycle that never
completed. The provider health map therefore contained only the official
calendar provider and the system monitor opened an incident. A scoped API
restart cleared the in-memory cycle and the incident was resolved. Direct
provider probes then confirmed that all eight approved RSS sources and both
official calendar sources were reachable.

Review found two concrete hardening gaps:

1. the RSS HTTP timeout did not bound the preceding DNS promise, so a stalled
   resolver could keep the refresh job in its `running` state indefinitely;
2. the live BLS calendar uses the timezone alias `US-Eastern`, which the
   production JavaScript runtime rejected instead of interpreting as
   `America/New_York`.

Commit `01162eb0b` (`fix(api): harden market intelligence refresh`) bounds DNS
validation with the existing request abort signal and normalizes the BLS
timezone alias. It was pushed as a fast-forward from production base
`e7130b1e6` to `main` and deployed through `scripts/deploy_prod.sh api`.
The Compose dependency graph also recreated the Python strategy service; no
Python source changed. API and Python strategy containers became healthy and
the public API health endpoint returned `200`.

## Verification

Pre-release and focused release checks passed:

- Prisma Client generation;
- Market Intelligence suite before the release change: 58/58;
- focused RSS and official calendar tests after the hardening change: 15/15;
- API typecheck;
- Web typecheck and i18n integrity from the local closeout pass;
- `git diff --check`.

Post-deploy direct provider probes through the deployed API image returned:

- RSS: 183 unique items, 8/8 approved sources healthy, no warnings, about
  0.8 seconds;
- Official calendar: 157 events for the probe range, BLS healthy, Eurostat
  healthy, no warnings, about 0.9 seconds.

The production database contained 211 RSS news rows with latest fetch
`2026-09-11 11:12:22 UTC`. Official calendar rows had latest fetch
`2026-09-11 11:01:23 UTC` and covered 63 high-, 36 medium-, and 39 low-impact
records. There were 32 upcoming records in the next 30 days at the time of the
check. The first automatic startup cycle after deployment completed but was
transiently degraded while the services were warming. The first regular
ten-minute RSS refresh then completed with 183 items, `degraded=false`, and no
warnings. The following central health cycle reported 10 providers or sources,
zero unavailable, and zero degraded. This is a stable rollout baseline, not a
seven-day stability result.

## Authenticated browser acceptance and follow-up hardening

Authenticated production checks in Chrome passed for the Dashboard Market
Intelligence widget, News, Economic Calendar, Market Intelligence, Admin
Providers, Predictions Dashboard, and AI Prediction Builder. The Market
Intelligence page reported 10/10 healthy sources. Admin Providers showed all
ten approved sources healthy, with the latest refresh totals of 183 news items
and 102 calendar events. Predictions reported the scheduled data sources as
operational, and the builder remained explicitly analysis-only; no AI request,
template save, order, bot, or wallet action was triggered.

The calendar browser check exposed a presentation mismatch: the blackout
summary correctly had no future high-impact event, while its empty-state text
incorrectly claimed that the selected range had no events even though four
earlier events were listed. Commit `94a85054f` changed the copy to describe the
high-impact risk horizon. The Web i18n check, Web typecheck, production Next.js
build, service health checks, and a live authenticated browser recheck passed.

The News content review also found three historical SEC archive items whose
feed dates had been interpreted as 2026, including a 1999 Year 2000 release and
two 1997 releases. Commit `61833487b` rejects future publication dates and SEC
press-release year mismatches during ingestion and filters already stored
invalid rows from reads without deleting historical raw data. Nine focused RSS
tests and the API typecheck passed before deployment. The API production build
passed and the public health endpoint returned `200` after restart. The first
post-restart provider cycle was transiently degraded: both SEC feeds failed to
connect and Eurostat used the curated fallback. One controlled retry through
Admin Providers at `2026-09-11 16:32:57` restored 8/8 RSS sources with 183
items and both official calendar sources with 102 events. The final News page
showed no partial-coverage warning, and the invalid SEC archive items were no
longer visible.

Telegram Daily Calendar configuration is enabled in Admin Providers, but the
page showed no completed delivery and a last-cycle count of `0/0`. No Telegram
message was sent during this pass.

Unauthenticated boundary smokes returned the expected results:

- `/health`: `200`;
- `/news`: `401`;
- `/economic-calendar`: `401`;
- `/market-intelligence/context`: `401`;
- `/market-intelligence/summary`: `401`.

## Remaining gates

- Exercise or observe one real Telegram Daily Calendar delivery path.
- Record at least seven stable FMP-off days, including source coverage,
  refresh completion, degraded/stale behavior, and alert transitions.
- After that observation passes, remove the legacy FMP adapter, key
  administration, health probe, tests, translations, and documentation in a
  separate reviewed release.

The existing `salad_http_401` system-health incident is unrelated to Market
Intelligence and remains outside this rollout.

## Superseding owner decision

Mario confirmed later on 2026-09-11 that the retired paid provider has no
subscription and has not been used for a long time. He authorized complete
removal instead of retaining an unsupported rollback path for a seven-day
observation. The implementation and production evidence are recorded in
[`2026-09-11-fmp-removal.md`](2026-09-11-fmp-removal.md). This decision does not
alter the earlier rollout observations or delete historical provider rows.
