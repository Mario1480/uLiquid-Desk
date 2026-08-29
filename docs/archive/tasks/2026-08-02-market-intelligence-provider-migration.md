# Market Intelligence Provider Migration Evidence

Date: 2026-08-02

## Local implementation status

- Provider-neutral news, calendar, health and summary contracts implemented.
- Reviewed Federal Reserve, ECB and SEC RSS sources registered.
- BLS ICS with a reviewed outage fallback and Eurostat's release-calendar endpoint plus curated official
  FOMC/ECB/BEA/Census/DOL schedules implemented.
- Stable occurrence identifiers prevent duplicates when release times move;
  released and revised values have a separate revision-history table.
- SSRF, XML, size, timeout, redirect and sanitization boundaries implemented.
- Postgres persistence, deduplication, retention, stale cache and circuit breaker
  implemented.
- Existing News, Calendar, Telegram and Prediction consumers connected to the
  provider-neutral data path.
- Grounded summary schema, citations, source-cluster cache and deterministic
  fallback implemented. AI summary remains off by default.
- Market Intelligence and Admin Providers web pages added with responsive styles
  and English/German translations.
- FMP is disabled by default. The legacy adapter is retained only for measured
  rollback and is not required by the primary path.

## Local evidence

| Check | Result |
| --- | --- |
| `npm -w apps/api run test:market-intelligence` | PASS, 46/46 |
| `npm -w apps/api run test:ai` | PASS, 134/134 |
| `npm -w apps/api run typecheck` | PASS |
| API TypeScript build with isolated `/tmp` output | PASS |
| `npm -w apps/web run typecheck` | PASS |
| `npm -w apps/web run i18n:check` | PASS |
| Prisma bundled-WASM schema validation | PASS |
| `npm run quality:vendor-charting` | PASS |
| `git diff --check` | PASS |

The contract suite covers three feed formats/sources, sanitization, SSRF
rejection, deduplication, one-source failure, official-calendar timezone and
date-only handling, all non-BLS U.S. MVP schedules, Eurostat CPI/GDP mapping,
stable reschedule identity, release revision merge, provider priority, stale
cache, circuit breaker, grounded citations, missing data, conflicting sentiment,
stale-data warnings, provider health, grouped Telegram alerts, Telegram calendar
formatting and conservative Prediction news-risk behavior.

A read-only live provider probe for 2026-08-02 through 2026-11-01 returned 57
MVP events across all seven official source groups. Eurostat was live; BLS
returned HTTP 403 to this host, so the result correctly remained degraded while
the reviewed BLS schedule fallback preserved CPI, Core CPI, PPI, NFP and
Unemployment coverage.

The standard API and Next production builds stalled with no CPU activity while
writing under the macOS Documents/FileProvider checkout. The API build passed
when its output was redirected to an isolated `/tmp` directory. Both Turbopack
and webpack Next builds showed the same checkout I/O stall; web type generation
and TypeScript validation passed. `quality:any-budget` is independently red in
the unchanged runner scope (`98` versus budget `97`).

## Evidence still requiring an environment

- Prisma migration applied and verified in staging.
- Staging E2E smokes for Dashboard, News, Calendar, Market Intelligence,
  Telegram daily digest and Prediction context.
- Provider coverage/latency comparison during shadow/internal beta.
- At least seven stable days with `FMP_LEGACY_ENABLED=false`.
- Final phase-5 removal of the legacy adapter, FMP admin UI and FMP health probe.

No migration, deploy, provider write, production action or live trading action
was executed as part of this local implementation.
