import {
  DEFAULT_CROSS_MARKET_FEE,
  scanArbitrage,
  scanXemm,
  type CrossMarketFeeProfile,
  type CrossMarketInventory,
  type CrossMarketVenue
} from "./core.js";
import { readPublicPerpBook } from "./publicMarket.js";

export class CrossMarketInsufficientDataError extends Error {
  constructor(readonly failures: Array<{ venue: CrossMarketVenue; code: string }>) {
    super("cross_market_insufficient_data");
  }
}

export type CrossMarketScanRequest = {
  kind: "arbitrage" | "xemm";
  symbol: string;
  venues: CrossMarketVenue[];
  targetNotionalUsd: number;
  bookLimit: number;
  safetyBufferBps: number;
  minNetEdgeBps: number;
  maxBookAgeMs: number;
  maxObservationSkewMs: number;
  feeProfiles: Partial<Record<CrossMarketVenue, CrossMarketFeeProfile>>;
  inventory?: Partial<Record<CrossMarketVenue, CrossMarketInventory>>;
};

export type CrossMarketBookReader = typeof readPublicPerpBook;

export async function runCrossMarketScan(request: CrossMarketScanRequest, readBook: CrossMarketBookReader = readPublicPerpBook) {
  const reads = await Promise.allSettled(request.venues.map((venue) => readBook({
    venue,
    symbol: request.symbol,
    limit: request.bookLimit
  })));
  const books = reads.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failures = reads.flatMap((result, index) => result.status === "rejected"
    ? [{ venue: request.venues[index], code: "provider_unavailable" }]
    : []);
  if (books.length < 2) throw new CrossMarketInsufficientDataError(failures);
  const effectiveFeeProfiles = Object.fromEntries(request.venues.map((venue) => [
    venue,
    request.feeProfiles[venue] ?? DEFAULT_CROSS_MARKET_FEE
  ])) as Record<CrossMarketVenue, CrossMarketFeeProfile>;
  const options = {
    symbol: request.symbol,
    marketType: "perp" as const,
    targetNotionalUsd: request.targetNotionalUsd,
    safetyBufferBps: request.safetyBufferBps,
    minNetEdgeBps: request.minNetEdgeBps,
    maxBookAgeMs: request.maxBookAgeMs,
    maxObservationSkewMs: request.maxObservationSkewMs,
    books,
    feeProfiles: effectiveFeeProfiles,
    inventory: request.inventory
  };
  const opportunities = request.kind === "arbitrage" ? scanArbitrage(options) : scanXemm(options);
  return {
    mode: "scanner_only" as const,
    kind: request.kind,
    marketType: "perp" as const,
    symbol: request.symbol,
    generatedAt: new Date().toISOString(),
    assumptions: {
      targetNotionalUsd: request.targetNotionalUsd,
      bookLimit: request.bookLimit,
      safetyBufferBps: request.safetyBufferBps,
      minNetEdgeBps: request.minNetEdgeBps,
      maxBookAgeMs: request.maxBookAgeMs,
      maxObservationSkewMs: request.maxObservationSkewMs,
      defaultMakerFeeBps: 2,
      defaultTakerFeeBps: 10,
      feeProfiles: effectiveFeeProfiles,
      inventoryModel: "perp_conservative_1x" as const
    },
    sources: books.map((book) => ({
      venue: book.venue,
      providerId: book.providerId,
      snapshotId: book.snapshotId,
      observedAt: book.observedAt,
      fetchedAt: book.fetchedAt,
      ageMs: book.ageMs,
      quality: book.quality,
      warnings: book.warnings
    })),
    failures,
    opportunities
  };
}
