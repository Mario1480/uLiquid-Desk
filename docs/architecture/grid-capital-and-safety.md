# Grid Capital And Safety

## Scope

This document defines the product-facing capital and safety model for grid preview, grid instance creation, and runtime margin adjustments.

The goal is to keep the existing grid runtime behavior compatible while making the following explicit:

- minimum capital required to place the configured grid
- how reserve capital is separated from active grid investment
- what auto margin is expected to do
- when liquidation proximity should block or warn
- how frontend clients should render preview readiness

## Execution Path

Grid planning and validation now flow through these layers:

1. `apps/api/src/grid/previewComputation.ts`
   Resolves venue context, validates constraints, computes auto-margin splits, and requests the Python preview.
2. `apps/py-strategy-service/grid/planner.py`
   Produces the grid preview, minimum investment, seed impact, capital summary, and safety summary.
3. `apps/api/src/grid/previewValidation.ts`
   Normalizes preview output into a frontend-facing `validation` block with blocking and warning codes.
4. Route handlers in:
   - `apps/api/src/grid/routes-templates.ts`
   - `apps/api/src/grid/routes-instances.ts`

## Capital Model

### Minimum Investment

`minInvestmentUSDT` is the minimum grid budget required to satisfy:

- venue min quantity / min notional constraints
- configured leverage
- grid slot count
- side budget split
- initial seed fraction, when enabled
- fee buffer assumptions

The Python planner now also exposes:

- `capitalSummary.minimumGridCapitalUsd`
  Minimum capital required for the grid portion alone.
- `capitalSummary.minimumRequiredBudgetUsd`
  Minimum total budget required after seed adjustment.
- `capitalSummary.minimumRecommendedBudgetUsd`
  A product-level recommended budget including additional operating buffer.

### Reserve Allocation

At the API layer, total budget is normalized into:

- `validation.capital.gridInvestUsd`
  Capital assigned to the active grid.
- `validation.capital.reserveUsd`
  Capital reserved as extra margin.
- `validation.capital.reservePct`
  Reserve as a share of total budget.

For manual margin mode:

- `gridInvestUsd` is the requested invest amount.
- `reserveUsd` is the explicitly supplied extra margin.

For auto margin mode:

- `totalBudgetUsd` is treated as the full user budget.
- API split logic decides how much stays in grid capital vs reserve capital.
- The response includes the chosen split mode and search iterations used.

### Capital Density Warnings

The planner now flags thin capital distribution with:

- `too_many_grids_for_available_capital`

This is triggered when effective per-grid capital is too close to venue minimums across a large number of grid slots.

## Safety Model

### Liquidation Proximity

Preview safety normalizes:

- `validation.safety.worstCaseLiqDistancePct`
- `validation.safety.liqDistanceMinPct`
- `validation.safety.liquidationBufferPct`
- `validation.safety.liquidationStatus`

Statuses:

- `ok`
  Current preview has acceptable liquidation distance.
- `low`
  The grid is not blocked, but the remaining liquidation buffer is thin.
- `blocked`
  Worst-case liquidation distance is below the required minimum.

### Range And Leverage Warnings

The planner now emits explicit product warnings for:

- `extreme_leverage_requested`
- `narrow_range_low_buffer`
- `auto_margin_buffer_recommended`

These do not automatically block every preview, but they are surfaced through the normalized validation model so frontend can explain the tradeoff clearly.

## Venue Constraint Safety

API now fails fast with `grid_invalid_venue_constraints` when venue context returns malformed values such as:

- negative min quantity
- non-finite step size
- negative fee rate
- invalid liquidation threshold inputs

This prevents the frontend from rendering a misleading preview from corrupted venue metadata.

## Normalized Preview Contract

Preview responses keep the existing fields and add a normalized `validation` block:

```json
{
  "status": {
    "ready": true,
    "codes": ["too_many_grids_for_available_capital", "reserve_below_recommended"]
  },
  "validation": {
    "ready": true,
    "severity": "warning",
    "codes": ["too_many_grids_for_available_capital", "reserve_below_recommended"],
    "blockingCodes": [],
    "warningCodes": ["too_many_grids_for_available_capital", "reserve_below_recommended"],
    "capital": {
      "marginMode": "AUTO",
      "totalBudgetUsd": 300,
      "gridInvestUsd": 210,
      "reserveUsd": 90,
      "reservePct": 30,
      "minInvestmentUSDT": 120
    },
    "safety": {
      "leverage": 10,
      "leverageBand": "elevated",
      "worstCaseLiqDistancePct": 9,
      "liqDistanceMinPct": 8,
      "liquidationBufferPct": 1,
      "liquidationStatus": "low"
    }
  }
}
```

## Blocking Rules

The normalized model blocks previews and creation flows for:

- `insufficient_budget`
- `grid_invest_below_minimum`
- `liq_distance_below_threshold`
- `grid_invalid_venue_constraints`

Warnings remain renderable without blocking, including:

- `too_many_grids_for_available_capital`
- `extreme_leverage_requested`
- `narrow_range_low_buffer`
- `reserve_below_recommended`
- `constraints_missing_or_fallback_used`

## Frontend Rendering Guidance

Recommended UI grouping:

1. Capital
   Show total budget, grid budget, reserve budget, minimum required budget, and shortfall.
2. Safety
   Show leverage band, liquidation buffer, and whether auto margin is recommended.
3. Warnings
   Render `validation.warningCodes` as user-facing guidance.
4. Blocking Issues
   Render `validation.blockingCodes` as actionable errors and disable create/start actions.

## Tested Edge Cases

Coverage added for:

- too many grids for available capital
- extreme leverage requests
- narrow range with low liquidation buffer
- invalid venue constraints at the API boundary
- normalized validation response shape from draft preview
