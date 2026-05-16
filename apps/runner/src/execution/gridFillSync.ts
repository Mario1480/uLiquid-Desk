import {
  buildOrderReferenceIdentity,
  collectCanonicalOrderReferenceKeys,
  collectOrderReferenceSet,
  type SupportedFuturesAdapter
} from "@mm/futures-exchange";
import {
  listPaperPositionsForRunner,
  loadBotTradeState,
  upsertBotTradeState
} from "../db.js";
import { normalizeComparableSymbol } from "./futuresVenueRuntime.js";

export type PlannerFillEventInput = {
  exchangeOrderId?: string | null;
  clientOrderId?: string | null;
  side?: "buy" | "sell" | null;
  fillPrice?: number | null;
  fillQty?: number | null;
  fillTs?: Date | string | null;
  gridIndex?: number | null;
};

export type PlannerPositionSnapshot = {
  side?: "long" | "short" | null;
  qty?: number | null;
  entryPrice?: number | null;
} | null;

export function resolvePlannerFillEventsForExecution(params: {
  currentStateJson: Record<string, unknown>;
  paperFillEvents: PlannerFillEventInput[];
  liveFillEvents: PlannerFillEventInput[];
}): {
  plannerFillEvents: Array<{
    exchangeOrderId?: string | null;
    clientOrderId?: string | null;
    side?: "buy" | "sell" | null;
    fillPrice: number;
    fillQty: number;
    fillTs: string;
    gridIndex?: number | null;
  }>;
  latestProcessedFillTs: string | null;
} {
  const plannerFillEvents: Array<{
    exchangeOrderId?: string | null;
    clientOrderId?: string | null;
    side?: "buy" | "sell" | null;
    fillPrice: number;
    fillQty: number;
    fillTs: string;
    gridIndex?: number | null;
  }> = [];
  let latestProcessedFillTs = String(params.currentStateJson.lastProcessedGridFillTs ?? "").trim() || null;

  for (const fill of [...params.paperFillEvents, ...params.liveFillEvents]) {
    const fillPrice = Number(fill.fillPrice ?? NaN);
    const fillQty = Number(fill.fillQty ?? NaN);
    const fillDate = fill.fillTs instanceof Date ? fill.fillTs : new Date(String(fill.fillTs ?? ""));
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) continue;
    if (!Number.isFinite(fillQty) || fillQty <= 0) continue;
    if (Number.isNaN(fillDate.getTime())) continue;
    const fillTs = fillDate.toISOString();
    plannerFillEvents.push({
      exchangeOrderId: fill.exchangeOrderId ?? null,
      clientOrderId: fill.clientOrderId ?? null,
      side: fill.side === "sell" ? "sell" : "buy",
      fillPrice,
      fillQty,
      fillTs,
      gridIndex: Number.isFinite(Number(fill.gridIndex)) ? Math.max(0, Math.trunc(Number(fill.gridIndex))) : null
    });
    if (!latestProcessedFillTs || fillTs > latestProcessedFillTs) {
      latestProcessedFillTs = fillTs;
    }
  }

  return {
    plannerFillEvents,
    latestProcessedFillTs
  };
}

export async function refreshTradeStateForVaultReconciliation(params: {
  executionExchange: string;
  liveFillEvents: PlannerFillEventInput[];
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  resolvePlannerPosition: () => Promise<{
    position: PlannerPositionSnapshot;
    source: "paper" | "adapter" | "trade_state" | "trade_state_fallback" | "empty_hyperliquid_bootstrap_fallback";
    degraded: boolean;
    readError: string | null;
  }>;
  syncTradeState: (plannerPosition: PlannerPositionSnapshot) => Promise<Awaited<ReturnType<typeof loadBotTradeState>>>;
}): Promise<{
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  plannerPositionResolution: {
    position: PlannerPositionSnapshot;
    source: "paper" | "adapter" | "trade_state" | "trade_state_fallback" | "empty_hyperliquid_bootstrap_fallback";
    degraded: boolean;
    readError: string | null;
  } | null;
}> {
  if (params.executionExchange === "paper" || params.liveFillEvents.length === 0) {
    return {
      tradeState: params.tradeState,
      plannerPositionResolution: null
    };
  }

  const plannerPositionResolution = await params.resolvePlannerPosition();
  return {
    tradeState: await params.syncTradeState(plannerPositionResolution.position),
    plannerPositionResolution
  };
}

