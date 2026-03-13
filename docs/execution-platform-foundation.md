# Execution Platform Foundation

This document captures the current consolidation direction for uTrade-Bots as it evolves from a feature-rich beta into a hardened multi-exchange execution platform.

## Scope

The platform now has multiple execution-facing products on top of the same exchange and orchestration stack:

- Manual Trading Desk
- standard runner bots
- Prediction Copier
- Grid
- Paper trading
- Python-backed strategy and grid planning

The consolidation goal is to make those flows share one execution foundation instead of each carrying venue-specific behavior on its own.

## Current foundation

The exchange layer now exposes an explicit venue-resolution step before adapter creation:

- `resolveFuturesVenue(...)`
- `createFuturesAdapter(...)`
- `getFuturesVenueCapabilities(...)`

Key source files:

- `packages/futures-exchange/src/core/exchange-capabilities.ts`
- `packages/futures-exchange/src/factory/create-futures-adapter.ts`

`resolveFuturesVenue(...)` separates three concerns that used to be blended together:

1. venue normalization
2. capability discovery
3. product-policy outcome (`adapter`, `paper`, `market_data_only`, `blocked`, `unsupported`)

That gives API and runner code one explicit place to ask:

- what venue are we really dealing with
- can it execute perp orders
- is it market-data-only
- is it blocked by policy
- does it require linked market data

## Capability matrix

The first normalized capability matrix is intentionally small and operational:

| Venue | Connector kind | Perp market data | Perp execution | Linked market data required | Grid execution |
| --- | --- | --- | --- | --- | --- |
| Bitget | `live` | yes | yes | no | yes |
| Hyperliquid | `live` | yes | yes | no | yes |
| MEXC | `live` | yes | yes | no | yes |
| Paper | `simulated` | yes | yes | yes | yes |
| Binance | `market_data_only` | yes | no | no | no |

Notes:

- `paper` is still simulation-backed and currently depends on a linked live market-data account.
- `binance` is intentionally modeled as a market-data venue, not a futures execution venue.
- policy toggles like `allowMexcPerp` are still applied above raw capabilities.

## Design rules

### 1. Adapter factory should not hide product policy

Raw venue resolution belongs in the exchange layer. Product decisions such as:

- market-data-only behavior
- Paper linkage requirements
- pilot gating
- plan gating

should be expressed in a higher-level resolver or service, not scattered across unrelated callers.

### 2. Paper must behave like a connector, not a side path

Paper is a real product path. It should converge toward:

- normalized order validation
- explicit fill and fee assumptions
- shared event and reconciliation semantics
- one documented dependency on linked live market data

instead of being implemented separately by manual trading, prediction, grid, and sync paths.

### 3. Entry paths should share one execution foundation

Manual trading, bots, prediction, and grid should eventually reuse the same foundation for:

- symbol and contract normalization
- precision and min-notional checks
- margin and leverage validation
- order intent mapping
- exchange failure normalization
- audit and reconciliation

### 4. Python owns strategy logic, TypeScript owns execution safety

Python remains the owner of:

- local strategy logic
- grid preview and planning logic

TypeScript remains the owner of:

- input validation
- timeout/fallback behavior
- execution safety and gating
- persistence
- exchange interaction

## Immediate next steps

The next consolidation slices should focus on:

1. making `ExchangeAdapterV2` the single canonical futures contract
2. hardening Paper into a first-class connector abstraction
3. moving more API and runner callers onto explicit venue resolution
4. decomposing `apps/api/src/index.ts` into domain route registrars
5. aligning grid execution with the common execution layer instead of parallel venue logic

## Related docs

- `README.md`
- `docs/exchange-capability-matrix.md`
- `docs/paper-trading-smoke-test.md`
- `docs/ts-python-grid-contract.md`
- `docs/regression-matrix.md`
- `docs/manual-trading-desk.md`
- `docs/vault-architecture.md`
- `docs/adr/0001-ccxt-hybrid-cex-standard.md`
