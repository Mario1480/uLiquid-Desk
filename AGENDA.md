# uLiquid Desk Release Agenda

Last updated: 2026-05-16

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
- [x] Fix v18 Core license HMAC test vector and require `packages/core` tests in release gates.
- [x] Make Hyperliquid CoreWriter unit tests deterministic by avoiding real RPC gas estimation when transaction sending is injected.
- [x] Clean duplicate/confusing Python token placeholders in `.env.prod.example`.
- [x] Add a CI-validatable vendored charting checksum gate and release-evidence entry.

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
- [ ] Attach GitHub Actions release-gates evidence for commit `8b0951f6` or the final release tag.
  Local evidence on 2026-05-16: `npm run typecheck`, `npm run build`, `npm run quality:any-budget`, `npm run quality:vendor-charting`, `npm -w packages/core run test`, `npm -w packages/futures-exchange run test`, `npm -w apps/api run test:release-hardening`, Python strategy tests, and `npm run contracts:test` were green.

## P1 Hardening

- [x] Require Redis-backed rate-limit/idempotency storage for production deployments or fail fast when missing.
- [x] Decide whether `/system/settings` remains public long-term; if public, keep it limited to UI-safe flags only.
- [x] Move `/license/state` consumers, if any are added, to authenticated admin APIs only.
- [x] Expand API typecheck coverage beyond the previous narrow `apps/api/tsconfig.json` include set.
  Current gate: all production `apps/api/src/**/*.ts` files are included, with `src/**/*.test.ts` excluded from build output.
- [x] Start an `any` budget for capital-moving API, runner, vault, funding, and exchange adapter paths.
- [x] Document vendored TradingView/charting assets with version, source, license, and checksum.
- [x] Automatically verify the documented vendored charting checksum in CI with `npm run quality:vendor-charting`.
- [ ] Start reducing the `any` budgets instead of only preventing regressions.
  Suggested first targets: vault settlement/funding DTOs, runner order/fill/reconciliation DTOs, exchange adapter responses, license/auth boundaries, and onchain integration payloads.
- [ ] Plan staged strictness upgrades for API and Web.
  API still carries `noImplicitAny: false`; Web still carries `strict: false`. Treat this as a gradual module-by-module track rather than a single flag flip.
- [ ] Document Prisma engine handling for restricted/offline deployment environments.
  CI now caches Prisma engines and local Node 20 gates passed, but fully air-gapped builds still need a documented cache/preinstall policy if they become a deployment requirement.

## P2 Refactor Tracks

- [ ] Break `apps/api/src/index.ts` into route registration, middleware/bootstrap, jobs, and service wiring.
  Started: base middleware/bootstrap is extracted into `apps/api/src/server/appMiddleware.ts`; API WebSocket upgrade/auth wiring is extracted into `apps/api/src/server/websocketUpgrade.ts`; API job/shutdown lifecycle is extracted into `apps/api/src/server/lifecycle.ts`; grid/vault route wiring is extracted into `apps/api/src/routes/gridVaultRouteGroup.ts`; broader route/service extraction remains.
- [x] Split BotVault lifecycle/funding/reconciliation/fee/recovery logic into smaller service modules.
  Live-critical split completed: funding display state mapping is extracted into `apps/api/src/vaults/botVaultFundingDisplay.ts`; V4 profit-share/atomic USD helpers are extracted into `apps/api/src/vaults/botVaultV4ProfitShare.ts`; settlement/post-processing state helpers are extracted into `apps/api/src/vaults/botVaultV3SettlementState.ts`; reconciliation state parsing and issue construction are extracted into `apps/api/src/vaults/botVaultV3ReconciliationState.ts`; operation-state derivation is extracted into `apps/api/src/vaults/botVaultV3OperationState.ts`; execution readiness/action-health decisions are extracted into `apps/api/src/vaults/botVaultV3Readiness.ts`; onchain resync and lifecycle counterevidence policy is extracted into `apps/api/src/vaults/botVaultV3ReconciliationPolicy.ts`; profit-share fee-event/idempotent affiliate accrual persistence is extracted into `apps/api/src/vaults/botVaultV3FeeEvents.ts`. The remaining `botVaultV3.service.ts` code is orchestration around controller wallets, RPC calls, and transactions rather than standalone policy.
- [x] Split runner grid execution into state machine, order placement, fill sync, recovery, and persistence modules.
  Live-critical split completed: market-data/noop/resubmit/noise guard decisions are extracted into `apps/runner/src/execution/gridExecutionGuards.ts`; initial-seed/restart-recovery helpers are extracted into `apps/runner/src/execution/gridInitialSeed.ts`; planner request/intent/risk-gate helpers are extracted into `apps/runner/src/execution/gridPlanning.ts`; order placement and order-persistence helpers are extracted into `apps/runner/src/execution/gridOrderExecution.ts`; planner fill/position sync helpers are extracted into `apps/runner/src/execution/gridFillSync.ts`; BotVault/vault readiness is extracted into `apps/runner/src/execution/gridVaultReadiness.ts`; vault funding/balance-transfer state is extracted into `apps/runner/src/execution/gridVaultFunding.ts`; pending-execution recovery remains in `apps/runner/src/execution/recovery.ts`. The remaining `futuresGridExecutionMode.ts` code is the runner orchestration loop around those modules.
- [x] Build a release evidence matrix for commit, build, tests, migrations, canary, rollback, and onchain ownership.
- [x] Add contract fuzz/invariant coverage before broad production capital movement.

## Production Evidence Still Needed

- [ ] Fill a release-specific copy of `docs/release-evidence-matrix.md` for the next tag/deploy.
- [ ] Record Docker production build evidence for API/Web/Runner images.
- [ ] Record staging migration evidence, including backup and restore confidence.
- [ ] Record canary limits and rollback rehearsal evidence before broader capital movement.
- [ ] Record onchain addresses, ownership, explorer verification, and pause/kill-switch evidence for the release.
