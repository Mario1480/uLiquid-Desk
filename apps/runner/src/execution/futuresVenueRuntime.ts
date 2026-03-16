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

export async function readMarkPriceFromAdapter(
  adapter: SupportedFuturesAdapter,
  symbol: string
): Promise<number | null> {
  try {
    const adapterAny = adapter as any;
    const exchangeSymbol = typeof adapterAny.toExchangeSymbol === "function"
      ? await adapterAny.toExchangeSymbol(symbol)
      : symbol;
    if (adapterAny.marketApi && typeof adapterAny.marketApi.getTicker === "function") {
      const ticker = await adapterAny.marketApi.getTicker(exchangeSymbol);
      const parsed = parseTickerPrice(ticker);
      if (parsed && parsed > 0) return parsed;
    }
  } catch {
    // best-effort only
  }
  return null;
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
