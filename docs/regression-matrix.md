# Core Regression Matrix

This matrix is the practical safety net for the consolidation effort. It is intentionally smaller than full product coverage, but it targets the highest-risk paths that can regress while the platform is being modularized.

Run it with:

```bash
npm run regression:core
```

Implementation:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/scripts/run_regression_matrix.sh`

## 1. Exchange foundation

Phase 2 shared-market coverage also runs with `npm -w apps/api run test:agent-chat`: `src/market-data/*.test.ts`, `src/ai/features/*.test.ts`, Agent Chat skill/Decision Log tests and the normalized perpetual client tests. It covers dataset/venue/market/coverage isolation, single-flight/timeouts, run pinning, Paper ownership, stored feature validation and Binance depth-limit translation. Fixture coverage is not connector certification.

Phase 2 consumer coverage adds `node node_modules/tsx/dist/cli.mjs --test apps/api/src/position-copilot/*.test.ts` and `npm -w apps/web run test:agent-chat-ui`: public feature context after ownership/settings checks, evidence paired with cached explanations, unsupported/linked source handling, deterministic risk floor, no AI tools, persisted metric projection and legacy/error states. See the [active Phase 2 plan](uLiquid-Hummingbot-Analysis-Final/implementation/PHASE_2_IMPLEMENTATION_PLAN.md) for synthetic browser evidence and remaining authenticated/model/typecheck gates.

Purpose:

- adapter creation / venue resolution
- capability outcomes
- normalized contract and error behavior
- retry policy semantics

Coverage:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/factory/create-futures-adapter.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/core/cross-exchange.contract.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/core/retry-policy.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/bitget/bitget-error.mapper.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/mexc/mexc-error.mapper.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/binance/binance-error.mapper.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/bingx/bingx.signing.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/bingx/bingx-error.mapper.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/bingx/bingx.adapter.test.ts`

Venues covered:

- Bitget
- Hyperliquid
- MEXC
- Binance
- BingX
- Paper (resolution/capability semantics)

## 2. API execution and Paper behavior

Purpose:

- Paper vs live perp execution context
- error normalization in trading/sync paths
- shared API behavior for manual trading

Coverage:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/trading.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/paper/policy.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/exchange-sync.errors.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/manual-trading-error.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/local-strategies/pythonClient.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/local-strategies/pythonRunner.test.ts`

## 3. Grid and vault-critical API paths

Purpose:

- Grid preview/plan client contract
- Grid lifecycle safety
- Hyperliquid demo vault/provider behavior
- execution lifecycle integrity

Coverage:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/grid/pythonGridClient.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/grid/autoMargin.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/grid/autoReserveDynamic.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/vaults/executionProvider.registry.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/vaults/executionProvider.hyperliquidDemo.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/vaults/executionLifecycle.service.test.ts`

## 4. Runner shared execution assumptions

Purpose:

- Grid planner contract on the runner side
- Prediction Copier safety
- execution registry behavior

Coverage:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/grid/pythonGridClient.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/prediction-copier.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/execution/registry.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/runtime/executionEvents.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/runtime/predictionTradeReconciliation.test.ts`

## 5. What this matrix is supposed to catch

- venue resolution drift between Bitget, Hyperliquid, MEXC, Binance, BingX, and Paper
- exchange error mapping regressions
- retry policy changes that alter live behavior
- Paper execution-context regressions
- Paper simulation-policy regressions
- Grid preview/plan protocol regressions
- Grid/vault lifecycle regressions
- shared runner-path regressions between Grid and Prediction Copier
- local strategy service `v2` envelope / fallback regressions
- structured strategy-service auth/timeout/error-code regressions
- shared Paper runtime / linked market-data support regressions on the runner side
- grid termination / best-effort history-close parity regressions
- shared `executionVenue` / `marketDataVenue` metadata regressions between Prediction Copier and Grid

## 6. What is still outside this core matrix

The following still need wider coverage over time:

- broader manual trading desk flows
- more detailed Hyperliquid, MEXC, Binance and BingX adapter parity tests
- deeper Paper fill/PnL/funding semantics
- more Grid venue-constraint edge cases
- full Grid route/integration flows with a live or mocked Python planner process
- strategy-run TS↔Python contract versioning beyond Grid
- broader live market-data / websocket smoke coverage

## 7. Usage guidance

Use this matrix:

- before large refactors in `apps/api/src/index.ts`
- before exchange-adapter changes
- before Grid/vault changes
- before TS↔Python contract changes
- before production deploys that touch execution, Paper, Grid, or venue resolution

For the final consolidation release gate, combine this matrix with:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/docs/consolidation-release-checklist.md`
