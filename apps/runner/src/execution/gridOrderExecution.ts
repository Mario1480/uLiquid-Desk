import type { TradeIntent } from "@mm/futures-core";
import type {
  PlaceOrderResult,
  SupportedFuturesAdapter
} from "@mm/futures-exchange";
import { closePaperPositionForRunner, upsertBotOrderEntry } from "../db.js";
import {
  buildExecutionVenueMeta,
  createNormalizedCloseOutcome,
  type NormalizedCloseOutcome
} from "../runtime/executionEvents.js";
import type { GridPlannerIntent } from "../grid/pythonGridClient.js";
import { normalizeComparableSymbol } from "./futuresVenueRuntime.js";
import type { ExecutionResult } from "./types.js";

function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value ?? NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function isNoPositionToCloseError(error: unknown): boolean {
  return /no position to close/i.test(String(error ?? ""));
}

export function toOrderIntentFromPlanner(
  botSymbol: string,
  plannerIntent: GridPlannerIntent
): Extract<TradeIntent, { type: "open" }> | null {
  if (plannerIntent.type !== "place_order" && plannerIntent.type !== "replace_order") return null;
  const side = plannerIntent.side === "sell" ? "short" : "long";
  const qty = Number(plannerIntent.qty ?? NaN);
  const price = Number(plannerIntent.price ?? NaN);
  const orderType: "market" | "limit" = Number.isFinite(price) && price > 0 ? "limit" : "market";

  return {
    type: "open",
    symbol: botSymbol,
    side,
    order: {
      type: orderType,
      qty: Number.isFinite(qty) && qty > 0 ? qty : undefined,
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      reduceOnly: plannerIntent.reduceOnly === true
    }
  };
}

export async function executeMappedIntentViaAdapter(params: {
  adapter: SupportedFuturesAdapter;
  botSymbol: string;
  intent: Extract<TradeIntent, { type: "open" }>;
  clientOrderId?: string | null;
  marginMode?: "cross" | "isolated";
}): Promise<PlaceOrderResult> {
  const order = params.intent.order ?? {};
  const qty = Number(order.qty ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("grid_adapter_fallback_invalid_qty");
  }

  const adapterAny = params.adapter as any;
  const canonicalSymbol = typeof adapterAny.toCanonicalSymbol === "function"
    ? (adapterAny.toCanonicalSymbol(params.botSymbol) ?? params.botSymbol)
    : params.botSymbol;
  const orderType: "market" | "limit" = order.type === "limit" ? "limit" : "market";
  const price = Number(order.price ?? NaN);
  const takeProfitPrice = toPositiveNumberOrNull(order.takeProfitPrice);
  const stopLossPrice = toPositiveNumberOrNull(order.stopLossPrice);

  return params.adapter.placeOrder({
    symbol: canonicalSymbol,
    side: params.intent.side === "long" ? "buy" : "sell",
    type: orderType,
    qty,
    clientOrderId: String(params.clientOrderId ?? "").trim() || undefined,
    price: orderType === "limit" && Number.isFinite(price) && price > 0 ? price : undefined,
    reduceOnly: order.reduceOnly === true,
    marginMode: params.marginMode ?? "cross",
    takeProfitPrice: takeProfitPrice ?? undefined,
    stopLossPrice: stopLossPrice ?? undefined
  });
}

