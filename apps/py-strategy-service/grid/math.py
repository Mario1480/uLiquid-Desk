from __future__ import annotations

import math
from typing import List


def round6(value: float) -> float:
    return round(float(value), 6)


def floor_to_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    return math.floor(value / step) * step


def ceil_to_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    return math.ceil(value / step) * step


def grid_levels(lower: float, upper: float, count: int, mode: str) -> List[float]:
    if count < 2:
        return [round6(lower), round6(upper)]
    if mode == "geometric":
        ratio = math.pow(upper / lower, 1.0 / count)
        return [round6(lower * math.pow(ratio, idx)) for idx in range(count + 1)]
    step = (upper - lower) / count
    return [round6(lower + step * idx) for idx in range(count + 1)]


def nearest_level_indexes(levels: List[float], price: float) -> tuple[int, int]:
    if not levels:
        return (0, 0)
    if price <= levels[0]:
        return (0, 1 if len(levels) > 1 else 0)
    if price >= levels[-1]:
        idx = len(levels) - 1
        return (idx - 1 if idx > 0 else idx, idx)
    lower_idx = 0
    upper_idx = len(levels) - 1
    for idx in range(len(levels) - 1):
        if levels[idx] <= price <= levels[idx + 1]:
            lower_idx = idx
            upper_idx = idx + 1
            break
    return (lower_idx, upper_idx)


def estimate_liq_price(mode: str, mark: float, leverage: float, slippage_pct: float) -> float | None:
    if leverage <= 0:
        return None
    buffer_pct = (100.0 / leverage) * 0.7
    if mode == "short":
        return round6(mark * (1 + (buffer_pct + slippage_pct) / 100.0))
    if mode == "long":
        return round6(mark * (1 - (buffer_pct + slippage_pct) / 100.0))
    if mode in ("neutral", "cross"):
        return round6(mark * (1 - (buffer_pct / 2.0) / 100.0))
    return None


def min_notional_from_constraints(
    min_notional: float | None,
    min_qty: float | None,
    mark_price: float | None,
) -> tuple[float | None, bool]:
    if mark_price is None or mark_price <= 0:
        return (min_notional if min_notional and min_notional > 0 else None, False)
    dynamic = None
    if min_qty is not None and min_qty > 0:
        dynamic = min_qty * mark_price
    if min_notional is None or min_notional <= 0:
        if dynamic is None:
            return (None, False)
        return (dynamic, True)
    if dynamic is None:
        return (min_notional, False)
    return (max(min_notional, dynamic), dynamic > min_notional)


def compute_qty_for_constraints(
    qty_raw: float,
    min_qty: float | None,
    qty_step: float | None,
    min_notional: float | None,
    mark_price: float | None,
) -> tuple[float, dict]:
    checks = {
        "minQtyHit": False,
        "minNotionalHit": False,
        "roundedByStep": False,
    }
    qty = max(float(qty_raw), 0.0)
    if min_qty is not None and min_qty > 0 and qty < min_qty:
        qty = min_qty
        checks["minQtyHit"] = True

    if qty_step is not None and qty_step > 0:
        rounded = ceil_to_step(qty, qty_step)
        if abs(rounded - qty) > 1e-12:
            checks["roundedByStep"] = True
        qty = rounded

    if (
        min_notional is not None
        and min_notional > 0
        and mark_price is not None
        and mark_price > 0
        and qty * mark_price < min_notional
    ):
        needed = min_notional / mark_price
        qty = max(qty, needed)
        checks["minNotionalHit"] = True
        if qty_step is not None and qty_step > 0:
            qty = ceil_to_step(qty, qty_step)
            checks["roundedByStep"] = True

    return (round6(qty), checks)


def effective_grid_slots(mode: str, grid_count: int) -> int:
    if mode in ("neutral", "cross"):
        return max(2, grid_count * 2)
    return max(1, grid_count)


def estimate_liq_with_mmr(
    side: str,
    entry_price: float | None,
    mark_price: float | None,
    qty: float | None,
    collateral: float | None,
    mmr_pct: float,
) -> tuple[float | None, float | None]:
    if (
        entry_price is None
        or entry_price <= 0
        or qty is None
        or qty <= 0
        or collateral is None
        or collateral <= 0
        or mark_price is None
        or mark_price <= 0
    ):
        return (None, None)

    position_notional = entry_price * qty
    maintenance = position_notional * (mmr_pct / 100.0)
    buffer = collateral - maintenance

    if side == "long":
        liq = entry_price - (buffer / qty)
    else:
        liq = entry_price + (buffer / qty)

    distance_pct = abs(mark_price - liq) / mark_price * 100.0
    return (round6(liq), round6(distance_pct))
