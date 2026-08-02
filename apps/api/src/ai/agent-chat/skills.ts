import { createHash } from "node:crypto";
import { z } from "zod";
import { ATR, EMA, RSI, SMA } from "technicalindicators";
import { createPerpMarketDataClient } from "../../perp/perp-market-data.client.js";
import { createSpotClient } from "../../spot/spot-client-factory.js";
import {
  createPerpExecutionAdapter,
  listOpenOrders,
  listPaperOpenOrders,
  listPaperPositions,
  listPositions,
  resolveMarketDataTradingAccount,
  resolveTradingAccount,
  type NormalizedPosition,
  type TradingAccount
} from "../../trading.js";
import { getMarketIntelligenceService } from "../../services/marketIntelligence/service.js";
import {
  buildDeterministicPositionAnalysis,
  buildPositionCopilotSnapshot
} from "../../position-copilot/core.js";
import { redactAiSafetySecrets } from "../safety/toolPolicy.js";
import { AgentChatError } from "./errors.js";
import { normalizeAgentCandleRows } from "./normalization.js";
import type {
  AgentMarketType,
  AgentSkillDescriptor,
  AgentSkillExecutionContext,
  AgentToolResult,
  AgentVenue
} from "./contracts.js";

const timeframeSchema = z.enum(["5m", "15m", "1h", "4h", "1d"]);
const symbolSchema = z.string().trim().min(2).max(32);
const venueSchema = z.enum(["auto", "binance", "bitget", "hyperliquid", "mexc", "bingx"]).optional();
const marketArgsSchema = z.object({
  symbol: symbolSchema.optional(),
  venue: venueSchema,
  marketType: z.enum(["spot", "perp"]).optional()
}).strict();
const candlesArgsSchema = marketArgsSchema.extend({
  interval: timeframeSchema.default("1h"),
  limit: z.number().int().min(20).max(1000).default(200)
}).strict();
const indicatorsArgsSchema = candlesArgsSchema.extend({
  indicators: z.array(z.enum(["sma20", "ema50", "rsi14", "atr14"])).max(8).optional()
}).strict();
const orderbookArgsSchema = marketArgsSchema.extend({ limit: z.number().int().min(5).max(100).default(25) }).strict();
const intelligenceArgsSchema = z.object({ symbol: symbolSchema.optional(), horizon: z.enum(["intraday", "24h", "7d"]).default("24h") }).strict();
const predictionArgsSchema = z.object({ symbol: symbolSchema.optional(), limit: z.number().int().min(1).max(20).default(10) }).strict();
const portfolioArgsSchema = z.object({ accountRef: z.literal("selected").default("selected"), symbol: symbolSchema.optional() }).strict();
const riskArgsSchema = z.object({ positionRef: z.string().trim().min(1).max(191).default("selected") }).strict();

type VenueResolution = { requestedVenue: AgentVenue; sourceVenue: Exclude<AgentVenue, "auto">; fallbackUsed: boolean; fallbackReason?: string };

const publicCache = new Map<string, { expiresAt: number; result: AgentToolResult }>();

function nowIso(): string {
  return new Date().toISOString();
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeSymbol(value: string | null | undefined): string {
  return String(value ?? "BTCUSDT").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 32);
}

function baseCoin(symbol: string): string {
  const canonical = normalizeSymbol(symbol);
  for (const quote of ["USDT", "USDC", "USD", "BTC", "ETH"]) {
    if (canonical.endsWith(quote) && canonical.length > quote.length) return canonical.slice(0, -quote.length);
  }
  return canonical;
}

function makeMeta(params: {
  toolId: string;
  venue?: string;
  provider?: string;
  observedAt?: string;
  stale?: boolean;
  degraded?: boolean;
  fallbackUsed?: boolean;
  cacheHit?: boolean;
  warnings?: string[];
}): AgentToolResult["meta"] {
  return {
    toolId: params.toolId,
    ...(params.venue ? { sourceVenue: params.venue } : {}),
    ...(params.provider ? { sourceProvider: params.provider } : {}),
    ...(params.observedAt ? { observedAt: params.observedAt } : {}),
    fetchedAt: nowIso(),
    stale: params.stale ?? false,
    degraded: params.degraded ?? false,
    fallbackUsed: params.fallbackUsed ?? false,
    cacheHit: params.cacheHit ?? false,
    warnings: params.warnings ?? []
  };
}

