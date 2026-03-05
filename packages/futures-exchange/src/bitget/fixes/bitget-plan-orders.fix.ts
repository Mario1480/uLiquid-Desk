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

export async function upsertBitgetPositionTpSl(params: {
  tradeApi: BitgetTradeApi;
  symbol: string;
  productType: BitgetProductType;
  marginCoin: string;
  holdSide: "long" | "short";
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
}): Promise<{ ok: true }> {
  const pendingRaw = await params.tradeApi.getPendingPlanOrders({
    productType: params.productType,
    symbol: params.symbol,
    pageSize: 100
  });
  const pendingRows = toOrderRows(pendingRaw);
  const cancelKinds = new Set<"tp" | "sl">();
  if (params.takeProfitPrice !== undefined) cancelKinds.add("tp");
  if (params.stopLossPrice !== undefined) cancelKinds.add("sl");

  if (cancelKinds.size > 0) {
    await Promise.allSettled(
      pendingRows.map(async (row) => {
        const rowSide = String(row.holdSide ?? row.posSide ?? "").toLowerCase();
        if (rowSide && rowSide !== params.holdSide) return;
        const kind = toPlanKind(row.planType ?? row.stopType ?? row.triggerType);
        if (!kind || !cancelKinds.has(kind)) return;
        const orderId = String(row.orderId ?? row.planOrderId ?? "").trim();
        if (!orderId) return;
        await params.tradeApi.cancelPlanOrder({
          symbol: params.symbol,
          orderId,
          productType: params.productType
        });
      })
    );
  }

  if (params.takeProfitPrice !== undefined && params.takeProfitPrice !== null) {
    await params.tradeApi.placePositionTpSl({
      symbol: params.symbol,
      productType: params.productType,
      marginCoin: params.marginCoin,
      holdSide: params.holdSide,
      planType: "profit_plan",
      triggerPrice: String(params.takeProfitPrice)
    });
  }
  if (params.stopLossPrice !== undefined && params.stopLossPrice !== null) {
    await params.tradeApi.placePositionTpSl({
      symbol: params.symbol,
      productType: params.productType,
      marginCoin: params.marginCoin,
      holdSide: params.holdSide,
      planType: "loss_plan",
      triggerPrice: String(params.stopLossPrice)
    });
  }
  return { ok: true };
}

