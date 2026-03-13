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

## Design intent

Paper should converge toward the same execution contract as live venues:

- normalized symbols and contract metadata
- min-notional and precision handling
- consistent order and position state
- normalized audit and failure semantics
- shared reconciliation model

What remains intentionally different is the simulation policy:

- fills
- slippage
- fees
- funding assumptions
- mark-price sourcing

Those rules should be explicit and versionable, not hidden behind route-specific branches.

## Current limitations

- Paper still uses API-level simulation helpers rather than a dedicated adapter implementation.
- Manual desk, prediction, and grid still call into Paper through partially different orchestration flows.
- Linked market-data behavior is explicit now at the context level, but not yet unified behind a full Paper adapter.

## Next hardening steps

1. introduce a dedicated Paper adapter that conforms to the same normalized futures execution contract as live venues
2. move fill/PnL/open-order/position semantics behind that adapter
3. align manual trading, prediction copier, runner, and grid to consume the same Paper execution surface
4. document fee, slippage, and funding assumptions as a versioned simulation policy

## Regression anchors

Current minimum regression anchors for Paper-related consolidation:

- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/api/src/trading.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/runner/src/prediction-copier.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/apps/api/src/routes/grid.vault-lifecycle.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uTrade-Bots/docs/regression-matrix.md`