function ok<T>(toolId: string, data: T, meta: Omit<Parameters<typeof makeMeta>[0], "toolId"> = {}): AgentToolResult<T> {
  return { ok: true, data, meta: makeMeta({ toolId, ...meta }) };
}

function publicAccount(venue: Exclude<AgentVenue, "auto">): TradingAccount {
  return {
    id: `public:${venue}`,
    userId: "public",
    exchange: venue,
    label: `${venue} public market data`,
    apiKey: "",
    apiSecret: "",
    passphrase: venue === "bitget" ? "public" : null,
    marketDataExchangeAccountId: null
  };
}

async function selectedAccountVenue(context: AgentSkillExecutionContext): Promise<Exclude<AgentVenue, "auto"> | null> {
  if (!context.selectedExchangeAccountId) return null;
  const account = await context.db.exchangeAccount.findFirst({
    where: { id: context.selectedExchangeAccountId, userId: context.userId },
    select: { exchange: true }
  });
  if (!account) throw new AgentChatError("agent_chat_account_access_denied", 404);
  const exchange = String(account.exchange ?? "").toLowerCase();
  if (exchange === "paper") {
    const resolved = await resolveMarketDataTradingAccount(context.userId, context.selectedExchangeAccountId);
    const linked = resolved.marketDataAccount.exchange as Exclude<AgentVenue, "auto">;
    return ["binance", "bitget", "hyperliquid", "mexc", "bingx"].includes(linked) ? linked : null;
  }
  return ["binance", "bitget", "hyperliquid", "mexc", "bingx"].includes(exchange)
    ? exchange as Exclude<AgentVenue, "auto">
    : null;
}

async function venueCandidates(
  context: AgentSkillExecutionContext,
  requested: AgentVenue | undefined,
  marketType: AgentMarketType
): Promise<Array<Exclude<AgentVenue, "auto">>> {
  const explicit = requested && requested !== "auto" ? requested : context.selectedVenue !== "auto" ? context.selectedVenue : null;
  if (explicit) return [explicit];
  const selected = await selectedAccountVenue(context);
  const preferred = context.profile.preferredVenue !== "auto" ? context.profile.preferredVenue : null;
  const defaults: Array<Exclude<AgentVenue, "auto">> = marketType === "perp"
    ? ["hyperliquid", "binance", "bitget"]
    : ["binance", "bitget", "hyperliquid", "mexc", "bingx"];
  return [...new Set([selected, preferred, ...defaults].filter((item): item is Exclude<AgentVenue, "auto"> => Boolean(item)))];
}

async function withPublicVenue<T>(params: {
  context: AgentSkillExecutionContext;
  requested?: AgentVenue;
  marketType: AgentMarketType;
  read(venue: Exclude<AgentVenue, "auto">): Promise<T>;
}): Promise<{ data: T; resolution: VenueResolution }> {
  const requestedVenue = params.requested ?? params.context.selectedVenue;
  const candidates = await venueCandidates(params.context, params.requested, params.marketType);
  let firstError = "";
  for (let index = 0; index < candidates.length; index += 1) {
    const venue = candidates[index];
    try {
      return {
        data: await params.read(venue),
        resolution: {
          requestedVenue,
          sourceVenue: venue,
          fallbackUsed: index > 0,
          ...(index > 0 ? { fallbackReason: firstError || "preferred_provider_unavailable" } : {})
        }
      };
    } catch (error) {
      if (!firstError) firstError = error instanceof Error ? error.message : String(error);
      if (requestedVenue !== "auto") break;
    }
  }
  throw new AgentChatError("agent_chat_market_data_degraded", 503, firstError || "No market-data venue available.");
}