export function extractHyperliquidLiveOrderRefs(params: {
  orderId?: string | null;
  raw?: unknown;
}): {
  clientOrderId: string | null;
  exchangeOrderRefs: string[];
} {
  const raw = params.raw && typeof params.raw === "object" && !Array.isArray(params.raw)
    ? params.raw as Record<string, unknown>
    : {};
  const clientOrderId = String(
    raw.clientOid
    ?? raw.clientOrderId
    ?? raw.clOrdId
    ?? ""
  ).trim() || null;
  const canonicalIdentity = buildOrderReferenceIdentity({
    clientOrderId,
    exchangeOrderId: params.orderId,
    cloid: String(raw.cloid ?? "").trim() || null
  });
  const exchangeOrderRefs = new Set<string>([
    ...collectOrderReferenceSet([
      params.orderId,
      raw.oid,
      raw.orderId,
      raw.order_id,
      raw.cloid
    ]),
    ...canonicalIdentity.keys,
    ...collectCanonicalOrderReferenceKeys([
      { value: params.orderId, hint: "exchange" },
      { value: raw.oid, hint: "exchange" },
      { value: raw.orderId, hint: "exchange" },
      { value: raw.order_id, hint: "exchange" },
      { value: raw.cloid, hint: "cloid" }
    ])
  ]);
  return {
    clientOrderId,
    exchangeOrderRefs: [...exchangeOrderRefs]
  };
}

export function liveOrderMatchesLocalOpenOrder(params: {
  openOrders: Array<{
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
  }>;
  clientOrderId?: string | null;
  exchangeOrderRefs?: string[];
}): boolean {
  const targetKeys = collectCanonicalOrderReferenceKeys([
    { value: params.clientOrderId, hint: "client_or_cloid" },
    ...((Array.isArray(params.exchangeOrderRefs) ? params.exchangeOrderRefs : []).map((value) => ({
      value,
      hint: "exchange" as const
    }))),
    ...((Array.isArray(params.exchangeOrderRefs) ? params.exchangeOrderRefs : []).map((value) => ({
      value,
      hint: "client_or_cloid" as const
    })))
  ]);
  if (targetKeys.size === 0) return false;
  return params.openOrders.some((row) => {
    const localIdentity = buildOrderReferenceIdentity({
      clientOrderId: row.clientOrderId,
      exchangeOrderId: row.exchangeOrderId
    });
    for (const key of localIdentity.keys) {
      if (targetKeys.has(key)) return true;
    }
    return false;
  });
}

export function hasOpenPlannerPosition(position: {
  side?: "long" | "short" | null;
  qty?: number | null;
} | null | undefined): boolean {
  return Boolean(position && Number.isFinite(Number(position.qty)) && Number(position.qty) > 0);
}

export function toPlannerPosition(tradeState: Awaited<ReturnType<typeof loadBotTradeState>>): PlannerPositionSnapshot {
  if (!tradeState.openSide || !Number.isFinite(Number(tradeState.openQty)) || Number(tradeState.openQty) <= 0) {
    return null;
  }
  return {
    side: tradeState.openSide,
    qty: Number(tradeState.openQty),
    entryPrice: Number.isFinite(Number(tradeState.openEntryPrice)) ? Number(tradeState.openEntryPrice) : null
  };
}

