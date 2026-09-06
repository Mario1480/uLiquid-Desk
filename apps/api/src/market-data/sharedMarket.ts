import { createHash } from "node:crypto";
import { z } from "zod";
import { createSnapshotCache, type SnapshotCacheOptions } from "./snapshotCache.js";

export const intervalMs = { "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 } as const;
export const marketIdentitySchema = z.object({ providerId: z.string().min(1).max(100),
  sourceVenue: z.enum(["binance", "bitget", "hyperliquid", "mexc", "bingx"]),
  marketType: z.enum(["spot", "perp"]), symbol: z.string().regex(/^[A-Z0-9]{2,32}$/) }).strict();
const common = { ...marketIdentitySchema.shape, schemaVersion: z.literal("1.0.0") };
export const marketDatasetKeySchema = z.discriminatedUnion("dataset", [
  z.object({ ...common, dataset: z.literal("candles"), interval: z.enum(["5m", "15m", "1h", "4h", "1d"]), limit: z.number().int().min(20).max(1000) }).strict(),
  z.object({ ...common, dataset: z.literal("ticker") }).strict(),
  z.object({ ...common, dataset: z.literal("orderbook"), limit: z.number().int().min(5).max(100) }).strict()
]);
export type MarketDatasetKey = z.infer<typeof marketDatasetKeySchema>;
const positive = z.number().finite().positive();
const numberOrNull = z.number().finite().nullable();
export const sharedCandleSchema = z.object({ ts: positive, open: positive, high: positive, low: positive, close: positive,
  volume: z.number().finite().nonnegative() }).strict().refine(row => row.high >= Math.max(row.open, row.close, row.low)
    && row.low <= Math.min(row.open, row.close), "invalid_candle_range");
const candleDataSchema = z.object({ candles: z.array(sharedCandleSchema).max(1000) }).strict();
const tickerDataSchema = z.object({ last: numberOrNull, mark: numberOrNull, bid: numberOrNull, ask: numberOrNull }).strict();
const bookDataSchema = z.object({ bids: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(100),
  asks: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(100) }).strict();
const observationSchema = z.object({ observedAt: z.string().datetime().nullable(),
  warnings: z.array(z.string().max(160)).max(32) });
export type MarketDatasetData = {
  candles: z.infer<typeof candleDataSchema>; ticker: z.infer<typeof tickerDataSchema>; orderbook: z.infer<typeof bookDataSchema>;
};
export type MarketDataset = keyof MarketDatasetData;

export function normalizeSharedOrderbook(depth: { bids: unknown; asks: unknown; ts?: unknown }, marketType: "spot" | "perp", venue: string, limit: number) {
  const numeric = z.union([z.number().finite(), z.string().trim().regex(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/).transform(Number).pipe(z.number().finite())]);
  const levels = z.array(z.tuple([numeric, numeric]));
  const data = { bids: levels.parse(depth.bids).slice(0, limit), asks: levels.parse(depth.asks).slice(0, limit) };
  // Binance Spot REST depth supplies an update sequence, not an observation timestamp.
  const observedAt = marketType === "spot" && venue === "binance" ? null : providerObservedAt(depth.ts);
  return { data, observedAt, warnings: [] as string[] };
}
export type SharedMarketSnapshot<D extends MarketDataset = MarketDataset> = {
  id: string; key: Extract<MarketDatasetKey, { dataset: D }>;
  data: MarketDatasetData[D]; observedAt: string | null; fetchedAt: string; warnings: string[];
};
export type SharedMarketRead<D extends MarketDataset = MarketDataset> = {
  snapshot: SharedMarketSnapshot<D>; cacheHit: boolean; ageMs: number | null;
  quality: "fresh" | "stale" | "degraded"; warnings: string[];
};

export function projectMarketSnapshot<D extends MarketDataset>(snapshot: SharedMarketSnapshot<D>, cacheHit: boolean, now = Date.now()): SharedMarketRead<D> {
  const key = snapshot.key as MarketDatasetKey;
  const at = snapshot.observedAt ? Date.parse(snapshot.observedAt) : null;
  const ageMs = at === null ? null : Math.max(0, now - at);
  const threshold = key.dataset === "candles" ? intervalMs[key.interval] + 30_000 : 30_000;
  const stale = ageMs !== null && ageMs > threshold;
  const warnings = [...new Set([...snapshot.warnings, ...(at === null ? ["provider_timestamp_missing"] : []),
    ...(at !== null && at > now ? ["provider_timestamp_in_future"] : []), ...(stale ? ["market_data_stale"] : [])])];
  return { snapshot: structuredClone(snapshot), cacheHit, ageMs, quality: stale ? "stale" : warnings.length ? "degraded" : "fresh", warnings };
}

export function createSharedMarketStore(options: SnapshotCacheOptions = {}) {
  const now = options.now ?? Date.now;
  const cache = createSnapshotCache<SharedMarketSnapshot>(options);
  return { async read<D extends MarketDataset>(key: Extract<MarketDatasetKey, { dataset: D }>,
    load: () => Promise<{ data: MarketDatasetData[D]; observedAt: string | null; warnings: string[] }>): Promise<SharedMarketRead<D>> {
    const parsedKey = marketDatasetKeySchema.parse(key);
    const result = await cache.read(JSON.stringify(parsedKey), parsedKey.dataset === "candles" ? 3000 : 2000, async () => {
      const raw = await load();
      const observation = observationSchema.parse(raw);
      const schema = parsedKey.dataset === "candles" ? candleDataSchema : parsedKey.dataset === "ticker" ? tickerDataSchema : bookDataSchema;
      const data = schema.parse(raw.data);
      const content = { key: parsedKey, data, ...observation, fetchedAt: new Date(now()).toISOString() };
      return { id: `mds_${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`, ...content };
    });
    // The validated key includes the discriminator; cached values cannot cross datasets.
    return projectMarketSnapshot(result.snapshot as unknown as SharedMarketSnapshot<D>, result.cacheHit, now());
  } };
}
export const sharedMarketStore = createSharedMarketStore();

export function providerObservedAt(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = typeof value === "string" && /[T:]/.test(value) ? Date.parse(value) : Number(value);
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? new Date(ms).toISOString() : null;
}

// No replacement prices or volumes are invented for malformed candle rows.
export function normalizeSharedCandles(raw: unknown, interval: keyof typeof intervalMs, limit: number, now = Date.now()) {
  const envelope = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rows: unknown[] = Array.isArray(raw) ? raw : Array.isArray(envelope.data) ? envelope.data : [];
  const warnings = new Set<string>();
  const candles: z.infer<typeof sharedCandleSchema>[] = [];
  const numeric = (v: unknown) => v === null || v === undefined || v === "" ? null : Number(v);
  for (const row of rows) {
    const r = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const tuple = Array.isArray(row) ? row : [r.t ?? r.ts ?? r.timestamp ?? r.time, r.o ?? r.open, r.h ?? r.high, r.l ?? r.low, r.c ?? r.close, r.v ?? r.volume];
    const parsed = sharedCandleSchema.safeParse({ ts: numeric(tuple[0]), open: numeric(tuple[1]), high: numeric(tuple[2]), low: numeric(tuple[3]), close: numeric(tuple[4]), volume: numeric(tuple[5]) });
    if (parsed.success) candles.push(parsed.data); else warnings.add("malformed_candle_rows");
  }
  candles.sort((a, b) => a.ts - b.ts);
  const bounded = candles.slice(-limit);
  if (bounded.length < limit) warnings.add("candle_coverage_incomplete");
  for (let i = 1; i < bounded.length; i++) if (bounded[i].ts - bounded[i - 1].ts !== intervalMs[interval]) warnings.add("candle_sequence_gap_or_duplicate");
  const latest = bounded.at(-1);
  if (latest && latest.ts + intervalMs[interval] > now) warnings.add("forming_candle_included");
  return { data: { candles: bounded }, observedAt: providerObservedAt(latest?.ts), warnings: [...warnings] };
}
