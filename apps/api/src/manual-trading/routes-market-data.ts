import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { createPerpReadService } from "../execution/perp-read-service.js";
import {
  createManualPerpMarketDataClient,
  createManualSpotClient,
  ensureManualPerpEligibility,
  ensureManualSpotEligibility,
  getHyperliquidAccountSetupHint,
  inferSpotSummaryCurrency,
  listBitgetSpotPositions,
  resolveManualMarketType
} from "./support.js";
import type { PerpMarketDataClient } from "../perp/perp-market-data.client.js";
import type { SpotClient } from "../spot/spot-client-factory.js";
import type {
  NormalizedOrder,
  NormalizedPosition,
  PerpExecutionAdapter,
  TradingAccount,
  TradingSettings
} from "../trading.js";
import { ManualTradingError } from "../trading.js";

function normalizeAddress(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(normalized) ? normalized : null;
}

function buildHyperliquidAccountContext(account: Pick<TradingAccount, "exchange" | "apiKey" | "passphrase">) {
  if (String(account.exchange ?? "").trim().toLowerCase() !== "hyperliquid") {
    return {
      hyperliquidSigningAddress: null,
      hyperliquidReadAddress: null,
      hyperliquidReadAddressSource: null
    };
  }
  const signingAddress = normalizeAddress(account.apiKey);
  const explicitReadAddress = normalizeAddress(account.passphrase);
  return {
    hyperliquidSigningAddress: signingAddress,
    hyperliquidReadAddress: explicitReadAddress ?? signingAddress,
    hyperliquidReadAddressSource: explicitReadAddress ? "account_or_vault" : signingAddress ? "wallet" : null
  };
}

type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";

type MarketCandlesQuery = {
  exchangeAccountId?: string;
  marketType?: "spot" | "perp";
  symbol: string;
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  limit: number;
};

type ResolvedTradingAccountPair = {
  selectedAccount: TradingAccount;
  marketDataAccount: TradingAccount;
};

type CandleBar = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

const manualMarketTypeSchema = z.enum(["spot", "perp"]);

const marketCandlesQuerySchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  marketType: manualMarketTypeSchema.optional(),
  symbol: z.string().trim().min(1),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("15m"),
  limit: z.coerce.number().int().min(20).max(1000).default(400)
});

