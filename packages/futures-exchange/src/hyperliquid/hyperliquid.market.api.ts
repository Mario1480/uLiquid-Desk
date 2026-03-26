import type { Hyperliquid, MetaAndAssetCtxs } from "hyperliquid";
import { computeRetryDelayMs } from "../core/retry-policy.js";
import { parseCoinFromAnySymbol } from "./hyperliquid.symbols.js";
import type { HyperliquidAdapterConfig, HyperliquidContractRaw } from "./hyperliquid.types.js";

export type HyperliquidPriceSource = "markPx" | "mid";
export type HyperliquidMarketEndpoint = "getAllMids" | "getMetaAndAssetCtxs";
export type HyperliquidMarketErrorCategory =
  | "timeout"
  | "network"
  | "upstream"
  | "client"
  | "invalid_payload"
  | "unknown";

export type HyperliquidMarketEndpointFailure = {
  endpoint: HyperliquidMarketEndpoint;
  errorCategory: HyperliquidMarketErrorCategory;
  retryCount: number;
  message: string;
  status?: number;
};

export type HyperliquidTickerDiagnostics = {
  degraded: boolean;
  endpointFailures: HyperliquidMarketEndpointFailure[];
  retryCount: number;
  snapshotFetchedAt: number;
  snapshotAgeMs: number;
  usedCachedSnapshot: boolean;
  attemptedSources: Array<HyperliquidPriceSource>;
  errorCategory: HyperliquidMarketErrorCategory | null;
  symbolFoundInMids: boolean;
  symbolFoundInAssetCtxs: boolean;
};

export type HyperliquidTickerSnapshot = {
  symbol: string;
  coin: string;
  lastPr: number | null;
  last: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  bidPr: number | null;
  askPr: number | null;
  ts: number;
  priceSource: HyperliquidPriceSource | null;
  midPrice: number | null;
  diagnostics: HyperliquidTickerDiagnostics;
};

export type HyperliquidMarketSnapshot = {
  fetchedAt: number;
  retryCount: number;
  degraded: boolean;
  endpointFailures: HyperliquidMarketEndpointFailure[];
  usedCachedSnapshot: boolean;
  tickers: HyperliquidTickerSnapshot[];
  tickersByCoin: Map<string, HyperliquidTickerSnapshot>;
};

type HyperliquidMarketApiOptions = Pick<
  HyperliquidAdapterConfig,
  "timeoutMs" | "retryAttempts" | "retryBaseDelayMs" | "log"
> & {
  staleSnapshotMs?: number;
};

type RequestSuccess<T> = {
  ok: true;
  value: T;
  retryCount: number;
};

type RequestFailure = {
  ok: false;
  failure: HyperliquidMarketEndpointFailure;
};

type RequestResult<T> = RequestSuccess<T> | RequestFailure;

function toMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
  return Math.trunc(parsed);
}

function toInterval(granularity: string): string {
  const normalized = String(granularity ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "8h": "8h",
    "12h": "12h",
    "1d": "1d",
    "3d": "3d",
    "1w": "1w",
    "1M": "1M",
    "1month": "1M"
  };
  return map[normalized] ?? "1m";
}