async function readMarketClient<T>(
  venue: Exclude<AgentVenue, "auto">,
  marketType: AgentMarketType,
  read: (client: ReturnType<typeof createPerpMarketDataClient> | ReturnType<typeof createSpotClient>) => Promise<T>
): Promise<T> {
  const account = publicAccount(venue);
  const client = marketType === "perp"
    ? createPerpMarketDataClient(account)
    : createSpotClient(account, venue === "bitget" ? { forceBackend: "ccxt" } : {});
  try {
    return await read(client);
  } finally {
    await (client as { close?: () => Promise<void> }).close?.().catch(() => undefined);
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`market_provider_http_${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function readFundingAndOpenInterest(venue: Exclude<AgentVenue, "auto">, symbol: string): Promise<{ fundingRate: number | null; openInterest: number | null; observedAt: string }> {
  if (venue === "binance") {
    const [premium, interest] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(normalizeSymbol(symbol))}`),
      fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(normalizeSymbol(symbol))}`)
    ]);
    return {
      fundingRate: toNumber(toRecord(premium)?.lastFundingRate),
      openInterest: toNumber(toRecord(interest)?.openInterest),
      observedAt: new Date(toNumber(toRecord(premium)?.time) ?? Date.now()).toISOString()
    };
  }
  if (venue === "bitget") {
    const payload = await fetchJson(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${encodeURIComponent(normalizeSymbol(symbol))}&productType=USDT-FUTURES`);
    const data = toRecord(payload)?.data;
    const row = toRecord(Array.isArray(data) ? data[0] : data);
    return {
      fundingRate: toNumber(row?.fundingRate),
      openInterest: toNumber(row?.holdingAmount ?? row?.openInterest),
      observedAt: new Date(toNumber(toRecord(payload)?.requestTime ?? row?.ts) ?? Date.now()).toISOString()
    };
  }
  if (venue === "hyperliquid") {
    const payload = await fetchJson("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" })
    });
    const meta = toRecord(Array.isArray(payload) ? payload[0] : null);
    const contexts = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
    const universe = Array.isArray(meta?.universe) ? meta.universe : [];
    const index = universe.findIndex((item) => String(toRecord(item)?.name ?? "").toUpperCase() === baseCoin(symbol));
    const row = index >= 0 ? toRecord(contexts[index]) : null;
    return { fundingRate: toNumber(row?.funding), openInterest: toNumber(row?.openInterest), observedAt: nowIso() };
  }
  throw new AgentChatError("agent_chat_venue_unsupported", 400);
}

async function requireOwnedSelectedAccount(context: AgentSkillExecutionContext): Promise<{ id: string; exchange: string; label: string; updatedAt: Date; spotBudgetAvailable: number | null; futuresBudgetAvailableMargin: number | null; futuresBudgetEquity: number | null }> {
  if (!context.selectedExchangeAccountId || context.profile.actionLevel !== "account_read") {
    throw new AgentChatError("agent_chat_account_access_denied", 403);
  }
  if (!context.profile.builtin && !context.profile.allowedExchangeAccountIds.includes(context.selectedExchangeAccountId)) {
    throw new AgentChatError("agent_chat_account_access_denied", 403);
  }
  const account = await context.db.exchangeAccount.findFirst({
    where: { id: context.selectedExchangeAccountId, userId: context.userId },
    select: {
      id: true,
      exchange: true,
      label: true,
      updatedAt: true,
      spotBudgetAvailable: true,
      futuresBudgetAvailableMargin: true,
      futuresBudgetEquity: true
    }
  });
  if (!account) throw new AgentChatError("agent_chat_account_access_denied", 404);
  return account;
}

async function loadPerpPositions(context: AgentSkillExecutionContext, symbol?: string): Promise<{ account: Awaited<ReturnType<typeof requireOwnedSelectedAccount>>; positions: NormalizedPosition[] }> {
  const account = await requireOwnedSelectedAccount(context);
  if (context.marketType !== "perp") throw new AgentChatError("agent_chat_venue_unsupported", 400, "Position reads currently require a perp context.");
  if (account.exchange === "paper") {
    const resolved = await resolveMarketDataTradingAccount(context.userId, account.id);
    const reader = createPerpMarketDataClient(resolved.marketDataAccount);
    try {
      return { account, positions: await listPaperPositions(resolved.selectedAccount, reader, symbol) };
    } finally {
      await reader.close().catch(() => undefined);
    }
  }
  const tradingAccount = await resolveTradingAccount(context.userId, account.id);
  const adapter = createPerpExecutionAdapter(tradingAccount);
  try {
    return { account, positions: await listPositions(adapter, symbol) };
  } finally {
    await adapter.close?.().catch(() => undefined);
  }
}