export async function writeBotOrderDualWrite(params: {
  botVaultId?: string | null;
  exchange: string;
  symbol: string;
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  price?: number | null;
  qty?: number | null;
  reduceOnly?: boolean;
  status?: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  if (!params.botVaultId) return;
  const qty = Number(params.qty ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0) return;
  await upsertBotOrderEntry({
    botVaultId: params.botVaultId,
    exchange: params.exchange,
    symbol: params.symbol,
    side: params.side === "sell" ? "SELL" : "BUY",
    orderType: params.orderType === "market" ? "MARKET" : "LIMIT",
    status: params.status ?? "OPEN",
    clientOrderId: params.clientOrderId,
    exchangeOrderId: params.exchangeOrderId,
    price: params.price ?? null,
    qty,
    reduceOnly: params.reduceOnly === true,
    metadata: params.metadata ?? null
  });
}

export function summarizeGridDelegatedResults(delegatedResults: ExecutionResult[]): {
  executedResults: ExecutionResult[];
  blockedResults: ExecutionResult[];
  protectionBlockedResults: ExecutionResult[];
  blockingResult: ExecutionResult | null;
} {
  const executedResults = delegatedResults.filter((entry) => entry.status === "executed");
  const blockedResults = delegatedResults.filter((entry) => entry.status === "blocked");
  const protectionBlockedResults = blockedResults.filter((entry) => entry.reason.startsWith("grid_set_protection_"));
  const nonProtectionBlocked = blockedResults.find((entry) => !entry.reason.startsWith("grid_set_protection_")) ?? null;
  const blockingResult =
    nonProtectionBlocked
    ?? (executedResults.length === 0 ? (blockedResults[0] ?? null) : null);
  return {
    executedResults,
    blockedResults,
    protectionBlockedResults,
    blockingResult
  };
}

export async function cancelGridOpenOrdersBestEffort(params: {
  adapter: SupportedFuturesAdapter | null;
  openOrders: Array<{ exchangeOrderId?: string | null; clientOrderId?: string | null }>;
  botSymbol: string;
}): Promise<{ canceled: number; failed: number }> {
  if (!params.adapter) return { canceled: 0, failed: 0 };
  let canceled = 0;
  let failed = 0;
  for (const row of params.openOrders) {
    const exchangeOrderId = String(row.exchangeOrderId ?? "").trim();
    if (!exchangeOrderId) continue;
    try {
      const adapterAny = params.adapter as any;
      if (typeof adapterAny.cancelOrderByParams === "function") {
        await adapterAny.cancelOrderByParams({
          orderId: exchangeOrderId,
          symbol: params.botSymbol
        });
      } else {
        await params.adapter.cancelOrder(exchangeOrderId);
      }
      canceled += 1;
    } catch {
      failed += 1;
    }
  }
  return { canceled, failed };
}

export async function closeGridResidualPositionBestEffort(params: {
  executionExchange: string;
  adapter: SupportedFuturesAdapter | null;
  exchangeAccountId: string;
  botSymbol: string;
  markPrice: number;
  paperMarketDataVenue?: string | null;
}): Promise<NormalizedCloseOutcome> {
  if (params.executionExchange === "paper") {
    try {
      const closed = await closePaperPositionForRunner({
        exchangeAccountId: params.exchangeAccountId,
        symbol: params.botSymbol,
        fillPrice: params.markPrice
      });
      return createNormalizedCloseOutcome({
        closed: Boolean(closed?.orderId) && Number(closed?.closedQty ?? 0) > 0,
        reason: null,
        source: "paper",
        orderId: closed?.orderId ?? null,
        closedQty: Number.isFinite(Number(closed?.closedQty)) ? Number(closed?.closedQty) : null,
        metadata: buildExecutionVenueMeta({
          executionVenue: "paper",
          marketDataVenue: params.paperMarketDataVenue ?? null
        })
      });
    } catch (error) {
      return createNormalizedCloseOutcome({
        closed: false,
        reason: String(error),
        source: "paper",
        metadata: buildExecutionVenueMeta({
          executionVenue: "paper",
          marketDataVenue: params.paperMarketDataVenue ?? null
        })
      });
    }
  }
  if (!params.adapter) {
    return createNormalizedCloseOutcome({
      closed: false,
      reason: "adapter_unavailable",
      source: "venue",
      metadata: buildExecutionVenueMeta({
        executionVenue: params.executionExchange
      })
    });
  }
  try {
    const positions = await params.adapter.getPositions();
    const target = positions.find((row: any) => {
      const symbol = normalizeComparableSymbol(String(row?.symbol ?? ""));
      return symbol === normalizeComparableSymbol(params.botSymbol) && Number(row?.size ?? 0) > 0;
    });
    if (!target) {
      return createNormalizedCloseOutcome({
        closed: false,
        reason: null,
        source: "venue",
        metadata: buildExecutionVenueMeta({
          executionVenue: params.executionExchange
        })
      });
    }
    const qty = Number(target.size ?? NaN);
    if (!Number.isFinite(qty) || qty <= 0) {
      return createNormalizedCloseOutcome({
        closed: false,
        reason: "invalid_position_qty",
        source: "venue",
        metadata: buildExecutionVenueMeta({
          executionVenue: params.executionExchange
        })
      });
    }
    const sideRaw = String(target.side ?? "").trim().toLowerCase();
    const closeSide: "buy" | "sell" = sideRaw === "long" ? "sell" : "buy";
    await params.adapter.placeOrder({
      symbol: params.botSymbol,
      side: closeSide,
      type: "market",
      qty,
      reduceOnly: true,
      marginMode: "cross"
    });
    return createNormalizedCloseOutcome({
      closed: true,
      reason: null,
      source: "venue",
      closedQty: qty,
      metadata: buildExecutionVenueMeta({
        executionVenue: params.executionExchange
      })
    });
  } catch (error) {
    if (isNoPositionToCloseError(error)) {
      return createNormalizedCloseOutcome({
        closed: false,
        reason: null,
        source: "venue",
        metadata: buildExecutionVenueMeta({
          executionVenue: params.executionExchange
        })
      });
    }
    return createNormalizedCloseOutcome({
      closed: false,
      reason: String(error),
      source: "venue",
      metadata: buildExecutionVenueMeta({
        executionVenue: params.executionExchange
      })
    });
  }
}
