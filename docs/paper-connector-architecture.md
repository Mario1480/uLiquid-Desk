# Paper Connector Architecture

Paper trading is a product path, not a side experiment. It should be treated as a first-class connector with explicit dependencies and clearly documented limitations.

## Current model

Paper execution currently behaves as:

- execution venue: `paper`
- market-data venue: a linked live exchange account
- persistence: TypeScript-managed state in `GlobalSetting`
- fill model: simulated inside the API/runner stack

Relevant sources:

- `apps/api/src/trading.ts`
- `apps/api/src/routes/grid.ts`
- `apps/runner/src/prediction-copier.ts`
- `apps/runner/src/execution/futuresGridExecutionMode.ts`
- `docs/paper-trading-smoke-test.md`
- `docs/exchange-capability-matrix.md`

## Explicit dependency

Paper is not self-sufficient market data. It requires a linked live market-data account:

- Bitget
- Hyperliquid
- MEXC
- Binance market-data-only where supported by the caller

The API now exposes this dependency more explicitly through `buildPerpTradingContext(...)` / `resolvePerpTradingContext(...)`:

- selected account
- linked market-data account
- execution venue resolution
- market-data venue resolution
- whether linked market data is required

This makes the Paper dependency visible in one place instead of being inferred ad hoc in every route.

At the exchange-factory level, callers can now also use `createResolvedFuturesAdapter(...)` to get either:

- a live adapter, or
- an explicit Paper/runtime resolution without relying on exceptions for normal control flow

The Paper contract is now also explicit in the runtime model:

- `PaperExecutionContext`
- `LinkedMarketDataContext`
- `PaperSimulationPolicy`
- `PaperRuntimeContract`
- `createPaperExecutionContext(...)`
- `resolvePaperLinkedMarketDataSupport(...)`

Key source:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/paper/policy.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/runtime/paperExecution.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/core/paper-runtime.ts`

Current default simulation policy is intentionally conservative and centralized:

- legacy `feeBps` / `slippageBps` are still accepted for backward compatibility
- explicit maker/taker fees:
  - `PAPER_TRADING_MAKER_FEE_BPS`
  - `PAPER_TRADING_TAKER_FEE_BPS`
- explicit slippage controls:
  - `PAPER_TRADING_MARKET_SLIPPAGE_BPS`
  - `PAPER_TRADING_STOP_SLIPPAGE_BPS`
- partial-fill and margin controls:
  - `PAPER_TRADING_LIMIT_PARTIAL_FILL_RATIO`
  - `PAPER_TRADING_INITIAL_MARGIN_RATIO`
  - `PAPER_TRADING_MAINTENANCE_MARGIN_RATIO`
  - `PAPER_TRADING_LIQUIDATION_SLIPPAGE_BPS`
- optional funding controls:
  - `PAPER_TRADING_FUNDING_MODE`
  - `PAPER_TRADING_FUNDING_RATE_BPS_PER_HOUR`
  - `PAPER_TRADING_FUNDING_INTERVAL_MINUTES`
- `startBalanceUsd` from `PAPER_TRADING_START_BALANCE_USD`

That gives us one documented place to evolve Paper assumptions instead of silently drifting per route or per product path.

## Design intent

Paper should converge toward the same execution contract as live venues:

- normalized symbols and contract metadata
- min-notional and precision handling
- consistent order and position state
- normalized audit and failure semantics
- shared reconciliation model

What remains intentionally different is the simulation policy:

- fills
- partial fills for resting limits
- slippage
- fees
- funding assumptions
- liquidation and margin thresholds
- mark-price sourcing

Those rules should be explicit and versionable, not hidden behind route-specific branches.

## Current capabilities

Perp paper simulation now models:

- taker slippage for market and stop-market execution
- maker/taker fee separation
- partial fills for resting limit orders
- stop-triggered execution semantics
- optional funding accrual
- account equity, available margin, maintenance margin, and liquidation handling

## Current limitations

- Paper still uses API-level simulation helpers rather than a dedicated adapter implementation.
- Manual desk perp flows are now materially more realistic than the older runner-side paper helpers used by some grid/prediction paths.
- Linked market-data behavior is explicit now at the context level, but not yet unified behind a full Paper adapter.

## Current hardening status

Already aligned or centralized:

1. API Paper support and eligibility rules are centralized in `paper/policy.ts`
2. Perp trading context carries an explicit `paperContext`
3. Manual trading, bot lifecycle, and prediction schedulers now reuse the same Paper-linked market-data contract more consistently
4. Runner-side default balance, linked market-data support, and simulation defaults now resolve from the same shared paper runtime helper used by the API

Still open:

1. introduce a dedicated Paper adapter that conforms to the same normalized futures execution contract as live venues
2. move fill/PnL/open-order/position semantics behind that adapter
3. finish aligning runner Grid and Prediction Copier on the same richer Paper execution surface
4. version the simulation policy if we later add funding or venue-dependent slippage models

## Regression anchors

Current minimum regression anchors for Paper-related consolidation:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/trading.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/prediction-copier.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/routes/grid.vault-lifecycle.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/docs/regression-matrix.md`
