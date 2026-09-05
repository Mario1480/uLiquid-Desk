import { createHash } from "node:crypto";
import { z } from "zod";
import { AGENT_ROUTINE_IDS, executeAgentRoutine, getAgentRoutine, routineVersionRefs } from "../routines/registry.js";

// Features identify reusable outputs; routines remain the only calculation authority.
export const MARKET_FEATURES = {
  "technical.indicator-summary": { version: "1.0.0", routineId: AGENT_ROUTINE_IDS.technicalIndicatorSummary },
  "derivatives.funding-snapshot": { version: "1.0.0", routineId: AGENT_ROUTINE_IDS.fundingSnapshot },
  "derivatives.open-interest-snapshot": { version: "1.0.0", routineId: AGENT_ROUTINE_IDS.openInterestSnapshot },
  "orderbook.snapshot": { version: "1.0.0", routineId: AGENT_ROUTINE_IDS.orderbookSnapshot }
} as const;

export type MarketFeatureId = keyof typeof MARKET_FEATURES;
export type MarketFeatureRef = {
  id: MarketFeatureId;
  version: string;
  snapshotId: string;
  inputSnapshotId: string;
};

export function evaluateMarketFeature<T = unknown>(id: MarketFeatureId, input: unknown, inputSnapshotId: string): {
  value: T;
  ref: MarketFeatureRef;
  routineVersions: Array<{ id: string; version: string }>;
} {
  if (!Object.hasOwn(MARKET_FEATURES, id)) throw new Error("market_feature_unknown");
  const sourceId = z.string().regex(/^mds_[a-f0-9]{64}$/).parse(inputSnapshotId);
  const descriptor = MARKET_FEATURES[id];
  const routine = getAgentRoutine(descriptor.routineId);
  const parsedInput = routine.inputSchema.parse(input);
  const value = executeAgentRoutine<T>(descriptor.routineId, parsedInput);
  const routineVersions = routineVersionRefs([descriptor.routineId]);
  const snapshotId = `fs_${createHash("sha256").update(JSON.stringify({
    id, version: descriptor.version, inputSnapshotId: sourceId, input: parsedInput, routineVersions, value
  })).digest("hex")}`;
  return { value, ref: { id, version: descriptor.version, snapshotId, inputSnapshotId: sourceId }, routineVersions };
}
