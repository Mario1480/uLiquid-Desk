import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { createPerpReadService } from "../execution/perp-read-service.js";
import {
  createPerpExecutionService,
  requirePerpSymbol
} from "../execution/perp-execution-service.js";
import type { PerpMarketDataClient } from "../perp/perp-market-data.client.js";
import type { SpotClient } from "../spot/spot-client-factory.js";
import { selectSpotSummary } from "../spot/bitget-spot.mapper.js";
import {
  ManualTradingError,
  type NormalizedOrder,
  type NormalizedPosition,
  type PerpExecutionAdapter,
  type TradingAccount,
  type TradingSettings
} from "../trading.js";
import {
  createManualPerpMarketDataClient,
  createManualSpotClient,
  ensureManualPerpEligibility,
  ensureManualSpotEligibility,
  inferSpotSummaryCurrency,
  listBitgetSpotPositions,
  resolveManualMarketType,
  resolveManualOrderSide
} from "../manual-trading/support.js";
import {
  createIdempotencyMiddleware,
  readIdempotencyKey
} from "../trafficControl.js";

type MobileMarketType = "spot" | "perp";
type MobileMarginMode = "cross" | "isolated";

type ResolvedTradingAccountPair = {
  selectedAccount: TradingAccount;
  marketDataAccount: TradingAccount;
};

type AccountState = {
  equity?: number | null;
  availableMargin?: number | null;
  marginMode?: string | null;
};

export type RegisterMobileTradingRoutesDeps = {
  getTradingSettings(userId: string): Promise<TradingSettings>;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId?: string): Promise<ResolvedTradingAccountPair>;
  sendManualTradingError(res: express.Response, error: unknown): express.Response;
  normalizeSpotSymbol(value: string | null | undefined): string;
  normalizeSymbolInput(value: string | null | undefined): string | null;
  createPerpExecutionAdapter(account: TradingAccount): PerpExecutionAdapter;
  isPaperTradingAccount(account: TradingAccount): boolean;
  getPaperAccountState(account: TradingAccount, reader: PerpMarketDataClient): Promise<AccountState>;
  getPaperSpotAccountState(account: TradingAccount, client: SpotClient): Promise<AccountState>;
  listPaperPositions(account: TradingAccount, reader: PerpMarketDataClient, symbol?: string): Promise<NormalizedPosition[]>;
  listPaperSpotPositions(account: TradingAccount, client: SpotClient, symbol?: string): Promise<NormalizedPosition[]>;
  listPaperOpenOrders(account: TradingAccount, reader: PerpMarketDataClient, symbol?: string): Promise<NormalizedOrder[]>;
  listPaperSpotOpenOrders(account: TradingAccount, client: SpotClient, symbol?: string): Promise<NormalizedOrder[]>;
  listPositions(adapter: PerpExecutionAdapter, symbol?: string): Promise<NormalizedPosition[]>;
  listOpenOrders(adapter: PerpExecutionAdapter, symbol?: string): Promise<NormalizedOrder[]>;
  loadGridDeskVisibilityMask(userId: string, exchangeAccountIds: string[]): Promise<unknown>;
  filterGridBotPositionsForDesk<T extends { symbol?: string | null }>(
    rows: T[],
    mask: unknown,
    exchangeAccountId: string
  ): T[];
  filterGridBotOrdersForDesk<T extends { orderId?: string | null; symbol?: string | null }>(
    rows: T[],
    mask: unknown,
    exchangeAccountId: string
  ): T[];
  splitCanonicalSymbol(symbol: string): { baseAsset: string | null; quoteAsset: string | null };
  placePaperOrder(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    input: {
      symbol: string;
      side: "buy" | "sell";
      type: "market" | "limit";
      qty: number;
      price?: number;
      takeProfitPrice?: number;
      stopLossPrice?: number;
      reduceOnly?: boolean;
    }
  ): Promise<{ orderId: string }>;
  placePaperSpotOrder(
    account: TradingAccount,
    client: SpotClient,
    input: {
      symbol: string;
      side: "buy" | "sell";
      type: "market" | "limit";
      qty: number;
      quoteQty?: number;
      price?: number;
    }
  ): Promise<{ orderId: string }>;
  cancelPaperOrder(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    orderId: string,
    symbol?: string
  ): Promise<{ ok: boolean }>;
  cancelPaperSpotOrder(
    account: TradingAccount,
    client: SpotClient,
    orderId: string,
    symbol?: string
  ): Promise<{ ok: boolean }>;
  setPaperPositionTpSl(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    input: {
      symbol: string;
      side?: "long" | "short";
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }
  ): Promise<{ updated: boolean }>;
  setPositionTpSl(
    adapter: PerpExecutionAdapter,
    input: {
      symbol: string;
      side?: "long" | "short";
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }
  ): Promise<{ ok: true }>;
  cancelAllOrders(adapter: PerpExecutionAdapter, symbol?: string): Promise<{
    requested: number;
    cancelled: number;
    failed: number;
  }>;
  closePositionsMarket(adapter: PerpExecutionAdapter, symbol: string, side?: "long" | "short"): Promise<string[]>;
  closePaperPosition(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol: string,
    side?: "long" | "short"
  ): Promise<string[]>;
  closePaperSpotPosition(account: TradingAccount, client: SpotClient, symbol: string): Promise<string[]>;
};

