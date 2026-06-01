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
import { selectSpotSummary } from "../spot/bitget-spot.mapper.js";
import { buildManualTradingErrorResponse } from "../manual-trading-error.js";
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

function shouldUseTransientHyperliquidDeskFallback(
  error: unknown,
  resolved: Pick<ResolvedTradingAccountPair, "selectedAccount" | "marketDataAccount">
): boolean {
  const selectedExchange = String(resolved.selectedAccount.exchange ?? "").trim().toLowerCase();
  const marketDataExchange = String(resolved.marketDataAccount.exchange ?? "").trim().toLowerCase();
  if (selectedExchange !== "hyperliquid" && marketDataExchange !== "hyperliquid") {
    return false;
  }

  const result = buildManualTradingErrorResponse(error);
  const code = String(result.payload.code ?? "").trim().toUpperCase();
  const message = String(result.payload.message ?? "").trim().toLowerCase();
  const retryable = result.payload.retryable === true;

  return retryable
    || code === "EX_UNKNOWN"
    || message.includes("429")
    || message.includes("rate_limited")
    || message.includes("hyperliquid_info_failed")
    || message.includes("unknown error occurred")
    || message.includes("hyperliquidapierror");
}

function logTransientHyperliquidDeskFallback(endpoint: string, error: unknown): void {
  const result = buildManualTradingErrorResponse(error);
  const code = String(result.payload.code ?? "").trim() || "unknown";
  const message = String(result.payload.message ?? "").trim() || "unknown";
  // eslint-disable-next-line no-console
  console.warn("[manual-trading] transient_hyperliquid_desk_fallback", {
    endpoint,
    status: result.status,
    code,
    message
  });
}

function sendMarketDataDegraded(res: express.Response, params: {
  exchangeAccountId: string;
  marketType: "spot" | "perp";
}) {
  return res.status(503).json({
    error: "market_data_degraded",
    code: "market_data_degraded",
    degraded: true,
    retryable: true,
    exchangeAccountId: params.exchangeAccountId,
    marketType: params.marketType
  });
}

