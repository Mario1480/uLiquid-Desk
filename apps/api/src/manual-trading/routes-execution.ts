import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import type { PerpMarketDataClient } from "../perp/perp-market-data.client.js";
import type { SpotClient } from "../spot/spot-client-factory.js";
import {
  createPerpExecutionService,
  requirePerpSymbol
} from "../execution/perp-execution-service.js";
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
  parseSpotOrderType,
  resolveManualMarketType,
  resolveManualOrderSide
} from "./support.js";

const manualMarketTypeSchema = z.enum(["spot", "perp"]);

const placeOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  marketType: manualMarketTypeSchema.optional(),
  symbol: z.string().trim().min(1),
  type: z.enum(["market", "limit"]),
  side: z.enum(["long", "short", "buy", "sell"]),
  qty: z.number().positive(),
  price: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  stopLossPrice: z.number().positive().optional(),
  reduceOnly: z.boolean().optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  marginMode: z.enum(["isolated", "cross"]).optional()
}).superRefine((value, ctx) => {
  if (value.type === "limit" && value.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["price"],
      message: "price is required for limit orders"
    });
  }
});

const adjustLeverageSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  marketType: manualMarketTypeSchema.optional(),
  symbol: z.string().trim().min(1),
  leverage: z.number().int().min(1).max(125),
  marginMode: z.enum(["isolated", "cross"]).default("cross")
});

const cancelOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  marketType: manualMarketTypeSchema.optional(),
  orderId: z.string().trim().min(1),
  symbol: z.string().trim().min(1).optional()
});

const closePositionSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  marketType: manualMarketTypeSchema.optional(),
  symbol: z.string().trim().min(1),
  side: z.enum(["long", "short"]).optional()
});

const editOrderSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  marketType: manualMarketTypeSchema.optional(),
  orderId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  price: z.number().positive().optional(),
  qty: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().nullable().optional(),
  stopLossPrice: z.number().positive().nullable().optional()
}).superRefine((value, ctx) => {
  if (
    value.price === undefined &&
    value.qty === undefined &&
    value.takeProfitPrice === undefined &&
    value.stopLossPrice === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["orderId"],
      message: "price, qty, takeProfitPrice or stopLossPrice is required"
    });
  }
});

const positionTpSlSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  marketType: manualMarketTypeSchema.optional(),
  symbol: z.string().trim().min(1),
  side: z.enum(["long", "short"]).optional(),
  takeProfitPrice: z.number().positive().nullable().optional(),
  stopLossPrice: z.number().positive().nullable().optional()
}).superRefine((value, ctx) => {
  if (value.takeProfitPrice === undefined && value.stopLossPrice === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["symbol"],
      message: "takeProfitPrice or stopLossPrice is required"
    });
  }
});

type ResolvedTradingAccountPair = {
  selectedAccount: TradingAccount;
  marketDataAccount: TradingAccount;
};

