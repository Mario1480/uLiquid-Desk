from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

from .math import (
    compute_qty_for_constraints,
    effective_grid_slots,
    estimate_liq_with_mmr,
    estimate_liq_price,
    grid_levels,
    min_notional_from_constraints,
    nearest_level_indexes,
    round6,
)
from .models import GridIntent, GridLevel, GridPlanRequest, GridPlanResponse, GridPreviewRequest, GridPreviewResponse


def _reference_price(mark_price: float | None, levels: List[float]) -> float:
    if mark_price and mark_price > 0:
        return mark_price
    if not levels:
        return 1.0
    return (levels[0] + levels[-1]) / 2.0


def _per_grid_values(invest_usd: float, leverage: float, grid_count: int, reference_price: float) -> Tuple[float, float]:
    per_grid_notional = (invest_usd * leverage) / max(1, grid_count)
    per_grid_qty = per_grid_notional / max(reference_price, 1e-9)
    return (round6(per_grid_notional), round6(per_grid_qty))


def _side_slots(mode: str, grid_count: int) -> Tuple[int, int]:
    if mode == "long":
        return (max(1, grid_count), 0)
    if mode == "short":
        return (0, max(1, grid_count))
    if mode == "neutral":
        return (max(1, grid_count // 2), max(1, grid_count - (grid_count // 2)))
    if mode == "cross":
        return (max(1, grid_count), max(1, grid_count))
    return (max(1, grid_count), 0)


def _side_budget_split(mode: str, policy: str, long_pct: float, short_pct: float) -> Tuple[float, float]:
    if mode == "long":
        return (100.0, 0.0)
    if mode == "short":
        return (0.0, 100.0)
    if mode == "neutral":
        return (100.0, 100.0)
    if mode == "cross" and policy == "FIXED_CUSTOM":
        return (max(0.0, long_pct), max(0.0, short_pct))
    return (50.0, 50.0)


def _seed_side(mode: str, mark_price: float, lower_price: float, upper_price: float) -> str:
    if mode == "long":
        return "buy"
    if mode == "short":
        return "sell"
    midpoint = (lower_price + upper_price) / 2.0
    return "buy" if mark_price <= midpoint else "sell"


def _initial_seed_snapshot(
    *,
    payload: GridPreviewRequest | GridPlanRequest,
    mark_price: float,
    min_qty: float | None,
    qty_step: float | None,
    min_notional: float,
) -> Dict[str, Any]:
    seed_pct = max(0.0, min(60.0, float(payload.initialSeedPct or 0.0)))
    seed_enabled = bool(payload.initialSeedEnabled and seed_pct > 0)
    if not seed_enabled:
        return {
            "enabled": False,
            "seedPct": round6(seed_pct),
            "seedSide": None,
            "seedQty": 0.0,
            "seedNotionalUsd": 0.0,
            "seedMarginUsd": 0.0,
            "seedMinMarginUsd": 0.0,
        }

    seed_margin_usd = max(0.0, float(payload.investUsd) * (seed_pct / 100.0))
    seed_notional_usd_raw = seed_margin_usd * max(float(payload.leverage), 1e-9)
    seed_qty_raw = seed_notional_usd_raw / max(mark_price, 1e-9)
    seed_qty, _ = compute_qty_for_constraints(seed_qty_raw, min_qty, qty_step, min_notional, mark_price)
    seed_notional_usd = round6(seed_qty * mark_price)
    seed_margin_effective = round6(seed_notional_usd / max(float(payload.leverage), 1e-9))
    seed_side = _seed_side(payload.mode, mark_price, payload.lowerPrice, payload.upperPrice)
    seed_min_margin_usd = round6((min_notional if min_notional > 0 else 0.0) / max(float(payload.leverage), 1e-9))
    return {
        "enabled": True,
        "seedPct": round6(seed_pct),
        "seedSide": seed_side,
        "seedQty": round6(seed_qty),
        "seedNotionalUsd": seed_notional_usd,
        "seedMarginUsd": seed_margin_effective,
        "seedMinMarginUsd": seed_min_margin_usd,
    }


def _profit_per_grid(levels: List[float], reference_price: float, taker_pct: float) -> Tuple[float, float]:
    if len(levels) < 2:
        return (0.0, 0.0)
    gross_pct = ((levels[1] - levels[0]) / max(reference_price, 1e-9)) * 100.0
    net_pct = gross_pct - (2.0 * taker_pct)
    return (round6(net_pct), round6(net_pct / 100.0))


def _env_float(name: str, default: float, min_value: float | None = None, max_value: float | None = None) -> float:
    try:
        parsed = float(os.getenv(name, str(default)))
    except Exception:
        parsed = default
    if min_value is not None:
        parsed = max(min_value, parsed)
    if max_value is not None:
        parsed = min(max_value, parsed)
    return parsed


def _resolve_venue_inputs(payload: GridPreviewRequest | GridPlanRequest, reference_price: float) -> Tuple[float | None, float | None, float | None, float, bool]:
    constraints = payload.venueConstraints
    min_qty = float(constraints.minQty) if constraints and constraints.minQty and constraints.minQty > 0 else None
    qty_step = float(constraints.qtyStep) if constraints and constraints.qtyStep and constraints.qtyStep > 0 else None
    raw_min_notional = (
        float(constraints.minNotional)
        if constraints and constraints.minNotional and constraints.minNotional > 0
        else None
    )
    if raw_min_notional is None:
        fallback = _env_float("GRID_MIN_NOTIONAL_FALLBACK_USDT", 5.0, 0.0, None)
        raw_min_notional = fallback if fallback > 0 else None
    min_notional, fallback_used = min_notional_from_constraints(raw_min_notional, min_qty, reference_price)
    if min_notional is None:
        min_notional = 0.0

    fee_rate = (
        float(constraints.feeRate)
        if constraints and constraints.feeRate is not None and constraints.feeRate >= 0
        else _env_float("GRID_FEE_RATE_FALLBACK_PCT", payload.feeModel.takerPct, 0.0, 20.0)
    )
    return (min_qty, qty_step, min_notional, fee_rate, fallback_used)


def _build_risk_snapshot(
    *,
    mode: str,
    grid_count: int,
    per_grid_qty: float,
    per_grid_qty_long: float | None = None,
    per_grid_qty_short: float | None = None,
    min_investment_usdt: float,
    mark_price: float,
    invest_usd: float,
    extra_margin_usd: float = 0.0,
    entry_price_override: float | None = None,
    mmr_pct_override: float | None = None,
    liq_distance_min_pct_override: float | None = None,
) -> Dict[str, Any]:
    mmr_pct = (
        mmr_pct_override
        if mmr_pct_override is not None
        else _env_float("GRID_LIQ_MMR_DEFAULT_PCT", 0.75, 0.01, 20.0)
    )
    liq_distance_min_pct = (
        liq_distance_min_pct_override
        if liq_distance_min_pct_override is not None
        else _env_float("GRID_LIQ_DISTANCE_MIN_PCT", 8.0, 0.0, 100.0)
    )
    entry_price = entry_price_override if entry_price_override and entry_price_override > 0 else mark_price
    collateral = invest_usd + (extra_margin_usd or 0.0)
    slots = effective_grid_slots(mode, grid_count)
    slots_long, slots_short = _side_slots(mode, grid_count)
    qty_long = per_grid_qty_long if per_grid_qty_long is not None else per_grid_qty
    qty_short = per_grid_qty_short if per_grid_qty_short is not None else per_grid_qty
    base_qty = per_grid_qty * slots

    long_qty = 0.0
    short_qty = 0.0
    if mode == "long":
        long_qty = qty_long * max(1, slots_long)
    elif mode == "short":
        short_qty = qty_short * max(1, slots_short)
    elif mode in ("neutral", "cross"):
        long_qty = qty_long * max(1, slots_long)
        short_qty = qty_short * max(1, slots_short)

    liq_long, dist_long = estimate_liq_with_mmr("long", entry_price, mark_price, long_qty, collateral, mmr_pct)
    liq_short, dist_short = estimate_liq_with_mmr("short", entry_price, mark_price, short_qty, collateral, mmr_pct)

    candidates = [dist for dist in [dist_long, dist_short] if dist is not None]
    worst_distance = min(candidates) if candidates else None
    worst_liq = None
    if worst_distance is not None:
        if dist_long is not None and abs(dist_long - worst_distance) < 1e-9:
            worst_liq = liq_long
        elif dist_short is not None and abs(dist_short - worst_distance) < 1e-9:
            worst_liq = liq_short

    entry_blocked_by_liq = worst_distance is not None and worst_distance < liq_distance_min_pct
    entry_blocked_by_min_investment = invest_usd < min_investment_usdt

    return {
        "mmrPctUsed": round6(mmr_pct),
        "liqEstimateLong": liq_long,
        "liqEstimateShort": liq_short,
        "worstCaseLiqPrice": worst_liq,
        "worstCaseLiqDistancePct": round6(worst_distance) if worst_distance is not None else None,
        "entryBlockedByLiq": entry_blocked_by_liq,
        "entryBlockedByMinInvestment": entry_blocked_by_min_investment,
        "minInvestmentUSDT": round6(min_investment_usdt),
        "liqDistanceMinPct": round6(liq_distance_min_pct),
    }


def preview(payload: GridPreviewRequest) -> GridPreviewResponse:
    levels = grid_levels(payload.lowerPrice, payload.upperPrice, payload.gridCount, payload.gridMode)
    reference_price = _reference_price(payload.markPrice, levels)
    min_qty, qty_step, min_notional, fee_rate_pct, fallback_used = _resolve_venue_inputs(payload, reference_price)
    seed_pct = max(0.0, min(60.0, float(payload.initialSeedPct or 0.0)))
    seed_ratio = (seed_pct / 100.0) if payload.initialSeedEnabled and seed_pct > 0 else 0.0
    effective_grid_invest_usd = max(0.0, float(payload.investUsd) * (1.0 - seed_ratio))
    _, per_grid_qty_raw = _per_grid_values(
        effective_grid_invest_usd, payload.leverage, payload.gridCount, reference_price
    )

    validation_errors: List[str] = []
    allocation_mode = payload.allocationMode
    if allocation_mode == "WEIGHTED_NEAR_PRICE":
        validation_errors.append("allocation_mode_not_implemented")
        allocation_mode = "EQUAL_NOTIONAL_PER_GRID"
    split_policy = payload.budgetSplitPolicy
    if split_policy == "DYNAMIC_BY_PRICE_POSITION":
        validation_errors.append("budget_split_policy_not_implemented")
        split_policy = "FIXED_50_50"

    slots_long, slots_short = _side_slots(payload.mode, payload.gridCount)
    long_budget_pct, short_budget_pct = _side_budget_split(
        payload.mode, split_policy, payload.longBudgetPct, payload.shortBudgetPct
    )
    if payload.mode == "cross" and split_policy == "FIXED_CUSTOM" and abs((long_budget_pct + short_budget_pct) - 100.0) > 1e-6:
        validation_errors.append("custom_budget_split_must_sum_to_100")
        long_budget_pct, short_budget_pct = 50.0, 50.0
    if payload.mode != "cross" and (
        split_policy != "FIXED_50_50" or abs(payload.longBudgetPct - 50.0) > 1e-6 or abs(payload.shortBudgetPct - 50.0) > 1e-6
    ):
        validation_errors.append("split_ignored_for_mode")

    total_notional = effective_grid_invest_usd * payload.leverage
    if payload.mode == "neutral":
        # Neutral runs one-way: the currently active side can use full budget.
        budget_notional_long = total_notional if slots_long > 0 else 0.0
        budget_notional_short = total_notional if slots_short > 0 else 0.0
    else:
        budget_notional_long = total_notional * (long_budget_pct / 100.0)
        budget_notional_short = total_notional * (short_budget_pct / 100.0)

    if allocation_mode == "EQUAL_BASE_QTY_PER_GRID":
        qty_long_raw = (
            budget_notional_long / max(1, slots_long) / max(reference_price, 1e-9)
            if slots_long > 0
            else 0.0
        )
        qty_short_raw = (
            budget_notional_short / max(1, slots_short) / max(reference_price, 1e-9)
            if slots_short > 0
            else 0.0
        )
    else:
        side_notional_long = budget_notional_long / max(1, slots_long) if slots_long > 0 else 0.0
        side_notional_short = budget_notional_short / max(1, slots_short) if slots_short > 0 else 0.0
        qty_long_raw = side_notional_long / max(reference_price, 1e-9) if slots_long > 0 else 0.0
        qty_short_raw = side_notional_short / max(reference_price, 1e-9) if slots_short > 0 else 0.0

    qty_long, checks_long = compute_qty_for_constraints(qty_long_raw, min_qty, qty_step, min_notional, reference_price)
    qty_short, checks_short = compute_qty_for_constraints(qty_short_raw, min_qty, qty_step, min_notional, reference_price)
    per_grid_qty = max(per_grid_qty_raw, qty_long, qty_short)
    per_grid_notional = round6(per_grid_qty * reference_price)
    side_notional_per_order_long = round6((qty_long * reference_price) if slots_long > 0 else 0.0)
    side_notional_per_order_short = round6((qty_short * reference_price) if slots_short > 0 else 0.0)

    net_pct, net_fraction = _profit_per_grid(levels, reference_price, fee_rate_pct)
    slots = max(0, slots_long) + max(0, slots_short)
    fee_buffer_pct = payload.feeBufferPct if payload.feeBufferPct is not None else _env_float(
        "GRID_MIN_INVEST_FEE_BUFFER_PCT", 1.0, 0.0, 25.0
    )
    raw_min_notional = (
        float(payload.venueConstraints.minNotional)
        if payload.venueConstraints and payload.venueConstraints.minNotional and payload.venueConstraints.minNotional > 0
        else _env_float("GRID_MIN_NOTIONAL_FALLBACK_USDT", 5.0, 0.0, None)
    )
    worst_price = min(payload.lowerPrice, payload.upperPrice, reference_price)
    worst_side_min_notional, _ = min_notional_from_constraints(raw_min_notional, min_qty, worst_price)
    min_notional_adjusted = max(min_notional, worst_side_min_notional or min_notional) * (1.0 + fee_buffer_pct / 100.0)

    if payload.mode == "neutral":
        long_ratio = 1.0 if slots_long > 0 else 0.0
        short_ratio = 1.0 if slots_short > 0 else 0.0
    else:
        long_ratio = long_budget_pct / 100.0
        short_ratio = short_budget_pct / 100.0
    min_invest_long = (
        (min_notional_adjusted * max(0, slots_long)) / max(payload.leverage, 1e-9) / max(long_ratio, 1e-9)
        if slots_long > 0 and long_ratio > 0
        else 0.0
    )
    min_invest_short = (
        (min_notional_adjusted * max(0, slots_short)) / max(payload.leverage, 1e-9) / max(short_ratio, 1e-9)
        if slots_short > 0 and short_ratio > 0
        else 0.0
    )
    if payload.mode == "long":
        grid_min_investment_usdt = min_invest_long
    elif payload.mode == "short":
        grid_min_investment_usdt = min_invest_short
    elif payload.mode == "neutral":
        grid_min_investment_usdt = max(min_invest_long, min_invest_short)
    else:
        grid_min_investment_usdt = min_invest_long + min_invest_short

    initial_seed = _initial_seed_snapshot(
        payload=payload,
        mark_price=reference_price,
        min_qty=min_qty,
        qty_step=qty_step,
        min_notional=min_notional_adjusted,
    )
    seed_min_margin_usd = float(initial_seed.get("seedMinMarginUsd", 0.0) or 0.0)
    min_invest_for_grid_fraction = (
        grid_min_investment_usdt / max(1e-9, (1.0 - seed_ratio))
        if seed_ratio > 0 and seed_ratio < 1
        else grid_min_investment_usdt
    )
    min_invest_for_seed_fraction = (
        seed_min_margin_usd / max(1e-9, seed_ratio)
        if seed_ratio > 0
        else 0.0
    )
    min_investment_usdt = max(min_invest_for_grid_fraction, min_invest_for_seed_fraction)

    risk = _build_risk_snapshot(
        mode=payload.mode,
        grid_count=payload.gridCount,
        per_grid_qty=per_grid_qty,
        per_grid_qty_long=qty_long,
        per_grid_qty_short=qty_short,
        min_investment_usdt=min_investment_usdt,
        mark_price=reference_price,
        invest_usd=payload.investUsd,
        extra_margin_usd=payload.extraMarginUsd or 0.0,
        mmr_pct_override=payload.mmrPct,
    )

    warnings: List[str] = []
    if payload.markPrice is not None and (payload.markPrice < payload.lowerPrice or payload.markPrice > payload.upperPrice):
        warnings.append("mark_outside_grid_range")
    if net_pct <= 0:
        warnings.append("net_grid_profit_non_positive")
    if fallback_used or min_qty is None or qty_step is None:
        warnings.append("constraints_missing_or_fallback_used")
    if payload.investUsd < min_investment_usdt:
        warnings.append("min_investment_above_current_invest")
    if risk.get("entryBlockedByLiq"):
        warnings.append("liq_distance_below_threshold")
    if payload.mode == "neutral":
        warnings.append("neutral_full_budget_mode")
    if initial_seed.get("enabled"):
        if float(initial_seed.get("seedNotionalUsd", 0.0) or 0.0) + 1e-9 < min_notional_adjusted:
            warnings.append("seed_below_venue_min_notional")
        if effective_grid_invest_usd <= 0:
            warnings.append("seed_consumes_all_grid_invest")

    checks = {
        "minQtyHit": checks_long["minQtyHit"] or checks_short["minQtyHit"],
        "minNotionalHit": checks_long["minNotionalHit"] or checks_short["minNotionalHit"],
        "roundedByStep": checks_long["roundedByStep"] or checks_short["roundedByStep"],
    }
    preview_center_idx = _nearest_center_index(levels, reference_price)
    preview_window_size = max(1, min(int(payload.activeOrderWindowSize), 120))
    preview_buy_target, preview_sell_target = _window_targets(payload.mode, preview_window_size, None)
    preview_buy_indexes, preview_sell_indexes, _, _ = _resolve_window_indexes(
        center_idx=preview_center_idx,
        level_count=len(levels),
        target_buys=preview_buy_target,
        target_sells=preview_sell_target,
        window_size=preview_window_size,
    )
    preview_active_indexes = preview_buy_indexes + preview_sell_indexes
    preview_buy_prices = [levels[idx] for idx in preview_buy_indexes if 0 <= idx < len(levels)]
    preview_sell_prices = [levels[idx] for idx in preview_sell_indexes if 0 <= idx < len(levels)]
    preview_active_prices = [levels[idx] for idx in preview_active_indexes if 0 <= idx < len(levels)]

    return GridPreviewResponse(
        levels=[GridLevel(index=idx, price=price) for idx, price in enumerate(levels)],
        perGridQty=per_grid_qty,
        perGridNotional=per_grid_notional,
        profitPerGridNetPct=net_pct,
        profitPerGridNetUsd=round6(per_grid_notional * net_fraction),
        profitPerGridEstimateUSDT=round6(per_grid_notional * net_fraction),
        liqEstimate=estimate_liq_price(payload.mode, reference_price, payload.leverage, payload.slippagePct),
        liqEstimateLong=risk.get("liqEstimateLong"),
        liqEstimateShort=risk.get("liqEstimateShort"),
        worstCaseLiqPrice=risk.get("worstCaseLiqPrice"),
        worstCaseLiqDistancePct=risk.get("worstCaseLiqDistancePct"),
        liqDistanceMinPct=risk.get("liqDistanceMinPct"),
        entryBlockedByLiq=bool(risk.get("entryBlockedByLiq")),
        minInvestmentUSDT=round6(min_investment_usdt),
        minInvestmentBreakdown={
            "long": round6(min_invest_long),
            "short": round6(min_invest_short),
            "seed": round6(min_invest_for_seed_fraction),
            "total": round6(min_investment_usdt),
        },
        initialSeed=initial_seed,
        effectiveGridSlots=slots,
        allocationBreakdown={
            "mode": "NEUTRAL_FULL_BUDGET_ONE_WAY" if payload.mode == "neutral" else allocation_mode,
            "slotsLong": slots_long,
            "slotsShort": slots_short,
            "longBudgetPct": round6(long_budget_pct) if payload.mode == "cross" else None,
            "shortBudgetPct": round6(short_budget_pct) if payload.mode == "cross" else None,
            "sideNotionalPerOrderLong": side_notional_per_order_long,
            "sideNotionalPerOrderShort": side_notional_per_order_short,
            "qtyPerOrderLong": qty_long,
            "qtyPerOrderShort": qty_short,
            "effectiveGridInvestUsd": round6(effective_grid_invest_usd),
        },
        qtyModel={
            "mode": allocation_mode,
            "qtyPerOrder": round6(per_grid_qty) if allocation_mode == "EQUAL_NOTIONAL_PER_GRID" else None,
            "qtyBase": round6(per_grid_qty) if allocation_mode == "EQUAL_BASE_QTY_PER_GRID" else None,
        },
        qtyPerOrderRounded=per_grid_qty,
        venueChecks={
            "minQtyHit": checks["minQtyHit"],
            "minNotionalHit": checks["minNotionalHit"],
            "roundedByStep": checks["roundedByStep"],
            "fallbackUsed": fallback_used,
            "minQtyUsed": round6(min_qty) if min_qty is not None else None,
            "minNotionalUsed": round6(min_notional) if min_notional is not None else None,
        },
        windowMeta={
            "activeOrdersTotal": len(preview_buy_indexes) + len(preview_sell_indexes),
            "activeBuys": len(preview_buy_indexes),
            "activeSells": len(preview_sell_indexes),
            "windowLowerIdx": min(preview_active_indexes) if preview_active_indexes else preview_center_idx,
            "windowUpperIdx": max(preview_active_indexes) if preview_active_indexes else preview_center_idx,
            "windowCenterIdx": preview_center_idx,
            "activeOrderWindowSize": preview_window_size,
            "recenterReason": "seed",
            "activeBuyLowerPrice": round6(min(preview_buy_prices)) if preview_buy_prices else None,
            "activeBuyUpperPrice": round6(max(preview_buy_prices)) if preview_buy_prices else None,
            "activeSellLowerPrice": round6(min(preview_sell_prices)) if preview_sell_prices else None,
            "activeSellUpperPrice": round6(max(preview_sell_prices)) if preview_sell_prices else None,
            "activeRangeLowPrice": round6(min(preview_active_prices)) if preview_active_prices else None,
            "activeRangeHighPrice": round6(max(preview_active_prices)) if preview_active_prices else None,
            "currentMarkPrice": round6(reference_price),
            "positionSide": None,
            "positionQty": 0.0,
        },
        warnings=warnings,
        validationErrors=validation_errors,
    )


def _nearest_center_index(levels: List[float], mark_price: float) -> int:
    lower_idx, upper_idx = nearest_level_indexes(levels, mark_price)
    lower_price = levels[max(0, min(len(levels) - 1, lower_idx))]
    upper_price = levels[max(0, min(len(levels) - 1, upper_idx))]
    if abs(mark_price - lower_price) <= abs(upper_price - mark_price):
        return max(0, min(len(levels) - 1, lower_idx))
    return max(0, min(len(levels) - 1, upper_idx))


def _window_targets(mode: str, window_size: int, position_side: str | None) -> Tuple[int, int]:
    half_up = (window_size + 1) // 2
    half_down = window_size // 2
    if mode == "long":
        return half_up, half_down
    if mode == "short":
        return half_down, half_up
    if mode == "neutral":
        if position_side == "long":
            return half_up, half_down
        if position_side == "short":
            return half_down, half_up
        return half_up, half_down
    # cross
    return half_up, half_down


def _resolve_window_indexes(
    center_idx: int,
    level_count: int,
    target_buys: int,
    target_sells: int,
    window_size: int,
) -> Tuple[List[int], List[int], int, int]:
    lower_indexes = list(range(center_idx - 1, -1, -1))
    upper_indexes = list(range(center_idx + 1, level_count))
    buys = min(target_buys, len(lower_indexes))
    sells = min(target_sells, len(upper_indexes))
    allocated = buys + sells
    remaining = max(0, window_size - allocated)
    while remaining > 0:
        lower_spare = len(lower_indexes) - buys
        upper_spare = len(upper_indexes) - sells
        if lower_spare <= 0 and upper_spare <= 0:
            break
        if lower_spare >= upper_spare and lower_spare > 0:
            buys += 1
        elif upper_spare > 0:
            sells += 1
        remaining -= 1
    return lower_indexes[:buys], upper_indexes[:sells], buys, sells


def _desired_orders(
    payload: GridPlanRequest,
    levels: List[float],
    per_grid_qty_long: float,
    per_grid_qty_short: float,
    center_idx: int,
) -> Tuple[List[GridIntent], Dict[str, Any]]:
    desired: List[GridIntent] = []

    position_side = None
    position_qty = 0.0
    if payload.position and payload.position.side in ("long", "short"):
        try:
            position_qty = float(payload.position.qty or 0.0)
        except Exception:
            position_qty = 0.0
        if position_qty > 0:
            position_side = payload.position.side

    window_size = max(1, min(int(payload.activeOrderWindowSize), 120))
    target_buys, target_sells = _window_targets(payload.mode, window_size, position_side)
    buy_indexes, sell_indexes, active_buys, active_sells = _resolve_window_indexes(
        center_idx=center_idx,
        level_count=len(levels),
        target_buys=target_buys,
        target_sells=target_sells,
        window_size=window_size,
    )

    def add_intent(side: str, idx: int, leg: str, qty: float, reduce_only: bool = False):
        if idx < 0 or idx >= len(levels):
            return
        desired.append(
            GridIntent(
                type="place_order",
                side=side,
                price=round6(levels[idx]),
                qty=round6(max(0.0, qty)),
                reduceOnly=reduce_only,
                clientOrderId=f"grid-{payload.instanceId}-{leg}-{idx}",
                gridLeg=leg,
                gridIndex=idx,
            )
        )

    for idx in buy_indexes:
        if payload.mode == "short":
            add_intent("buy", idx, "short", per_grid_qty_short, True)
        elif payload.mode == "neutral":
            reduce_only = position_side == "short"
            add_intent("buy", idx, "long", per_grid_qty_long, reduce_only)
        else:
            # long/cross
            add_intent("buy", idx, "long", per_grid_qty_long, False)

    for idx in sell_indexes:
        if payload.mode == "long":
            add_intent("sell", idx, "long", per_grid_qty_long, True)
        elif payload.mode == "neutral":
            reduce_only = position_side == "long"
            add_intent("sell", idx, "short", per_grid_qty_short, reduce_only)
        else:
            # short/cross
            add_intent("sell", idx, "short", per_grid_qty_short, False)

    active_indexes = buy_indexes + sell_indexes
    buy_prices = [levels[idx] for idx in buy_indexes if 0 <= idx < len(levels)]
    sell_prices = [levels[idx] for idx in sell_indexes if 0 <= idx < len(levels)]
    active_prices = [levels[idx] for idx in active_indexes if 0 <= idx < len(levels)]
    window_meta = {
        "activeOrdersTotal": len(desired),
        "activeBuys": active_buys,
        "activeSells": active_sells,
        "windowLowerIdx": min(active_indexes) if active_indexes else center_idx,
        "windowUpperIdx": max(active_indexes) if active_indexes else center_idx,
        "windowCenterIdx": center_idx,
        "activeOrderWindowSize": window_size,
        "activeBuyLowerPrice": round6(min(buy_prices)) if buy_prices else None,
        "activeBuyUpperPrice": round6(max(buy_prices)) if buy_prices else None,
        "activeSellLowerPrice": round6(min(sell_prices)) if sell_prices else None,
        "activeSellUpperPrice": round6(max(sell_prices)) if sell_prices else None,
        "activeRangeLowPrice": round6(min(active_prices)) if active_prices else None,
        "activeRangeHighPrice": round6(max(active_prices)) if active_prices else None,
        "positionSide": position_side,
        "positionQty": round6(position_qty) if position_qty > 0 else 0.0,
    }
    return desired, window_meta


def _normalize_open_order_price(value: Any) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    if parsed <= 0:
        return None
    return round6(parsed)


def plan(payload: GridPlanRequest) -> GridPlanResponse:
    preview_result = preview(
        GridPreviewRequest(
            mode=payload.mode,
            gridMode=payload.gridMode,
            allocationMode=payload.allocationMode,
            budgetSplitPolicy=payload.budgetSplitPolicy,
            longBudgetPct=payload.longBudgetPct,
            shortBudgetPct=payload.shortBudgetPct,
            lowerPrice=payload.lowerPrice,
            upperPrice=payload.upperPrice,
            gridCount=payload.gridCount,
            activeOrderWindowSize=payload.activeOrderWindowSize,
            recenterDriftLevels=payload.recenterDriftLevels,
            investUsd=payload.investUsd,
            leverage=payload.leverage,
            markPrice=payload.markPrice,
            slippagePct=payload.slippagePct,
            tpPct=payload.tpPct,
            slPct=payload.slPct,
            triggerPrice=payload.triggerPrice,
            trailingEnabled=payload.trailingEnabled,
            feeModel=payload.feeModel,
            venueConstraints=payload.venueConstraints,
            feeBufferPct=payload.feeBufferPct,
            mmrPct=payload.mmrPct,
            extraMarginUsd=payload.extraMarginUsd,
            initialSeedEnabled=payload.initialSeedEnabled,
            initialSeedPct=payload.initialSeedPct,
        )
    )

    levels = [row.price for row in preview_result.levels]
    reason_codes: List[str] = []
    intents: List[GridIntent] = []
    allocation_breakdown = preview_result.allocationBreakdown if isinstance(preview_result.allocationBreakdown, dict) else {}
    qty_long = float(allocation_breakdown.get("qtyPerOrderLong", preview_result.qtyPerOrderRounded) or 0.0)
    qty_short = float(allocation_breakdown.get("qtyPerOrderShort", preview_result.qtyPerOrderRounded) or 0.0)
    risk = _build_risk_snapshot(
        mode=payload.mode,
        grid_count=payload.gridCount,
        per_grid_qty=preview_result.qtyPerOrderRounded,
        per_grid_qty_long=qty_long,
        per_grid_qty_short=qty_short,
        min_investment_usdt=preview_result.minInvestmentUSDT,
        mark_price=payload.markPrice,
        invest_usd=payload.investUsd,
        extra_margin_usd=payload.extraMarginUsd or 0.0,
        entry_price_override=payload.position.entryPrice if payload.position else None,
        mmr_pct_override=payload.mmrPct,
        liq_distance_min_pct_override=payload.liqDistanceMinPct,
    )

    if risk.get("entryBlockedByLiq"):
        reason_codes.append("liq_distance_below_threshold")
    if risk.get("entryBlockedByMinInvestment"):
        reason_codes.append("min_investment_above_current_invest")

    state_json_in = payload.stateJson if isinstance(payload.stateJson, dict) else {}
    prior_center_idx = None
    try:
        parsed_center = int(state_json_in.get("windowCenterIndex"))  # type: ignore[arg-type]
        if 0 <= parsed_center < len(levels):
            prior_center_idx = parsed_center
    except Exception:
        prior_center_idx = None
    nearest_center_idx = _nearest_center_index(levels, payload.markPrice)
    has_fill_events = len(payload.fillEvents or []) > 0
    drift_levels = abs(nearest_center_idx - prior_center_idx) if prior_center_idx is not None else None
    recenter_reason = "no_change"
    window_center_idx = nearest_center_idx
    if prior_center_idx is None:
        recenter_reason = "seed"
    elif has_fill_events:
        recenter_reason = "fill"
    elif drift_levels is not None and drift_levels > max(1, int(payload.recenterDriftLevels)):
        recenter_reason = "drift"
    else:
        window_center_idx = prior_center_idx

    window_recentered = recenter_reason in ("seed", "fill", "drift")
    if window_recentered:
        reason_codes.append(f"window_recentered:{recenter_reason}")
    else:
        reason_codes.append("window_no_change")

    desired_orders, window_meta = _desired_orders(payload, levels, qty_long, qty_short, window_center_idx)
    window_meta["recenterReason"] = recenter_reason
    window_meta["driftLevels"] = drift_levels

    if payload.triggerPrice is not None:
        if payload.mode in ("long", "neutral", "cross") and payload.markPrice < payload.triggerPrice:
            reason_codes.append("trigger_not_reached")
        elif payload.mode == "short" and payload.markPrice > payload.triggerPrice:
            reason_codes.append("trigger_not_reached")
        if "trigger_not_reached" in reason_codes:
            return GridPlanResponse(
                intents=[],
                nextStateJson={
                    "lastMarkPrice": round6(payload.markPrice),
                    "waitingForTrigger": True,
                    "windowCenterIndex": window_center_idx,
                    "lastWindowRecenterReason": recenter_reason,
                    "lastWindowDriftLevels": drift_levels,
                },
                metricsDelta={"tickSkipped": 1},
                windowMeta=window_meta,
                risk=risk,
                reasonCodes=reason_codes,
            )
    desired_by_client_id = {intent.clientOrderId: intent for intent in desired_orders if intent.clientOrderId}

    existing_client_ids = set()
    for open_order in payload.openOrders:
        client_id = (open_order.clientOrderId or "").strip()
        if not client_id:
            continue
        existing_client_ids.add(client_id)
        desired = desired_by_client_id.get(client_id)
        if desired is None:
            intents.append(
                GridIntent(
                    type="cancel_order",
                    clientOrderId=client_id,
                    exchangeOrderId=open_order.exchangeOrderId,
                )
            )
            continue
        existing_price = _normalize_open_order_price(open_order.price)
        desired_price = round6(float(desired.price or 0)) if desired.price else None
        if desired_price is not None and existing_price is not None and abs(existing_price - desired_price) > 1e-6:
            intents.append(
                GridIntent(
                    type="replace_order",
                    clientOrderId=client_id,
                    exchangeOrderId=open_order.exchangeOrderId,
                    side=desired.side,
                    price=desired.price,
                    qty=desired.qty,
                    reduceOnly=desired.reduceOnly,
                    gridLeg=desired.gridLeg,
                    gridIndex=desired.gridIndex,
                )
            )

    for client_id, desired in desired_by_client_id.items():
        if client_id not in existing_client_ids:
            intents.append(desired)

    if payload.tpPct is not None or payload.slPct is not None:
        tp_price = None
        sl_price = None
        if payload.tpPct is not None:
            if payload.mode == "short":
                tp_price = round6(payload.markPrice * (1.0 - payload.tpPct / 100.0))
            else:
                tp_price = round6(payload.markPrice * (1.0 + payload.tpPct / 100.0))
        if payload.slPct is not None:
            if payload.mode == "short":
                sl_price = round6(payload.markPrice * (1.0 + payload.slPct / 100.0))
            else:
                sl_price = round6(payload.markPrice * (1.0 - payload.slPct / 100.0))

        intents.append(
            GridIntent(
                type="set_protection",
                tpPrice=tp_price,
                slPrice=sl_price,
            )
        )

    if not intents:
        reason_codes.append("no_changes")
    else:
        reason_codes.append("plan_generated")

    next_state: Dict[str, Any] = {
        "lastMarkPrice": round6(payload.markPrice),
        "lastPlanIntents": len(intents),
        "mode": payload.mode,
        "gridMode": payload.gridMode,
        "gridCount": payload.gridCount,
        "windowCenterIndex": window_center_idx,
        "lastWindowRecenterReason": recenter_reason,
        "lastWindowDriftLevels": drift_levels,
        "lastWindowActiveSize": window_meta.get("activeOrdersTotal", 0),
    }

    metrics_delta = {
        "plannedOrders": len([row for row in intents if row.type == "place_order"]),
        "cancelledOrders": len([row for row in intents if row.type == "cancel_order"]),
        "replacedOrders": len([row for row in intents if row.type == "replace_order"]),
        "profitPerGridNetPct": preview_result.profitPerGridNetPct,
        "perGridNotional": preview_result.perGridNotional,
        "allocationMode": payload.allocationMode,
        "budgetSplitPolicy": payload.budgetSplitPolicy,
        "minInvestmentBreakdown": preview_result.minInvestmentBreakdown,
        "initialSeed": preview_result.initialSeed,
        "allocationBreakdown": preview_result.allocationBreakdown,
        "qtyModel": preview_result.qtyModel,
        "profitPerGridEstimateUSDT": preview_result.profitPerGridEstimateUSDT,
        "minInvestmentUSDT": preview_result.minInvestmentUSDT,
        "qtyPerOrderRounded": preview_result.qtyPerOrderRounded,
        "liqEstimateLong": risk.get("liqEstimateLong"),
        "liqEstimateShort": risk.get("liqEstimateShort"),
        "worstCaseLiqDistancePct": risk.get("worstCaseLiqDistancePct"),
        "windowMeta": window_meta,
    }

    return GridPlanResponse(
        intents=intents,
        nextStateJson=next_state,
        metricsDelta=metrics_delta,
        windowMeta=window_meta,
        risk=risk,
        reasonCodes=reason_codes,
    )
