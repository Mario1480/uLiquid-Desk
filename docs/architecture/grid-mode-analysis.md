# Grid Mode Analysis

Source paths reviewed:

- `apps/api/src/grid/previewComputation.ts`
- `apps/api/src/grid/routes-instances.ts`
- `apps/runner/src/execution/futuresGridExecutionMode.ts`
- `apps/py-strategy-service/grid/planner.py`

## Shared Logic Path

- Preview uses `computeGridPreviewAndAllocation()` and forwards mode, range, budgets, seed settings, and `crossSideConfig` to the Python planner.
- Create uses the same preview computation for validation, then persists the resolved mode fields onto the grid instance and bot snapshot.
- Live runner forwards the persisted instance fields to the same Python planner via `buildGridPlanRequest()`.

Current conclusion:

- Order placement logic is centralized in the Python planner for preview and live execution.
- Seed direction is duplicated in Python and TypeScript, but the current rules match.
- The main remaining divergences are around data availability and diagnostics, not around the core ladder logic.

## Mode Summary

### Long

Expected behavior:

- Initial seed is always `buy`.
- Buy orders sit below market.
- Sell orders above market are reduce-only exits for the long inventory.
- Capital is allocated 100% to the long side.

Current implementation:

- Seed rule matches in runner (`computeInitialSeedSide`) and planner (`_seed_side` / `_seed_side_from_payload`).
- Preview and live planner intents are consistent.

Known deviation:

- If preview has no usable venue mark price, it can synthesize one from the grid range midpoint. Live runner waits for market data instead.

### Short

Expected behavior:

- Initial seed is always `sell`.
- Sell orders sit above market.
- Buy orders below market are reduce-only exits for the short inventory.
- Capital is allocated 100% to the short side.

Current implementation:

- Seed rule matches in runner and planner.
- Preview and live planner intents are consistent.

Known deviation:

- Same preview mark-price fallback caveat as long mode, but it is less likely to change directional behavior because short seed is fixed.

### Neutral

Expected behavior:

- Seed direction depends on the current mark price versus the grid midpoint.
- Below market the ladder uses long-leg buys.
- Above market the ladder uses short-leg sells.
- Once a position exists, the opposite-side orders become reduce-only and the active-entry side collapses to one way.
- Capital behaves as one-way full-budget exposure, not simultaneous 50/50 deployment.

Current implementation:

- Planner documents this explicitly via `neutral_full_budget_mode` and `NEUTRAL_FULL_BUDGET_ONE_WAY`.
- Preview and live use the same planner rules.
- Runner seed logic matches planner midpoint logic.

Known deviation:

- With an odd `activeOrderWindowSize`, neutral biases one extra active order to the buy side while flat. This is small, but not semantically perfect.

Recommended follow-up:

- Decide whether neutral should require an even active window size, or whether the extra slot should be allocated by a clearer rule.

### Cross

Expected behavior:

- Long and short use separate side ranges from `crossSideConfig`.
- Seed direction is chosen by the nearer side midpoint:
  - long side if mark is closer to the long band
  - short side if mark is closer to the short band
- Buy intents are generated only from the long range.
- Sell intents are generated only from the short range.
- Capital split is 50/50 by default or custom via `FIXED_CUSTOM`.

Current implementation:

- Preview and live planner both use side-specific ranges and side-specific per-order quantity.
- Runner forwards `crossSideConfig` to the live planner and uses the same side-midpoint seed rule.
- Create persists the side config onto the bot snapshot and grid instance.

Known deviation:

- With an odd `activeOrderWindowSize`, cross also biases one extra active order to the buy side because `_window_targets()` defaults to `half_up` buys and `half_down` sells.
- Preview can still synthesize a midpoint mark price when venue mark data is missing; for cross this can change the preview seed side and active window center more visibly than in long or short.

Recommended follow-up:

- Consider making cross active windows explicitly symmetric by policy, or require even window sizes.
- If stricter preview/live parity is desired, create could refuse previews that rely on a synthetic mark price.

## Small Safe Fixes Implemented

- Preview now emits `preview_mark_price_fallback_used` when no explicit mark price override and no positive venue mark price are available, so UI/support can tell when the preview used a synthetic midpoint price.

## High-Value Follow-Ups

- Add planner tests for odd `activeOrderWindowSize` in neutral and cross to lock current behavior before changing it.
- Decide whether synthetic preview mark prices should remain allowed for create or become a hard block for more modes.
