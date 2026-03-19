from __future__ import annotations

from grid.models import GridPlanRequest, GridPreviewRequest
from grid.planner import plan, preview


def test_preview_builds_levels_and_positive_qty() -> None:
    payload = GridPreviewRequest(
        mode="long",
        gridMode="arithmetic",
        lowerPrice=60000,
        upperPrice=70000,
        gridCount=10,
        investUsd=1000,
        leverage=3,
        markPrice=65000,
    )
    result = preview(payload)
    assert len(result.levels) == 11
    assert result.perGridQty > 0
    assert result.perGridNotional > 0
    assert result.liqEstimateLong is not None
    assert result.liqEstimateShort is not None
    assert result.worstCaseLiqDistancePct is not None


def test_preview_applies_min_qty_and_min_notional_constraints() -> None:
    payload = GridPreviewRequest(
        mode="long",
        gridMode="arithmetic",
        lowerPrice=100,
        upperPrice=120,
        gridCount=10,
        investUsd=50,
        leverage=2,
        markPrice=100,
        venueConstraints={
            "minQty": 1,
            "qtyStep": 0.1,
            "minNotional": 150,
            "priceTick": 0.1,
            "feeRate": 0.06,
        },
    )
    result = preview(payload)
    assert result.qtyPerOrderRounded >= 1
    assert result.qtyPerOrderRounded * payload.markPrice >= 150
    assert result.venueChecks.minNotionalHit is True


def test_preview_min_investment_uses_one_way_neutral_full_budget() -> None:
    payload = GridPreviewRequest(
        mode="neutral",
        gridMode="arithmetic",
        lowerPrice=100,
        upperPrice=120,
        gridCount=10,
        investUsd=100,
        leverage=2,
        markPrice=100,
        venueConstraints={"minQty": 0.5, "qtyStep": 0.1, "minNotional": 100, "feeRate": 0.06},
        feeBufferPct=1,
    )
    result = preview(payload)
    # neutral uses full budget on one active side and takes the stricter side requirement.
    expected = (100 * 1.01 * 5) / 2
    assert abs(result.minInvestmentUSDT - expected) < 1e-6
    assert result.minInvestmentBreakdown.get("long", 0) > 0
    assert result.minInvestmentBreakdown.get("short", 0) > 0


def test_preview_allocation_mode_changes_qty_model() -> None:
    payload_notional = GridPreviewRequest(
        mode="cross",
        gridMode="arithmetic",
        allocationMode="EQUAL_NOTIONAL_PER_GRID",
        budgetSplitPolicy="FIXED_50_50",
        lowerPrice=100,
        upperPrice=120,
        gridCount=10,
        investUsd=500,
        leverage=2,
        markPrice=110,
        venueConstraints={"minQty": 0.1, "qtyStep": 0.01, "minNotional": 10, "feeRate": 0.06},
    )
    payload_base = payload_notional.model_copy(update={"allocationMode": "EQUAL_BASE_QTY_PER_GRID"})

    notional = preview(payload_notional)
    base = preview(payload_base)
    assert notional.qtyModel.get("mode") == "EQUAL_NOTIONAL_PER_GRID"
    assert base.qtyModel.get("mode") == "EQUAL_BASE_QTY_PER_GRID"
    assert base.qtyModel.get("qtyBase") is not None


def test_preview_custom_budget_split_is_respected() -> None:
    payload = GridPreviewRequest(
        mode="cross",
        gridMode="arithmetic",
        allocationMode="EQUAL_NOTIONAL_PER_GRID",
        budgetSplitPolicy="FIXED_CUSTOM",
        longBudgetPct=60,
        shortBudgetPct=40,
        lowerPrice=100,
        upperPrice=120,
        gridCount=10,
        investUsd=500,
        leverage=2,
        markPrice=110,
        venueConstraints={"minQty": 0.1, "qtyStep": 0.01, "minNotional": 10, "feeRate": 0.06},
    )
    result = preview(payload)
    assert result.allocationBreakdown.get("longBudgetPct") == 60
    assert result.allocationBreakdown.get("shortBudgetPct") == 40


def test_preview_cross_uses_separate_ranges_and_grid_counts() -> None:
    payload = GridPreviewRequest(
        mode="cross",
        gridMode="arithmetic",
        allocationMode="EQUAL_NOTIONAL_PER_GRID",
        budgetSplitPolicy="FIXED_50_50",
        lowerPrice=100,
        upperPrice=140,
        gridCount=12,
        crossSideConfig={
            "long": {"lowerPrice": 100, "upperPrice": 118, "gridCount": 4},
            "short": {"lowerPrice": 122, "upperPrice": 140, "gridCount": 7},
        },
        investUsd=500,
        leverage=2,
        markPrice=120,
        venueConstraints={"minQty": 0.1, "qtyStep": 0.01, "minNotional": 10, "feeRate": 0.06},
    )
    result = preview(payload)
    assert result.allocationBreakdown.get("gridCountLong") == 4
    assert result.allocationBreakdown.get("gridCountShort") == 7
    assert result.allocationBreakdown.get("longRange", {}).get("upperPrice") == 118
    assert result.allocationBreakdown.get("shortRange", {}).get("lowerPrice") == 122
    assert result.minInvestmentBreakdown.get("long", 0) > 0
    assert result.minInvestmentBreakdown.get("short", 0) > 0