function descriptor(params: Omit<AgentSkillDescriptor, "version" | "sideEffect" | "outputSchema">): AgentSkillDescriptor {
  return { ...params, version: 1, sideEffect: false, outputSchema: z.unknown() };
}

function tool(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) {
  return {
    type: "function" as const,
    function: {
      name,
      description,
      parameters: { type: "object", additionalProperties: false, properties, required }
    }
  };
}

const marketCommon = {
  symbol: { type: "string" },
  venue: { type: "string", enum: ["auto", "binance", "bitget", "hyperliquid", "mexc", "bingx"] },
  marketType: { type: "string", enum: ["spot", "perp"] }
};

export const AGENT_SKILLS: readonly AgentSkillDescriptor[] = [
  descriptor({
    id: "market.get_ohlcv", title: "OHLCV", description: "Normalized candles with source and freshness metadata.", category: "market", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 3_000, supportedMarketTypes: ["spot", "perp"], inputSchema: candlesArgsSchema,
    toolDefinition: tool("market_get_ohlcv", "Load normalized cross-venue OHLCV candles.", { ...marketCommon, interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] }, limit: { type: "integer", minimum: 20, maximum: 1000 } }, ["interval"]),
    async execute(context, input) {
      const args = candlesArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue({ context, requested: args.venue, marketType, read: (venue) => readMarketClient(venue, marketType, async (client) => normalizeAgentCandleRows(await client.getCandles({ symbol, timeframe: args.interval as never, limit: args.limit }))) });
      const observedAt = result.data.at(-1)?.ts ? new Date(result.data.at(-1)!.ts).toISOString() : undefined;
      return ok("market.get_ohlcv", { symbol, marketType, interval: args.interval, candles: result.data.slice(-args.limit) }, { venue: result.resolution.sourceVenue, provider: result.resolution.sourceVenue, observedAt, degraded: result.data.length < 20, fallbackUsed: result.resolution.fallbackUsed, warnings: result.resolution.fallbackReason ? [result.resolution.fallbackReason] : [] });
    }
  }),
  descriptor({
    id: "market.get_indicators", title: "Indicators", description: "Deterministic SMA, EMA, RSI and ATR indicators.", category: "market", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 3_000, supportedMarketTypes: ["spot", "perp"], inputSchema: indicatorsArgsSchema,
    toolDefinition: tool("market_get_indicators", "Compute deterministic indicators from normalized market candles.", { ...marketCommon, interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] }, limit: { type: "integer", minimum: 20, maximum: 1000 }, indicators: { type: "array", items: { type: "string", enum: ["sma20", "ema50", "rsi14", "atr14"] }, maxItems: 8 } }, ["interval"]),
    async execute(context, input) {
      const args = indicatorsArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue({ context, requested: args.venue, marketType, read: (venue) => readMarketClient(venue, marketType, async (client) => normalizeAgentCandleRows(await client.getCandles({ symbol, timeframe: args.interval as never, limit: args.limit }))) });
      const closes = result.data.map((row) => row.close); const requested = args.indicators ?? ["sma20", "ema50", "rsi14", "atr14"];
      const values: Record<string, number | null> = {};
      if (requested.includes("sma20")) values.sma20 = SMA.calculate({ period: 20, values: closes }).at(-1) ?? null;
      if (requested.includes("ema50")) values.ema50 = EMA.calculate({ period: 50, values: closes }).at(-1) ?? null;
      if (requested.includes("rsi14")) values.rsi14 = RSI.calculate({ period: 14, values: closes }).at(-1) ?? null;
      if (requested.includes("atr14")) values.atr14 = ATR.calculate({ period: 14, high: result.data.map((row) => row.high), low: result.data.map((row) => row.low), close: closes }).at(-1) ?? null;
      return ok("market.get_indicators", { symbol, marketType, interval: args.interval, values }, { venue: result.resolution.sourceVenue, provider: result.resolution.sourceVenue, observedAt: result.data.at(-1)?.ts ? new Date(result.data.at(-1)!.ts).toISOString() : undefined, degraded: result.data.length < 50, fallbackUsed: result.resolution.fallbackUsed });
    }
  }),
  descriptor({
    id: "market.get_ticker", title: "Ticker", description: "Current normalized top-of-book ticker.", category: "market", accessLevel: "public_data", maxCallsPerRun: 3, timeoutMs: 8_000, cacheTtlMs: 2_000, supportedMarketTypes: ["spot", "perp"], inputSchema: marketArgsSchema,
    toolDefinition: tool("market_get_ticker", "Load a normalized cross-venue ticker.", marketCommon),
    async execute(context, input) {
      const args = marketArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue({ context, requested: args.venue, marketType, read: (venue) => readMarketClient(venue, marketType, (client) => client.getTicker(symbol)) });
      const ticker = result.data as { last: number | null; mark: number | null; bid: number | null; ask: number | null; ts: number | null };
      return ok("market.get_ticker", { symbol, marketType, last: ticker.last, mark: ticker.mark, bid: ticker.bid, ask: ticker.ask }, { venue: result.resolution.sourceVenue, provider: result.resolution.sourceVenue, observedAt: ticker.ts ? new Date(ticker.ts).toISOString() : nowIso(), fallbackUsed: result.resolution.fallbackUsed });
    }
  }),
  descriptor({
    id: "market.get_orderbook", title: "Order book", description: "Bounded normalized order-book levels.", category: "market", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 2_000, supportedMarketTypes: ["spot", "perp"], inputSchema: orderbookArgsSchema,
    toolDefinition: tool("market_get_orderbook", "Load a bounded normalized cross-venue order book.", { ...marketCommon, limit: { type: "integer", minimum: 5, maximum: 100 } }),
    async execute(context, input) {
      const args = orderbookArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue<unknown>({
        context,
        requested: args.venue,
        marketType,
        read: (venue) => readMarketClient<unknown>(venue, marketType, async (client) => client.getDepth(symbol, args.limit))
      });
      const depth = result.data as { bids: unknown[]; asks: unknown[]; ts?: string | number | null };
      return ok("market.get_orderbook", { symbol, marketType, bids: depth.bids.slice(0, args.limit), asks: depth.asks.slice(0, args.limit) }, { venue: result.resolution.sourceVenue, provider: result.resolution.sourceVenue, observedAt: depth.ts ? new Date(Number(depth.ts)).toISOString() : nowIso(), fallbackUsed: result.resolution.fallbackUsed });
    }
  }),
  ...(["market.get_funding_rate", "market.get_open_interest"] as const).map((id) => descriptor({
    id, title: id.endsWith("funding_rate") ? "Funding rate" : "Open interest", description: "Normalized perpetual-market context.", category: "market", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 5_000, supportedMarketTypes: ["perp"], inputSchema: marketArgsSchema,
    toolDefinition: tool(id.replaceAll(".", "_"), `Load normalized ${id.endsWith("funding_rate") ? "funding rate" : "open interest"}.`, marketCommon),
    async execute(context, input) {
      const args = marketArgsSchema.parse(input); const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue({ context, requested: args.venue, marketType: "perp", read: (venue) => readFundingAndOpenInterest(venue, symbol) });
      const key = id.endsWith("funding_rate") ? "fundingRate" : "openInterest";
      return ok(id, { symbol, [key]: result.data[key] }, { venue: result.resolution.sourceVenue, provider: result.resolution.sourceVenue, observedAt: result.data.observedAt, degraded: result.data[key] === null, fallbackUsed: result.resolution.fallbackUsed });
    }
  })),
  descriptor({
    id: "market.get_contract_info", title: "Contract info", description: "Normalized market contract capabilities.", category: "market", accessLevel: "public_data", maxCallsPerRun: 1, timeoutMs: 8_000, cacheTtlMs: 60_000, supportedMarketTypes: ["spot", "perp"], inputSchema: marketArgsSchema,
    toolDefinition: tool("market_get_contract_info", "Load normalized contract or spot-market metadata.", marketCommon),
    async execute(context, input) {
      const args = marketArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue({ context, requested: args.venue, marketType, read: (venue) => readMarketClient(venue, marketType, async (client) => (await client.listSymbols()).find((item) => normalizeSymbol(item.symbol) === symbol) ?? null) });
      return ok("market.get_contract_info", { symbol, marketType, contract: result.data }, { venue: result.resolution.sourceVenue, provider: result.resolution.sourceVenue, degraded: result.data === null, fallbackUsed: result.resolution.fallbackUsed });
    }
  }),
  ...(["intelligence.get_news", "intelligence.get_economic_events"] as const).map((id) => descriptor({
    id, title: id.endsWith("news") ? "News" : "Economic events", description: "Provider-neutral market intelligence.", category: "intelligence", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 30_000, supportedMarketTypes: ["spot", "perp"], inputSchema: intelligenceArgsSchema,
    toolDefinition: tool(id.replaceAll(".", "_"), id.endsWith("news") ? "Load normalized relevant news." : "Load normalized upcoming economic events.", { symbol: { type: "string" }, horizon: { type: "string", enum: ["intraday", "24h", "7d"] } }),
    async execute(context, input) {
      const args = intelligenceArgsSchema.parse(input); const service = getMarketIntelligenceService(context.db); const market = await service.getMarketContext({ symbol: normalizeSymbol(args.symbol ?? context.symbol), horizon: args.horizon }); const data = id.endsWith("news") ? market.news.slice(0, 12) : market.events.slice(0, 12);
      return ok(id, data, { provider: "market_intelligence_registry", observedAt: nowIso(), degraded: market.degraded, warnings: market.warnings.slice(0, 5) });
    }
  })),
  descriptor({
    id: "predictions.get_recent", title: "Recent predictions", description: "Recent user-owned prediction results.", category: "prediction", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 4_000, cacheTtlMs: 10_000, supportedMarketTypes: ["spot", "perp"], inputSchema: predictionArgsSchema,
    toolDefinition: tool("predictions_get_recent", "Load recent user-owned predictions.", { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }),
    async execute(context, input) {
      const args = predictionArgsSchema.parse(input); const symbol = args.symbol ? normalizeSymbol(args.symbol) : context.symbol ? normalizeSymbol(context.symbol) : undefined;
      const rows = await context.db.prediction.findMany({ where: { userId: context.userId, ...(symbol ? { symbol } : {}) }, orderBy: { tsCreated: "desc" }, take: args.limit, select: { id: true, symbol: true, marketType: true, timeframe: true, tsCreated: true, signal: true, expectedMovePct: true, confidence: true, explanation: true, outcomeStatus: true, outcomeResult: true, outcomePnlPct: true } });
      return ok("predictions.get_recent", rows, { provider: "uliquid_predictions", observedAt: rows[0]?.tsCreated?.toISOString?.(), degraded: rows.length === 0 });
    }
  }),
  descriptor({
    id: "predictions.get_performance_summary", title: "Prediction performance", description: "Deterministic outcome summary for user-owned predictions.", category: "prediction", accessLevel: "public_data", maxCallsPerRun: 1, timeoutMs: 4_000, cacheTtlMs: 30_000, supportedMarketTypes: ["spot", "perp"], inputSchema: predictionArgsSchema,
    toolDefinition: tool("predictions_get_performance_summary", "Summarize evaluated prediction outcomes.", { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }),
    async execute(context, input) {
      const args = predictionArgsSchema.parse(input); const symbol = args.symbol ? normalizeSymbol(args.symbol) : context.symbol ? normalizeSymbol(context.symbol) : undefined;
      const rows = await context.db.prediction.findMany({ where: { userId: context.userId, outcomeStatus: "evaluated", ...(symbol ? { symbol } : {}) }, orderBy: { outcomeEvaluatedAt: "desc" }, take: Math.max(args.limit, 20), select: { outcomeResult: true, outcomePnlPct: true } });
      const wins = rows.filter((row: any) => row.outcomeResult === "win").length; const losses = rows.filter((row: any) => row.outcomeResult === "loss").length; const avgPnlPct = rows.length ? rows.reduce((sum: number, row: any) => sum + Number(row.outcomePnlPct ?? 0), 0) / rows.length : null;
      return ok("predictions.get_performance_summary", { evaluated: rows.length, wins, losses, winRate: rows.length ? wins / rows.length : null, avgPnlPct }, { provider: "uliquid_predictions", degraded: rows.length === 0 });
    }
  }),
  descriptor({
    id: "portfolio.get_positions", title: "Positions", description: "Read-only selected-account positions.", category: "portfolio", accessLevel: "account_read", maxCallsPerRun: 2, timeoutMs: 10_000, cacheTtlMs: 0, supportedMarketTypes: ["perp"], inputSchema: portfolioArgsSchema,
    toolDefinition: tool("portfolio_get_positions", "Load read-only positions from the server-bound selected account.", { accountRef: { type: "string", enum: ["selected"] }, symbol: { type: "string" } }),
    async execute(context, input) {
      const args = portfolioArgsSchema.parse(input); const loaded = await loadPerpPositions(context, args.symbol ? normalizeSymbol(args.symbol) : undefined);
      const positions = loaded.positions.slice(0, 50).map((position, index) => { const positionRef = index === 0 ? "selected" : `position:${createHash("sha256").update(`${context.runId}:${index}`).digest("hex").slice(0, 16)}`; context.positionRefs.set(positionRef, position); if (index === 0) context.positionRefs.set("selected", position); return { positionRef, ...position }; });
      return ok("portfolio.get_positions", { accountLabel: loaded.account.label, venue: loaded.account.exchange, positions }, { venue: loaded.account.exchange, provider: "user_exchange_account", observedAt: nowIso(), degraded: false });
    }
  }),
  descriptor({
    id: "portfolio.get_balance_summary", title: "Balance summary", description: "Read-only cached balance summary without credentials.", category: "portfolio", accessLevel: "account_read", maxCallsPerRun: 1, timeoutMs: 4_000, cacheTtlMs: 0, supportedMarketTypes: ["spot", "perp"], inputSchema: portfolioArgsSchema,
    toolDefinition: tool("portfolio_get_balance_summary", "Load a read-only balance summary for the server-bound selected account.", { accountRef: { type: "string", enum: ["selected"] } }),
    async execute(context) {
      const account = await requireOwnedSelectedAccount(context); const observedAt = account.updatedAt.toISOString(); const ageMs = Date.now() - account.updatedAt.getTime();
      return ok("portfolio.get_balance_summary", { accountLabel: account.label, venue: account.exchange, spotAvailable: account.spotBudgetAvailable, futuresAvailableMargin: account.futuresBudgetAvailableMargin, futuresEquity: account.futuresBudgetEquity }, { venue: account.exchange, provider: "cached_account_summary", observedAt, stale: ageMs > 120_000, degraded: ageMs > 120_000, warnings: ageMs > 120_000 ? ["account_summary_stale"] : [] });
    }
  }),
  descriptor({
    id: "portfolio.get_open_orders", title: "Open orders", description: "Read-only selected-account open orders.", category: "portfolio", accessLevel: "account_read", maxCallsPerRun: 1, timeoutMs: 10_000, cacheTtlMs: 0, supportedMarketTypes: ["perp"], inputSchema: portfolioArgsSchema,
    toolDefinition: tool("portfolio_get_open_orders", "Load read-only open orders from the server-bound selected account.", { accountRef: { type: "string", enum: ["selected"] }, symbol: { type: "string" } }),
    async execute(context, input) {
      const args = portfolioArgsSchema.parse(input); const account = await requireOwnedSelectedAccount(context); let orders;
      if (account.exchange === "paper") {
        const resolved = await resolveMarketDataTradingAccount(context.userId, account.id);
        const reader = createPerpMarketDataClient(resolved.marketDataAccount);
        try {
          orders = await listPaperOpenOrders(resolved.selectedAccount, reader, args.symbol ? normalizeSymbol(args.symbol) : undefined);
        } finally {
          await reader.close().catch(() => undefined);
        }
      }
      else { const tradingAccount = await resolveTradingAccount(context.userId, account.id); const adapter = createPerpExecutionAdapter(tradingAccount); try { orders = await listOpenOrders(adapter, args.symbol ? normalizeSymbol(args.symbol) : undefined); } finally { await adapter.close?.().catch(() => undefined); } }
      return ok("portfolio.get_open_orders", { accountLabel: account.label, venue: account.exchange, orders: orders.slice(0, 50).map(({ raw: _raw, ...order }: any) => order) }, { venue: account.exchange, provider: "user_exchange_account", observedAt: nowIso() });
    }
  }),
  descriptor({
    id: "risk.analyze_position_snapshot", title: "Position risk", description: "Shared deterministic Position Copilot analysis.", category: "risk", accessLevel: "account_read", maxCallsPerRun: 2, timeoutMs: 4_000, cacheTtlMs: 0, supportedMarketTypes: ["perp"], inputSchema: riskArgsSchema,
    toolDefinition: tool("risk_analyze_position_snapshot", "Analyze a previously loaded opaque position reference with deterministic risk rules.", { positionRef: { type: "string" } }),
    async execute(context, input) {
      const args = riskArgsSchema.parse(input); let position = context.positionRefs.get(args.positionRef) as NormalizedPosition | undefined;
      const account = await requireOwnedSelectedAccount(context);
      if (!position && args.positionRef === "selected") { const loaded = await loadPerpPositions(context, context.symbol ?? undefined); position = loaded.positions[0]; }
      if (!position) throw new AgentChatError("agent_chat_account_access_denied", 404, "Position reference is stale or unavailable.");
      const snapshot = buildPositionCopilotSnapshot({ ...position, exchangeAccountId: account.id, exchange: account.exchange, marketType: "perp", unrealizedPnlUsd: position.unrealizedPnl, dataDegraded: false, observedAt: nowIso(), openedByPredictionCopier: false });
      const analysis = buildDeterministicPositionAnalysis(snapshot, new Date(), context.locale);
      return ok("risk.analyze_position_snapshot", analysis, { venue: account.exchange, provider: "position_copilot_deterministic", observedAt: snapshot.observedAt, degraded: analysis.dataQuality.state === "degraded" });
    }
  })
];

