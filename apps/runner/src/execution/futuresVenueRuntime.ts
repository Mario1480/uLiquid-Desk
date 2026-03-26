import {
  createResolvedFuturesAdapter,
  type SupportedFuturesAdapter
} from "@mm/futures-exchange";

const MEXC_FUTURES_ENABLED_LEGACY = !["0", "false", "off", "no"].includes(
  String(process.env.MEXC_FUTURES_ENABLED ?? "0").trim().toLowerCase()
);
export const RUNNER_MEXC_PERP_ENABLED =
  typeof process.env.MEXC_PERP_ENABLED === "string"
    ? !["0", "false", "off", "no"].includes(
        String(process.env.MEXC_PERP_ENABLED ?? "0").trim().toLowerCase()
      )
    : MEXC_FUTURES_ENABLED_LEGACY;

const adapterCache = new Map<string, SupportedFuturesAdapter>();

export type RunnerSupportedFuturesAdapter = SupportedFuturesAdapter;

export type RunnerFuturesAdapterResolution = {
  cacheKey: string;
  exchange: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
};

export function normalizeVaultExecutionState(
  value: unknown
): "active" | "paused" | "close_only" | "closed" | "error" {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "PAUSED" || normalized === "STOPPED") return "paused";
  if (normalized === "CLOSE_ONLY") return "close_only";
  if (normalized === "CLOSED") return "closed";
  if (normalized === "ERROR") return "error";
  return "active";
}