export type RegisterManualTradingMarketDataRoutesDeps = {
  getTradingSettings(userId: string): Promise<TradingSettings>;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId?: string): Promise<ResolvedTradingAccountPair>;
  sendManualTradingError(res: express.Response, error: unknown): express.Response;
  normalizeSpotSymbol(value: string | null | undefined): string;
  normalizeSymbolInput(value: string | null | undefined): string | null;
  marketTimeframeToBitgetSpotGranularity(
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d"
  ): string;
  marketTimeframeToBitgetGranularity(timeframe: "1m" | PredictionTimeframe): string;
  parseBitgetCandles(value: unknown): CandleBar[];
  createPerpExecutionAdapter(account: TradingAccount): PerpExecutionAdapter;
  isPaperTradingAccount(account: TradingAccount): boolean;
  getPaperAccountState(account: TradingAccount, reader: PerpMarketDataClient): Promise<{
    equity?: number | null;
    availableMargin?: number | null;
    marginMode?: string | null;
  }>;
  getPaperSpotAccountState(account: TradingAccount, client: SpotClient): Promise<{
    equity?: number | null;
    availableMargin?: number | null;
    marginMode?: string | null;
  }>;
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
  listPaperOpenOrders(
    account: TradingAccount,
    reader: PerpMarketDataClient,
    symbol?: string
  ): Promise<NormalizedOrder[]>;
  listPaperSpotOpenOrders(
    account: TradingAccount,
    client: SpotClient,
    symbol?: string
  ): Promise<NormalizedOrder[]>;
  listPositions(adapter: PerpExecutionAdapter, symbol?: string): Promise<NormalizedPosition[]>;
  listOpenOrders(adapter: PerpExecutionAdapter, symbol?: string): Promise<NormalizedOrder[]>;
  loadGridDeskVisibilityMask(
    userId: string,
    exchangeAccountIds: string[]
  ): Promise<unknown>;
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
  countVisibleDeskPositions<T extends { symbol?: string | null }>(
    rows: T[],
    mask: unknown,
    exchangeAccountId: string
  ): number;
  splitCanonicalSymbol(symbol: string): { baseAsset: string | null; quoteAsset: string | null };
};

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function registerManualTradingMarketDataRoutes(
  app: express.Express,
  deps: RegisterManualTradingMarketDataRoutesDeps
) {
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

  app.get("/api/symbols", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: typeof req.query.marketType === "string" ? req.query.marketType : undefined,
        settings
      });
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : undefined;
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/symbols");
        const items = await spotClient.listSymbols();
        const defaultSymbol =
          items.find((item) => item.tradable)?.symbol ??
          items[0]?.symbol ??
          null;
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          exchange: resolved.selectedAccount.exchange,
          marketDataExchange: resolved.marketDataAccount.exchange,
          marketType,
          items,
          defaultSymbol
        });
      }
      ensureManualPerpEligibility(resolved);
      const perpClient = createManualPerpMarketDataClient(resolved.marketDataAccount, "/api/symbols");
      try {
        const items = await perpClient.listSymbols();
        const defaultSymbol =
          items.find((item) => item.tradable)?.symbol ??
          items[0]?.symbol ??
          null;
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          exchange: resolved.selectedAccount.exchange,
          marketDataExchange: resolved.marketDataAccount.exchange,
          marketType,
          items,
          defaultSymbol
        });
      } finally {
        await perpClient.close();
      }
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/api/market/candles", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = marketCandlesQuerySchema.safeParse(req.query ?? {}) as
      | { success: true; data: MarketCandlesQuery }
      | { success: false; error: z.ZodError };
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
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
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/market/candles");
        const granularity = deps.marketTimeframeToBitgetSpotGranularity(parsed.data.timeframe);
        const raw = await spotClient.getCandles({
          symbol,
          timeframe: parsed.data.timeframe,
          limit: parsed.data.limit
        });
        const items = deps.parseBitgetCandles(raw);
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          exchange: resolved.selectedAccount.exchange,
          marketDataExchange: resolved.marketDataAccount.exchange,
          marketType,
          symbol,
          timeframe: parsed.data.timeframe,
          granularity,
          items
        });
      }
      ensureManualPerpEligibility(resolved);
      const perpClient = createManualPerpMarketDataClient(
        resolved.marketDataAccount,
        "/api/market/candles"
      );
      try {
        const symbol = deps.normalizeSymbolInput(parsed.data.symbol);
        if (!symbol) {
          return res.status(400).json({ error: "symbol_required" });
        }
        const granularity = deps.marketTimeframeToBitgetGranularity(
          parsed.data.timeframe as "1m" | PredictionTimeframe
        );
        const raw = await perpClient.getCandles({
          symbol,
          timeframe: parsed.data.timeframe,
          granularity,
          limit: parsed.data.limit
        });

        const items = deps.parseBitgetCandles(raw);

        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          exchange: resolved.selectedAccount.exchange,
          marketDataExchange: resolved.marketDataAccount.exchange,
          marketType,
          symbol,
          timeframe: parsed.data.timeframe,
          granularity,
          items
        });
      } finally {
        await perpClient.close();
      }
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/api/account/summary", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: typeof req.query.marketType === "string" ? req.query.marketType : undefined,
        settings
      });
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : undefined;
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/account/summary");
        const preferredSymbol = deps.normalizeSpotSymbol(
          typeof req.query.symbol === "string" ? req.query.symbol : settings.symbol
        );
        const preferredPair = preferredSymbol ? deps.splitCanonicalSymbol(preferredSymbol) : null;
        const summaryCurrency = preferredPair?.quoteAsset ?? "USDT";
        const preferredBaseAsset = preferredPair?.baseAsset ?? null;

        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          const [summary, positions] = await Promise.all([
            deps.getPaperSpotAccountState(resolved.selectedAccount, spotClient),
            deps.listPaperSpotPositions(resolved.selectedAccount, spotClient)
          ]);
          const basePosition = preferredSymbol
            ? positions.find((row) => row.symbol === preferredSymbol)
            : null;
          const baseAvailable =
            basePosition && Number.isFinite(basePosition.size)
              ? Number(basePosition.size)
              : null;

          return res.json({
            exchangeAccountId: resolved.selectedAccount.id,
            exchange: resolved.selectedAccount.exchange,
            marketDataExchange: resolved.marketDataAccount.exchange,
            marketType,
            equity: summary.equity ?? null,
            availableMargin: summary.availableMargin ?? null,
            spotQuoteAsset: summaryCurrency,
            spotQuoteAvailable: summary.availableMargin ?? null,
            spotBaseAsset: preferredBaseAsset,
            spotBaseAvailable: baseAvailable,
            spotBaseTotal: baseAvailable,
            marginMode: summary.marginMode ?? null,
            positionsCount: positions.length,
            updatedAt: new Date().toISOString(),
            ...buildHyperliquidAccountContext(resolved.marketDataAccount)
          });
        }

        const [summary, balances] = await Promise.all([
          spotClient.getSummary(summaryCurrency),
          spotClient.getBalances()
        ]);
        const hyperliquidHint =
          balances.length === 0
            ? await getHyperliquidAccountSetupHint(resolved.selectedAccount)
            : null;
        if (hyperliquidHint?.requiresAccountAddress) {
          throw new ManualTradingError(
            "hyperliquid_agent_account_address_required",
            400,
            "hyperliquid_agent_account_address_required"
          );
        }
        const baseBalance = preferredBaseAsset
          ? balances.find((row) => String(row.coin ?? row.asset ?? "").trim().toUpperCase() === preferredBaseAsset)
          : null;
        const baseAvailable = baseBalance ? toFiniteNumber(baseBalance.available) : null;
        const baseFrozen = baseBalance ? toFiniteNumber(baseBalance.frozen ?? baseBalance.locked ?? baseBalance.lock) : null;
        const baseTotal =
          baseAvailable === null && baseFrozen === null
            ? null
            : Number(((baseAvailable ?? 0) + (baseFrozen ?? 0)).toFixed(8));
        const positionsCount = balances.filter((row) => {
          const asset = String(row.coin ?? row.asset ?? "").trim().toUpperCase();
          if (!asset || asset === summary.currency) return false;
          const available = Number(row.available ?? 0);
          const frozen = Number(row.frozen ?? row.locked ?? row.lock ?? 0);
          return Number.isFinite(available + frozen) && available + frozen > 0;
        }).length;

        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          exchange: resolved.selectedAccount.exchange,
          marketDataExchange: resolved.marketDataAccount.exchange,
          marketType,
          equity: summary.equity,
          availableMargin: summary.available,
          spotQuoteAsset: summary.currency ?? summaryCurrency,
          spotQuoteAvailable: summary.available ?? null,
          spotBaseAsset: preferredBaseAsset,
          spotBaseAvailable: baseAvailable,
          spotBaseTotal: baseTotal,
          marginMode: null,
          positionsCount,
          updatedAt: new Date().toISOString(),
          ...buildHyperliquidAccountContext(resolved.marketDataAccount)
        });
      }
      ensureManualPerpEligibility(resolved);
      const visibilityMask = await deps.loadGridDeskVisibilityMask(user.id, [
        String(resolved.selectedAccount.id)
      ]);
      const snapshot = await perpReadService.getAccountSnapshot({
        resolved,
        endpoint: "/api/account/summary"
      });
      const hyperliquidHint =
        Number(snapshot.accountState.equity ?? 0) <= 0
        && Number(snapshot.accountState.availableMargin ?? 0) <= 0
        && snapshot.positions.length === 0
          ? await getHyperliquidAccountSetupHint(resolved.selectedAccount)
          : null;
      if (hyperliquidHint?.requiresAccountAddress) {
        throw new ManualTradingError(
          "hyperliquid_agent_account_address_required",
          400,
          "hyperliquid_agent_account_address_required"
        );
      }
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        exchange: resolved.selectedAccount.exchange,
        marketDataExchange: snapshot.marketDataExchange,
        marketType,
        equity: snapshot.accountState.equity ?? null,
        availableMargin: snapshot.accountState.availableMargin ?? null,
        marginMode: snapshot.accountState.marginMode ?? null,
        positionsCount: deps.countVisibleDeskPositions(
          snapshot.positions,
          visibilityMask,
          resolved.selectedAccount.id
        ),
        updatedAt: new Date().toISOString(),
        ...buildHyperliquidAccountContext(resolved.marketDataAccount)
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/api/positions", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: typeof req.query.marketType === "string" ? req.query.marketType : undefined,
        settings
      });
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : undefined;
      const perpSymbol = deps.normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);
      const spotSymbol = deps.normalizeSpotSymbol(typeof req.query.symbol === "string" ? req.query.symbol : null);

      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/positions");
        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          const items = await deps.listPaperSpotPositions(
            resolved.selectedAccount,
            spotClient,
            spotSymbol || undefined
          );
          return res.json({
            exchangeAccountId: resolved.selectedAccount.id,
            marketType,
            items
          });
        }
        const filtered = await listBitgetSpotPositions({
          client: spotClient,
          symbol: spotSymbol || undefined,
          preferredQuoteAsset: spotSymbol ? inferSpotSummaryCurrency(spotSymbol) : "USDT"
        });
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          marketType,
          items: filtered
        });
      }
      ensureManualPerpEligibility(resolved);
      const visibilityMask = await deps.loadGridDeskVisibilityMask(user.id, [
        String(resolved.selectedAccount.id)
      ]);
      const result = await perpReadService.listPositions({
        resolved,
        symbol: perpSymbol ?? undefined,
        endpoint: "/api/positions"
      });
      return res.json({
        exchangeAccountId: result.exchangeAccountId,
        marketType,
        items: deps.filterGridBotPositionsForDesk(
          result.items,
          visibilityMask,
          resolved.selectedAccount.id
        )
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/api/orders/open", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: typeof req.query.marketType === "string" ? req.query.marketType : undefined,
        settings
      });
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : undefined;
      const perpSymbol = deps.normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);
      const spotSymbol = deps.normalizeSpotSymbol(typeof req.query.symbol === "string" ? req.query.symbol : null);

      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/orders/open");
        const items = deps.isPaperTradingAccount(resolved.selectedAccount)
          ? await deps.listPaperSpotOpenOrders(resolved.selectedAccount, spotClient, spotSymbol || undefined)
          : await spotClient.getOpenOrders(spotSymbol || undefined);
        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          marketType,
          items
        });
      }
      ensureManualPerpEligibility(resolved);
      const visibilityMask = await deps.loadGridDeskVisibilityMask(user.id, [
        String(resolved.selectedAccount.id)
      ]);
      const result = await perpReadService.listOpenOrders({
        resolved,
        symbol: perpSymbol ?? undefined,
        endpoint: "/api/orders/open"
      });
      return res.json({
        exchangeAccountId: result.exchangeAccountId,
        marketType,
        items: deps.filterGridBotOrdersForDesk(
          result.items,
          visibilityMask,
          resolved.selectedAccount.id
        )
      });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });
}
