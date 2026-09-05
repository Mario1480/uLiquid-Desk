import { createHash } from "node:crypto";
import { z } from "zod";
import { createSnapshotCache, type SnapshotCacheOptions } from "./snapshotCache.js";
import type { PerpDerivativesSnapshot } from "../perp/perp-derivatives-normalization.js";

const nullableNumber = z.number().finite().nullable();
const dataSchema = z.object({
  fundingRate: nullableNumber,
  fundingIntervalHours: nullableNumber,
  openInterest: nullableNumber,
  openInterestUnit: z.enum(["base_asset", "quote_asset", "contracts", "provider_native", "unknown"]),
  contractSize: nullableNumber,
  markPrice: nullableNumber,
  observedAt: z.string().datetime(),
  sourceTimestampProvided: z.boolean(),
  warnings: z.array(z.string().max(160)).max(32)
}).strict();

const keySchema = z.object({
  providerId: z.string().min(1).max(100),
  sourceVenue: z.enum(["binance", "bitget", "hyperliquid", "mexc", "bingx"]),
  marketType: z.literal("perp"),
  symbol: z.string().regex(/^[A-Z0-9]{2,32}$/)
}).strict();

export type DerivativesMarketKey = z.infer<typeof keySchema>;
export type SharedDerivativesSnapshot = {
  id: string;
  schemaVersion: "1.0.0";
  market: DerivativesMarketKey;
  data: PerpDerivativesSnapshot;
  fetchedAt: string;
};
export type SharedDerivativesRead = {
  snapshot: SharedDerivativesSnapshot;
  cacheHit: boolean;
  ageMs: number | null;
  quality: "fresh" | "stale" | "degraded";
  warnings: string[];
};

export function projectDerivativesSnapshot(snapshot: SharedDerivativesSnapshot, cacheHit: boolean, now = Date.now(), staleAfterMs = 120_000): SharedDerivativesRead {
  const observedMs = Date.parse(snapshot.data.observedAt);
  const missing = !snapshot.data.sourceTimestampProvided;
  const future = !missing && observedMs > now;
  const ageMs = missing ? null : Math.max(0, now - observedMs);
  const stale = ageMs !== null && ageMs > staleAfterMs;
  const warnings = [...new Set([...snapshot.data.warnings,
    ...(missing ? ["provider_timestamp_missing"] : []),
    ...(future ? ["provider_timestamp_in_future"] : []),
    ...(stale ? ["market_data_stale"] : [])])];
  return { snapshot: structuredClone(snapshot), cacheHit, ageMs,
    quality: stale ? "stale" : missing || future || warnings.length > 0 ? "degraded" : "fresh", warnings };
}

// Capability and account resolution must run before every shared or pinned read.
export function createSharedDerivativesStore(options: SnapshotCacheOptions & { ttlMs?: number; staleAfterMs?: number } = {}) {
  const config = z.object({ ttlMs: z.number().int().positive(), staleAfterMs: z.number().int().positive() })
    .parse({ ttlMs: options.ttlMs ?? 5_000, staleAfterMs: options.staleAfterMs ?? 120_000 });
  const now = options.now ?? Date.now;
  const cache = createSnapshotCache<SharedDerivativesSnapshot>(options);
  return {
    async read(market: DerivativesMarketKey, load: () => Promise<PerpDerivativesSnapshot>): Promise<SharedDerivativesRead> {
      const normalized = keySchema.parse(market);
      const result = await cache.read(JSON.stringify({ dataset: "derivatives", schemaVersion: "1.0.0", ...normalized }), config.ttlMs, async () => {
        const data = dataSchema.parse(await load());
        const fetchedAt = new Date(now()).toISOString();
        const content = { schemaVersion: "1.0.0" as const, market: normalized, data, fetchedAt };
        return { id: `mds_${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`, ...content };
      });
      return projectDerivativesSnapshot(result.snapshot, result.cacheHit, now(), config.staleAfterMs);
    }
  };
}
export const sharedDerivativesStore = createSharedDerivativesStore();