const skillsById = new Map(AGENT_SKILLS.map((skill) => [skill.id, skill]));
const skillsByToolName = new Map(AGENT_SKILLS.map((skill) => [skill.toolDefinition.function.name, skill]));

export function listAgentSkillDescriptors(): AgentSkillDescriptor[] {
  return AGENT_SKILLS.map((skill) => skill);
}

export function getAgentSkillById(id: string): AgentSkillDescriptor | null {
  return skillsById.get(id) ?? null;
}

export function getAgentSkillByToolName(name: string): AgentSkillDescriptor | null {
  return skillsByToolName.get(name) ?? null;
}

export async function executeAgentSkill(skill: AgentSkillDescriptor, context: AgentSkillExecutionContext, rawInput: unknown): Promise<AgentToolResult> {
  if (!context.profile.enabledSkillIds.includes(skill.id)) throw new AgentChatError("agent_chat_skill_not_allowed", 403);
  if (skill.accessLevel === "account_read" && context.profile.actionLevel !== "account_read") throw new AgentChatError("agent_chat_skill_not_allowed", 403);
  if (!skill.supportedMarketTypes.includes(context.marketType)) throw new AgentChatError("agent_chat_venue_unsupported", 400);
  const input = skill.inputSchema.parse(rawInput);
  const cacheKey = `${skill.id}:${context.selectedVenue}:${context.marketType}:${JSON.stringify(input)}`;
  if (skill.accessLevel === "public_data" && skill.cacheTtlMs > 0) {
    const cached = publicCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.result, meta: { ...cached.result.meta, cacheHit: true } };
  }
  const result = await skill.execute(context, input);
  const sanitized = redactAiSafetySecrets(result) as AgentToolResult;
  if (skill.accessLevel === "public_data" && skill.cacheTtlMs > 0) publicCache.set(cacheKey, { expiresAt: Date.now() + skill.cacheTtlMs, result: sanitized });
  return sanitized;
}