function intervalToMs(interval: string): number {
  const raw = String(interval ?? "").trim();
  if (raw.endsWith("M")) {
    const amount = Number.parseInt(raw, 10);
    if (Number.isFinite(amount) && amount > 0) return amount * 30 * 24 * 60 * 60_000;
  }
  const normalized = raw.toLowerCase();
  const amount = Number.parseInt(normalized, 10);
  if (!Number.isFinite(amount) || amount <= 0) return 60_000;
  if (normalized.endsWith("m")) return amount * 60_000;
  if (normalized.endsWith("h")) return amount * 60 * 60_000;
  if (normalized.endsWith("d")) return amount * 24 * 60 * 60_000;
  if (normalized.endsWith("w")) return amount * 7 * 24 * 60 * 60_000;
  return 60_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toStatus(value: unknown): number | undefined {
  const direct = Number(value);
  if (Number.isFinite(direct) && direct >= 100) return Math.trunc(direct);
  return undefined;
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  return (
    toStatus(record.status) ??
    toStatus(record.statusCode) ??
    (record.response && typeof record.response === "object"
      ? toStatus((record.response as Record<string, unknown>).status)
      : undefined)
  );
}

function classifyMarketReadError(error: unknown): HyperliquidMarketErrorCategory {
  const status = extractHttpStatus(error);
  if (status !== undefined) {
    if (status >= 500) return "upstream";
    if (status >= 400) return "client";
  }

  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const name = String(record?.name ?? "");
  const code = String(record?.code ?? "").toUpperCase();
  const message = String(record?.message ?? error ?? "").toLowerCase();

  if (
    name === "AbortError" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return "timeout";
  }

  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("connection reset")
  ) {
    return "network";
  }

  if (message.includes("invalid payload") || message.includes("malformed")) {
    return "invalid_payload";
  }

  return "unknown";
}

function shouldRetryMarketRead(
  category: HyperliquidMarketErrorCategory,
  attempt: number,
  maxAttempts: number
): boolean {
  if (attempt >= maxAttempts) return false;
  return category === "timeout" || category === "network" || category === "upstream";
}

function createTimeoutError(endpoint: HyperliquidMarketEndpoint, timeoutMs: number): Error {
  const error = new Error(`hyperliquid ${endpoint} timed out after ${timeoutMs}ms`);
  (error as Error & { code?: string }).code = "ETIMEDOUT";
  return error;
}

