import { createHash } from "node:crypto";
import { z } from "zod";
import { derivativesHistoryInputSchema, historyPointSchema, type DerivativesHistoryInput } from "../ai/routines/derivativesHistory.js";
import { createSnapshotCache, type SnapshotCacheOptions } from "./snapshotCache.js";

const requestSchema = z.object({
  venue: z.enum(["binance", "bitget", "mexc", "hyperliquid", "bingx"]),
  symbol: z.string().regex(/^[A-Z0-9]{2,24}USDT$/),
  kind: z.enum(["funding", "open_interest"])
}).strict();
export type HistoryRequest = z.infer<typeof requestSchema>;
export type PublicHistorySnapshot = {
  id: string; providerId: string; sourceVenue: HistoryRequest["venue"]; symbol: string;
  marketType: "perp"; fetchedAt: string; input: DerivativesHistoryInput;
};
const windowMs = (kind: HistoryRequest["kind"]) => (kind === "funding" ? 30 : 7) * 24 * 60 * 60 * 1000;
const HOUR_MS = 3_600_000;
const decimal = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Only one public page is requested. No account, credentials, pagination or fallback.
export function historyRequestUrl(raw: HistoryRequest, end: number): { url: URL; limit: number } {
  const request = requestSchema.parse(raw);
  if (request.kind === "open_interest" && request.venue !== "binance") throw new Error("history_provider_unsupported");
  const params = new URLSearchParams();
  let base: string;
  let limit = 200;
  if (request.venue === "binance") {
    base = `https://fapi.binance.com/${request.kind === "funding" ? "fapi/v1/fundingRate" : "futures/data/openInterestHist"}`;
    params.set("symbol", request.symbol); params.set("startTime", String(end - windowMs(request.kind))); params.set("endTime", String(end));
    params.set("limit", String(limit));
    if (request.kind === "open_interest") params.set("period", "1h");
  } else if (request.venue === "bitget") {
    base = "https://api.bitget.com/api/v2/mix/market/history-fund-rate"; limit = 100;
    params.set("symbol", request.symbol); params.set("productType", "USDT-FUTURES"); params.set("pageNo", "1"); params.set("pageSize", String(limit));
  } else if (request.venue === "mexc") {
    base = "https://contract.mexc.com/api/v1/contract/funding_rate/history";
    params.set("symbol", request.symbol.replace(/USDT$/, "_USDT")); params.set("page_num", "1"); params.set("page_size", String(limit));
  } else throw new Error("history_provider_not_verified");
  const url = new URL(base); url.search = params.toString();
  return { url, limit };
}

export function normalizePublicHistory(rawRequest: HistoryRequest, payload: unknown, end: number, evaluatedAt: number): DerivativesHistoryInput {
  const request = requestSchema.parse(rawRequest);
  const { limit } = historyRequestUrl(request, end);
  const envelope = record(payload);
  let rawRows: unknown;
  if (request.venue === "binance") rawRows = payload;
  else if (request.venue === "bitget" && envelope.code === "00000") rawRows = envelope.data;
  else if (request.venue === "mexc" && envelope.success === true && envelope.code === 0) rawRows = record(envelope.data).resultList;
  if (!Array.isArray(rawRows) || rawRows.length > limit) throw new Error("history_provider_response_invalid");
  const points: z.infer<typeof historyPointSchema>[] = [];
  const warnings = new Set<string>();
  let excludedRows = 0;
  let reachesBeforeWindow = false;
  for (const raw of rawRows) {
    const row = record(raw);
    const expectedSymbol = request.venue === "mexc" ? request.symbol.replace(/USDT$/, "_USDT") : request.symbol;
    if (row.symbol !== expectedSymbol) throw new Error("history_provider_identity_mismatch");
    const timestamp = decimal(request.venue === "mexc" ? row.settleTime : request.kind === "funding" ? row.fundingTime : row.timestamp);
    const value = decimal(request.kind === "funding" ? row.fundingRate : row.sumOpenInterest);
    if (timestamp === null || !Number.isSafeInteger(timestamp) || timestamp <= 0 || value === null || (request.kind === "open_interest" && value < 0)) {
      excludedRows++; continue;
    }
    // Page-only APIs may return older observations. They are outside the requested
    // analysis window, not malformed data or synthetic gaps within that window.
    if (timestamp < end - windowMs(request.kind)) { reachesBeforeWindow = true; continue; }
    if (timestamp > end) { excludedRows++; warnings.add("history_future_observation"); continue; }
    if (request.venue === "binance" && request.kind === "funding" && row.rateType !== "Regular") {
      excludedRows++; warnings.add("history_funding_event_type_not_regular"); continue;
    }
    // Binance OI period is contractual. Funding cadence is not inferred from
    // today's snapshot or event spacing. MEXC supplies collectCycle per event.
    const cycle = request.venue === "mexc" ? decimal(row.collectCycle) : null;
    const cadenceMs = request.kind === "open_interest" ? HOUR_MS : cycle !== null && cycle > 0 && cycle <= 24 ? cycle * HOUR_MS : null;
    const notional = request.kind === "open_interest" ? decimal(row.sumOpenInterestValue) : null;
    if (request.kind === "open_interest" && (notional === null || notional < 0)) warnings.add("history_reported_notional_unavailable");
    points.push({ timestamp, value, reportedNotional: notional !== null && notional >= 0 ? notional : null, cadenceMs });
  }
  return derivativesHistoryInputSchema.parse({ kind: request.kind, unit: request.kind === "funding" ? "rate" : "base_asset",
    requestedStart: end - windowMs(request.kind), requestedEnd: end, evaluatedAt, points,
    warningCodes: [...warnings], excludedRows, conflictingDuplicates: false, truncated: rawRows.length === limit && !reachesBeforeWindow });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(response.status === 429 ? "history_provider_rate_limited" : "history_provider_unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("history_provider_response_invalid");
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262_144) throw new Error("history_provider_response_too_large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); }
}

export function createPublicHistoryStore(options: SnapshotCacheOptions & { fetch?: typeof fetch } = {}) {
  const cache = createSnapshotCache<PublicHistorySnapshot>(options);
  const now = options.now ?? Date.now;
  const requestFetch: typeof fetch = options.fetch ?? ((...args) => fetch(...args));
  return {
    async read(raw: HistoryRequest) {
      const request = requestSchema.parse(raw);
      const end = now();
      const { url } = historyRequestUrl(request, end);
      const key = JSON.stringify({ ...request, policy: "funding30d-oi7d-one-page-v1" });
      const result = await cache.read(key, 60_000, async () => {
        const response = await requestFetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(6_000) });
        const payload = await readBoundedJson(response);
        const fetched = now();
        const input = normalizePublicHistory(request, payload, end, fetched);
        const content = { providerId: `uliquid-native:${request.venue}`, sourceVenue: request.venue,
          symbol: request.symbol, marketType: "perp" as const, fetchedAt: new Date(fetched).toISOString(), input };
        return { id: `mds_${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`, ...content };
      });
      // Re-evaluate age without changing cached observation identity or fetch time.
      return { ...result, evaluationInput: derivativesHistoryInputSchema.parse({ ...result.snapshot.input, evaluatedAt: now() }) };
    }
  };
}