const mobileMarketTypeSchema = z.enum(["spot", "perp"]);
const mobileOrderTypeSchema = z.enum(["market", "limit"]);
const mobileIntentSchema = z.enum(["buy", "sell", "long", "short"]);
const mobileSizingModeSchema = z.enum(["cost", "quantity"]);
const mobileMarginModeSchema = z.enum(["cross", "isolated"]);
const nullablePositiveNumberSchema = z.preprocess(
  (value) => value === 0 ? null : value,
  z.number().positive().nullable().optional()
);

const mobileTradingStateQuerySchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  marketType: mobileMarketTypeSchema,
  symbol: z.string().trim().min(1).max(80)
});

const mobileOrderSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  exchangeAccountId: z.string().trim().min(1),
  marketType: mobileMarketTypeSchema,
  symbol: z.string().trim().min(1).max(80),
  orderType: mobileOrderTypeSchema,
  intent: mobileIntentSchema,
  sizingMode: mobileSizingModeSchema,
  quantity: z.number().positive().optional(),
  cost: z.number().positive().optional(),
  limitPrice: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  stopLossPrice: z.number().positive().optional(),
  marginMode: mobileMarginModeSchema.optional(),
  leverage: z.number().int().min(1).max(125).optional()
}).superRefine((value, ctx) => {
  if (value.sizingMode === "quantity" && value.quantity === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "quantity is required" });
  }
  if (value.sizingMode === "cost" && value.cost === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cost"], message: "cost is required" });
  }
  if (value.orderType === "limit" && value.limitPrice === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["limitPrice"],
      message: "limitPrice is required for limit orders"
    });
  }
});

const mobileOrderManagementSchema = z.object({
  idempotencyKey: z.string().trim().min(1),
  exchangeAccountId: z.string().trim().min(1),
  marketType: mobileMarketTypeSchema,
  symbol: z.string().trim().min(1).max(80)
});

const mobileClosePositionSchema = mobileOrderManagementSchema.extend({
  side: z.enum(["long", "short"]).optional(),
  orderType: mobileOrderTypeSchema.default("market"),
  quantity: z.number().positive().optional(),
  closePercent: z.number().positive().max(100).optional(),
  limitPrice: z.number().positive().optional()
});

