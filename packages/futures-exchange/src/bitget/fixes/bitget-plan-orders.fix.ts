import type { BitgetProductType } from "../bitget.constants.js";
import type { BitgetTradeApi } from "../bitget.trade.api.js";

function toOrderRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record) return [];
  const candidates = [record.entrustedList, record.orderList, record.list, record.rows, record.data];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  return [];
}

function toPlanKind(value: unknown): "tp" | "sl" | null {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("profit")) return "tp";
  if (text.includes("loss")) return "sl";
  return null;
}

type BitgetPositionTpSlHoldSide = "long" | "short" | "buy" | "sell";
type BitgetCancelPlanType = "normal_plan" | "profit_plan" | "loss_plan" | "pos_profit" | "pos_loss" | "moving_plan";

function toComparableHoldSide(value: unknown): "long" | "short" | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "long" || text === "buy") return "long";
  if (text === "short" || text === "sell") return "short";
  return null;
}

function toCancelPlanType(row: Record<string, unknown>, kind: "tp" | "sl"): BitgetCancelPlanType {
  const planType = String(row.planType ?? "").trim().toLowerCase();
  if (
    planType === "normal_plan"
    || planType === "profit_plan"
    || planType === "loss_plan"
    || planType === "pos_profit"
    || planType === "pos_loss"
    || planType === "moving_plan"
  ) {
    return planType;
  }

  const orderSource = String(row.orderSource ?? "").trim().toLowerCase();
  if (orderSource.includes("pos_profit")) return "pos_profit";
  if (orderSource.includes("pos_loss")) return "pos_loss";
  if (orderSource.includes("profit")) return "profit_plan";
  if (orderSource.includes("loss")) return "loss_plan";

  return kind === "tp" ? "pos_profit" : "pos_loss";
}

export async function upsertBitgetPositionTpSl(params: {
  tradeApi: BitgetTradeApi;
  symbol: string;
  productType: BitgetProductType;
  marginCoin: string;
  positionSide: "long" | "short";
  holdSide: BitgetPositionTpSlHoldSide;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
}): Promise<{ ok: true }> {
  const pendingRaw = await params.tradeApi.getPendingPlanOrders({
    productType: params.productType,
    symbol: params.symbol,
    planType: "profit_loss",
    pageSize: 100
  });
  const pendingRows = toOrderRows(pendingRaw);
  const cancelKinds = new Set<"tp" | "sl">();
  if (params.takeProfitPrice !== undefined) cancelKinds.add("tp");
  if (params.stopLossPrice !== undefined) cancelKinds.add("sl");

  if (cancelKinds.size > 0) {
    await Promise.allSettled(
      pendingRows.map(async (row) => {
        const rowSide = toComparableHoldSide(row.holdSide ?? row.posSide ?? row.positionSide);
        if (rowSide && rowSide !== params.positionSide) return;
        const kind = toPlanKind(row.planType ?? row.stopType ?? row.triggerType);
        if (!kind || !cancelKinds.has(kind)) return;
        const orderId = String(row.orderId ?? row.planOrderId ?? "").trim();
        if (!orderId) return;
        await params.tradeApi.cancelPlanOrder({
          symbol: params.symbol,
          orderId,
          marginCoin: params.marginCoin,
          planType: toCancelPlanType(row, kind),
          productType: params.productType
        });
      })
    );
  }

  const payload = {
    symbol: params.symbol,
    productType: params.productType,
    marginCoin: params.marginCoin,
    holdSide: params.holdSide,
    stopSurplusTriggerPrice:
      params.takeProfitPrice !== undefined && params.takeProfitPrice !== null
        ? String(params.takeProfitPrice)
        : undefined,
    stopSurplusTriggerType:
      params.takeProfitPrice !== undefined && params.takeProfitPrice !== null
        ? "mark_price" as const
        : undefined,
    stopSurplusExecutePrice:
      params.takeProfitPrice !== undefined && params.takeProfitPrice !== null
        ? "0"
        : undefined,
    stopLossTriggerPrice:
      params.stopLossPrice !== undefined && params.stopLossPrice !== null
        ? String(params.stopLossPrice)
        : undefined,
    stopLossTriggerType:
      params.stopLossPrice !== undefined && params.stopLossPrice !== null
        ? "mark_price" as const
        : undefined,
    stopLossExecutePrice:
      params.stopLossPrice !== undefined && params.stopLossPrice !== null
        ? "0"
        : undefined
  };

  if (
    (params.takeProfitPrice !== undefined && params.takeProfitPrice !== null)
    || (params.stopLossPrice !== undefined && params.stopLossPrice !== null)
  ) {
    await params.tradeApi.placePositionTpSl(payload);
  }
  return { ok: true };
}
