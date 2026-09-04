export type PerpDerivativesSnapshot = {
  fundingRate: number | null;
  fundingIntervalHours: number | null;
  openInterest: number | null;
  openInterestUnit: "base_asset" | "quote_asset" | "contracts" | "provider_native" | "unknown";
  contractSize: number | null;
  markPrice: number | null;
  observedAt: string;
  sourceTimestampProvided: boolean;
  warnings: string[];
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pick(row: Record<string, unknown> | null, keys: string[]): number | null {
  for (const key of keys) { const value = numberOrNull(row?.[key]); if (value !== null) return value; }
  return null;
}

function observedAt(value: unknown) {
  const parsed = numberOrNull(value);
  if (parsed === null || parsed <= 0) return { observedAt: new Date().toISOString(), sourceTimestampProvided: false };
  const date = new Date(parsed < 10_000_000_000 ? parsed * 1000 : parsed);
  return Number.isFinite(date.getTime()) ? { observedAt: date.toISOString(), sourceTimestampProvided: true } : { observedAt: new Date().toISOString(), sourceTimestampProvided: false };
}

function baseSymbol(value: string): string {
  const canonical = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  for (const quote of ["USDT", "USDC", "USD", "BTC", "ETH"]) if (canonical.endsWith(quote) && canonical.length > quote.length) return canonical.slice(0, -quote.length);
  return canonical;
}

export function normalizePerpDerivativesSnapshot(params: { venue: "binance" | "bitget" | "hyperliquid" | "mexc" | "bingx"; symbol: string; primary?: unknown; secondary?: unknown }): PerpDerivativesSnapshot {
  if (params.venue === "bingx") return { fundingRate: null, fundingIntervalHours: null, openInterest: null, openInterestUnit: "unknown", contractSize: null, markPrice: null, observedAt: new Date().toISOString(), sourceTimestampProvided: false, warnings: ["funding_rate_unsupported", "open_interest_unsupported", "provider_timestamp_missing"] };
  if (params.venue === "binance") {
    const premium = record(params.primary); const interest = record(params.secondary); const timestamp = observedAt(premium?.time ?? interest?.time);
    return { fundingRate: pick(premium, ["lastFundingRate"]), fundingIntervalHours: null, openInterest: pick(interest, ["openInterest"]), openInterestUnit: "base_asset", contractSize: null, markPrice: pick(premium, ["markPrice", "indexPrice"]), ...timestamp, warnings: ["funding_interval_unavailable", ...(!timestamp.sourceTimestampProvided ? ["provider_timestamp_missing"] : [])] };
  }
  if (params.venue === "bitget") {
    const envelope = record(params.primary); const data = envelope?.data; const row = record(Array.isArray(data) ? data[0] : data) ?? record(Array.isArray(params.primary) ? params.primary[0] : params.primary); const timestamp = observedAt(envelope?.requestTime ?? row?.ts);
    return { fundingRate: pick(row, ["fundingRate"]), fundingIntervalHours: pick(row, ["fundingRateInterval", "fundingIntervalHours"]), openInterest: pick(row, ["holdingAmount", "openInterest"]), openInterestUnit: "provider_native", contractSize: null, markPrice: pick(row, ["markPrice", "indexPrice", "lastPr", "last"]), ...timestamp, warnings: timestamp.sourceTimestampProvided ? [] : ["provider_timestamp_missing"] };
  }
  if (params.venue === "hyperliquid") {
    const payload = params.primary; const meta = record(Array.isArray(payload) ? payload[0] : null); const contexts = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : []; const universe = Array.isArray(meta?.universe) ? meta.universe : []; const index = universe.findIndex((item) => String(record(item)?.name ?? "").toUpperCase() === baseSymbol(params.symbol)); const row = index >= 0 ? record(contexts[index]) : null; const timestamp = observedAt(row?.ts ?? row?.timestamp);
    return { fundingRate: pick(row, ["funding", "fundingRate"]), fundingIntervalHours: 1, openInterest: pick(row, ["openInterest"]), openInterestUnit: "base_asset", contractSize: null, markPrice: pick(row, ["markPx", "markPrice", "oraclePx"]), ...timestamp, warnings: timestamp.sourceTimestampProvided ? [] : ["provider_timestamp_missing"] };
  }
  const funding = record(params.primary); const ticker = record(Array.isArray(params.secondary) ? params.secondary[0] : params.secondary); const timestamp = observedAt(funding?.timestamp ?? funding?.ts ?? ticker?.timestamp ?? ticker?.ts);
  return { fundingRate: pick(funding, ["fundingRate", "rate"]), fundingIntervalHours: pick(funding, ["collectCycle", "fundingIntervalHours"]), openInterest: null, openInterestUnit: "unknown", contractSize: null, markPrice: pick(ticker, ["fairPrice", "lastPrice", "last"]), ...timestamp, warnings: ["open_interest_unsupported", ...(!timestamp.sourceTimestampProvided ? ["provider_timestamp_missing"] : [])] };
}
