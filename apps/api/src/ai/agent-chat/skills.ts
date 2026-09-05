import { createHash } from "node:crypto";
import { z } from "zod";
import type { analyzeFundingSnapshot, analyzeOpenInterestSnapshot, analyzeOrderbookSnapshot } from "@mm/futures-core";
import { getFuturesVenueCapabilities } from "@mm/futures-exchange";
import { sharedDerivativesStore, projectDerivativesSnapshot } from "../../market-data/sharedDerivatives.js";
import { evaluateMarketFeature } from "../features/registry.js";
import { storedFeatureEvidence, marketSnapshotEvidenceSchema, featureMatchesSnapshot } from "../features/evidence.js";
import { pinRunSnapshot } from "../../market-data/snapshotCache.js";
import { sharedMarketStore, projectMarketSnapshot, providerObservedAt, normalizeSharedCandles,
  type MarketDataset, type MarketDatasetKey, type MarketDatasetData, type SharedMarketRead } from "../../market-data/sharedMarket.js";
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
import { redactAiSafetySecrets } from "../safety/toolPolicy.js";
import {
  AGENT_ROUTINE_IDS,
  executeAgentRoutine,
  routineVersionRefs,
  type AgentRoutineId
} from "../routines/registry.js";
import { AgentChatError } from "./errors.js";
import type {
  AgentMarketType,
  AgentProfileKey,
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
const portfolioRiskArgsSchema = z.object({ accountRef: z.literal("selected").default("selected") }).strict();
const riskArgsSchema = z.object({ positionRef: z.string().trim().min(1).max(191).default("selected") }).strict();

type VenueResolution = { requestedVenue: AgentVenue; sourceVenue: Exclude<AgentVenue, "auto">; fallbackUsed: boolean; fallbackReason?: string };

const publicCache = new Map<string, { expiresAt: number; result: AgentToolResult }>();
export const agentMarketDataAccounts = { resolveLinked: resolveMarketDataTradingAccount };

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSymbol(value: string | null | undefined): string {
  return String(value ?? "BTCUSDT").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 32);
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
  quality?: AgentToolResult["meta"]["quality"];
  timestampSource?: AgentToolResult["meta"]["timestampSource"];
}): AgentToolResult["meta"] {
  const fetchedAt = nowIso();
  const observedMs = params.observedAt ? Date.parse(params.observedAt) : Number.NaN;
  const ageMs = Number.isFinite(observedMs) ? Math.max(0, Date.parse(fetchedAt) - observedMs) : null;
  const stale = params.stale ?? false;
  const degraded = params.degraded ?? false;
  return {
    toolId: params.toolId,
    ...(params.venue ? { sourceVenue: params.venue } : {}),
    ...(params.provider ? { sourceProvider: params.provider } : {}),
    ...(params.observedAt ? { observedAt: params.observedAt } : {}),
    fetchedAt,
    ageMs,
    quality: params.quality ?? (stale ? "stale" : degraded ? "degraded" : "fresh"),
    timestampSource: params.timestampSource ?? (params.observedAt ? "provider" : "unknown"),
    stale,
    degraded,
    fallbackUsed: params.fallbackUsed ?? false,
    cacheHit: params.cacheHit ?? false,
    warnings: params.warnings ?? [],
    routineVersions: []
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

function marketProviderId(venue: Exclude<AgentVenue, "auto">, marketType: AgentMarketType): string {
  return marketType === "perp" ? getFuturesVenueCapabilities(venue).providerId : `uliquid-native-spot:${venue}`;
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
    const resolved = await agentMarketDataAccounts.resolveLinked(context.userId, context.selectedExchangeAccountId);
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

async function readDerivativesSnapshot(
  context: AgentSkillExecutionContext,
  venue: Exclude<AgentVenue, "auto">,
  symbol: string,
  field: "fundingRate" | "openInterest"
) {
  const capability = getFuturesVenueCapabilities(venue);
  if (capability.marketData[field] === "unsupported") {
    throw new AgentChatError("agent_chat_venue_unsupported", 400, `${field} is unsupported for ${venue}.`);
  }
  const key = {
    providerId: capability.providerId, sourceVenue: venue, marketType: "perp", symbol
  } as const;
  const result = await pinRunSnapshot(context, `derivatives:${JSON.stringify(key)}`, () => sharedDerivativesStore.read(key, async () => {
    const client = createPerpMarketDataClient(publicAccount(venue));
    try {
      return await client.getDerivativesSnapshot(symbol);
    } finally {
      await client.close().catch(() => undefined);
    }
  }));
  if (result.snapshot.data[field] === null) {
    throw new AgentChatError("agent_chat_market_data_degraded", 503, `${field}_unavailable`);
  }
  return projectDerivativesSnapshot(result.snapshot, result.cacheHit);
}

async function readSharedMarket<D extends MarketDataset>(context: AgentSkillExecutionContext,
  key: Extract<MarketDatasetKey, { dataset: D }>,
  load: () => Promise<{ data: MarketDatasetData[D]; observedAt: string | null; warnings: string[] }>) {
  const result = await pinRunSnapshot(context, JSON.stringify(key), () => sharedMarketStore.read<D>(key, load));
  return projectMarketSnapshot(result.snapshot, result.cacheHit);
}

function sharedMeta<D extends MarketDataset>(id: string, result: SharedMarketRead<D>, resolution: VenueResolution): AgentToolResult["meta"] {
  const snapshot = result.snapshot;
  const key: MarketDatasetKey = snapshot.key;
  const meta = makeMeta({ toolId: id, venue: key.sourceVenue, provider: key.providerId,
    observedAt: snapshot.observedAt ?? undefined, quality: result.quality, stale: result.quality === "stale",
    degraded: result.quality === "degraded", timestampSource: snapshot.observedAt ? "provider" : "unknown",
    fallbackUsed: resolution.fallbackUsed, cacheHit: result.cacheHit,
    warnings: [...new Set([...result.warnings, ...(resolution.fallbackReason ? [resolution.fallbackReason] : [])])] });
  meta.fetchedAt = snapshot.fetchedAt;
  meta.ageMs = result.ageMs;
  meta.marketSnapshot = marketSnapshotEvidenceSchema.parse({ id: snapshot.id, schemaVersion: key.schemaVersion,
    freshnessPolicyVersion: "1.0.0", market: { providerId: key.providerId, sourceVenue: key.sourceVenue, marketType: key.marketType, symbol: key.symbol },
    dataset: key.dataset, interval: key.dataset === "candles" ? key.interval : null, limit: "limit" in key ? key.limit : null,
    observedAt: snapshot.observedAt, fetchedAt: snapshot.fetchedAt, ageMs: result.ageMs,
    quality: result.quality, warningCodes: result.warnings, atomicObservation: false });
  return meta;
}

function attachFeature(response: AgentToolResult, feature: ReturnType<typeof evaluateMarketFeature>) {
  response.meta.featureVersions = [feature.ref];
  response.meta.featureSnapshots = [storedFeatureEvidence(feature.ref, feature.value, feature.routineVersions)];
}

async function readCandles(context: AgentSkillExecutionContext, args: z.infer<typeof candlesArgsSchema>) {
  const marketType = args.marketType ?? context.marketType;
  const symbol = normalizeSymbol(args.symbol ?? context.symbol);
  return withPublicVenue({ context, requested: args.venue, marketType, read: venue => readSharedMarket<"candles">(context,
    { providerId: marketProviderId(venue, marketType), sourceVenue: venue, marketType, symbol,
      dataset: "candles", schemaVersion: "1.0.0", interval: args.interval, limit: args.limit },
    () => readMarketClient(venue, marketType, async client => normalizeSharedCandles(
      await client.getCandles({ symbol, timeframe: args.interval as never, limit: args.limit }), args.interval, args.limit))) });
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

const genericObjectSchema = z.record(z.unknown());
const genericObjectArraySchema = z.array(genericObjectSchema);
const nullableNumberSchema = z.number().finite().nullable();
const candleOutputSchema = z.object({ ts: z.number().finite(), open: z.number().finite(), high: z.number().finite(), low: z.number().finite(), close: z.number().finite(), volume: z.number().finite() }).strict();
const qualityOutputSchema = z.object({ state: z.enum(["fresh", "stale", "degraded", "unavailable"]), reasons: z.array(z.string()) }).strict();
const analyticsOutputSchema = z.object({ routineId: z.string(), quality: qualityOutputSchema }).passthrough();

const SKILL_OUTPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "market.get_ohlcv": z.object({ symbol: z.string(), marketType: z.enum(["spot", "perp"]), interval: timeframeSchema, candles: z.array(candleOutputSchema) }).strict(),
  "market.get_indicators": z.object({ symbol: z.string(), marketType: z.enum(["spot", "perp"]), interval: timeframeSchema, values: z.record(nullableNumberSchema) }).strict(),
  "market.get_ticker": z.object({ symbol: z.string(), marketType: z.enum(["spot", "perp"]), last: nullableNumberSchema, mark: nullableNumberSchema, bid: nullableNumberSchema, ask: nullableNumberSchema }).strict(),
  "market.get_orderbook": z.object({ symbol: z.string(), marketType: z.enum(["spot", "perp"]), bids: z.array(z.tuple([z.number().finite(), z.number().finite()])), asks: z.array(z.tuple([z.number().finite(), z.number().finite()])), analytics: analyticsOutputSchema }).strict(),
  "market.get_funding_rate": z.object({ symbol: z.string(), fundingRate: nullableNumberSchema, analytics: analyticsOutputSchema }).strict(),
  "market.get_open_interest": z.object({ symbol: z.string(), openInterest: nullableNumberSchema, analytics: analyticsOutputSchema }).strict(),
  "market.get_contract_info": z.object({ symbol: z.string(), marketType: z.enum(["spot", "perp"]), contract: genericObjectSchema.nullable() }).strict(),
  "intelligence.get_news": genericObjectArraySchema,
  "intelligence.get_economic_events": genericObjectArraySchema,
  "predictions.get_recent": genericObjectArraySchema,
  "predictions.get_performance_summary": z.object({ evaluated: z.number().int().nonnegative(), wins: z.number().int().nonnegative(), losses: z.number().int().nonnegative(), winRate: nullableNumberSchema, avgPnlPct: nullableNumberSchema }).strict(),
  "portfolio.get_positions": z.object({ accountLabel: z.string(), venue: z.string(), positions: genericObjectArraySchema }).strict(),
  "portfolio.get_balance_summary": z.object({ accountLabel: z.string(), venue: z.string(), spotAvailable: nullableNumberSchema, futuresAvailableMargin: nullableNumberSchema, futuresEquity: nullableNumberSchema }).strict(),
  "portfolio.get_open_orders": z.object({ accountLabel: z.string(), venue: z.string(), orders: z.array(z.unknown()) }).strict(),
  "risk.analyze_portfolio": z.object({ accountLabel: z.string(), venue: z.string(), positionCount: z.number().int().nonnegative(), positions: genericObjectArraySchema }).strict(),
  "risk.analyze_position_snapshot": genericObjectSchema
};

type DescriptorParams = Omit<AgentSkillDescriptor, "version" | "status" | "allowedProfiles" | "outputSchemaId" | "routineIds" | "sideEffect" | "outputSchema"> & {
  version?: number;
  routineIds?: readonly AgentRoutineId[];
  allowedProfiles?: readonly AgentProfileKey[];
};

function descriptor(params: DescriptorParams): AgentSkillDescriptor {
  const version = params.version ?? 1;
  const outputSchema = SKILL_OUTPUT_SCHEMAS[params.id];
  if (!outputSchema) throw new Error(`agent_skill_output_schema_missing:${params.id}`);
  return {
    ...params,
    version,
    status: "production",
    allowedProfiles: params.allowedProfiles ?? (params.accessLevel === "account_read" ? ["position_copilot"] : ["market_analyst", "position_copilot"]),
    outputSchemaId: `${params.id}.v${version}`,
    routineIds: params.routineIds ?? [],
    sideEffect: false,
    outputSchema
  };
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
    id: "market.get_ohlcv", version: 2, title: "OHLCV", description: "Shared normalized candles with source and freshness metadata.", category: "market", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 0, supportedMarketTypes: ["spot", "perp"], inputSchema: candlesArgsSchema,
    toolDefinition: tool("market_get_ohlcv", "Load normalized cross-venue OHLCV candles.", { ...marketCommon, interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] }, limit: { type: "integer", minimum: 20, maximum: 1000 } }, ["interval"]),
    async execute(context, input) {
      const args = candlesArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await readCandles(context, args);
      return { ok: true, data: { symbol, marketType, interval: args.interval, candles: result.data.snapshot.data.candles },
        meta: sharedMeta("market.get_ohlcv", result.data, result.resolution) };
    }
  }),
  descriptor({
    id: "market.get_indicators", version: 3, routineIds: [AGENT_ROUTINE_IDS.technicalIndicatorSummary], title: "Indicators", description: "Versioned SMA, EMA, RSI and ATR features from shared candles.", category: "market", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 0, supportedMarketTypes: ["spot", "perp"], inputSchema: indicatorsArgsSchema,
    toolDefinition: tool("market_get_indicators", "Compute deterministic indicators from normalized market candles.", { ...marketCommon, interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] }, limit: { type: "integer", minimum: 20, maximum: 1000 }, indicators: { type: "array", items: { type: "string", enum: ["sma20", "ema50", "rsi14", "atr14"] }, maxItems: 8 } }, ["interval"]),
    async execute(context, input) {
      const args = indicatorsArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await readCandles(context, args);
      const feature = evaluateMarketFeature<{ values: Record<string, number | null>; quality: { state: string; reasons: string[] } }>(
        "technical.indicator-summary", { candles: result.data.snapshot.data.candles, indicators: args.indicators ?? ["sma20", "ema50", "rsi14", "atr14"] }, result.data.snapshot.id);
      const response = { ok: true, data: { symbol, marketType, interval: args.interval, values: feature.value.values },
        meta: sharedMeta("market.get_indicators", result.data, result.resolution) };
      response.meta.warnings = [...new Set([...response.meta.warnings, ...feature.value.quality.reasons])];
      if (feature.value.quality.state !== "fresh") { response.meta.degraded = true; if (response.meta.quality === "fresh") response.meta.quality = "degraded"; }
      attachFeature(response, feature);
      return response;
    }
  }),
  descriptor({
    id: "market.get_ticker", version: 2, title: "Ticker", description: "Shared normalized top-of-book ticker.", category: "market", accessLevel: "public_data", maxCallsPerRun: 3, timeoutMs: 8_000, cacheTtlMs: 0, supportedMarketTypes: ["spot", "perp"], inputSchema: marketArgsSchema,
    toolDefinition: tool("market_get_ticker", "Load a normalized cross-venue ticker.", marketCommon),
    async execute(context, input) {
      const args = marketArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue({ context, requested: args.venue, marketType, read: venue => readSharedMarket<"ticker">(context,
        { providerId: marketProviderId(venue, marketType), sourceVenue: venue, marketType, symbol, dataset: "ticker", schemaVersion: "1.0.0" },
        () => readMarketClient(venue, marketType, async client => {
          const ticker = await client.getTicker(symbol) as { last?: number | null; mark?: number | null; bid?: number | null; ask?: number | null; ts?: number | null };
          const data = { last: ticker.last ?? null, mark: ticker.mark ?? null, bid: ticker.bid ?? null, ask: ticker.ask ?? null };
          const invalid = Object.values(data).some(value => value !== null && (!Number.isFinite(value) || value <= 0));
          const warnings = invalid || Object.values(data).every(value => value === null) ? ["ticker_values_unavailable_or_invalid"] : [];
          if (data.bid !== null && data.ask !== null && data.bid >= data.ask) warnings.push("ticker_crossed");
          return { data, observedAt: providerObservedAt(ticker.ts), warnings };
        })) });
      return { ok: true, data: { symbol, marketType, ...result.data.snapshot.data }, meta: sharedMeta("market.get_ticker", result.data, result.resolution) };
    }
  }),
  descriptor({
    id: "market.get_orderbook", version: 3, routineIds: [AGENT_ROUTINE_IDS.orderbookSnapshot], title: "Order book", description: "Shared bounded order-book levels with versioned depth features.", category: "market", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 0, supportedMarketTypes: ["spot", "perp"], inputSchema: orderbookArgsSchema,
    toolDefinition: tool("market_get_orderbook", "Load a bounded normalized cross-venue order book.", { ...marketCommon, limit: { type: "integer", minimum: 5, maximum: 100 } }),
    async execute(context, input) {
      const args = orderbookArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue({ context, requested: args.venue, marketType, read: venue => readSharedMarket<"orderbook">(context,
        { providerId: marketProviderId(venue, marketType), sourceVenue: venue, marketType, symbol, dataset: "orderbook", schemaVersion: "1.0.0", limit: args.limit },
        () => readMarketClient(venue, marketType, async client => {
          const depth = await client.getDepth(symbol, args.limit);
          return { data: { bids: depth.bids.slice(0, args.limit) as Array<[number, number]>, asks: depth.asks.slice(0, args.limit) as Array<[number, number]> },
            observedAt: providerObservedAt(depth.ts), warnings: [] };
        })) });
      const data = result.data.snapshot.data;
      const feature = evaluateMarketFeature<ReturnType<typeof analyzeOrderbookSnapshot>>("orderbook.snapshot", data, result.data.snapshot.id);
      const response = { ok: true, data: { symbol, marketType, ...data, analytics: feature.value }, meta: sharedMeta("market.get_orderbook", result.data, result.resolution) };
      response.meta.warnings = [...new Set([...response.meta.warnings, ...feature.value.quality.reasons])];
      if (feature.value.quality.state !== "fresh") { response.meta.degraded = true; if (response.meta.quality === "fresh" || feature.value.quality.state === "unavailable") response.meta.quality = feature.value.quality.state; }
      attachFeature(response, feature);
      return response;
    }
  }),
  ...(["market.get_funding_rate", "market.get_open_interest"] as const).map((id) => descriptor({
    id, version: 4, routineIds: [id.endsWith("funding_rate") ? AGENT_ROUTINE_IDS.fundingSnapshot : AGENT_ROUTINE_IDS.openInterestSnapshot], title: id.endsWith("funding_rate") ? "Funding rate" : "Open interest", description: "Run-pinned perpetual-market snapshot with persisted versioned features.", category: "market", accessLevel: "public_data", maxCallsPerRun: 2, timeoutMs: 8_000, cacheTtlMs: 0, supportedMarketTypes: ["perp"], inputSchema: marketArgsSchema,
    toolDefinition: tool(id.replaceAll(".", "_"), `Load normalized ${id.endsWith("funding_rate") ? "funding rate" : "open interest"}.`, marketCommon),
    async execute(context, input) {
      const args = marketArgsSchema.parse(input); const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const isFunding = id.endsWith("funding_rate");
      const result = await withPublicVenue({ context, requested: args.venue, marketType: "perp", read: (venue) => readDerivativesSnapshot(context, venue, symbol, isFunding ? "fundingRate" : "openInterest") });
      const shared = result.data;
      const data = shared.snapshot.data;
      const feature = isFunding
        ? evaluateMarketFeature<ReturnType<typeof analyzeFundingSnapshot>>("derivatives.funding-snapshot", { rate: data.fundingRate, fundingIntervalHours: data.fundingIntervalHours }, shared.snapshot.id)
        : evaluateMarketFeature<ReturnType<typeof analyzeOpenInterestSnapshot>>("derivatives.open-interest-snapshot", { reportedValue: data.openInterest, reportedUnit: data.openInterestUnit, referencePrice: data.markPrice, contractSize: data.contractSize }, shared.snapshot.id);
      const analytics = feature.value;
      const value = isFunding ? data.fundingRate : data.openInterest;
      const stale = shared.quality === "stale";
      const degraded = shared.quality === "degraded" || analytics.quality.state !== "fresh";
      const response = ok(id, { symbol, [isFunding ? "fundingRate" : "openInterest"]: value, analytics }, {
        venue: result.resolution.sourceVenue, provider: shared.snapshot.market.providerId,
        observedAt: data.observedAt, timestampSource: data.sourceTimestampProvided ? "provider" : "request",
        stale, degraded, quality: stale ? "stale" : degraded ? "degraded" : "fresh",
        fallbackUsed: result.resolution.fallbackUsed, cacheHit: shared.cacheHit,
        warnings: [...new Set([...shared.warnings, ...analytics.quality.reasons,
          ...(result.resolution.fallbackReason ? [result.resolution.fallbackReason] : [])])]
      });
      response.meta.fetchedAt = shared.snapshot.fetchedAt;
      response.meta.ageMs = shared.ageMs;
      response.meta.marketSnapshot = marketSnapshotEvidenceSchema.parse({ id: shared.snapshot.id, schemaVersion: "1.0.0", freshnessPolicyVersion: "1.0.0",
        market: shared.snapshot.market, dataset: "derivatives", interval: null, limit: null,
        observedAt: data.sourceTimestampProvided ? data.observedAt : null, fetchedAt: shared.snapshot.fetchedAt, ageMs: shared.ageMs,
        quality: shared.quality, warningCodes: shared.warnings, atomicObservation: false });
      attachFeature(response, feature);
      return response;
    }
  })),
  descriptor({
    id: "market.get_contract_info", title: "Contract info", description: "Normalized market contract capabilities.", category: "market", accessLevel: "public_data", maxCallsPerRun: 1, timeoutMs: 8_000, cacheTtlMs: 60_000, supportedMarketTypes: ["spot", "perp"], inputSchema: marketArgsSchema,
    toolDefinition: tool("market_get_contract_info", "Load normalized contract or spot-market metadata.", marketCommon),
    async execute(context, input) {
      const args = marketArgsSchema.parse(input); const marketType = args.marketType ?? context.marketType; const symbol = normalizeSymbol(args.symbol ?? context.symbol);
      const result = await withPublicVenue({ context, requested: args.venue, marketType, read: (venue) => readMarketClient(venue, marketType, async (client) => (await client.listSymbols()).find((item) => normalizeSymbol(item.symbol) === symbol) ?? null) });
      return ok("market.get_contract_info", { symbol, marketType, contract: result.data }, { venue: result.resolution.sourceVenue, provider: marketProviderId(result.resolution.sourceVenue, marketType), observedAt: nowIso(), timestampSource: "request", degraded: result.data === null, fallbackUsed: result.resolution.fallbackUsed });
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
    toolDefinition: tool("portfolio_get_positions", "Load read-only positions from the server-bound selected account. Omit symbol to load every open position.", { accountRef: { type: "string", enum: ["selected"] }, symbol: { type: "string" } }),
    async execute(context, input) {
      const args = portfolioArgsSchema.parse(input); const loaded = await loadPerpPositions(context, args.symbol ? normalizeSymbol(args.symbol) : undefined);
      const positions = loaded.positions.slice(0, 50).map((position, index) => { const positionRef = index === 0 ? "selected" : `position:${createHash("sha256").update(`${context.runId}:${index}`).digest("hex").slice(0, 16)}`; context.positionRefs.set(positionRef, position); if (index === 0) context.positionRefs.set("selected", position); return { positionRef, ...position }; });
      return ok("portfolio.get_positions", { accountLabel: loaded.account.label, venue: loaded.account.exchange, positions }, { venue: loaded.account.exchange, provider: "user_exchange_account", observedAt: nowIso(), degraded: false });
    }
  }),
  descriptor({
    id: "risk.analyze_portfolio", routineIds: [AGENT_ROUTINE_IDS.positionSnapshot, AGENT_ROUTINE_IDS.positionRisk], title: "Portfolio risk", description: "Deterministic read-only risk analysis for every open position in the selected account.", category: "risk", accessLevel: "account_read", maxCallsPerRun: 1, timeoutMs: 12_000, cacheTtlMs: 0, supportedMarketTypes: ["perp"], inputSchema: portfolioRiskArgsSchema,
    toolDefinition: tool("risk_analyze_portfolio", "Analyze all open positions in the server-bound selected account. This tool never requires a symbol.", { accountRef: { type: "string", enum: ["selected"] } }),
    async execute(context, input) {
      portfolioRiskArgsSchema.parse(input);
      const loaded = await loadPerpPositions(context);
      const positions = loaded.positions.slice(0, 50).map((position, index) => {
        const positionRef = index === 0 ? "selected" : `position:${createHash("sha256").update(`${context.runId}:${index}`).digest("hex").slice(0, 16)}`;
        context.positionRefs.set(positionRef, position);
        if (index === 0) context.positionRefs.set("selected", position);
        const routineInput = { ...position, exchangeAccountId: loaded.account.id, exchange: loaded.account.exchange, marketType: "perp", unrealizedPnlUsd: position.unrealizedPnl, dataDegraded: false, observedAt: nowIso(), openedByPredictionCopier: false };
        const snapshot = executeAgentRoutine<any>(AGENT_ROUTINE_IDS.positionSnapshot, { input: routineInput, locale: context.locale });
        const { exchangeAccountId: _exchangeAccountId, ...readOnlySnapshot } = snapshot;
        const risk = executeAgentRoutine<any>(AGENT_ROUTINE_IDS.positionRisk, { input: routineInput, locale: context.locale });
        return { positionRef, snapshot: readOnlySnapshot, analysis: risk.analysis };
      });
      return ok("risk.analyze_portfolio", { accountLabel: loaded.account.label, venue: loaded.account.exchange, positionCount: positions.length, positions }, { venue: loaded.account.exchange, provider: "position_copilot_deterministic", observedAt: nowIso(), degraded: positions.some((position) => position.analysis.dataQuality.state === "degraded") });
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
    id: "risk.analyze_position_snapshot", routineIds: [AGENT_ROUTINE_IDS.positionSnapshot, AGENT_ROUTINE_IDS.positionRisk], title: "Position risk", description: "Shared deterministic Position Copilot analysis.", category: "risk", accessLevel: "account_read", maxCallsPerRun: 2, timeoutMs: 4_000, cacheTtlMs: 0, supportedMarketTypes: ["perp"], inputSchema: riskArgsSchema,
    toolDefinition: tool("risk_analyze_position_snapshot", "Analyze a previously loaded opaque position reference with deterministic risk rules.", { positionRef: { type: "string" } }),
    async execute(context, input) {
      const args = riskArgsSchema.parse(input); let position = context.positionRefs.get(args.positionRef) as NormalizedPosition | undefined;
      const account = await requireOwnedSelectedAccount(context);
      if (!position && args.positionRef === "selected") { const loaded = await loadPerpPositions(context, context.symbol ?? undefined); position = loaded.positions[0]; }
      if (!position) throw new AgentChatError("agent_chat_account_access_denied", 404, "Position reference is stale or unavailable.");
      const routineInput = { ...position, exchangeAccountId: account.id, exchange: account.exchange, marketType: "perp", unrealizedPnlUsd: position.unrealizedPnl, dataDegraded: false, observedAt: nowIso(), openedByPredictionCopier: false };
      const snapshot = executeAgentRoutine<any>(AGENT_ROUTINE_IDS.positionSnapshot, { input: routineInput, locale: context.locale });
      const analysis = executeAgentRoutine<any>(AGENT_ROUTINE_IDS.positionRisk, { input: routineInput, locale: context.locale }).analysis;
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
  context.signal?.throwIfAborted();
  if (!context.profile.enabledSkillIds.includes(skill.id)) throw new AgentChatError("agent_chat_skill_not_allowed", 403);
  if (!skill.allowedProfiles.includes(context.profile.baseProfileKey)) throw new AgentChatError("agent_chat_skill_not_allowed", 403);
  if (skill.accessLevel === "account_read" && context.profile.actionLevel !== "account_read") throw new AgentChatError("agent_chat_skill_not_allowed", 403);
  if (!skill.supportedMarketTypes.includes(context.marketType)) throw new AgentChatError("agent_chat_venue_unsupported", 400);
  const input = skill.inputSchema.parse(rawInput);
  if (input.marketType && !skill.supportedMarketTypes.includes(input.marketType)) throw new AgentChatError("agent_chat_venue_unsupported", 400);
  // Tool outputs can contain user predictions or depend on account-derived venue
  // selection. Only normalized public snapshots are shared across runs/users.
  const cacheKey = JSON.stringify([skill.id, skill.version, context.userId, context.runId,
    context.conversationId, context.symbol, context.selectedExchangeAccountId,
    context.profile.id, context.profile.version, context.profile.preferredVenue,
    context.selectedVenue, context.marketType, input]);
  if (skill.accessLevel === "public_data" && skill.cacheTtlMs > 0) {
    const cached = publicCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const result = structuredClone(cached.result);
      result.meta.cacheHit = true;
      if (result.meta.observedAt && result.meta.timestampSource === "provider") {
        result.meta.ageMs = Math.max(0, Date.now() - Date.parse(result.meta.observedAt));
      }
      return result;
    }
  }
  const result = await skill.execute(context, input);
  context.signal?.throwIfAborted();
  const sanitized = redactAiSafetySecrets(result) as AgentToolResult;
  const parsedOutput = skill.outputSchema.safeParse(sanitized.data);
  if (!sanitized.ok || !parsedOutput.success) {
    throw new AgentChatError("agent_chat_tool_result_invalid", 502, `Invalid output from ${skill.id}.`);
  }
  sanitized.data = parsedOutput.data;
  try {
    if (sanitized.meta.marketSnapshot) sanitized.meta.marketSnapshot = marketSnapshotEvidenceSchema.parse(sanitized.meta.marketSnapshot);
    if (sanitized.meta.featureSnapshots) sanitized.meta.featureSnapshots = sanitized.meta.featureSnapshots.slice(0, 4).map(feature => {
      if (!sanitized.meta.marketSnapshot || !featureMatchesSnapshot(feature, sanitized.meta.marketSnapshot)) throw new Error("feature_source_mismatch");
      const { id, version, snapshotId, inputSnapshotId } = feature;
      return storedFeatureEvidence({ id, version, snapshotId, inputSnapshotId }, feature.value, feature.routineVersions);
    });
  } catch { throw new AgentChatError("agent_chat_tool_result_invalid", 502, `Invalid evidence from ${skill.id}.`); }
  sanitized.meta.routineVersions = routineVersionRefs(skill.routineIds as readonly AgentRoutineId[]);
  if (skill.accessLevel === "public_data" && skill.cacheTtlMs > 0) {
    for (const [key, entry] of publicCache) if (entry.expiresAt <= Date.now()) publicCache.delete(key);
    if (publicCache.size >= 128) publicCache.delete(publicCache.keys().next().value!);
    publicCache.set(cacheKey, { expiresAt: Date.now() + skill.cacheTtlMs, result: structuredClone(sanitized) });
  }
  return sanitized;
}
