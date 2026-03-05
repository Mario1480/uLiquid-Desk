import { BitgetInvalidParamsError } from "../bitget.errors.js";
import type { BitgetProductType } from "../bitget.constants.js";
import type { BitgetTradeApi } from "../bitget.trade.api.js";

type AdapterLike = {
  productType: BitgetProductType;
  toExchangeSymbol(symbol: string): Promise<string>;
  cancelOrder(orderId: string): Promise<void>;
  placeOrder(input: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    qty: number;
    price?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    reduceOnly?: boolean;
    marginMode?: "isolated" | "cross";
  }): Promise<{ orderId: string }>;
};

type EditOrderInput = {
  symbol: string;
  orderId: string;
  price?: number;
  qty?: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function getNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function toOrderRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  const record = toRecord(value);
  if (!record) return [];
  const candidates = [record.entrustedList, record.orderList, record.list, record.rows, record.data];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  return [];
}

function almostEqual(a: number, b: number): boolean {
  const tolerance = Math.max(1e-8, Math.abs(a) * 1e-8, Math.abs(b) * 1e-8);
  return Math.abs(a - b) <= tolerance;
}

function isNoChangeError(error: unknown): boolean {
  const text = String(error ?? "").toLowerCase();
  const code = String((error as { options?: { code?: unknown } })?.options?.code ?? "");
  return code === "40923" || text.includes("order size and price have not changed");
}

function needsNewClientOid(error: unknown): boolean {
  const text = String(error ?? "").toLowerCase();
  const code = String((error as { options?: { code?: unknown } })?.options?.code ?? "");
  return code === "45115" || text.includes("newclientoid") || text.includes("please pass in newclientoid");
}

function assertPositive(value: number | undefined, field: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new BitgetInvalidParamsError(`Invalid ${field}`, {
      endpoint: "/api/v2/mix/order/modify-order",
      method: "POST"
    });
  }
}

function assertNullablePositive(value: number | null | undefined, field: string): void {
  if (value === undefined || value === null) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new BitgetInvalidParamsError(`Invalid ${field}`, {
      endpoint: "/api/v2/mix/order/modify-order",
      method: "POST"
    });
  }
}