const mobileProtectionSchema = mobileOrderManagementSchema.extend({
  side: z.enum(["long", "short"]).optional(),
  takeProfitPrice: nullablePositiveNumberSchema,
  stopLossPrice: nullablePositiveNumberSchema
}).superRefine((value, ctx) => {
  if (value.takeProfitPrice === undefined && value.stopLossPrice === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["symbol"],
      message: "takeProfitPrice or stopLossPrice is required"
    });
  }
});

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMarginMode(value: unknown): MobileMarginMode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "cross" || normalized.includes("cross")) return "cross";
  if (normalized === "isolated" || normalized.includes("isolated")) return "isolated";
  return null;
}

function buildCapabilities(marketType: MobileMarketType, marginMode?: unknown) {
  if (marketType === "spot") {
    return {
      supportsMarketOrders: true,
      supportsLimitOrders: true,
      supportsTPSL: false,
      supportsSpotProtection: false,
      supportsCrossMargin: false,
      supportsIsolatedMargin: false,
      minLeverage: null,
      maxLeverage: null,
      defaultLeverage: null,
      defaultMarginMode: null
    };
  }

  return {
    supportsMarketOrders: true,
    supportsLimitOrders: true,
    supportsTPSL: true,
    supportsSpotProtection: false,
    supportsCrossMargin: true,
    supportsIsolatedMargin: true,
    minLeverage: 1,
    maxLeverage: 125,
    defaultLeverage: 10,
    defaultMarginMode: normalizeMarginMode(marginMode) ?? "isolated"
  };
}

function toMobilePosition(
  row: NormalizedPosition,
  exchangeAccountId: string,
  exchange: string | null,
  marketType: MobileMarketType
) {
  return {
    exchangeAccountId,
    exchange,
    exchangeLabel: exchange,
    marketType,
    symbol: String(row.symbol ?? ""),
    side: String(row.side ?? "long"),
    size: Number(row.size ?? 0),
    entryPrice: toFiniteNumber(row.entryPrice),
    markPrice: toFiniteNumber(row.markPrice),
    liquidationPrice: toFiniteNumber(row.liquidationPrice),
    unrealizedPnl: toFiniteNumber(row.unrealizedPnl),
    leverage: toFiniteNumber(row.leverage),
    marginMode: normalizeMarginMode(row.marginMode),
    takeProfitPrice: toFiniteNumber(row.takeProfitPrice),
    stopLossPrice: toFiniteNumber(row.stopLossPrice)
  };
}

function normalizeOrderType(value: unknown): "market" | "limit" {
  return String(value ?? "").trim().toLowerCase().includes("limit") ? "limit" : "market";
}

function toMobileOpenOrder(row: NormalizedOrder, exchangeAccountId: string, marketType: MobileMarketType) {
  const quantity = toFiniteNumber(row.qty);
  return {
    id: String(row.orderId ?? ""),
    exchangeOrderId: String(row.orderId ?? ""),
    exchangeAccountId,
    marketType,
    symbol: String(row.symbol ?? ""),
    side: String(row.side ?? ""),
    orderType: normalizeOrderType(row.type),
    status: String(row.status ?? "open"),
    quantity,
    filledQuantity: null,
    remainingQuantity: quantity,
    price: toFiniteNumber(row.price),
    averagePrice: null,
    takeProfitPrice: toFiniteNumber(row.takeProfitPrice),
    stopLossPrice: toFiniteNumber(row.stopLossPrice),
    createdAt: row.createdAt ?? null
  };
}

function buildActionResponse(params: {
  status: string;
  message?: string;
  orderId?: string | null;
  submittedQuantity?: number | null;
}) {
  return {
    ok: true,
    status: params.status,
    message: params.message ?? null,
    orderId: params.orderId ?? null,
    exchangeOrderId: params.orderId ?? null,
    submittedQuantity: params.submittedQuantity ?? null,
    filledQuantity: null,
    averagePrice: null,
    fees: null,
    state: null
  };
}