def test_preview_neutral_ignores_budget_split_inputs() -> None:
    base = GridPreviewRequest(
        mode="neutral",
        gridMode="arithmetic",
        allocationMode="EQUAL_NOTIONAL_PER_GRID",
        lowerPrice=100,
        upperPrice=120,
        gridCount=10,
        investUsd=500,
        leverage=2,
        markPrice=110,
        venueConstraints={"minQty": 0.1, "qtyStep": 0.01, "minNotional": 10, "feeRate": 0.06},
    )
    custom = base.model_copy(
        update={"budgetSplitPolicy": "FIXED_CUSTOM", "longBudgetPct": 90, "shortBudgetPct": 10}
    )

    base_result = preview(base)
    custom_result = preview(custom)

    assert abs(base_result.perGridQty - custom_result.perGridQty) < 1e-9
    assert abs(base_result.minInvestmentUSDT - custom_result.minInvestmentUSDT) < 1e-9
    assert custom_result.allocationBreakdown.get("longBudgetPct") is None
    assert custom_result.allocationBreakdown.get("shortBudgetPct") is None
    assert "split_ignored_for_mode" in custom_result.validationErrors


def test_preview_flags_too_many_grids_for_available_capital() -> None:
    payload = GridPreviewRequest(
        mode="cross",
        gridMode="arithmetic",
        budgetSplitPolicy="FIXED_50_50",
        lowerPrice=100,
        upperPrice=120,
        gridCount=80,
        investUsd=120,
        leverage=2,
        markPrice=110,
        venueConstraints={"minQty": 0.1, "qtyStep": 0.01, "minNotional": 20, "feeRate": 0.06},
    )
    result = preview(payload)
    assert result.capitalSummary.get("tooManyGridsForCapital") is True
    assert "too_many_grids_for_available_capital" in result.warnings


def test_preview_flags_extreme_leverage_requests() -> None:
    payload = GridPreviewRequest(
        mode="long",
        gridMode="arithmetic",
        lowerPrice=60000,
        upperPrice=76000,
        gridCount=12,
        investUsd=500,
        leverage=20,
        markPrice=68000,
        venueConstraints={"minQty": 0.001, "qtyStep": 0.001, "minNotional": 5, "feeRate": 0.06},
    )
    result = preview(payload)
    assert result.safetySummary.get("leverageBand") == "extreme"
    assert "extreme_leverage_requested" in result.warnings


def test_preview_flags_narrow_range_with_low_buffer() -> None:
    payload = GridPreviewRequest(
        mode="long",
        gridMode="arithmetic",
        lowerPrice=98,
        upperPrice=102,
        gridCount=10,
        investUsd=300,
        leverage=6,
        markPrice=100,
        venueConstraints={"minQty": 0.1, "qtyStep": 0.01, "minNotional": 10, "feeRate": 0.06},
    )
    result = preview(payload)
    assert result.safetySummary.get("narrowRangeLowBuffer") is True
    assert "narrow_range_low_buffer" in result.warnings


def test_plan_is_deterministic_for_same_input() -> None:
    payload = GridPlanRequest(
        instanceId="inst-1",
        mode="neutral",
        gridMode="geometric",
        lowerPrice=60000,
        upperPrice=70000,
        gridCount=8,
        investUsd=1200,
        leverage=2,
        markPrice=65000,
        openOrders=[],
        stateJson={},
        fillEvents=[],
    )
    first = plan(payload).model_dump()
    second = plan(payload).model_dump()
    assert first == second


def test_plan_provides_liq_risk_and_threshold_block_flag() -> None:
    payload = GridPlanRequest(
        instanceId="inst-1b",
        mode="long",
        gridMode="arithmetic",
        lowerPrice=60000,
        upperPrice=70000,
        gridCount=10,
        investUsd=100,
        leverage=20,
        markPrice=65000,
        openOrders=[],
        stateJson={},
        fillEvents=[],
        mmrPct=1.0,
        liqDistanceMinPct=50.0,
    )
    result = plan(payload)
    assert "risk" in result.model_dump()
    assert result.risk.get("entryBlockedByLiq") in (True, False)
    assert result.risk.get("worstCaseLiqDistancePct") is not None


