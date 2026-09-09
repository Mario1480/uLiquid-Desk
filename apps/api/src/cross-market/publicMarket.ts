import { getFuturesVenueCapabilities } from "@mm/futures-exchange";
import { sharedMarketStore, normalizeSharedOrderbook } from "../market-data/sharedMarket.js";
import { createPerpMarketDataClient } from "../perp/perp-market-data.client.js";
import type { TradingAccount } from "../trading-contracts.js";
import type { CrossMarketBook, CrossMarketVenue } from "./core.js";

function publicAccount(venue: CrossMarketVenue): TradingAccount {
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

export async function readPublicPerpBook(params: {
  venue: CrossMarketVenue;
  symbol: string;
  limit: number;
}): Promise<CrossMarketBook> {
  const capability = getFuturesVenueCapabilities(params.venue);
  const key = {
    providerId: capability.providerId,
    sourceVenue: params.venue,
    marketType: "perp" as const,
    symbol: params.symbol,
    dataset: "orderbook" as const,
    schemaVersion: "1.0.0" as const,
    limit: params.limit
  };
  const result = await sharedMarketStore.read<"orderbook">(key, async () => {
    const client = createPerpMarketDataClient(publicAccount(params.venue));
    try {
      return normalizeSharedOrderbook(await client.getDepth(params.symbol, params.limit), "perp", params.venue, params.limit);
    } finally {
      await client.close().catch(() => undefined);
    }
  });
  const hasBid = result.snapshot.data.bids.some(([price, qty]) => Number.isFinite(price) && price > 0 && Number.isFinite(qty) && qty > 0);
  const hasAsk = result.snapshot.data.asks.some(([price, qty]) => Number.isFinite(price) && price > 0 && Number.isFinite(qty) && qty > 0);
  if (!hasBid || !hasAsk) throw new Error("public_orderbook_empty");
  return {
    venue: params.venue,
    bids: result.snapshot.data.bids,
    asks: result.snapshot.data.asks,
    observedAt: result.snapshot.observedAt,
    fetchedAt: result.snapshot.fetchedAt,
    ageMs: result.ageMs,
    quality: result.quality,
    warnings: result.warnings,
    snapshotId: result.snapshot.id,
    providerId: result.snapshot.key.providerId
  };
}