export type RegisterManualTradingExecutionRoutesDeps = {
  getTradingSettings(userId: string): Promise<TradingSettings>;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId?: string): Promise<ResolvedTradingAccountPair>;
  resolveTradingAccount(userId: string, exchangeAccountId?: string): Promise<TradingAccount>;
  sendManualTradingError(res: express.Response, error: unknown): express.Response;
  normalizeSpotSymbol(value: string | null | undefined): string;
  normalizeSymbolInput(value: string | null | undefined): string | null;
  createPerpExecutionAdapter(account: TradingAccount): PerpExecutionAdapter;
  isPaperTradingAccount(account: TradingAccount): boolean;
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
      price?: number;
    }
  ): Promise<{ orderId: string }>;
  editPaperOrder(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    input: {
      orderId: string;
      symbol: string;
      price?: number;
      qty?: number;
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }
  ): Promise<{ orderId: string }>;
  editPaperSpotOrder(
    account: TradingAccount,
    client: SpotClient,
    input: {
      orderId: string;
      symbol: string;
      price?: number;
      qty?: number;
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
  cancelAllPaperOrders(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol?: string
  ): Promise<{ requested: number; cancelled: number; failed: number }>;
  cancelAllPaperSpotOrders(
    account: TradingAccount,
    client: SpotClient,
    symbol?: string
  ): Promise<{ requested: number; cancelled: number; failed: number }>;
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
  editOpenOrder(
    adapter: PerpExecutionAdapter,
    params: {
      symbol: string;
      orderId: string;
      price?: number;
      qty?: number;
      takeProfitPrice?: number | null;
      stopLossPrice?: number | null;
    }
  ): Promise<{ orderId: string }>;
  cancelAllOrders(
    adapter: PerpExecutionAdapter,
    symbol?: string
  ): Promise<{ requested: number; cancelled: number; failed: number }>;
  closePositionsMarket(
    adapter: PerpExecutionAdapter,
    symbol: string,
    side?: "long" | "short"
  ): Promise<string[]>;
  closePaperPosition(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol: string,
    side?: "long" | "short"
  ): Promise<string[]>;
  closePaperSpotPosition(
    account: TradingAccount,
    client: SpotClient,
    symbol: string
  ): Promise<string[]>;
  listPaperPositions(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol?: string
  ): Promise<NormalizedPosition[]>;
  listPaperSpotPositions(
    account: TradingAccount,
    client: SpotClient,
    symbol?: string
  ): Promise<NormalizedPosition[]>;
  listPositions(
    adapter: PerpExecutionAdapter,
    symbol?: string
  ): Promise<NormalizedPosition[]>;
  db: any;
  ignoreMissingTable<T>(fn: () => Promise<T>): Promise<T | null>;
};

export function registerManualTradingExecutionRoutes(
  app: express.Express,
  deps: RegisterManualTradingExecutionRoutesDeps
) {
  const perpExecutionService = createPerpExecutionService({
    isPaperTradingAccount: deps.isPaperTradingAccount,
    createPerpExecutionAdapter: deps.createPerpExecutionAdapter,
    createPerpMarketDataClient: createManualPerpMarketDataClient,
    placePaperOrder: deps.placePaperOrder,
    editPaperOrder: deps.editPaperOrder,
    cancelPaperOrder: deps.cancelPaperOrder,
    cancelAllPaperOrders: deps.cancelAllPaperOrders,
    setPaperPositionTpSl: deps.setPaperPositionTpSl,
    closePaperPosition: deps.closePaperPosition,
    editOpenOrder: deps.editOpenOrder,
    cancelAllOrders: deps.cancelAllOrders,
    closePositionsMarket: deps.closePositionsMarket,
    setPositionTpSl: deps.setPositionTpSl
  });

  app.post("/api/account/leverage", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = adjustLeverageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: parsed.data.marketType,
        settings
      });
      if (marketType === "spot") {
        throw new ManualTradingError(
          "leverage_not_supported_for_spot",
          400,
          "leverage_not_supported_for_spot"
        );
      }
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
      ensureManualPerpEligibility(resolved);
      const result = await perpExecutionService.setLeverage({
        resolved,
        symbol: requirePerpSymbol(deps.normalizeSymbolInput(parsed.data.symbol)),
        leverage: parsed.data.leverage,
        marginMode: parsed.data.marginMode
      });
      return res.json({
        ok: true,
        exchangeAccountId: result.exchangeAccountId,
        marketType,
        symbol: result.symbol,
        leverage: result.leverage,
        marginMode: result.marginMode
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/api/orders", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: parsed.data.marketType,
        settings
      });
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const symbol = deps.normalizeSpotSymbol(parsed.data.symbol);
        if (!symbol) {
          return res.status(400).json({ error: "symbol_required" });
        }
        if (parsed.data.leverage !== undefined) {
          throw new ManualTradingError(
            "leverage_not_supported_for_spot",
            400,
            "leverage_not_supported_for_spot"
          );
        }
        if (parsed.data.takeProfitPrice !== undefined || parsed.data.stopLossPrice !== undefined) {
          throw new ManualTradingError(
            "tpsl_not_supported_for_spot_v1",
            400,
            "tpsl_not_supported_for_spot_v1"
          );
        }
        const side = resolveManualOrderSide(parsed.data.side, marketType);
        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/orders");
          const placed = await deps.placePaperSpotOrder(resolved.selectedAccount, spotClient, {
            symbol,
            side,
            type: parsed.data.type,
            qty: parsed.data.qty,
            price: parsed.data.price
          });
          return res.status(201).json({
            exchangeAccountId: resolved.selectedAccount.id,
            marketType,
            orderId: placed.orderId,
            status: "accepted"
          });
        }
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/orders");
        const placed = await spotClient.placeOrder({
          symbol,
          side,
          type: parsed.data.type,
          qty: parsed.data.qty,
          price: parsed.data.price
        });
        return res.status(201).json({
          exchangeAccountId: resolved.selectedAccount.id,
          marketType,
          orderId: placed.orderId,
          status: "accepted"
        });
      }
      ensureManualPerpEligibility(resolved);
      const placed = await perpExecutionService.placeOrder({
        resolved,
        symbol: requirePerpSymbol(deps.normalizeSymbolInput(parsed.data.symbol)),
        side: resolveManualOrderSide(parsed.data.side, marketType),
        type: parsed.data.type,
        qty: parsed.data.qty,
        price: parsed.data.price,
        takeProfitPrice: parsed.data.takeProfitPrice,
        stopLossPrice: parsed.data.stopLossPrice,
        reduceOnly: parsed.data.reduceOnly,
        leverage: parsed.data.leverage,
        marginMode: parsed.data.marginMode
      });
      return res.status(201).json({
        exchangeAccountId: placed.exchangeAccountId,
        marketType,
        orderId: placed.orderId,
        status: placed.status
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/api/orders/edit", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = editOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: parsed.data.marketType,
        settings
      });
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const symbol = deps.normalizeSpotSymbol(parsed.data.symbol);
        if (!symbol) {
          return res.status(400).json({ error: "symbol_required" });
        }
        if (parsed.data.takeProfitPrice !== undefined || parsed.data.stopLossPrice !== undefined) {
          throw new ManualTradingError(
            "tpsl_not_supported_for_spot_v1",
            400,
            "tpsl_not_supported_for_spot_v1"
          );
        }

        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/orders/edit");
          const updated = await deps.editPaperSpotOrder(resolved.selectedAccount, spotClient, {
            orderId: parsed.data.orderId,
            symbol,
            price: parsed.data.price,
            qty: parsed.data.qty
          });
          return res.json({
            exchangeAccountId: resolved.selectedAccount.id,
            marketType,
            orderId: updated.orderId,
            ok: true
          });
        }

      const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/orders/edit");
      const current = (await spotClient.getOpenOrders(symbol)).find((row) => row.orderId === parsed.data.orderId);
      if (!current) {
        throw new ManualTradingError("order_not_found", 404, "order_not_found");
      }
      const qty = parsed.data.qty ?? current.qty ?? null;
      if (!qty || !Number.isFinite(qty) || qty <= 0) {
        throw new ManualTradingError("invalid_qty", 400, "invalid_qty");
      }
        const currentPrice = current.price ?? undefined;
      const orderType = parseSpotOrderType(current.type);
      const price = orderType === "limit" ? (parsed.data.price ?? currentPrice) : undefined;
      if (orderType === "limit" && (!price || !Number.isFinite(price) || price <= 0)) {
        throw new ManualTradingError("limit_requires_price", 400, "limit_requires_price");
      }
        const side = String(current.side ?? "").toLowerCase() === "sell" ? "sell" : "buy";
        const updated = await spotClient.editOrder({
          symbol,
          orderId: parsed.data.orderId,
          side,
          type: orderType,
          qty,
          price
        });
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          marketType,
          orderId: updated.orderId,
          ok: true
        });
      }
      ensureManualPerpEligibility(resolved);
      const updated = await perpExecutionService.editOrder({
        resolved,
        symbol: requirePerpSymbol(deps.normalizeSymbolInput(parsed.data.symbol)),
        orderId: parsed.data.orderId,
        price: parsed.data.price,
        qty: parsed.data.qty,
        takeProfitPrice: parsed.data.takeProfitPrice,
        stopLossPrice: parsed.data.stopLossPrice
      });
      return res.json({
        exchangeAccountId: updated.exchangeAccountId,
        marketType,
        orderId: updated.orderId,
        ok: updated.ok
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/api/orders/cancel", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = cancelOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: parsed.data.marketType,
        settings
      });
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const symbol = deps.normalizeSpotSymbol(parsed.data.symbol);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/orders/cancel");
        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          await deps.cancelPaperSpotOrder(
            resolved.selectedAccount,
            spotClient,
            parsed.data.orderId,
            symbol || undefined
          );
          return res.json({ ok: true, marketType });
        }

        if (symbol) {
          await spotClient.cancelOrder(symbol, parsed.data.orderId);
        } else {
          const open = await spotClient.getOpenOrders();
          const row = open.find((item) => item.orderId === parsed.data.orderId);
          if (!row) {
            return res.json({ ok: true, marketType });
          }
          await spotClient.cancelOrder(row.symbol, row.orderId);
        }
        return res.json({ ok: true, marketType });
      }
      ensureManualPerpEligibility(resolved);
      const cancelled = await perpExecutionService.cancelOrder({
        resolved,
        orderId: parsed.data.orderId,
        symbol: deps.normalizeSymbolInput(parsed.data.symbol) ?? undefined
      });
      return res.json({ ok: cancelled.ok, marketType });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/api/orders/cancel-all", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested:
          typeof req.query.marketType === "string"
            ? req.query.marketType
            : typeof req.body?.marketType === "string"
              ? req.body.marketType
              : undefined,
        settings
      });
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : typeof req.body?.exchangeAccountId === "string"
          ? req.body.exchangeAccountId
          : undefined;
      const symbolRaw =
        typeof req.query.symbol === "string"
          ? req.query.symbol
          : typeof req.body?.symbol === "string"
            ? req.body.symbol
            : null;
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const symbol = deps.normalizeSpotSymbol(symbolRaw);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/orders/cancel-all");
        const result = deps.isPaperTradingAccount(resolved.selectedAccount)
          ? await deps.cancelAllPaperSpotOrders(resolved.selectedAccount, spotClient, symbol || undefined)
          : await spotClient.cancelAll(symbol || undefined);
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          marketType,
          ...result
        });
      }
      const symbol = deps.normalizeSymbolInput(symbolRaw);
      ensureManualPerpEligibility(resolved);
      const result = await perpExecutionService.cancelAllOrders({
        resolved,
        symbol: symbol ?? undefined
      });
      return res.json({
        exchangeAccountId: result.exchangeAccountId,
        marketType,
        requested: result.requested,
        cancelled: result.cancelled,
        failed: result.failed
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/api/positions/tpsl", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = positionTpSlSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: parsed.data.marketType,
        settings
      });
      if (marketType === "spot") {
        throw new ManualTradingError(
          "tpsl_not_supported_for_spot_v1",
          400,
          "tpsl_not_supported_for_spot_v1"
        );
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
      return res.json({
        exchangeAccountId: result.exchangeAccountId,
        marketType,
        symbol: result.symbol,
        ok: result.ok
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.post("/api/positions/close", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = closePositionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: parsed.data.marketType,
        settings
      });
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, parsed.data.exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
      } else {
        ensureManualPerpEligibility(resolved);
      }

      const paperMode = deps.isPaperTradingAccount(resolved.selectedAccount);
      const spotClient = marketType === "spot"
        ? createManualSpotClient(resolved.marketDataAccount, "/api/positions/close")
        : null;

      const symbol = marketType === "spot"
        ? deps.normalizeSpotSymbol(parsed.data.symbol)
        : deps.normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }
      if (marketType === "spot" && parsed.data.side === "short") {
        throw new ManualTradingError(
          "spot_close_side_not_supported",
          400,
          "spot_close_side_not_supported"
        );
      }

      const listPerpRowsForSync = async (endpoint: string) => {
        if (paperMode) {
          const perpClient = createManualPerpMarketDataClient(resolved.marketDataAccount, endpoint);
          try {
            return await deps.listPaperPositions(resolved.selectedAccount, perpClient, symbol);
          } finally {
            await perpClient.close();
          }
        }
        const adapter = deps.createPerpExecutionAdapter(resolved.marketDataAccount);
        try {
          return await deps.listPositions(adapter, symbol);
        } finally {
          await adapter.close();
        }
      };

      const preCloseRows =
        marketType === "spot"
          ? paperMode
            ? await deps.listPaperSpotPositions(resolved.selectedAccount, spotClient!, symbol)
            : await listBitgetSpotPositions({
                client: spotClient!,
                symbol,
                preferredQuoteAsset: inferSpotSummaryCurrency(symbol)
              })
          : await listPerpRowsForSync("/api/positions/close/pre");
        const exitPriceBySide = new Map<"long" | "short", number>();
        for (const row of preCloseRows) {
          const normalizedRowSymbol = marketType === "spot"
            ? deps.normalizeSpotSymbol(row.symbol)
            : deps.normalizeSymbolInput(row.symbol);
          if (normalizedRowSymbol !== symbol) continue;
          if (!(Number.isFinite(Number(row.size)) && Number(row.size) > 0)) continue;
          if (parsed.data.side && row.side !== parsed.data.side) continue;
          const markPrice = Number(row.markPrice);
          const entryPrice = Number(row.entryPrice);
          const exitPrice =
            Number.isFinite(markPrice) && markPrice > 0
              ? markPrice
              : Number.isFinite(entryPrice) && entryPrice > 0
                ? entryPrice
                : null;
          if (exitPrice !== null && !exitPriceBySide.has(row.side)) {
            exitPriceBySide.set(row.side, exitPrice);
          }
        }
        const orderIds = await (
          marketType === "spot"
            ? paperMode
              ? await deps.closePaperSpotPosition(resolved.selectedAccount, spotClient!, symbol)
              : (async () => {
                  const liveRows = await listBitgetSpotPositions({
                    client: spotClient!,
                    symbol,
                    preferredQuoteAsset: inferSpotSummaryCurrency(symbol)
                  });
                  const currentQty = Number(liveRows[0]?.size ?? 0);
                  if (!Number.isFinite(currentQty) || currentQty <= 0) return [];
                  const placed = await spotClient!.placeOrder({
                    symbol,
                    side: "sell",
                    type: "market",
                    qty: currentQty
                  });
                  return [placed.orderId];
                })()
            : (await perpExecutionService.closePosition({
                resolved,
                symbol,
                side: parsed.data.side
              })).orderIds
        );
        const stateSync: {
          hasRemainingLivePosition: boolean;
          syncedTradeStates: number;
          closedHistoryRows: number;
          error?: string;
        } = {
          hasRemainingLivePosition: false,
          syncedTradeStates: 0,
          closedHistoryRows: 0
        };
        try {
          const liveRows =
            marketType === "spot"
            ? paperMode
              ? await deps.listPaperSpotPositions(resolved.selectedAccount, spotClient!, symbol)
              : await listBitgetSpotPositions({
                  client: spotClient!,
                  symbol,
                  preferredQuoteAsset: inferSpotSummaryCurrency(symbol)
                })
              : await listPerpRowsForSync("/api/positions/close/post");
          stateSync.hasRemainingLivePosition = liveRows.some((row) => {
            const normalizedRowSymbol = marketType === "spot"
              ? deps.normalizeSpotSymbol(row.symbol)
              : deps.normalizeSymbolInput(row.symbol);
            if (normalizedRowSymbol !== symbol) return false;
            if (!(Number.isFinite(Number(row.size)) && Number(row.size) > 0)) return false;
            if (parsed.data.side && row.side !== parsed.data.side) return false;
            return true;
          });

          if (!stateSync.hasRemainingLivePosition || orderIds.length > 0) {
            const accountIds = Array.from(
              new Set(
                [resolved.selectedAccount.id, parsed.data.exchangeAccountId]
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
              )
            );
            const botRows = await deps.db.bot.findMany({
              where: {
                userId: user.id,
                exchangeAccountId: { in: accountIds }
              },
              select: { id: true, symbol: true }
            });
            const botIds = botRows
              .filter((row: any) => deps.normalizeSymbolInput(row.symbol) === symbol)
              .map((row: any) => String(row.id))
              .filter((id: string) => id.length > 0);

            if (botIds.length > 0) {
              const stateRowsRaw = await deps.ignoreMissingTable(() => deps.db.botTradeState.findMany({
                where: {
                  botId: { in: botIds },
                  ...(parsed.data.side ? { openSide: parsed.data.side } : {}),
                  ...(marketType === "spot" ? { openSide: "long" } : {})
                },
                select: { id: true, symbol: true }
              }));
              const stateRows = Array.isArray(stateRowsRaw) ? stateRowsRaw : [];
              const stateIds = stateRows
                .filter((row: any) => deps.normalizeSymbolInput(row.symbol) === symbol)
                .map((row: any) => String(row.id))
                .filter((id: string) => id.length > 0);
              if (stateIds.length > 0) {
                const clearedState = await deps.ignoreMissingTable(() => deps.db.botTradeState.updateMany({
                  where: {
                    id: { in: stateIds }
                  },
                  data: {
                    openSide: null,
                    openQty: null,
                    openEntryPrice: null,
                    openTs: null,
                    lastTradeTs: new Date()
                  }
                }));
                stateSync.syncedTradeStates = Number((clearedState as any)?.count ?? 0);
              }

              const openHistoryRowsRaw = await deps.ignoreMissingTable(() => deps.db.botTradeHistory.findMany({
                where: {
                  botId: { in: botIds },
                  status: "open",
                  ...(parsed.data.side ? { side: parsed.data.side } : {}),
                  ...(marketType === "spot" ? { side: "long" } : {})
                },
                select: {
                  id: true,
                  symbol: true,
                  side: true,
                  entryPrice: true,
                  entryQty: true,
                  entryNotionalUsd: true
                }
              }));
              const openHistoryRows = Array.isArray(openHistoryRowsRaw) ? openHistoryRowsRaw : [];
              const historyRows = openHistoryRows
                .filter((row: any) => deps.normalizeSymbolInput(row.symbol) === symbol)
                .map((row: any) => ({
                  id: String(row.id),
                  side: String(row.side ?? "").trim().toLowerCase(),
                  entryPrice: Number(row.entryPrice),
                  entryQty: Number(row.entryQty),
                  entryNotionalUsd: Number(row.entryNotionalUsd)
                }))
                .filter((row) => row.id.length > 0);
              if (historyRows.length > 0) {
                const exitTs = new Date();
                const exitOrderId = orderIds.length > 0 ? orderIds[0] : null;
                const updates = historyRows.map((row) => {
                  const closeSide: "long" | "short" | null = row.side === "short"
                    ? "short"
                    : row.side === "long"
                      ? "long"
                      : null;
                  const exitPrice = closeSide ? (exitPriceBySide.get(closeSide) ?? null) : null;
                  const qty = Math.abs(Number(row.entryQty));
                  const entryPrice = Number(row.entryPrice);
                  const entryNotionalUsd = Number(row.entryNotionalUsd);
                  const exitNotionalUsd =
                    exitPrice !== null && Number.isFinite(qty) && qty > 0
                      ? Number((exitPrice * qty).toFixed(8))
                      : null;
                  const realizedPnlUsd =
                    exitPrice !== null &&
                    Number.isFinite(entryPrice) &&
                    entryPrice > 0 &&
                    Number.isFinite(qty) &&
                    qty > 0
                      ? Number((
                          closeSide === "short"
                            ? (entryPrice - exitPrice) * qty
                            : (exitPrice - entryPrice) * qty
                        ).toFixed(4))
                      : null;
                  const realizedPnlPct =
                    realizedPnlUsd !== null &&
                    Number.isFinite(entryNotionalUsd) &&
                    entryNotionalUsd > 0
                      ? Number(((realizedPnlUsd / entryNotionalUsd) * 100).toFixed(6))
                      : null;
                  return deps.db.botTradeHistory.update({
                    where: { id: row.id },
                    data: {
                      status: "closed",
                      outcome: "manual_exit",
                      exitReason: "manual_close",
                      exitTs,
                      exitPrice,
                      exitNotionalUsd,
                      realizedPnlUsd,
                      realizedPnlPct,
                      exitOrderId
                    }
                  });
                });
                await deps.ignoreMissingTable(() => deps.db.$transaction(updates));
                stateSync.closedHistoryRows = updates.length;
              }
            }
          }
        } catch (error) {
          stateSync.error = error instanceof Error ? error.message : String(error);
        }
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          marketType,
          closedCount: orderIds.length,
          orderIds,
          stateSync
        });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });
}