def test_plan_returns_trigger_wait_when_not_reached() -> None:
    payload = GridPlanRequest(
        instanceId="inst-2",
        mode="long",
        gridMode="arithmetic",
        lowerPrice=60000,
        upperPrice=70000,
        gridCount=12,
        investUsd=2000,
        leverage=3,
        markPrice=64000,
        triggerPrice=65000,
        openOrders=[],
        stateJson={},
        fillEvents=[],
    )
    result = plan(payload)
    assert result.intents == []
    assert "trigger_not_reached" in result.reasonCodes


def test_plan_does_not_wait_when_trigger_is_reached() -> None:
    payload = GridPlanRequest(
        instanceId="inst-2b",
        mode="long",
        gridMode="arithmetic",
        lowerPrice=60000,
        upperPrice=70000,
        gridCount=12,
        investUsd=2000,
        leverage=3,
        markPrice=66000,
        triggerPrice=65000,
        openOrders=[],
        stateJson={},
        fillEvents=[],
    )
    result = plan(payload)
    assert len(result.intents) > 0
    assert "trigger_not_reached" not in result.reasonCodes


def test_plan_neutral_one_way_uses_reduce_only_on_opposite_side_when_long_open() -> None:
    payload = GridPlanRequest(
        instanceId="inst-neutral-long",
        mode="neutral",
        gridMode="arithmetic",
        lowerPrice=60000,
        upperPrice=70000,
        gridCount=12,
        investUsd=1000,
        leverage=3,
        markPrice=65000,
        openOrders=[],
        stateJson={},
        fillEvents=[],
        position={"side": "long", "qty": 0.5, "entryPrice": 64000},
    )
    result = plan(payload)
    buy = next((intent for intent in result.intents if intent.side == "buy"), None)
    sell = next((intent for intent in result.intents if intent.side == "sell"), None)
    assert buy is not None and buy.reduceOnly is False
    assert sell is not None and sell.reduceOnly is True


def test_plan_neutral_one_way_uses_reduce_only_on_opposite_side_when_short_open() -> None:
    payload = GridPlanRequest(
        instanceId="inst-neutral-short",
        mode="neutral",
        gridMode="arithmetic",
        lowerPrice=60000,
        upperPrice=70000,
        gridCount=12,
        investUsd=1000,
        leverage=3,
        markPrice=65000,
        openOrders=[],
        stateJson={},
        fillEvents=[],
        position={"side": "short", "qty": 0.5, "entryPrice": 66000},
    )
    result = plan(payload)
    buy = next((intent for intent in result.intents if intent.side == "buy"), None)
    sell = next((intent for intent in result.intents if intent.side == "sell"), None)
    assert buy is not None and buy.reduceOnly is True
    assert sell is not None and sell.reduceOnly is False


def test_plan_neutral_flat_keeps_both_entry_sides_non_reduce() -> None:
    payload = GridPlanRequest(
        instanceId="inst-neutral-flat",
        mode="neutral",
        gridMode="arithmetic",
        lowerPrice=60000,
        upperPrice=70000,
        gridCount=12,
        investUsd=1000,
        leverage=3,
        markPrice=65000,
        openOrders=[],
        stateJson={},
        fillEvents=[],
        position={"side": "long", "qty": 0.0, "entryPrice": 64000},
    )
    result = plan(payload)
    buy = next((intent for intent in result.intents if intent.side == "buy"), None)
    sell = next((intent for intent in result.intents if intent.side == "sell"), None)
    assert buy is not None and buy.reduceOnly is False
    assert sell is not None and sell.reduceOnly is False


def test_plan_cross_keeps_long_and_short_orders_inside_their_own_ranges() -> None:
    payload = GridPlanRequest(
        instanceId="inst-cross-separate",
        mode="cross",
        gridMode="arithmetic",
        lowerPrice=100,
        upperPrice=140,
        gridCount=12,
        crossSideConfig={
            "long": {"lowerPrice": 100, "upperPrice": 118, "gridCount": 4},
            "short": {"lowerPrice": 122, "upperPrice": 140, "gridCount": 7},
        },
        investUsd=1000,
        leverage=3,
        markPrice=120,
        openOrders=[],
        stateJson={},
        fillEvents=[],
    )
    result = plan(payload)
    long_prices = [float(intent.price or 0) for intent in result.intents if intent.gridLeg == "long" and intent.side == "buy"]
    short_prices = [float(intent.price or 0) for intent in result.intents if intent.gridLeg == "short" and intent.side == "sell"]
    assert long_prices
    assert short_prices
    assert all(100 <= price <= 118 for price in long_prices)
    assert all(122 <= price <= 140 for price in short_prices)
