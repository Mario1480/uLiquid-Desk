import { getFuturesVenueCapabilities } from "@mm/futures-exchange";
import { createPerpMarketDataClient } from "../perp/perp-market-data.client.js";
import { createSpotClient } from "../spot/spot-client-factory.js";
import { resolveMarketDataTradingAccount, type TradingAccount } from "../trading.js";
import { sharedDerivativesStore } from "../market-data/sharedDerivatives.js";
import { sharedMarketStore, normalizeSharedCandles, normalizeSharedOrderbook, type SharedMarketRead } from "../market-data/sharedMarket.js";
import { evaluateMarketFeature, type MarketFeatureId } from "../ai/features/registry.js";
import { marketSnapshotEvidenceSchema, storedFeatureEvidence, type MarketSnapshotEvidence, type StoredFeatureEvidence } from "../ai/features/evidence.js";
import { buildMarketFeatureContext } from "../ai/features/context.js";

// Called only after entitlement and account ownership checks. Factories receive
// synthetic public credentials, never the selected account's private credentials.
export const positionMarketContextDependencies = {
  resolveLinked: resolveMarketDataTradingAccount,
  createClient: createPerpMarketDataClient,
  createSpotClient
};

export async function loadPositionMarketContext(params: {
  userId: string; account: { id: string; exchange: string }; symbol: string; marketType: "spot" | "perp";
}) {
  let venue = params.account.exchange.toLowerCase();
  const warnings: string[] = [];
  if (venue === "paper") {
    try {
      venue = (await positionMarketContextDependencies.resolveLinked(params.userId, params.account.id)).marketDataAccount.exchange;
      warnings.push("paper_linked_market_data");
    } catch { return buildMarketFeatureContext([], [], ["linked_market_data_unavailable"]); }
  }
  if (!["binance", "bitget", "hyperliquid", "mexc", "bingx"].includes(venue)) {
    return buildMarketFeatureContext([], [], ["market_data_venue_unsupported"]);
  }
  const sourceVenue = venue as MarketSnapshotEvidence["market"]["sourceVenue"];
  const capability = getFuturesVenueCapabilities(sourceVenue);
  const market = { providerId: params.marketType === "perp" ? capability.providerId : `uliquid-native-spot:${venue}`,
    sourceVenue, marketType: params.marketType, symbol: params.symbol };
  const account: TradingAccount = { id: `public:${venue}`, userId: "public", exchange: venue, label: "Public market context",
    apiKey: "", apiSecret: "", passphrase: venue === "bitget" ? "public" : null, marketDataExchangeAccountId: null };
  const snapshots: MarketSnapshotEvidence[] = [];
  const features: StoredFeatureEvidence[] = [];
  const withClient = async <T>(read: (client: ReturnType<typeof createPerpMarketDataClient>) => Promise<T>) => {
    const client = positionMarketContextDependencies.createClient(account);
    try { return await read(client); } finally { await client.close().catch(() => undefined); }
  };
  // Match Agent Chat's existing public spot backend selection and shared cache keys.
  const withMarketClient = async <T>(read: (client: Pick<ReturnType<typeof createSpotClient>, "getCandles" | "getDepth"> | ReturnType<typeof createPerpMarketDataClient>) => Promise<T>) => {
    if (params.marketType === "perp") return withClient(read);
    const client = positionMarketContextDependencies.createSpotClient(account, venue === "bitget" ? { forceBackend: "ccxt" } : {});
    try { return await read(client); }
    finally { await (client as { close?: () => Promise<void> }).close?.().catch(() => undefined); }
  };
  const addFeature = (id: MarketFeatureId, input: unknown, sourceId: string) => {
    const result = evaluateMarketFeature(id, input, sourceId);
    features.push(storedFeatureEvidence(result.ref, result.value, result.routineVersions));
  };
  const addSnapshot = (read: SharedMarketRead<"candles"> | SharedMarketRead<"orderbook">) => {
    const s = read.snapshot;
    snapshots.push(marketSnapshotEvidenceSchema.parse({ id: s.id, schemaVersion: "1.0.0", freshnessPolicyVersion: "1.0.0", market,
      dataset: s.key.dataset, interval: s.key.dataset === "candles" ? s.key.interval : null, limit: s.key.limit,
      observedAt: s.observedAt, fetchedAt: s.fetchedAt, ageMs: read.ageMs, quality: read.quality,
      warningCodes: read.warnings, atomicObservation: false }));
  };
  // Each dataset uses the same bounded public store as Agent Chat. A failed
  // dataset cannot erase successful evidence or trigger a cross-venue fallback.
  await Promise.all([
    (async () => {
      if (params.marketType === "spot") return;
      const funding = capability.marketData.fundingRate !== "unsupported";
      const oi = capability.marketData.openInterest !== "unsupported";
      if (!funding) warnings.push("funding_unsupported");
      if (!oi) warnings.push("open_interest_unsupported");
      if (!funding && !oi) return;
      const read = await sharedDerivativesStore.read({ ...market, marketType: "perp" }, () => withClient(client => client.getDerivativesSnapshot(params.symbol)));
      const s = read.snapshot, d = s.data;
      snapshots.push(marketSnapshotEvidenceSchema.parse({ id: s.id, schemaVersion: "1.0.0", freshnessPolicyVersion: "1.0.0", market,
        dataset: "derivatives", interval: null, limit: null, observedAt: d.sourceTimestampProvided ? d.observedAt : null,
        fetchedAt: s.fetchedAt, ageMs: read.ageMs, quality: read.quality, warningCodes: read.warnings, atomicObservation: false }));
      if (funding) addFeature("derivatives.funding-snapshot", { rate: d.fundingRate, fundingIntervalHours: d.fundingIntervalHours }, s.id);
      if (oi) addFeature("derivatives.open-interest-snapshot", { reportedValue: d.openInterest, reportedUnit: d.openInterestUnit, referencePrice: d.markPrice, contractSize: d.contractSize }, s.id);
    })().catch(() => { warnings.push("derivatives_snapshot_unavailable"); }),
    (async () => {
      if (params.marketType === "perp" && capability.marketData.candles === "unsupported") { warnings.push("candles_unsupported"); return; }
      const read = await sharedMarketStore.read<"candles">({ ...market, schemaVersion: "1.0.0", dataset: "candles", interval: "1h", limit: 100 },
        () => withMarketClient(async client => normalizeSharedCandles(await client.getCandles({ symbol: params.symbol, timeframe: "1h", limit: 100 }), "1h", 100)));
      addSnapshot(read);
      addFeature("technical.indicator-summary", { candles: read.snapshot.data.candles, indicators: ["sma20", "ema50", "rsi14", "atr14"] }, read.snapshot.id);
    })().catch(() => { warnings.push("candles_snapshot_unavailable"); }),
    (async () => {
      if (params.marketType === "perp" && (capability.marketData.orderbookAnalytics === "unsupported" || capability.marketData.orderbook === "unsupported")) { warnings.push("orderbook_unsupported"); return; }
      const read = await sharedMarketStore.read<"orderbook">({ ...market, schemaVersion: "1.0.0", dataset: "orderbook", limit: 25 },
        () => withMarketClient(async client => {
          const depth = await client.getDepth(params.symbol, 25);
          return normalizeSharedOrderbook(depth, params.marketType, venue, 25);
        }));
      addSnapshot(read);
      addFeature("orderbook.snapshot", read.snapshot.data, read.snapshot.id);
    })().catch(() => { warnings.push("orderbook_snapshot_unavailable"); })
  ]);
  snapshots.sort((a, b) => a.dataset.localeCompare(b.dataset));
  features.sort((a, b) => a.id.localeCompare(b.id));
  return buildMarketFeatureContext(snapshots, features, warnings.sort());
}
