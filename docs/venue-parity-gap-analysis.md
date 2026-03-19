# Venue Parity Gap Analysis

Last updated: 2026-03-19

## Scope

This document compares the operational maturity of the main perp venues currently present in uLiquid Desk:

- Bitget
- Hyperliquid
- MEXC
- Paper

The goal is not to claim perfect symmetry. The goal is to make the highest-risk differences explicit, then close the gaps that most affect live safety and product UX.

## Current parity snapshot

Legend:

- `strong`: mature normalized support in adapter/runtime paths
- `partial`: supported, but with caveats or fallback dependence
- `gap`: materially behind the reference venue

| Capability | Bitget | Hyperliquid | MEXC | Paper | Notes |
| --- | --- | --- | --- | --- | --- |
| Perp execution | strong | strong | strong | strong | Paper remains simulated and linked to live market data |
| Manual order placement | strong | strong | strong | strong | Shared execution foundation now validates capabilities centrally |
| Market / limit order support | strong | strong | strong | strong | Normalized through shared execution pipeline |
| Reduce-only support | strong | strong | strong | strong | Important for safe close flows |
| Leverage / margin controls | strong | strong | strong | strong | Subject to venue-specific exchange behavior |
| Close position support | strong | strong | strong | strong | Hyperliquid and MEXC were brought up in this pass |
| Position TP/SL controls | strong | strong | gap | strong | MEXC exchange endpoints exist but normalized adapter parity still lags |
| Order editing | strong | gap | gap | gap | Hyperliquid and MEXC remain behind Bitget here |
| Normalized open-order reads | strong | partial | partial | strong | Hyperliquid/MEXC still rely more on higher-level fallback shaping |
| Normalized position reads | strong | partial | partial | strong | Raw read support exists; direct normalized adapter parity still trails Bitget |
| Grid execution support | strong | strong | strong | strong | Capability-checked at runtime |
| Vault execution support | gap | strong | gap | gap | Hyperliquid remains the vault reference venue |

## Reference venue

Bitget is still the operational reference venue because it already combines:

- normalized close support
- normalized TP/SL support
- normalized order editing
- normalized open-order reads
- normalized position reads
- the deepest fix/test coverage

Hyperliquid is strategically the most important venue after Bitget because it matters for:

- Grid
- vault execution
- manual live trading safety

MEXC remains viable, but its advanced order surface is still less mature in the normalized adapter contract.

Paper is product-critical, but its parity work is intentionally different: its gaps are about simulation/runtime convergence rather than exchange endpoint coverage.

## Highest-priority gaps before this pass

### 1. Hyperliquid lacked normalized emergency close support

Impact:

- live safety risk
- manual close-position UX inconsistency
- weaker parity with Bitget and Paper

Why it mattered:

- `closePositionsMarket(...)` in the API depends on adapter `closePosition(...)`
- without adapter support, Hyperliquid close requests could degrade into empty results instead of explicit close execution

Status:

- fixed in this pass

### 2. Hyperliquid lacked normalized position TP/SL controls

Impact:

- live safety risk
- weaker protective-order UX
- lower parity for manual trading workflows

Why it mattered:

- Bitget and Paper already supported this normalized product flow
- Hyperliquid already had enough trade-api primitives to support it safely

Status:

- fixed in this pass

### 3. MEXC lacked normalized emergency close support

Impact:

- live safety risk
- inconsistent manual exit behavior

Why it mattered:

- MEXC could place reduce-only orders already
- the missing piece was adapter-level normalized close orchestration

Status:

- fixed in this pass

## Implemented parity fixes

### Fix 1: Hyperliquid normalized `closePosition(...)`

Implemented in:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/hyperliquid/hyperliquid.adapter.ts`

Outcome:

- Hyperliquid now closes open exposure through normalized reduce-only market orders
- manual/API close flows now behave like the stronger reference venues

### Fix 2: Hyperliquid normalized `setPositionTpSl(...)`

Implemented in:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/hyperliquid/hyperliquid.adapter.ts`

Outcome:

- Hyperliquid now replaces existing TP/SL plan orders before creating new ones
- current position side is resolved from live position state when needed
- capability registry now exposes Hyperliquid TP/SL support

### Fix 3: MEXC normalized `closePosition(...)`

Implemented in:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/mexc/mexc.adapter.ts`

Outcome:

- MEXC now supports normalized close-position execution through reduce-only market orders
- capability registry now exposes MEXC close-position support

## Remaining gaps after this pass

Priority order:

1. MEXC normalized TP/SL support
2. Hyperliquid normalized order editing
3. MEXC normalized order editing
4. Hyperliquid direct normalized open-order / position-read surfaces
5. MEXC direct normalized open-order / position-read surfaces
6. Paper convergence toward a fuller first-class adapter contract

## Validation and smoke coverage

Primary sources:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/core/exchange-capabilities.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/hyperliquid/hyperliquid.adapter.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/mexc/mexc.adapter.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/core/cross-exchange.contract.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/packages/futures-exchange/src/factory/create-futures-adapter.test.ts`

Smoke/test coverage added in this pass:

- Hyperliquid close-position parity check
- Hyperliquid TP/SL replacement parity check
- MEXC close-position parity check
- capability-registry assertions for new support flags