function readErrorMessage(error: unknown): string | null {
  if (!error) return null;
  const result = buildManualTradingErrorResponse(error);
  return String(
    result.payload.message ??
    result.payload.code ??
    result.payload.error ??
    "read_failed"
  );
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

const manualCandleCache = new Map<string, {
  expiresAt: number;
  limit: number;
  promise: Promise<CandleBar[]>;
}>();

function manualCandleCacheTtlMs(timeframe: MarketCandlesQuery["timeframe"]): number {
  if (timeframe === "1m") return 5_000;
  if (timeframe === "5m") return 8_000;
  return 15_000;
}

function pruneManualCandleCache(now = Date.now()): void {
  for (const [key, entry] of manualCandleCache) {
    if (entry.expiresAt <= now) {
      manualCandleCache.delete(key);
    }
  }

  while (manualCandleCache.size > 250) {
    const oldestKey = manualCandleCache.keys().next().value;
    if (!oldestKey) break;
    manualCandleCache.delete(oldestKey);
  }
}

function limitCandleBars(items: CandleBar[], limit: number): CandleBar[] {
  return items.length > limit ? items.slice(-limit) : items;
}

async function readCachedManualCandles(params: {
  cacheKey: string;
  timeframe: MarketCandlesQuery["timeframe"];
  limit: number;
  fetch: () => Promise<CandleBar[]>;
}): Promise<CandleBar[]> {
  const now = Date.now();
  const cached = manualCandleCache.get(params.cacheKey);
  if (cached && cached.expiresAt > now && cached.limit >= params.limit) {
    return cached.promise.then((items) => limitCandleBars(items, params.limit));
  }

  pruneManualCandleCache(now);
  const promise = params.fetch()
    .then((items) => limitCandleBars(items, params.limit))
    .catch((error) => {
      const current = manualCandleCache.get(params.cacheKey);
      if (current?.promise === promise) {
        manualCandleCache.delete(params.cacheKey);
      }
      throw error;
    });
  manualCandleCache.set(params.cacheKey, {
    expiresAt: now + manualCandleCacheTtlMs(params.timeframe),
    limit: params.limit,
    promise
  });
  return promise;
}

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

async function ensureHyperliquidReadAddressConfigured(
  account: TradingAccount
): Promise<void> {
  const hint = await getHyperliquidAccountSetupHint(account);
  if (hint?.requiresAccountAddress) {
    throw new ManualTradingError(
      "hyperliquid_agent_account_address_required",
      400,
      "hyperliquid_agent_account_address_required"
    );
  }
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
        await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
        const symbol = deps.normalizeSpotSymbol(parsed.data.symbol);
        if (!symbol) {
          return res.status(400).json({ error: "symbol_required" });
        }
        const granularity = deps.marketTimeframeToBitgetSpotGranularity(parsed.data.timeframe);
        const cacheKey = [
          user.id,
          resolved.selectedAccount.id,
          resolved.marketDataAccount.id,
          marketType,
          symbol,
          parsed.data.timeframe
        ].join("::");
        const items = await readCachedManualCandles({
          cacheKey,
          timeframe: parsed.data.timeframe,
          limit: parsed.data.limit,
          fetch: async () => {
            const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/market/candles");
            const raw = await spotClient.getCandles({
              symbol,
              timeframe: parsed.data.timeframe,
              limit: parsed.data.limit
            });
            return deps.parseBitgetCandles(raw);
          }
        });
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
      await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
      const symbol = deps.normalizeSymbolInput(parsed.data.symbol);
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }
      const granularity = deps.marketTimeframeToBitgetGranularity(
        parsed.data.timeframe as "1m" | PredictionTimeframe
      );
      const cacheKey = [
        user.id,
        resolved.selectedAccount.id,
        resolved.marketDataAccount.id,
        marketType,
        symbol,
        parsed.data.timeframe
      ].join("::");
      const items = await readCachedManualCandles({
        cacheKey,
        timeframe: parsed.data.timeframe,
        limit: parsed.data.limit,
        fetch: async () => {
          const perpClient = createManualPerpMarketDataClient(
            resolved.marketDataAccount,
            "/api/market/candles"
          );
          try {
            const raw = await perpClient.getCandles({
              symbol,
              timeframe: parsed.data.timeframe,
              granularity,
              limit: parsed.data.limit
            });
            return deps.parseBitgetCandles(raw);
          } finally {
            await perpClient.close();
          }
        }
      });

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
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/api/account/summary", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    let resolvedForFallback: ResolvedTradingAccountPair | null = null;
    let marketTypeForFallback: "spot" | "perp" | null = null;
    let settingsForFallback: TradingSettings | null = null;
    try {
      const settings = await deps.getTradingSettings(user.id);
      settingsForFallback = settings;
      const marketType = resolveManualMarketType({
        requested: typeof req.query.marketType === "string" ? req.query.marketType : undefined,
        settings
      });
      marketTypeForFallback = marketType;
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : undefined;
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      resolvedForFallback = resolved;
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/account/summary");
        const preferredSymbol = deps.normalizeSpotSymbol(
          typeof req.query.symbol === "string" ? req.query.symbol : settings.symbol
        );
        const preferredPair = preferredSymbol ? deps.splitCanonicalSymbol(preferredSymbol) : null;
        const summaryCurrency =
          preferredPair?.quoteAsset ??
          (String(resolved.marketDataAccount.exchange ?? "").trim().toLowerCase() === "hyperliquid"
            ? "USDC"
            : "USDT");
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

        const balances = await spotClient.getBalances();
        const summary = selectSpotSummary(
          balances.map((row) => ({
            coin: String(row.coin ?? row.asset ?? "").toUpperCase(),
            available: String(row.available ?? "0"),
            frozen: String(row.frozen ?? row.locked ?? row.lock ?? "0")
          })),
          summaryCurrency
        );
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
      await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
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
      if (
        resolvedForFallback &&
        marketTypeForFallback &&
        settingsForFallback &&
        shouldUseTransientHyperliquidDeskFallback(error, resolvedForFallback)
      ) {
        logTransientHyperliquidDeskFallback("/api/account/summary", error);
        if (marketTypeForFallback === "spot") {
          const preferredSymbol = deps.normalizeSpotSymbol(
            typeof req.query.symbol === "string" ? req.query.symbol : settingsForFallback.symbol
          );
          const preferredPair = preferredSymbol ? deps.splitCanonicalSymbol(preferredSymbol) : null;
          const summaryCurrency =
            preferredPair?.quoteAsset ??
            (String(resolvedForFallback.marketDataAccount.exchange ?? "").trim().toLowerCase() === "hyperliquid"
              ? "USDC"
              : "USDT");
          const preferredBaseAsset = preferredPair?.baseAsset ?? null;
          return res.json({
            exchangeAccountId: resolvedForFallback.selectedAccount.id,
            exchange: resolvedForFallback.selectedAccount.exchange,
            marketDataExchange: resolvedForFallback.marketDataAccount.exchange,
            marketType: marketTypeForFallback,
            equity: null,
            availableMargin: null,
            spotQuoteAsset: summaryCurrency,
            spotQuoteAvailable: null,
            spotBaseAsset: preferredBaseAsset,
            spotBaseAvailable: null,
            spotBaseTotal: null,
            marginMode: null,
            positionsCount: 0,
            updatedAt: new Date().toISOString(),
            degraded: true,
            ...buildHyperliquidAccountContext(resolvedForFallback.marketDataAccount)
          });
        }
        return res.json({
          exchangeAccountId: resolvedForFallback.selectedAccount.id,
          exchange: resolvedForFallback.selectedAccount.exchange,
          marketDataExchange: resolvedForFallback.marketDataAccount.exchange,
          marketType: marketTypeForFallback,
          equity: null,
          availableMargin: null,
          marginMode: null,
          positionsCount: 0,
          updatedAt: new Date().toISOString(),
          degraded: true,
          ...buildHyperliquidAccountContext(resolvedForFallback.marketDataAccount)
        });
      }
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/api/trading/live-state", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    let resolvedForFallback: ResolvedTradingAccountPair | null = null;
    let marketTypeForFallback: "spot" | "perp" | null = null;
    let settingsForFallback: TradingSettings | null = null;
    try {
      const settings = await deps.getTradingSettings(user.id);
      settingsForFallback = settings;
      const marketType = resolveManualMarketType({
        requested: typeof req.query.marketType === "string" ? req.query.marketType : undefined,
        settings
      });
      marketTypeForFallback = marketType;
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : undefined;
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      resolvedForFallback = resolved;

      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
        const symbol = deps.normalizeSpotSymbol(
          typeof req.query.symbol === "string" ? req.query.symbol : settings.symbol
        );
        if (!symbol) {
          return res.status(400).json({ error: "symbol_required" });
        }

        const spotClient = createManualSpotClient(resolved.marketDataAccount, "/api/trading/live-state");
        const preferredPair = deps.splitCanonicalSymbol(symbol);
        const summaryCurrency =
          preferredPair.quoteAsset ??
          (String(resolved.marketDataAccount.exchange ?? "").trim().toLowerCase() === "hyperliquid"
            ? "USDC"
            : "USDT");
        const preferredBaseAsset = preferredPair.baseAsset ?? null;

        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          const [summaryResult, positionsResult, openOrdersResult] = await Promise.allSettled([
            deps.getPaperSpotAccountState(resolved.selectedAccount, spotClient),
            deps.listPaperSpotPositions(resolved.selectedAccount, spotClient, symbol),
            deps.listPaperSpotOpenOrders(resolved.selectedAccount, spotClient, symbol)
          ]);
          if (
            summaryResult.status === "rejected" &&
            positionsResult.status === "rejected" &&
            openOrdersResult.status === "rejected"
          ) {
            throw summaryResult.reason;
          }
          const accountState = summaryResult.status === "fulfilled" ? summaryResult.value : null;
          const positions = positionsResult.status === "fulfilled" ? positionsResult.value : [];
          const openOrders = openOrdersResult.status === "fulfilled" ? openOrdersResult.value : [];
          const basePosition = positions.find((row) => row.symbol === symbol) ?? null;
          const baseAvailable =
            basePosition && Number.isFinite(basePosition.size)
              ? Number(basePosition.size)
              : null;
          const summaryError = summaryResult.status === "rejected" ? summaryResult.reason : null;
          const positionsError = positionsResult.status === "rejected" ? positionsResult.reason : null;
          const openOrdersError = openOrdersResult.status === "rejected" ? openOrdersResult.reason : null;
          const degraded = Boolean(summaryError || positionsError || openOrdersError);

          return res.json({
            exchangeAccountId: resolved.selectedAccount.id,
            exchange: resolved.selectedAccount.exchange,
            marketDataExchange: resolved.marketDataAccount.exchange,
            marketType,
            symbol,
            fetchedAt: new Date().toISOString(),
            degraded,
            summary: {
              exchangeAccountId: resolved.selectedAccount.id,
              exchange: resolved.selectedAccount.exchange,
              marketDataExchange: resolved.marketDataAccount.exchange,
              marketType,
              equity: accountState?.equity ?? null,
              availableMargin: accountState?.availableMargin ?? null,
              spotQuoteAsset: summaryCurrency,
              spotQuoteAvailable: accountState?.availableMargin ?? null,
              spotBaseAsset: preferredBaseAsset,
              spotBaseAvailable: baseAvailable,
              spotBaseTotal: baseAvailable,
              marginMode: accountState?.marginMode ?? null,
              positionsCount: positions.length,
              updatedAt: new Date().toISOString(),
              degraded: Boolean(summaryError),
              error: readErrorMessage(summaryError),
              ...buildHyperliquidAccountContext(resolved.marketDataAccount)
            },
            positions: {
              items: positions,
              degraded: Boolean(positionsError),
              error: readErrorMessage(positionsError)
            },
            openOrders: {
              items: openOrders,
              degraded: Boolean(openOrdersError),
              error: readErrorMessage(openOrdersError)
            }
          });
        }

        const [balancesResult, positionsResult, openOrdersResult] = await Promise.allSettled([
          spotClient.getBalances(),
          listBitgetSpotPositions({
            client: spotClient,
            symbol,
            preferredQuoteAsset: summaryCurrency
          }),
          spotClient.getOpenOrders(symbol)
        ]);
        if (
          balancesResult.status === "rejected" &&
          positionsResult.status === "rejected" &&
          openOrdersResult.status === "rejected"
        ) {
          throw balancesResult.reason;
        }

        const balances = balancesResult.status === "fulfilled" ? balancesResult.value : [];
        const positions = positionsResult.status === "fulfilled" ? positionsResult.value : [];
        const openOrders = openOrdersResult.status === "fulfilled" ? openOrdersResult.value : [];
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
        const summary = selectSpotSummary(
          balances.map((row) => ({
            coin: String(row.coin ?? row.asset ?? "").toUpperCase(),
            available: String(row.available ?? "0"),
            frozen: String(row.frozen ?? row.locked ?? row.lock ?? "0")
          })),
          summaryCurrency
        );
        const baseBalance = preferredBaseAsset
          ? balances.find((row) => String(row.coin ?? row.asset ?? "").trim().toUpperCase() === preferredBaseAsset)
          : null;
        const baseAvailable = baseBalance ? toFiniteNumber(baseBalance.available) : null;
        const baseFrozen = baseBalance ? toFiniteNumber(baseBalance.frozen ?? baseBalance.locked ?? baseBalance.lock) : null;
        const baseTotal =
          baseAvailable === null && baseFrozen === null
            ? null
            : Number(((baseAvailable ?? 0) + (baseFrozen ?? 0)).toFixed(8));
        const balancesError = balancesResult.status === "rejected" ? balancesResult.reason : null;
        const positionsError = positionsResult.status === "rejected" ? positionsResult.reason : null;
        const openOrdersError = openOrdersResult.status === "rejected" ? openOrdersResult.reason : null;
        const degraded = Boolean(balancesError || positionsError || openOrdersError);

        return res.json({
          exchangeAccountId: resolved.selectedAccount.id,
          exchange: resolved.selectedAccount.exchange,
          marketDataExchange: resolved.marketDataAccount.exchange,
          marketType,
          symbol,
          fetchedAt: new Date().toISOString(),
          degraded,
          summary: {
            exchangeAccountId: resolved.selectedAccount.id,
            exchange: resolved.selectedAccount.exchange,
            marketDataExchange: resolved.marketDataAccount.exchange,
            marketType,
            equity: balancesError ? null : summary.equity,
            availableMargin: balancesError ? null : summary.available,
            spotQuoteAsset: summary.currency ?? summaryCurrency,
            spotQuoteAvailable: balancesError ? null : summary.available,
            spotBaseAsset: preferredBaseAsset,
            spotBaseAvailable: baseAvailable,
            spotBaseTotal: baseTotal,
            marginMode: null,
            positionsCount: positions.length,
            updatedAt: new Date().toISOString(),
            degraded: Boolean(balancesError),
            error: readErrorMessage(balancesError),
            ...buildHyperliquidAccountContext(resolved.marketDataAccount)
          },
          positions: {
            items: positions,
            degraded: Boolean(positionsError),
            error: readErrorMessage(positionsError)
          },
          openOrders: {
            items: openOrders,
            degraded: Boolean(openOrdersError),
            error: readErrorMessage(openOrdersError)
          }
        });
      }

      ensureManualPerpEligibility(resolved);
      await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
      const symbol = deps.normalizeSymbolInput(
        typeof req.query.symbol === "string" ? req.query.symbol : settings.symbol
      );
      if (!symbol) {
        return res.status(400).json({ error: "symbol_required" });
      }

      const [visibilityMask, state] = await Promise.all([
        deps.loadGridDeskVisibilityMask(user.id, [String(resolved.selectedAccount.id)]),
        perpReadService.getTradingState({
          resolved,
          openOrdersSymbol: symbol,
          endpoint: "/api/trading/live-state"
        })
      ]);
      const accountError = state.errors.accountState;
      const positionsError = state.errors.positions;
      const openOrdersError = state.errors.openOrders;
      if (accountError && positionsError && openOrdersError) {
        throw accountError;
      }

      const visiblePositions = deps.filterGridBotPositionsForDesk(
        state.positions,
        visibilityMask,
        resolved.selectedAccount.id
      );
      const visibleOrders = deps.filterGridBotOrdersForDesk(
        state.openOrders,
        visibilityMask,
        resolved.selectedAccount.id
      );
      const hyperliquidHint =
        Number(state.accountState?.equity ?? 0) <= 0
        && Number(state.accountState?.availableMargin ?? 0) <= 0
        && visiblePositions.length === 0
          ? await getHyperliquidAccountSetupHint(resolved.selectedAccount)
          : null;
      if (hyperliquidHint?.requiresAccountAddress) {
        throw new ManualTradingError(
          "hyperliquid_agent_account_address_required",
          400,
          "hyperliquid_agent_account_address_required"
        );
      }

      const degraded = Boolean(accountError || positionsError || openOrdersError);
      return res.json({
        exchangeAccountId: resolved.selectedAccount.id,
        exchange: resolved.selectedAccount.exchange,
        marketDataExchange: state.marketDataExchange,
        marketType,
        symbol,
        fetchedAt: new Date().toISOString(),
        degraded,
        summary: {
          exchangeAccountId: resolved.selectedAccount.id,
          exchange: resolved.selectedAccount.exchange,
          marketDataExchange: state.marketDataExchange,
          marketType,
          equity: state.accountState?.equity ?? null,
          availableMargin: state.accountState?.availableMargin ?? null,
          marginMode: state.accountState?.marginMode ?? null,
          positionsCount: positionsError
            ? visiblePositions.length
            : deps.countVisibleDeskPositions(
                state.positions,
                visibilityMask,
                resolved.selectedAccount.id
              ),
          updatedAt: new Date().toISOString(),
          degraded: Boolean(accountError || positionsError),
          error: readErrorMessage(accountError ?? positionsError),
          ...buildHyperliquidAccountContext(resolved.marketDataAccount)
        },
        positions: {
          items: visiblePositions,
          degraded: Boolean(positionsError),
          error: readErrorMessage(positionsError)
        },
        openOrders: {
          items: visibleOrders,
          degraded: Boolean(openOrdersError),
          error: readErrorMessage(openOrdersError)
        }
      });
    } catch (error) {
      if (
        resolvedForFallback &&
        marketTypeForFallback &&
        settingsForFallback &&
        shouldUseTransientHyperliquidDeskFallback(error, resolvedForFallback)
      ) {
        logTransientHyperliquidDeskFallback("/api/trading/live-state", error);
        const symbol = marketTypeForFallback === "spot"
          ? deps.normalizeSpotSymbol(
              typeof req.query.symbol === "string" ? req.query.symbol : settingsForFallback.symbol
            )
          : deps.normalizeSymbolInput(
              typeof req.query.symbol === "string" ? req.query.symbol : settingsForFallback.symbol
            );
        const preferredPair = marketTypeForFallback === "spot" && symbol
          ? deps.splitCanonicalSymbol(symbol)
          : null;
        const summaryCurrency =
          preferredPair?.quoteAsset ??
          (String(resolvedForFallback.marketDataAccount.exchange ?? "").trim().toLowerCase() === "hyperliquid"
            ? "USDC"
            : "USDT");

        return res.json({
          exchangeAccountId: resolvedForFallback.selectedAccount.id,
          exchange: resolvedForFallback.selectedAccount.exchange,
          marketDataExchange: resolvedForFallback.marketDataAccount.exchange,
          marketType: marketTypeForFallback,
          symbol,
          fetchedAt: new Date().toISOString(),
          degraded: true,
          summary: {
            exchangeAccountId: resolvedForFallback.selectedAccount.id,
            exchange: resolvedForFallback.selectedAccount.exchange,
            marketDataExchange: resolvedForFallback.marketDataAccount.exchange,
            marketType: marketTypeForFallback,
            equity: null,
            availableMargin: null,
            spotQuoteAsset: marketTypeForFallback === "spot" ? summaryCurrency : undefined,
            spotQuoteAvailable: marketTypeForFallback === "spot" ? null : undefined,
            spotBaseAsset: preferredPair?.baseAsset ?? undefined,
            spotBaseAvailable: marketTypeForFallback === "spot" ? null : undefined,
            spotBaseTotal: marketTypeForFallback === "spot" ? null : undefined,
            marginMode: null,
            positionsCount: 0,
            updatedAt: new Date().toISOString(),
            degraded: true,
            error: readErrorMessage(error),
            ...buildHyperliquidAccountContext(resolvedForFallback.marketDataAccount)
          },
          positions: {
            items: [],
            degraded: true,
            error: readErrorMessage(error)
          },
          openOrders: {
            items: [],
            degraded: true,
            error: readErrorMessage(error)
          }
        });
      }
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/api/positions", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    let resolvedForFallback: ResolvedTradingAccountPair | null = null;
    let marketTypeForFallback: "spot" | "perp" | null = null;
    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: typeof req.query.marketType === "string" ? req.query.marketType : undefined,
        settings
      });
      marketTypeForFallback = marketType;
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : undefined;
      const perpSymbol = deps.normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);
      const spotSymbol = deps.normalizeSpotSymbol(typeof req.query.symbol === "string" ? req.query.symbol : null);

      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      resolvedForFallback = resolved;
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
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
      await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
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
      if (
        resolvedForFallback &&
        marketTypeForFallback &&
        shouldUseTransientHyperliquidDeskFallback(error, resolvedForFallback)
      ) {
        logTransientHyperliquidDeskFallback("/api/positions", error);
        if (marketTypeForFallback === "spot") {
          return res.json({
            exchangeAccountId: resolvedForFallback.selectedAccount.id,
            marketType: marketTypeForFallback,
            items: [],
            degraded: true
          });
        }
        return sendMarketDataDegraded(res, {
          exchangeAccountId: resolvedForFallback.selectedAccount.id,
          marketType: marketTypeForFallback
        });
      }
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/api/orders/open", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    let resolvedForFallback: ResolvedTradingAccountPair | null = null;
    let marketTypeForFallback: "spot" | "perp" | null = null;
    try {
      const settings = await deps.getTradingSettings(user.id);
      const marketType = resolveManualMarketType({
        requested: typeof req.query.marketType === "string" ? req.query.marketType : undefined,
        settings
      });
      marketTypeForFallback = marketType;
      const exchangeAccountId = typeof req.query.exchangeAccountId === "string"
        ? req.query.exchangeAccountId
        : undefined;
      const perpSymbol = deps.normalizeSymbolInput(typeof req.query.symbol === "string" ? req.query.symbol : null);
      const spotSymbol = deps.normalizeSpotSymbol(typeof req.query.symbol === "string" ? req.query.symbol : null);

      const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
      resolvedForFallback = resolved;
      if (marketType === "spot") {
        ensureManualSpotEligibility(resolved);
        await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
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
      await ensureHyperliquidReadAddressConfigured(resolved.selectedAccount);
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
      if (
        resolvedForFallback &&
        marketTypeForFallback &&
        shouldUseTransientHyperliquidDeskFallback(error, resolvedForFallback)
      ) {
        logTransientHyperliquidDeskFallback("/api/orders/open", error);
        return sendMarketDataDegraded(res, {
          exchangeAccountId: resolvedForFallback.selectedAccount.id,
          marketType: marketTypeForFallback
        });
      }
      return deps.sendManualTradingError(res, error);
    }
  });
}