export async function syncGridTradeStateWithPlannerPosition(params: {
  botId: string;
  symbol: string;
  now: Date;
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  plannerPosition: PlannerPositionSnapshot;
}): Promise<Awaited<ReturnType<typeof loadBotTradeState>>> {
  const plannerPosition = params.plannerPosition;
  const nextOpenSide =
    plannerPosition && plannerPosition.side === "short"
      ? "short"
      : plannerPosition && plannerPosition.side === "long"
        ? "long"
        : null;
  const nextOpenQty =
    plannerPosition && Number.isFinite(Number(plannerPosition.qty)) && Number(plannerPosition.qty) > 0
      ? Number(plannerPosition.qty)
      : null;
  const nextOpenEntryPrice =
    plannerPosition && Number.isFinite(Number(plannerPosition.entryPrice))
      ? Number(plannerPosition.entryPrice)
      : null;
  const currentOpenTs = params.tradeState.openTs ?? null;
  const nextOpenTs = nextOpenSide ? (currentOpenTs ?? params.now) : null;
  const unchanged =
    params.tradeState.openSide === nextOpenSide
    && (params.tradeState.openQty ?? null) === nextOpenQty
    && (params.tradeState.openEntryPrice ?? null) === nextOpenEntryPrice
    && (currentOpenTs?.toISOString() ?? null) === (nextOpenTs?.toISOString() ?? null);
  if (unchanged) return params.tradeState;

  await upsertBotTradeState({
    botId: params.botId,
    symbol: params.symbol,
    dailyResetUtc: params.tradeState.dailyResetUtc,
    dailyTradeCount: params.tradeState.dailyTradeCount,
    openSide: nextOpenSide,
    openQty: nextOpenQty,
    openEntryPrice: nextOpenEntryPrice,
    openTs: nextOpenTs
  });
  return {
    ...params.tradeState,
    openSide: nextOpenSide,
    openQty: nextOpenQty,
    openEntryPrice: nextOpenEntryPrice,
    openTs: nextOpenTs
  };
}

export async function toPlannerPositionFromPaper(params: {
  exchangeAccountId: string;
  symbol: string;
}): Promise<PlannerPositionSnapshot> {
  const rows = await listPaperPositionsForRunner({
    exchangeAccountId: params.exchangeAccountId,
    symbol: params.symbol
  });
  const row = rows[0];
  if (!row) return null;
  if (!Number.isFinite(Number(row.size)) || Number(row.size) <= 0) return null;
  return {
    side: row.side === "short" ? "short" : "long",
    qty: Number(row.size),
    entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null
  };
}

export async function toPlannerPositionFromAdapter(params: {
  adapter: SupportedFuturesAdapter;
  symbol: string;
}): Promise<PlannerPositionSnapshot> {
  const positions = await params.adapter.getPositions();
  const row = positions.find((entry: any) =>
    normalizeComparableSymbol(String(entry?.symbol ?? "")) === normalizeComparableSymbol(params.symbol)
    && Number(entry?.size ?? 0) > 0
  );
  if (!row) return null;
  const qty = Number(row.size ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return {
    side: String(row.side ?? "").trim().toLowerCase() === "short" ? "short" : "long",
    qty,
    entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null
  };
}

export async function resolvePlannerPositionForExecution(params: {
  adapter: SupportedFuturesAdapter | null;
  symbol: string;
  executionExchange: string;
  tradeState: Awaited<ReturnType<typeof loadBotTradeState>>;
  openOrdersCount: number;
  currentStateJson: Record<string, unknown>;
}): Promise<{
  position: PlannerPositionSnapshot;
  source: "paper" | "adapter" | "trade_state" | "trade_state_fallback" | "empty_hyperliquid_bootstrap_fallback";
  degraded: boolean;
  readError: string | null;
}> {
  const tradeStatePosition = toPlannerPosition(params.tradeState);
  if (params.executionExchange === "paper") {
    throw new Error("paper_planner_position_requires_exchange_account_context");
  }
  if (!params.adapter) {
    return {
      position: tradeStatePosition,
      source: "trade_state",
      degraded: false,
      readError: null
    };
  }
  try {
    return {
      position: await toPlannerPositionFromAdapter({
        adapter: params.adapter,
        symbol: params.symbol
      }),
      source: "adapter",
      degraded: false,
      readError: null
    };
  } catch (error) {
    const isFreshHyperliquidBootstrap =
      params.executionExchange === "hyperliquid"
      && params.openOrdersCount === 0
      && params.currentStateJson.initialSeedExecuted !== true
      && params.currentStateJson.initialSeedNeedsReseed !== true
      && !hasOpenPlannerPosition(tradeStatePosition);
    if (!isFreshHyperliquidBootstrap) {
      throw error;
    }
    return {
      position: tradeStatePosition,
      source: tradeStatePosition ? "trade_state_fallback" : "empty_hyperliquid_bootstrap_fallback",
      degraded: true,
      readError: String(error)
    };
  }
}
