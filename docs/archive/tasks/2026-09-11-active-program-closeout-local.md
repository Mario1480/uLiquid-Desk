# Active program closeout and local gate restoration — 2026-09-11

Status: `LOCAL COMPLETE / PRODUCTION GATES OPEN`.

## Scope

This pass executed the first three items of the recommended active-program
sequence:

1. reconcile the current status of AI Agent Chat, Limited Beta, OpenAI Router
   and AI Credits, and Execution Foundation;
2. complete the safe local Market Intelligence closeout work and identify the
   exact production boundary;
3. restore the failing Type Safety any-budget gate without raising a ceiling.

Hummingbot and ULIQ remain open by explicit owner direction. Arbitrum USDC
Billing was not changed. No deployment, database migration, production setting,
provider activation, wallet action, trade, or onchain action was performed.

## Documentation reconciliation

- Added the evidence-based active-program closeout register.
- Reclassified AI Agent Chat as implemented and released with formal retention,
  operations, and acceptance closeout still open.
- Reclassified OpenAI Router and AI Credits as implemented with paid production
  run evidence, while preserving pricing, live reconciliation, and operations
  gates.
- Separated the deployed beta-intake flow from the Limited Beta packet's
  unaccepted product-wide launch mode.
- Re-baselined the Execution Foundation list: manual leverage, placement, edit,
  TP/SL, and close use the shared service/pipeline; cancel paths, the legacy
  Prediction Copier mode, Vault policy, and parity evidence remain open.

## Market Intelligence local closeout

Eight tracked files with names ending in ` 2.ts` were unreferenced older copies
of their canonical Market Intelligence source or test file. They were removed
after comparison and reference checks. No canonical implementation was deleted.

The repository defaults already describe the FMP-independent configuration and
the operations guide records reviewed source terms. The following local checks
passed:

- Prisma Client generation;
- Market Intelligence suite: 58/58;
- API typecheck;
- Web typecheck;
- Web i18n integrity.

A read-only unauthenticated production probe returned:

- `/health`: `200`;
- `/news`: `401`;
- `/economic-calendar`: `401`;
- `/market-intelligence/context`: `401`;
- `/market-intelligence/summary`: `401`.

This confirms API reachability and the public authorization boundary only. It
does not prove the production migration, provider configuration, authenticated
content, Telegram delivery, Prediction Context, Admin Providers, stale/degraded
behavior, or seven stable FMP-off days.

## Type Safety gate

The initial any-budget run failed because `packages/exchange` contained 73
explicit `any` type nodes against a ceiling of 72. The Binance symbol-identity
boundary now accepts `unknown` and narrows an object record before reading
fields. The ceiling was not increased.

Verification passed:

- `npm run quality:any-budget`: all seven protected scopes within budget;
- `npm -w packages/exchange run typecheck`;
- focused Binance client tests: 2/2.

The broader strictness program remains active: API still has
`noImplicitAny=false`, Web still has `strict=false` and `allowJs=true`, and the
current API Vault ceiling of 334 is above the historical 323 target.

## Remaining production gate

Market Intelligence can close only after an authorized backup and migration,
production flag verification, authenticated post-deploy smokes, alert and
degraded-state evidence, at least seven stable FMP-off days, and the subsequent
legacy FMP cleanup and deployment.

Production follow-up: the backup, restore probe, migration verification,
configuration verification, and scoped API hardening deployment are recorded in
[`2026-09-11-market-intelligence-production-rollout.md`](2026-09-11-market-intelligence-production-rollout.md).
Authenticated acceptance and the seven-day observation remain open.