export function normalizeComparableSymbol(value: string): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export async function fetchBinancePerpMarkPrice(symbol: string): Promise<number | null> {
  const normalized = normalizeComparableSymbol(symbol);
  if (!normalized) return null;
  const baseUrl = (process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "");
  const url = `${baseUrl}/fapi/v1/ticker/price?symbol=${encodeURIComponent(normalized)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;
    const parsed = Number((payload as Record<string, unknown>).price ?? NaN);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseTickerPrice(payload: unknown): number | null {
  const row = Array.isArray(payload) ? payload[0] ?? null : payload;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const candidates = [
    record.markPrice,
    record.midPrice,
    record.lastPr,
    record.last,
    record.price,
    record.close,
    record.indexPrice,
    record.lastPrice,
    record.mark
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate ?? NaN);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export type AdapterMarkPriceDiagnostic = {
  ok: boolean;
  price: number | null;
  priceSource: string | null;
  endpointFailures: Array<Record<string, unknown>>;
  retryCount: number;
  staleCacheAgeMs: number | null;
  errorCategory: string | null;
  symbol: string;
  exchangeSymbol: string;
  attemptedSources: string[];
  usedCachedSnapshot: boolean;
};

function classifyAdapterReadError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error ?? "unknown_error");
  }
  const record = error as Record<string, unknown>;
  const code = String(record.code ?? "").toUpperCase();
  const name = String(record.name ?? "");
  const message = String(record.message ?? "").toLowerCase();
  const status = Number(record.status ?? (record.response && typeof record.response === "object"
    ? (record.response as Record<string, unknown>).status
    : NaN));
  if (Number.isFinite(status)) {
    if (status >= 500) return "upstream";
    if (status >= 400) return "client";
  }
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
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    message.includes("fetch failed") ||
    message.includes("network")
  ) {
    return "network";
  }
  return "unknown";
}

function parseTickerDiagnostics(
  payload: unknown,
  symbol: string,
  exchangeSymbol: string
): AdapterMarkPriceDiagnostic {
  const row = Array.isArray(payload) ? payload[0] ?? null : payload;
  const record = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  const diagnostics =
    record?.diagnostics && typeof record.diagnostics === "object"
      ? (record.diagnostics as Record<string, unknown>)
      : null;
  const price = parseTickerPrice(payload);
  const endpointFailures = Array.isArray(diagnostics?.endpointFailures)
    ? diagnostics.endpointFailures.filter(
        (item): item is Record<string, unknown> => !!item && typeof item === "object"
      )
    : [];
  const retryCount = Number(diagnostics?.retryCount ?? 0);
  const staleCacheAgeMs = Number(diagnostics?.snapshotAgeMs ?? NaN);
  const priceSource = typeof record?.priceSource === "string" ? record.priceSource : null;
  const attemptedSources = Array.isArray(diagnostics?.attemptedSources)
    ? diagnostics.attemptedSources
        .filter((item): item is string => typeof item === "string")
    : [];
  const errorCategory = typeof diagnostics?.errorCategory === "string"
    ? diagnostics.errorCategory
    : null;
  return {
    ok: price !== null && price > 0,
    price,
    priceSource,
    endpointFailures,
    retryCount: Number.isFinite(retryCount) && retryCount >= 0 ? retryCount : 0,
    staleCacheAgeMs: Number.isFinite(staleCacheAgeMs) && staleCacheAgeMs >= 0 ? staleCacheAgeMs : null,
    errorCategory,
    symbol,
    exchangeSymbol,
    attemptedSources,
    usedCachedSnapshot: diagnostics?.usedCachedSnapshot === true
  };
}

export async function readMarkPriceDiagnosticFromAdapter(
  adapter: SupportedFuturesAdapter,
  symbol: string
): Promise<AdapterMarkPriceDiagnostic> {
  const adapterAny = adapter as any;
  let exchangeSymbol = symbol;
  try {
    exchangeSymbol = typeof adapterAny.toExchangeSymbol === "function"
      ? await adapterAny.toExchangeSymbol(symbol)
      : symbol;

    if (typeof adapterAny.getLatestTickerSnapshot === "function") {
      const cachedPayload = adapterAny.getLatestTickerSnapshot(exchangeSymbol);
      if (cachedPayload) {
        const cachedDiagnostic = parseTickerDiagnostics(cachedPayload, symbol, exchangeSymbol);
        if (cachedDiagnostic.ok) return cachedDiagnostic;
      }
    }

    if (adapterAny.marketApi && typeof adapterAny.marketApi.getTicker === "function") {
      const ticker = await adapterAny.marketApi.getTicker(exchangeSymbol);
      return parseTickerDiagnostics(ticker, symbol, exchangeSymbol);
    }
  } catch (error) {
    const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
    const endpointFailures = Array.isArray(record?.endpointFailures)
      ? record.endpointFailures.filter(
          (item): item is Record<string, unknown> => !!item && typeof item === "object"
        )
      : [{
          endpoint: "symbol_resolution",
          errorCategory: typeof record?.errorCategory === "string"
            ? record.errorCategory
            : classifyAdapterReadError(error),
          retryCount: 0,
          message: String(record?.message ?? error ?? "adapter_ticker_failed")
        }];
    const retryCount = Number(record?.retryCount ?? 0);
    return {
      ok: false,
      price: null,
      priceSource: null,
      endpointFailures,
      retryCount: Number.isFinite(retryCount) && retryCount >= 0 ? retryCount : 0,
      staleCacheAgeMs: null,
      errorCategory:
        typeof record?.errorCategory === "string"
          ? record.errorCategory
          : classifyAdapterReadError(error),
      symbol,
      exchangeSymbol,
      attemptedSources: exchangeSymbol === symbol ? [] : ["markPx", "mid"],
      usedCachedSnapshot: false
    };
  }

  return {
    ok: false,
    price: null,
    priceSource: null,
    endpointFailures: [],
    retryCount: 0,
    staleCacheAgeMs: null,
    errorCategory: "adapter_market_api_unavailable",
    symbol,
    exchangeSymbol,
    attemptedSources: [],
    usedCachedSnapshot: false
  };
}

export async function readMarkPriceFromAdapter(
  adapter: SupportedFuturesAdapter,
  symbol: string
): Promise<number | null> {
  const result = await readMarkPriceDiagnosticFromAdapter(adapter, symbol).catch(() => null);
  return result?.ok ? result.price : null;
}

export function getOrCreateRunnerFuturesAdapter(
  resolution: RunnerFuturesAdapterResolution
): SupportedFuturesAdapter | null {
  const exchange = String(resolution.exchange ?? "").trim().toLowerCase();
  if (exchange === "paper" || exchange === "binance") return null;
  if (exchange === "mexc" && !RUNNER_MEXC_PERP_ENABLED) return null;
  const cached = adapterCache.get(resolution.cacheKey);
  if (cached) return cached;
  const resolved = createResolvedFuturesAdapter(
    {
      exchange,
      apiKey: resolution.apiKey,
      apiSecret: resolution.apiSecret,
      passphrase: resolution.passphrase ?? undefined
    },
    {
      allowMexcPerp: RUNNER_MEXC_PERP_ENABLED,
      allowBinancePerp: false
    }
  );
  if (resolved.kind !== "adapter") return null;
  adapterCache.set(resolution.cacheKey, resolved.adapter);
  return resolved.adapter;
}