async function withTimeout<T>(
  endpoint: HyperliquidMarketEndpoint,
  timeoutMs: number,
  work: () => Promise<T>
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(createTimeoutError(endpoint, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createFailure(
  endpoint: HyperliquidMarketEndpoint,
  error: unknown,
  retryCount: number
): HyperliquidMarketEndpointFailure {
  const errorCategory = classifyMarketReadError(error);
  const message = String(
    (error && typeof error === "object" && "message" in error
      ? (error as Record<string, unknown>).message
      : error) ?? `hyperliquid ${endpoint} failed`
  );
  return {
    endpoint,
    errorCategory,
    retryCount,
    message,
    status: extractHttpStatus(error)
  };
}

function normalizeMids(payload: unknown): Map<string, unknown> {
  const mids = new Map<string, unknown>();
  if (!payload || typeof payload !== "object") return mids;
  for (const [coin, value] of Object.entries(payload as Record<string, unknown>)) {
    mids.set(String(coin ?? "").trim().toUpperCase(), value);
  }
  return mids;
}

function normalizeCoin(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeAssetCtxMap(metaAndAssetCtxs: MetaAndAssetCtxs | null): {
  universe: Array<{ name?: string }>;
  ctxByCoin: Map<string, unknown>;
} {
  if (!metaAndAssetCtxs) {
    return {
      universe: [],
      ctxByCoin: new Map<string, unknown>()
    };
  }
  const [meta, assetCtxs] = metaAndAssetCtxs;
  const universe = Array.isArray(meta?.universe) ? meta.universe : [];
  const ctxByCoin = new Map<string, unknown>();
  for (const [index, row] of universe.entries()) {
    const coin = normalizeCoin((row as { name?: string } | null | undefined)?.name);
    if (!coin) continue;
    const ctx = Array.isArray(assetCtxs) ? assetCtxs[index] : null;
    ctxByCoin.set(coin, ctx ?? null);
  }
  return { universe, ctxByCoin };
}

export function parsePositivePrice(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function selectHyperliquidPrice(params: {
  markPx: unknown;
  mid: unknown;
}): {
  price: number | null;
  source: HyperliquidPriceSource | null;
  markPrice: number | null;
  midPrice: number | null;
  attemptedSources: Array<HyperliquidPriceSource>;
} {
  const markPrice = parsePositivePrice(params.markPx);
  const midPrice = parsePositivePrice(params.mid);
  const attemptedSources: Array<HyperliquidPriceSource> = ["markPx", "mid"];
  if (markPrice) {
    return {
      price: markPrice,
      source: "markPx",
      markPrice,
      midPrice,
      attemptedSources
    };
  }
  if (midPrice) {
    return {
      price: midPrice,
      source: "mid",
      markPrice,
      midPrice,
      attemptedSources
    };
  }
  return {
    price: null,
    source: null,
    markPrice,
    midPrice,
    attemptedSources
  };
}

function cloneTickerForAge(
  ticker: HyperliquidTickerSnapshot,
  snapshotFetchedAt: number,
  usedCachedSnapshot: boolean,
  endpointFailures: HyperliquidMarketEndpointFailure[],
  retryCount: number,
  errorCategory: HyperliquidMarketErrorCategory | null
): HyperliquidTickerSnapshot {
  return {
    ...ticker,
    diagnostics: {
      ...ticker.diagnostics,
      degraded: ticker.diagnostics.degraded || endpointFailures.length > 0 || usedCachedSnapshot,
      endpointFailures,
      retryCount,
      snapshotFetchedAt,
      snapshotAgeMs: Math.max(0, Date.now() - snapshotFetchedAt),
      usedCachedSnapshot,
      errorCategory
    }
  };
}

function createStructuredMarketError(params: {
  message: string;
  endpointFailures: HyperliquidMarketEndpointFailure[];
  retryCount: number;
}): Error & {
  endpointFailures: HyperliquidMarketEndpointFailure[];
  retryCount: number;
  errorCategory: HyperliquidMarketErrorCategory | null;
} {
  const error = new Error(params.message) as Error & {
    endpointFailures: HyperliquidMarketEndpointFailure[];
    retryCount: number;
    errorCategory: HyperliquidMarketErrorCategory | null;
  };
  error.endpointFailures = params.endpointFailures;
  error.retryCount = params.retryCount;
  error.errorCategory = params.endpointFailures[0]?.errorCategory ?? null;
  return error;
}

export class HyperliquidMarketApi {
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly staleSnapshotMs: number;
  private lastSnapshot: HyperliquidMarketSnapshot | null = null;

  constructor(
    private readonly sdk: Hyperliquid,
    private readonly options: HyperliquidMarketApiOptions = {}
  ) {
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs ?? process.env.HYPERLIQUID_INFO_TIMEOUT_MS ?? "8_000"));
    this.retryAttempts = Math.max(1, Number(options.retryAttempts ?? process.env.HYPERLIQUID_INFO_RETRY_ATTEMPTS ?? "3"));
    this.retryBaseDelayMs = Math.max(
      100,
      Number(options.retryBaseDelayMs ?? process.env.HYPERLIQUID_INFO_RETRY_BASE_DELAY_MS ?? "300")
    );
    this.staleSnapshotMs = Math.max(
      this.timeoutMs,
      Number(options.staleSnapshotMs ?? process.env.HYPERLIQUID_MARKET_SNAPSHOT_MAX_STALE_MS ?? "10_000")
    );
  }

  async getMetaAndAssetCtxs(): Promise<MetaAndAssetCtxs> {
    const result = await this.readWithRetry("getMetaAndAssetCtxs", async () => {
      const value = await this.sdk.info.perpetuals.getMetaAndAssetCtxs(true);
      if (!Array.isArray(value) || value.length < 2) {
        throw new Error("hyperliquid getMetaAndAssetCtxs invalid payload");
      }
      return value as MetaAndAssetCtxs;
    });
    if (!result.ok) {
      throw new Error(result.failure.message);
    }
    return result.value;
  }

  async getContracts(_productType?: string): Promise<HyperliquidContractRaw[]> {
    const meta = await this.sdk.info.perpetuals.getMeta(true);
    return Array.isArray(meta?.universe) ? (meta.universe as HyperliquidContractRaw[]) : [];
  }

  async getMarketSnapshot(): Promise<HyperliquidMarketSnapshot> {
    const fetchedAt = Date.now();
    const [midsResult, metaResult] = await Promise.all([
      this.readWithRetry("getAllMids", async () => this.sdk.info.getAllMids(true)),
      this.readWithRetry("getMetaAndAssetCtxs", async () => {
        const value = await this.sdk.info.perpetuals.getMetaAndAssetCtxs(true);
        if (!Array.isArray(value) || value.length < 2) {
          throw new Error("hyperliquid getMetaAndAssetCtxs invalid payload");
        }
        return value as MetaAndAssetCtxs;
      })
    ]);

    const endpointFailures = [
      midsResult.ok ? null : midsResult.failure,
      metaResult.ok ? null : metaResult.failure
    ].filter((item): item is HyperliquidMarketEndpointFailure => item !== null);
    const retryCount = (midsResult.ok ? midsResult.retryCount : midsResult.failure.retryCount) +
      (metaResult.ok ? metaResult.retryCount : metaResult.failure.retryCount);

    const mids = midsResult.ok ? normalizeMids(midsResult.value) : new Map<string, unknown>();
    const { universe, ctxByCoin } = normalizeAssetCtxMap(metaResult.ok ? metaResult.value : null);
    const coins = new Set<string>();
    for (const coin of mids.keys()) coins.add(coin);
    for (const row of universe) {
      const coin = normalizeCoin(row?.name);
      if (coin) coins.add(coin);
    }

    if (coins.size === 0) {
      const cached = this.useCachedSnapshot(endpointFailures, retryCount);
      if (cached) return cached;
      throw createStructuredMarketError({
        message: endpointFailures[0]?.message ?? "hyperliquid market snapshot unavailable",
        endpointFailures,
        retryCount
      });
    }

    const tickersByCoin = new Map<string, HyperliquidTickerSnapshot>();
    for (const coin of coins) {
      const ctx = ctxByCoin.get(coin) ?? null;
      const midRaw = mids.get(coin) ?? null;
      const selection = selectHyperliquidPrice({
        markPx: ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>).markPx : null,
        mid: midRaw
      });
      const indexPrice = parsePositivePrice(
        ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>).oraclePx : null
      );
      const lastPrice = selection.midPrice ?? selection.price;
      if (!selection.price && !lastPrice && !indexPrice) continue;

      const diagnostics: HyperliquidTickerDiagnostics = {
        degraded: endpointFailures.length > 0,
        endpointFailures,
        retryCount,
        snapshotFetchedAt: fetchedAt,
        snapshotAgeMs: 0,
        usedCachedSnapshot: false,
        attemptedSources: selection.attemptedSources,
        errorCategory: endpointFailures[0]?.errorCategory ?? null,
        symbolFoundInMids: selection.midPrice !== null,
        symbolFoundInAssetCtxs: ctxByCoin.has(coin)
      };

      tickersByCoin.set(coin, {
        symbol: `${coin}-PERP`,
        coin,
        lastPr: lastPrice,
        last: lastPrice,
        markPrice: selection.price,
        indexPrice,
        bidPr: lastPrice,
        askPr: lastPrice,
        ts: fetchedAt,
        priceSource: selection.source,
        midPrice: selection.midPrice,
        diagnostics
      });
    }

    if (tickersByCoin.size === 0) {
      const cached = this.useCachedSnapshot(endpointFailures, retryCount);
      if (cached) return cached;
      throw createStructuredMarketError({
        message: endpointFailures[0]?.message ?? "hyperliquid market snapshot has no usable prices",
        endpointFailures,
        retryCount
      });
    }

    const snapshot: HyperliquidMarketSnapshot = {
      fetchedAt,
      retryCount,
      degraded: endpointFailures.length > 0,
      endpointFailures,
      usedCachedSnapshot: false,
      tickers: [...tickersByCoin.values()],
      tickersByCoin
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  async getTicker(symbol: string, _productType?: string): Promise<HyperliquidTickerSnapshot> {
    const coin = parseCoinFromAnySymbol(symbol);
    const snapshot = await this.getMarketSnapshot();
    const ticker = snapshot.tickersByCoin.get(coin);
    if (ticker) return ticker;
    throw createStructuredMarketError({
      message: `hyperliquid_ticker_not_found:${coin}`,
      endpointFailures: [],
      retryCount: snapshot.retryCount
    });
  }

  async getTickers(_productType?: string): Promise<HyperliquidTickerSnapshot[]> {
    const snapshot = await this.getMarketSnapshot();
    return snapshot.tickers;
  }

  async getCandles(params: {
    symbol: string;
    granularity: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    productType?: string;
  }): Promise<unknown> {
    const coin = parseCoinFromAnySymbol(params.symbol);
    const endTime = toMs(params.endTime ?? Date.now());
    const interval = toInterval(params.granularity);
    const intervalMs = intervalToMs(interval);
    const defaultWindowMs = Math.max(intervalMs, (Number(params.limit ?? 500) || 500) * intervalMs);
    const startTime = toMs(params.startTime ?? endTime - defaultWindowMs);

    return this.sdk.info.getCandleSnapshot(coin, interval, startTime, endTime, true);
  }

  async getDepth(symbol: string, _limit = 50, _productType?: string): Promise<unknown> {
    const coin = parseCoinFromAnySymbol(symbol);
    return this.sdk.info.getL2Book(coin, true);
  }

  async getTrades(_symbol: string, _limit = 100, _productType?: string): Promise<unknown> {
    return [];
  }

  private useCachedSnapshot(
    endpointFailures: HyperliquidMarketEndpointFailure[],
    retryCount: number
  ): HyperliquidMarketSnapshot | null {
    const cached = this.lastSnapshot;
    if (!cached) return null;
    const ageMs = Date.now() - cached.fetchedAt;
    if (ageMs > this.staleSnapshotMs) return null;
    const errorCategory = endpointFailures[0]?.errorCategory ?? cached.endpointFailures[0]?.errorCategory ?? null;
    const nextFailures = [...cached.endpointFailures, ...endpointFailures];
    return {
      fetchedAt: cached.fetchedAt,
      retryCount: cached.retryCount + retryCount,
      degraded: true,
      endpointFailures: nextFailures,
      usedCachedSnapshot: true,
      tickers: cached.tickers.map((ticker) =>
        cloneTickerForAge(
          ticker,
          cached.fetchedAt,
          true,
          nextFailures,
          cached.retryCount + retryCount,
          errorCategory
        )
      ),
      tickersByCoin: new Map(
        [...cached.tickersByCoin.entries()].map(([coin, ticker]) => [
          coin,
          cloneTickerForAge(
            ticker,
            cached.fetchedAt,
            true,
            nextFailures,
            cached.retryCount + retryCount,
            errorCategory
          )
        ])
      )
    };
  }

  private async readWithRetry<T>(
    endpoint: HyperliquidMarketEndpoint,
    loader: () => Promise<T>
  ): Promise<RequestResult<T>> {
    let attempt = 0;
    let retryCount = 0;
    let lastError: unknown = null;
    while (attempt < this.retryAttempts) {
      attempt += 1;
      const startedAt = Date.now();
      try {
        const value = await withTimeout(endpoint, this.timeoutMs, loader);
        this.options.log?.({
          at: new Date().toISOString(),
          endpoint: `hyperliquid/${endpoint}`,
          method: "GET",
          durationMs: Date.now() - startedAt,
          ok: true
        });
        return {
          ok: true,
          value,
          retryCount
        };
      } catch (error) {
        lastError = error;
        const category = classifyMarketReadError(error);
        this.options.log?.({
          at: new Date().toISOString(),
          endpoint: `hyperliquid/${endpoint}`,
          method: "GET",
          durationMs: Date.now() - startedAt,
          status: extractHttpStatus(error),
          ok: false,
          message: String((error as { message?: string } | null)?.message ?? error ?? category)
        });
        if (!shouldRetryMarketRead(category, attempt, this.retryAttempts)) {
          return {
            ok: false,
            failure: createFailure(endpoint, error, retryCount)
          };
        }
        retryCount += 1;
        await sleep(computeRetryDelayMs(attempt, this.retryBaseDelayMs, 4_000));
      }
    }
    return {
      ok: false,
      failure: createFailure(endpoint, lastError, retryCount)
    };
  }
}