export async function editBitgetOpenOrder(params: {
  adapter: AdapterLike;
  tradeApi: BitgetTradeApi;
  input: EditOrderInput;
}): Promise<{ orderId: string }> {
  const symbol = String(params.input.symbol ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const orderId = String(params.input.orderId ?? "").trim();
  if (!symbol) {
    throw new BitgetInvalidParamsError("symbol_required", {
      endpoint: "/api/v2/mix/order/modify-order",
      method: "POST"
    });
  }
  if (!orderId) {
    throw new BitgetInvalidParamsError("order_id_required", {
      endpoint: "/api/v2/mix/order/modify-order",
      method: "POST"
    });
  }
  if (
    params.input.price === undefined &&
    params.input.qty === undefined &&
    params.input.takeProfitPrice === undefined &&
    params.input.stopLossPrice === undefined
  ) {
    throw new BitgetInvalidParamsError("no_edit_fields", {
      endpoint: "/api/v2/mix/order/modify-order",
      method: "POST"
    });
  }

  assertPositive(params.input.price, "price");
  assertPositive(params.input.qty, "qty");
  assertNullablePositive(params.input.takeProfitPrice, "takeProfitPrice");
  assertNullablePositive(params.input.stopLossPrice, "stopLossPrice");

  const exchangeSymbol = await params.adapter.toExchangeSymbol(symbol);
  let nextPrice = params.input.price;
  let nextQty = params.input.qty;
  let nextTakeProfit = params.input.takeProfitPrice;
  let nextStopLoss = params.input.stopLossPrice;
  const tpExplicit = params.input.takeProfitPrice !== undefined;
  const slExplicit = params.input.stopLossPrice !== undefined;

  let currentPrice: number | null = null;
  let currentQty: number | null = null;
  let currentTakeProfit: number | null = null;
  let currentStopLoss: number | null = null;
  let currentSide: "buy" | "sell" | null = null;
  let currentOrderType: "limit" | "market" | null = null;
  let currentReduceOnly = false;
  let currentMarginMode: "isolated" | "cross" = "cross";

  try {
    const detailRaw = await params.tradeApi.getOrderDetail({
      symbol: exchangeSymbol,
      orderId
    });
    const detail = toRecord(detailRaw);
    currentPrice = getNumber(detail, ["price", "orderPrice", "limitPrice"]);
    currentQty = getNumber(detail, ["size", "baseVolume", "qty", "vol"]);
    currentTakeProfit = getNumber(detail, [
      "presetStopSurplusPrice",
      "takeProfitPrice",
      "stopSurplusTriggerPrice",
      "stopSurplusExecutePrice"
    ]);
    currentStopLoss = getNumber(detail, [
      "presetStopLossPrice",
      "stopLossPrice",
      "stopLossTriggerPrice",
      "stopLossExecutePrice"
    ]);
    const sideRaw = getString(detail, ["side", "orderSide", "tradeSide"])?.toLowerCase() ?? "";
    if (sideRaw.includes("buy")) currentSide = "buy";
    if (sideRaw.includes("sell")) currentSide = "sell";
    const typeRaw = getString(detail, ["orderType", "type"])?.toLowerCase() ?? "";
    if (typeRaw === "limit" || typeRaw === "market") currentOrderType = typeRaw;
    const reduceOnlyRaw = String(detail?.reduceOnly ?? detail?.reduceOnlyFlag ?? "").toLowerCase();
    currentReduceOnly = reduceOnlyRaw === "yes" || reduceOnlyRaw === "true" || reduceOnlyRaw === "1";
    const marginModeRaw = getString(detail, ["marginMode", "marginType"])?.toLowerCase() ?? "";
    currentMarginMode = marginModeRaw.includes("isolated") ? "isolated" : "cross";

    if (nextPrice !== undefined && currentPrice !== null && almostEqual(nextPrice, currentPrice)) nextPrice = undefined;
    if (nextQty !== undefined && currentQty !== null && almostEqual(nextQty, currentQty)) nextQty = undefined;
  } catch {
    // Best effort; fallback to pending snapshot below.
  }

  try {
    const pendingRaw = await params.tradeApi.getPendingOrders({
      productType: params.adapter.productType,
      symbol: exchangeSymbol,
      pageSize: 100
    });
    const pending = toOrderRows(pendingRaw).find((row) => String(row.orderId ?? "").trim() === orderId) ?? null;
    if (pending) {
      if (currentPrice === null) currentPrice = getNumber(pending, ["price", "orderPrice", "limitPrice"]);
      if (currentQty === null) currentQty = getNumber(pending, ["size", "baseVolume", "qty", "vol"]);
      if (nextTakeProfit === undefined && currentTakeProfit === null) {
        currentTakeProfit = getNumber(pending, [
          "presetStopSurplusPrice",
          "takeProfitPrice",
          "stopSurplusTriggerPrice",
          "stopSurplusExecutePrice",
          "tp"
        ]);
      }
      if (nextStopLoss === undefined && currentStopLoss === null) {
        currentStopLoss = getNumber(pending, [
          "presetStopLossPrice",
          "stopLossPrice",
          "stopLossTriggerPrice",
          "stopLossExecutePrice",
          "sl"
        ]);
      }
      if (currentSide === null) {
        const rowSide = getString(pending, ["side", "orderSide", "tradeSide"])?.toLowerCase() ?? "";
        if (rowSide.includes("buy")) currentSide = "buy";
        if (rowSide.includes("sell")) currentSide = "sell";
      }
      if (currentOrderType === null) {
        const rowType = getString(pending, ["orderType", "type"])?.toLowerCase() ?? "";
        if (rowType === "limit" || rowType === "market") currentOrderType = rowType;
      }
      const rowReduceOnly = String(pending.reduceOnly ?? pending.reduceOnlyFlag ?? "").toLowerCase();
      if (rowReduceOnly) {
        currentReduceOnly = rowReduceOnly === "yes" || rowReduceOnly === "true" || rowReduceOnly === "1";
      }
      const rowMarginMode = getString(pending, ["marginMode", "marginType"])?.toLowerCase() ?? "";
      if (rowMarginMode) currentMarginMode = rowMarginMode.includes("isolated") ? "isolated" : "cross";
    }
  } catch {
    // keep detail snapshot values
  }

  const modifiesPriceOrSize = nextPrice !== undefined || nextQty !== undefined;
  const tpChanged = nextTakeProfit !== undefined && (
    (nextTakeProfit === null && currentTakeProfit !== null)
    || (nextTakeProfit !== null && (currentTakeProfit === null || !almostEqual(nextTakeProfit, currentTakeProfit)))
  );
  const slChanged = nextStopLoss !== undefined && (
    (nextStopLoss === null && currentStopLoss !== null)
    || (nextStopLoss !== null && (currentStopLoss === null || !almostEqual(nextStopLoss, currentStopLoss)))
  );

  if (!modifiesPriceOrSize && !tpChanged && !slChanged) {
    throw new BitgetInvalidParamsError("no_edit_fields", {
      endpoint: "/api/v2/mix/order/modify-order",
      method: "POST"
    });
  }

  if (modifiesPriceOrSize) {
    if (nextPrice === undefined) {
      if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
        throw new BitgetInvalidParamsError("invalid_price", {
          endpoint: "/api/v2/mix/order/modify-order",
          method: "POST"
        });
      }
      nextPrice = currentPrice;
    }
    if (nextQty === undefined) {
      if (currentQty === null || !Number.isFinite(currentQty) || currentQty <= 0) {
        throw new BitgetInvalidParamsError("invalid_qty", {
          endpoint: "/api/v2/mix/order/modify-order",
          method: "POST"
        });
      }
      nextQty = currentQty;
    }
    if (!tpExplicit && nextTakeProfit === undefined && currentTakeProfit !== null) nextTakeProfit = currentTakeProfit;
    if (!slExplicit && nextStopLoss === undefined && currentStopLoss !== null) nextStopLoss = currentStopLoss;
    if (currentSide === null || currentOrderType !== "limit") {
      throw new BitgetInvalidParamsError("order_replace_context_missing", {
        endpoint: "/api/v2/mix/order/modify-order",
        method: "POST"
      });
    }

    await params.adapter.cancelOrder(orderId);
    const replacement = await params.adapter.placeOrder({
      symbol,
      side: currentSide,
      type: currentOrderType,
      qty: nextQty,
      price: nextPrice,
      takeProfitPrice: nextTakeProfit === undefined || nextTakeProfit === null ? undefined : nextTakeProfit,
      stopLossPrice: nextStopLoss === undefined || nextStopLoss === null ? undefined : nextStopLoss,
      reduceOnly: currentReduceOnly,
      marginMode: currentMarginMode
    });
    return { orderId: replacement.orderId };
  }

  const buildModifyPayload = (newClientOid?: string) => ({
    symbol: exchangeSymbol,
    productType: params.adapter.productType,
    orderId,
    newClientOid,
    newSize: nextQty !== undefined ? String(nextQty) : undefined,
    newPrice: nextPrice !== undefined ? String(nextPrice) : undefined,
    newPresetStopSurplusPrice:
      nextTakeProfit === undefined ? undefined : nextTakeProfit === null ? "" : String(nextTakeProfit),
    newPresetStopLossPrice:
      nextStopLoss === undefined ? undefined : nextStopLoss === null ? "" : String(nextStopLoss)
  });

  try {
    await params.tradeApi.modifyOrder(buildModifyPayload());
    return { orderId };
  } catch (error) {
    if (needsNewClientOid(error)) {
      const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      await params.tradeApi.modifyOrder(buildModifyPayload(`edit_${suffix}`));
      return { orderId };
    }
    const onlyTpSlEdit =
      nextPrice === undefined
      && nextQty === undefined
      && (nextTakeProfit !== undefined || nextStopLoss !== undefined);
    if (!onlyTpSlEdit || !isNoChangeError(error)) {
      throw error;
    }
    if (currentSide === null || currentOrderType !== "limit" || currentQty === null || currentPrice === null) {
      throw error;
    }
    const replacementTakeProfit = nextTakeProfit === undefined ? currentTakeProfit : nextTakeProfit;
    const replacementStopLoss = nextStopLoss === undefined ? currentStopLoss : nextStopLoss;
    await params.adapter.cancelOrder(orderId);
    const replacement = await params.adapter.placeOrder({
      symbol,
      side: currentSide,
      type: currentOrderType,
      qty: currentQty,
      price: currentPrice,
      takeProfitPrice: replacementTakeProfit ?? undefined,
      stopLossPrice: replacementStopLoss ?? undefined,
      reduceOnly: currentReduceOnly,
      marginMode: currentMarginMode
    });
    return { orderId: replacement.orderId };
  }
}