async function resolveReferencePrice(input: {
  marketType: MobileMarketType;
  resolved: ResolvedTradingAccountPair;
  symbol: string;
  orderType: "market" | "limit";
  limitPrice?: number;
}): Promise<number> {
  if (input.orderType === "limit" && input.limitPrice !== undefined) {
    return input.limitPrice;
  }

  if (input.marketType === "spot") {
    const spotClient = createManualSpotClient(input.resolved.marketDataAccount, "/mobile/trading/orders/price");
    const ticker = await spotClient.getTicker(input.symbol);
    const price = toFiniteNumber(ticker.last) ?? toFiniteNumber(ticker.mark);
    if (price !== null && price > 0) return price;
  } else {
    const perpClient = createManualPerpMarketDataClient(input.resolved.marketDataAccount, "/mobile/trading/orders/price");
    try {
      const ticker = await perpClient.getTicker(input.symbol);
      const price = toFiniteNumber(ticker.mark) ?? toFiniteNumber(ticker.last);
      if (price !== null && price > 0) return price;
    } finally {
      await perpClient.close();
    }
  }

  throw new ManualTradingError("market_price_unavailable", 422, "market_price_unavailable");
}

async function resolveMobileQuantity(input: {
  sizingMode: "cost" | "quantity";
  quantity?: number;
  cost?: number;
  marketType: MobileMarketType;
  resolved: ResolvedTradingAccountPair;
  symbol: string;
  orderType: "market" | "limit";
  limitPrice?: number;
}): Promise<number> {
  if (input.sizingMode === "quantity") {
    const quantity = Number(input.quantity);
    if (Number.isFinite(quantity) && quantity > 0) return quantity;
  }

  const cost = Number(input.cost);
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new ManualTradingError("invalid_cost", 400, "invalid_cost");
  }
  const price = await resolveReferencePrice(input);
  const quantity = Number((cost / price).toFixed(10));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ManualTradingError("invalid_qty", 400, "invalid_qty");
  }
  return quantity;
}

function resolveUserScopedIdempotencyKey(req: express.Request, res: express.Response) {
  const raw = readIdempotencyKey(req);
  if (!raw) return null;
  const userId = typeof res.locals.user?.id === "string" ? res.locals.user.id.trim() : "";
  return userId ? `${userId}:${raw}` : raw;
}

