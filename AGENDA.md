# uLiquid Desk Release Agenda

Last updated: 2026-05-15

This agenda tracks the review findings against the live repository. It is intentionally release-focused: new feature work should stay behind these gates until the canary path is repeatable.

## Review Alignment

- [x] Replace unordered root `npm -ws` build/typecheck with a topological workspace runner.
- [x] Run Prisma Client generation as an explicit early root build/typecheck step.
- [x] Keep Foundry contracts as explicit `contracts:build` / `contracts:test` gates instead of mixing them into the Node workspace build.
- [x] Fix Python strategy registry test semantics so the version-mismatch test targets a Python-registered strategy.
- [x] Minimize public API health output and move detailed job/vault status behind admin auth.
- [x] Add API security headers through Helmet with API-safe cross-origin settings.
- [x] Hash session-cookie rate-limit scopes before using or logging them.
- [x] Validate idempotency-key shape and cap accepted keys at 128 characters.
- [x] Add bounded in-memory cleanup for rate-limit and idempotency fallback stores.
- [x] Enforce production token quality in the Python strategy service.
- [x] Rename Next 16 `middleware.ts` convention to `proxy.ts`.

## P0 Release Gates

- [x] Verify the full Node build path locally on Node 20.x.
- [x] Verify the full Node typecheck path locally on Node 20.x.
- [x] Confirm `npx prisma generate` works locally before workspace build/typecheck.
- [x] Run `apps/web` production build locally under Node 20.
- [x] Run Foundry build/test locally through `npm run contracts:build` and `npm run contracts:test`.
- [x] Add CI enforcement for Node 20.x: `npm ci`, `npm run build`, `npm run typecheck`.
- [x] Cache Prisma engines in CI so `npx prisma generate` is not network-fragile.
- [x] Install Foundry in CI and require `npm run contracts:build` plus `npm run contracts:test`.
- [x] Run Python tests with explicit local tokens: `PY_STRATEGY_AUTH_TOKEN=test-token PY_GRID_AUTH_TOKEN=test-token PYTHONPATH=apps/py-strategy-service pytest -q apps/py-strategy-service`.
- [x] Split or tune long futures-exchange tests so CI failures are assertion failures, not global timeouts.

## P1 Hardening

- [x] Require Redis-backed rate-limit/idempotency storage for production deployments or fail fast when missing.
- [x] Decide whether `/system/settings` remains public long-term; if public, keep it limited to UI-safe flags only.
- [x] Move `/license/state` consumers, if any are added, to authenticated admin APIs only.
- [x] Expand API typecheck coverage beyond the previous narrow `apps/api/tsconfig.json` include set.
  Current gate: all production `apps/api/src/**/*.ts` files are included, with `src/**/*.test.ts` excluded from build output.
- [x] Start an `any` budget for capital-moving API, runner, vault, funding, and exchange adapter paths.
- [x] Document vendored TradingView/charting assets with version, source, license, and checksum.

## P2 Refactor Tracks

- [ ] Break `apps/api/src/index.ts` into route registration, middleware/bootstrap, jobs, and service wiring.
  Started: base middleware/bootstrap is extracted into `apps/api/src/server/appMiddleware.ts`; API job/shutdown lifecycle is extracted into `apps/api/src/server/lifecycle.ts`; route/service extraction remains.
- [ ] Split BotVault lifecycle/funding/reconciliation/fee/recovery logic into smaller service modules.
  Started: funding display state mapping is extracted into `apps/api/src/vaults/botVaultFundingDisplay.ts`; V4 profit-share/atomic USD helpers are extracted into `apps/api/src/vaults/botVaultV4ProfitShare.ts`; lifecycle, reconciliation, broader fee-settlement, and recovery flows remain.
- [ ] Split runner grid execution into state machine, order placement, fill sync, recovery, and persistence modules.
  Started: market-data/noop/resubmit/noise guard decisions are extracted into `apps/runner/src/execution/gridExecutionGuards.ts`; order placement, fill sync, recovery, and persistence flows remain.
- [x] Build a release evidence matrix for commit, build, tests, migrations, canary, rollback, and onchain ownership.
- [x] Add contract fuzz/invariant coverage before broad production capital movement.
