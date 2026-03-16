# Exchange Capability Matrix

This document captures the execution-facing venue contract that uLiquid-Desk is consolidating around.

It is intentionally operational rather than marketing-oriented: the goal is to show what the platform can rely on when it resolves a venue for manual trading, bots, prediction flows, Grid, and Paper-linked market data.

## Canonical sources

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/core/exchange-capabilities.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/factory/create-futures-adapter.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/trading.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/execution/futuresVenueRuntime.ts`

## Venue matrix

| Venue | Resolution kind | Perp market data | Perp execution | Requires linked market data | Grid planning | Grid execution intent | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bitget | `adapter` | yes | yes | no | yes | yes | Most mature connector; strongest fix coverage today |
| Hyperliquid | `adapter` | yes | yes | no | yes | yes | Strategically important for Grid + vault direction |
| MEXC | `adapter` or `blocked` | yes | yes | no | yes | yes | Perp enablement still policy-gated in some environments |
| Paper | `paper` | yes (via linked venue) | simulated | yes | yes | yes | First-class product path, but still being hardened into a normal connector |
| Binance | `market_data_only` | yes | no | no | yes (as source only where caller allows it) | no | Not a futures execution venue in the current platform |

## Shared capability intent

The platform is converging on these normalized questions for every venue:

- Can it provide perp market data?
- Can it execute perp orders?
- Does it require linked live market data?
- Is it allowed by current product policy?
- Is it suitable for Grid execution or only Grid planning?

Those answers should come from explicit capability resolution, not from scattered exchange-name checks in API or runner code.

## Product-path expectations

### Manual trading

- Uses the same venue resolution and normalized perp read/execution services.
- Live venues should behave consistently around precision, min notional, and failure mapping.
- Paper should eventually use the same contract, with simulation policy as the only deliberate difference.

### Prediction and bot execution

- Prediction Copier and bot lifecycle paths should not own venue-specific adapter behavior.
- They should consume shared execution/read services plus a common venue runtime layer.

### Grid

- Grid planning should consume venue constraints and market data through normalized services.
- Grid execution should reuse the same normalized execution foundation as other order-entry paths wherever possible.
- Hyperliquid and Paper are the most important reference venues for current Grid hardening.

## Consolidation rules

1. Adapter creation should not encode product policy.
2. Product policy belongs in higher-level resolvers.
3. Paper must become explicit, documented, and contract-shaped.
4. Exchange-specific fixes stay in adapter/fix modules, not in route or runner orchestration.
5. Any new venue behavior should be added to the capability matrix and regression matrix together.

## Current gaps to keep visible

- Paper still does not exist as a full normalized adapter implementation.
- Hyperliquid and MEXC need continued parity review against Bitget-level expectations.
- Some product policies still exist above the adapter boundary in API/runner orchestration and need further consolidation.
