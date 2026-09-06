import { z } from "zod";
import { featureMatchesSnapshot, marketSnapshotEvidenceSchema, parseStoredFeatures, type MarketSnapshotEvidence, type StoredFeatureEvidence } from "./evidence.js";

export const FEATURE_CONTEXT_POLICY = [
  "Use validated deterministic featureSnapshots as the metric authority; do not recalculate or replace null values.",
  "Match features to marketSnapshot by inputSnapshotId, source venue, symbol, market type and candle interval. Snapshot IDs identify evidence, not freshness.",
  "Describe stale, degraded, unavailable, fallback and mixed-source evidence explicitly. Missing provider timestamps are not fresh observations.",
  "Snapshots are not atomic across datasets. Candle timestamps are candle opens; forming candles are provisional. Do not claim simultaneous observations.",
  "Funding/OI snapshot features contain no history. Use only a validated derivatives.history-summary feature for historical changes, percentiles or Z-scores. Report its kind, actual window, sample count and quality; null metrics are unavailable. Never infer crowding or liquidation risk from history alone. A simple annualized funding estimate is not a forecast or yield promise.",
  "Orderbook depth covers only returned levels, not guaranteed liquidity or executable prices. Public market context never overrides deterministic position risk or authorizes an action."
].join("\n");

export type MarketFeatureContext = {
  version: "1.0.0";
  snapshotManifest: MarketSnapshotEvidence[];
  featureSnapshots: StoredFeatureEvidence[];
  quality: "fresh" | "stale" | "degraded" | "unavailable";
  warningCodes: string[];
};

export function buildMarketFeatureContext(snapshots: MarketSnapshotEvidence[], features: StoredFeatureEvidence[], warnings: string[] = []): MarketFeatureContext {
  const manifest = z.array(marketSnapshotEvidenceSchema).max(5).parse(snapshots);
  const parsed = parseStoredFeatures(features, 6);
  if (features.length > 6 || parsed.length !== features.length || parsed.some(f => !manifest.some(s => featureMatchesSnapshot(f, s)))) {
    throw new Error("market_feature_context_invalid");
  }
  const reasons = new Set(z.array(z.string().max(160)).max(32).parse(warnings));
  const states = manifest.map(s => s.quality);
  for (const snapshot of manifest) for (const reason of snapshot.warningCodes) reasons.add(reason);
  for (const feature of parsed) {
    const quality = (feature.value as { quality: { state: MarketSnapshotEvidence["quality"]; reasons: string[] } }).quality;
    states.push(quality.state);
    for (const reason of quality.reasons) reasons.add(reason);
  }
  const markets = new Set(manifest.map(s => JSON.stringify(s.market)));
  if (markets.size > 1) reasons.add("market_context_source_mismatch");
  const observed = manifest.filter(s => s.dataset !== "candles" && s.dataset !== "derivatives_history" && s.observedAt).map(s => Date.parse(s.observedAt!));
  if (observed.length > 1 && Math.max(...observed) - Math.min(...observed) > 120_000) reasons.add("market_observation_skew");
  const quality = parsed.length === 0 ? "unavailable" : states.includes("stale") ? "stale"
    : states.some(state => state !== "fresh") || warnings.some(w => !["historical_context_unavailable", "paper_linked_market_data"].includes(w))
      || markets.size > 1 || reasons.has("market_observation_skew") ? "degraded" : "fresh";
  return { version: "1.0.0", snapshotManifest: manifest, featureSnapshots: parsed, quality, warningCodes: [...reasons].slice(0, 32) };
}