export function registerMobileTradingRoutes(app: express.Express, deps: RegisterMobileTradingRoutesDeps) {
  const auth = requireAuth;
  const requirePlaceOrderIdempotency = createIdempotencyMiddleware({
    name: "mobile_manual_place_order",
    required: true,
    resolveKey: resolveUserScopedIdempotencyKey
  });
  const requireCancelOrderIdempotency = createIdempotencyMiddleware({
    name: "mobile_manual_cancel_order",
    required: true,
    resolveKey: resolveUserScopedIdempotencyKey
  });
  const requireClosePositionIdempotency = createIdempotencyMiddleware({
    name: "mobile_manual_close_position",
    required: true,
    resolveKey: resolveUserScopedIdempotencyKey
  });
  const requireProtectionIdempotency = createIdempotencyMiddleware({
    name: "mobile_manual_position_protection",
    required: true,
    resolveKey: resolveUserScopedIdempotencyKey
  });

  const perpReadService = createPerpReadService({
    isPaperTradingAccount: deps.isPaperTradingAccount,
    createPerpExecutionAdapter: deps.createPerpExecutionAdapter,
    createPerpMarketDataClient: createManualPerpMarketDataClient,
    getPaperAccountState: deps.getPaperAccountState,
    listPaperPositions: deps.listPaperPositions,
    listPaperOpenOrders: deps.listPaperOpenOrders,
    listPositions: deps.listPositions,
    listOpenOrders: deps.listOpenOrders
  });

  const perpExecutionService = createPerpExecutionService({
    isPaperTradingAccount: deps.isPaperTradingAccount,
    createPerpExecutionAdapter: deps.createPerpExecutionAdapter,
    createPerpMarketDataClient: createManualPerpMarketDataClient,
    placePaperOrder: deps.placePaperOrder,
    cancelPaperOrder: deps.cancelPaperOrder,
    cancelAllPaperOrders: async () => ({ requested: 0, cancelled: 0, failed: 0 }),
    setPaperPositionTpSl: deps.setPaperPositionTpSl,
    closePaperPosition: deps.closePaperPosition,
    editOpenOrder: async () => {
      throw new ManualTradingError("order_edit_not_supported", 400, "order_edit_not_supported");
    },
    cancelAllOrders: deps.cancelAllOrders,
    closePositionsMarket: deps.closePositionsMarket,
    setPositionTpSl: deps.setPositionTpSl
  });

  app.get("/mobile/trading/state", auth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = mobileTradingStateQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({ requested: parsed.data.marketType, settings });
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
      const exchange = String(resolved.selectedAccount.exchange ?? "");

      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const symbol = deps.normalizeSpotSymbol(parsed.data.symbol);
        if (!symbol) throw new ManualTradingError("symbol_required", 400, "symbol_required");
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/mobile/trading/state");
        const pair = deps.splitCanonicalSymbol(symbol);
        const quoteAsset =
          pair.quoteAsset ??
          (String(resolved.marketDataAccount.exchange ?? "").trim().toLowerCase() === "hyperliquid" ? "USDC" : "USDT");
        const baseAsset = pair.baseAsset;
        const [accountState, positions, openOrders] = deps.isPaperTradingAccount(resolved.selectedAccount)
          ? await Promise.all([
              deps.getPaperSpotAccountState(resolved.selectedAccount, spotClient),
              deps.listPaperSpotPositions(resolved.selectedAccount, spotClient, symbol),
              deps.listPaperSpotOpenOrders(resolved.selectedAccount, spotClient, symbol)
            ])
          : await (async () => {
              const [balances, livePositions, liveOpenOrders] = await Promise.all([
                spotClient.getBalances(),
                listBitgetSpotPositions({ client: spotClient, symbol, preferredQuoteAsset: quoteAsset }),
                spotClient.getOpenOrders(symbol)
              ]);
              const summary = selectSpotSummary(
                balances.map((row) => ({
                  coin: String(row.coin ?? row.asset ?? "").toUpperCase(),
                  available: String(row.available ?? "0"),
                  frozen: String(row.frozen ?? row.locked ?? row.lock ?? "0")
                })),
                quoteAsset
              );
              return [{ equity: summary.equity, availableMargin: summary.available, marginMode: null }, livePositions, liveOpenOrders] as const;
            })();

        return res.json({
          fetchedAt: new Date().toISOString(),
          exchangeAccountId: resolved.selectedAccount.id,
          exchange,
          marketType,
          symbol,
          balances: {
            quoteAsset,
            baseAsset,
            equity: toFiniteNumber(accountState.equity),
            total: toFiniteNumber(accountState.equity),
            availableMargin: null,
            availableQuote: toFiniteNumber(accountState.availableMargin)
          },
          capabilities: buildCapabilities(marketType),
          positions: positions.map((row) => toMobilePosition(row, resolved.selectedAccount.id, exchange, marketType)),
          openOrders: openOrders.map((row) => toMobileOpenOrder(row, resolved.selectedAccount.id, marketType))
        });
      }

      ensureManualPerpEligibility(resolved);
      const symbol = requirePerpSymbol(deps.normalizeSymbolInput(parsed.data.symbol));
      const visibilityMask = await deps.loadGridDeskVisibilityMask(user.id, [String(resolved.selectedAccount.id)]);
      const [snapshot, openOrders] = await Promise.all([
        perpReadService.getAccountSnapshot({ resolved, symbol, endpoint: "/mobile/trading/state" }),
        perpReadService.listOpenOrders({ resolved, symbol, endpoint: "/mobile/trading/state/open-orders" })
      ]);
      const positions = deps.filterGridBotPositionsForDesk(snapshot.positions, visibilityMask, resolved.selectedAccount.id);
      const orders = deps.filterGridBotOrdersForDesk(openOrders.items, visibilityMask, resolved.selectedAccount.id);

      return res.json({
        fetchedAt: new Date().toISOString(),
        exchangeAccountId: resolved.selectedAccount.id,
        exchange,
        marketType,
        symbol,
        balances: {
          quoteAsset: "USDT",
          baseAsset: symbol.replace(/USDT$/i, ""),
          equity: toFiniteNumber(snapshot.accountState.equity),
          total: toFiniteNumber(snapshot.accountState.equity),
          availableMargin: toFiniteNumber(snapshot.accountState.availableMargin),
          availableQuote: null
        },
        capabilities: buildCapabilities(marketType, snapshot.accountState.marginMode),
        positions: positions.map((row) => toMobilePosition(row, resolved.selectedAccount.id, exchange, marketType)),
        openOrders: orders.map((row) => toMobileOpenOrder(row, resolved.selectedAccount.id, marketType))
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/mobile/trading/orders", auth, requirePlaceOrderIdempotency, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = mobileOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({ requested: parsed.data.marketType, settings });
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
      const orderType = parsed.data.orderType;

      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const symbol = deps.normalizeSpotSymbol(parsed.data.symbol);
        if (!symbol) throw new ManualTradingError("symbol_required", 400, "symbol_required");
        if (parsed.data.leverage !== undefined) {
          throw new ManualTradingError("leverage_not_supported_for_spot", 400, "leverage_not_supported_for_spot");
        }
        if (parsed.data.takeProfitPrice !== undefined || parsed.data.stopLossPrice !== undefined) {
          throw new ManualTradingError("tpsl_not_supported_for_spot_v1", 400, "tpsl_not_supported_for_spot_v1");
        }
        const qty = await resolveMobileQuantity({
          sizingMode: parsed.data.sizingMode,
          quantity: parsed.data.quantity,
          cost: parsed.data.cost,
          marketType,
          resolved,
          symbol,
          orderType,
          limitPrice: parsed.data.limitPrice
        });
        const side = resolveManualOrderSide(parsed.data.intent, marketType);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/mobile/trading/orders");
        const placed = deps.isPaperTradingAccount(resolved.selectedAccount)
          ? await deps.placePaperSpotOrder(resolved.selectedAccount, spotClient, {
              symbol,
              side,
              type: orderType,
              qty,
              quoteQty: parsed.data.sizingMode === "cost" ? parsed.data.cost : undefined,
              price: parsed.data.limitPrice
            })
          : await spotClient.placeOrder({
              symbol,
              side,
              type: orderType,
              qty,
              quoteQty: parsed.data.sizingMode === "cost" ? parsed.data.cost : undefined,
              price: parsed.data.limitPrice
            });
        return res.status(201).json(buildActionResponse({ status: "accepted", orderId: placed.orderId, submittedQuantity: qty }));
      }

      ensureManualPerpEligibility(resolved);
      const symbol = requirePerpSymbol(deps.normalizeSymbolInput(parsed.data.symbol));
      const qty = await resolveMobileQuantity({
        sizingMode: parsed.data.sizingMode,
        quantity: parsed.data.quantity,
        cost: parsed.data.cost,
        marketType,
        resolved,
        symbol,
        orderType,
        limitPrice: parsed.data.limitPrice
      });
      const placed = await perpExecutionService.placeOrder({
        resolved,
        symbol,
        side: resolveManualOrderSide(parsed.data.intent, marketType),
        type: orderType,
        qty,
        price: parsed.data.limitPrice,
        takeProfitPrice: parsed.data.takeProfitPrice,
        stopLossPrice: parsed.data.stopLossPrice,
        leverage: parsed.data.leverage,
        marginMode: parsed.data.marginMode
      });
      return res.status(201).json(buildActionResponse({ status: placed.status, orderId: placed.orderId, submittedQuantity: qty }));
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/mobile/trading/orders/:id/cancel", auth, requireCancelOrderIdempotency, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = mobileOrderManagementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const orderId = String(req.params.id ?? "").trim();
      if (!orderId) throw new ManualTradingError("order_id_required", 400, "order_id_required");
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({ requested: parsed.data.marketType, settings });
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);

      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const symbol = deps.normalizeSpotSymbol(parsed.data.symbol);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/mobile/trading/orders/cancel");
        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          await deps.cancelPaperSpotOrder(resolved.selectedAccount, spotClient, orderId, symbol || undefined);
        } else {
          await spotClient.cancelOrder(symbol, orderId);
        }
        return res.json(buildActionResponse({ status: "cancelled", orderId }));
      }

      ensureManualPerpEligibility(resolved);
      const cancelled = await perpExecutionService.cancelOrder({
        resolved,
        orderId,
        symbol: deps.normalizeSymbolInput(parsed.data.symbol) ?? undefined
      });
      return res.json(buildActionResponse({ status: cancelled.ok ? "cancelled" : "submitted", orderId }));
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/mobile/trading/positions/close", auth, requireClosePositionIdempotency, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = mobileClosePositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (parsed.data.orderType !== "market") {
      return res.status(400).json({ error: "limit_close_not_supported_mobile" });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({ requested: parsed.data.marketType, settings });
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);

      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        if (parsed.data.side === "short") {
          throw new ManualTradingError("spot_close_side_not_supported", 400, "spot_close_side_not_supported");
        }
        const symbol = deps.normalizeSpotSymbol(parsed.data.symbol);
        if (!symbol) throw new ManualTradingError("symbol_required", 400, "symbol_required");
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/mobile/trading/positions/close");
        const orderIds = deps.isPaperTradingAccount(resolved.selectedAccount)
          ? await deps.closePaperSpotPosition(resolved.selectedAccount, spotClient, symbol)
          : await (async () => {
              const liveRows = await listBitgetSpotPositions({
                client: spotClient,
                symbol,
                preferredQuoteAsset: inferSpotSummaryCurrency(symbol)
              });
              const qty = Number(liveRows[0]?.size ?? 0);
              if (!Number.isFinite(qty) || qty <= 0) return [];
              const placed = await spotClient.placeOrder({ symbol, side: "sell", type: "market", qty });
              return [placed.orderId];
            })();
        return res.json(buildActionResponse({
          status: "closed",
          message: `${orderIds.length} close order(s) submitted.`,
          orderId: orderIds[0] ?? null
        }));
      }

      ensureManualPerpEligibility(resolved);
      const symbol = requirePerpSymbol(deps.normalizeSymbolInput(parsed.data.symbol));
      const result = await perpExecutionService.closePosition({ resolved, symbol, side: parsed.data.side });
      return res.json(buildActionResponse({
        status: "closed",
        message: `${result.orderIds.length} close order(s) submitted.`,
        orderId: result.orderIds[0] ?? null
      }));
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/mobile/trading/positions/protection", auth, requireProtectionIdempotency, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = mobileProtectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({ requested: parsed.data.marketType, settings });
      if (marketType === "spot") {
        throw new ManualTradingError("tpsl_not_supported_for_spot_v1", 400, "tpsl_not_supported_for_spot_v1");
      }
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
      ensureManualPerpEligibility(resolved);
      const result = await perpExecutionService.setPositionTpSl({
        resolved,
        symbol: requirePerpSymbol(deps.normalizeSymbolInput(parsed.data.symbol)),
        side: parsed.data.side,
        takeProfitPrice: parsed.data.takeProfitPrice,
        stopLossPrice: parsed.data.stopLossPrice
      });
      return res.json(buildActionResponse({
        status: result.ok ? "updated" : "submitted",
        message: "TP/SL updated."
      }));
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });
}
