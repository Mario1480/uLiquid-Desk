import { getFuturesVenueCapabilities } from "@mm/futures-exchange";
import { createPublicHistoryStore, type HistoryRequest } from "../../market-data/derivativesHistory.js";
import { derivativesHistoryOutputSchema } from "../routines/derivativesHistory.js";
import { evaluateMarketFeature } from "./registry.js";
import { marketSnapshotEvidenceSchema, storedFeatureEvidence } from "./evidence.js";

export const historyFeatureDependencies = { store: createPublicHistoryStore() };

// Caller resolves ownership/Paper and venue policy before every shared/pinned read.
export function requireHistoryCapability(request: HistoryRequest) {
  const capability = getFuturesVenueCapabilities(request.venue);
  const field = request.kind === "funding" ? "fundingHistory" : "openInterestHistory";
  if (capability.marketData[field] !== "native") throw new Error(`${request.kind}_history_unsupported`);
}

export async function readHistoryFeature(request: HistoryRequest) {
  requireHistoryCapability(request);
  const read = await historyFeatureDependencies.store.read(request);
  const evaluated = evaluateMarketFeature("derivatives.history-summary", read.evaluationInput, read.snapshot.id);
  const value = derivativesHistoryOutputSchema.parse(evaluated.value);
  const snapshot = marketSnapshotEvidenceSchema.parse({
    id: read.snapshot.id, schemaVersion: "1.0.0", freshnessPolicyVersion: "1.0.0",
    market: { providerId: read.snapshot.providerId, sourceVenue: read.snapshot.sourceVenue, symbol: read.snapshot.symbol, marketType: "perp" },
    dataset: "derivatives_history", interval: null, limit: request.venue === "bitget" ? 100 : 200,
    observedAt: value.actualEnd === null ? null : new Date(value.actualEnd).toISOString(), fetchedAt: read.snapshot.fetchedAt,
    ageMs: value.actualEnd === null ? null : Math.max(0, read.evaluationInput.evaluatedAt - value.actualEnd),
    quality: value.quality.state, warningCodes: value.quality.reasons, atomicObservation: false
  });
  return { value, snapshot, cacheHit: read.cacheHit,
    feature: storedFeatureEvidence(evaluated.ref, value, evaluated.routineVersions) };
}
