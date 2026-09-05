import { z } from "zod";
import { marketIdentitySchema } from "../../market-data/sharedMarket.js";
import { getAgentRoutine } from "../routines/registry.js";
import { MARKET_FEATURES, type MarketFeatureId, type MarketFeatureRef } from "./registry.js";

const referenceSchema = z.object({ id: z.enum(["technical.indicator-summary", "derivatives.funding-snapshot", "derivatives.open-interest-snapshot", "orderbook.snapshot"]),
  version: z.literal("1.0.0"), snapshotId: z.string().regex(/^fs_[a-f0-9]{64}$/), inputSnapshotId: z.string().regex(/^mds_[a-f0-9]{64}$/) }).strict();
export const marketSnapshotEvidenceSchema = z.object({
  id: z.string().regex(/^mds_[a-f0-9]{64}$/), schemaVersion: z.literal("1.0.0"), freshnessPolicyVersion: z.literal("1.0.0"),
  market: marketIdentitySchema, dataset: z.enum(["derivatives", "candles", "ticker", "orderbook"]),
  interval: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable(), limit: z.number().int().min(1).max(1000).nullable(),
  observedAt: z.string().datetime().nullable(), fetchedAt: z.string().datetime(), ageMs: z.number().finite().nonnegative().nullable(),
  quality: z.enum(["fresh", "stale", "degraded", "unavailable"]), warningCodes: z.array(z.string().max(160)).max(32),
  atomicObservation: z.literal(false)
}).strict().refine(row => row.dataset === "candles" ? row.interval !== null && row.limit !== null
  : row.dataset === "orderbook" ? row.interval === null && row.limit !== null
  : row.interval === null && row.limit === null, "snapshot_coverage_invalid");
export type MarketSnapshotEvidence = z.infer<typeof marketSnapshotEvidenceSchema>;
export type StoredFeatureEvidence = MarketFeatureRef & { value: unknown; routineVersions: Array<{ id: string; version: string }> };
export function featureMatchesSnapshot(feature: StoredFeatureEvidence, snapshot: MarketSnapshotEvidence): boolean {
  const dataset = feature.id === "technical.indicator-summary" ? "candles" : feature.id === "orderbook.snapshot" ? "orderbook" : "derivatives";
  return feature.inputSnapshotId === snapshot.id && snapshot.dataset === dataset;
}

// The v1 output schemas are immutable replay contracts. Future feature versions
// must add a decoder rather than reinterpret historical values with new routines.
const v1Outputs = Object.fromEntries(Object.entries(MARKET_FEATURES).map(([id, descriptor]) => [id, getAgentRoutine(descriptor.routineId).outputSchema]));
export function storedFeatureEvidence(ref: MarketFeatureRef, value: unknown, routineVersions: StoredFeatureEvidence["routineVersions"]): StoredFeatureEvidence {
  const parsedRef = referenceSchema.parse(ref);
  const parsedValue = v1Outputs[parsedRef.id].parse(value);
  const versions = z.array(z.object({ id: z.string().max(100), version: z.literal("1.0.0") }).strict()).length(1).parse(routineVersions);
  if (versions[0].id !== MARKET_FEATURES[parsedRef.id as MarketFeatureId].routineId) throw new Error("feature_routine_provenance_invalid");
  const evidence = { ...parsedRef, value: parsedValue, routineVersions: versions };
  if (Buffer.byteLength(JSON.stringify(evidence)) > 8192) throw new Error("feature_evidence_budget_exceeded");
  return evidence;
}

export function parseStoredFeatures(raw: unknown): StoredFeatureEvidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    try {
      const { id, version, snapshotId, inputSnapshotId, value, routineVersions } = item;
      return [storedFeatureEvidence({ id, version, snapshotId, inputSnapshotId }, value, routineVersions)];
    } catch { return []; }
  });
}
