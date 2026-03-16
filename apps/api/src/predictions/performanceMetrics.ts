function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeHitValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value > 0;
  return null;
}

export function resolvePredictionPerformanceMetrics(input: {
  signal: "up" | "down" | "neutral";
  expectedMovePct: unknown;
  outcomeMeta: unknown;
  outcomePnlPct?: unknown;
  asRecord(value: unknown): Record<string, any>;
  readRealizedPayloadFromOutcomeMeta(outcomeMeta: unknown): Record<string, any>;
  computePredictionErrorMetrics(input: {
    signal: "up" | "down" | "neutral";
    expectedMovePct: number | null;
    realizedReturnPct: number | null;
  }): Record<string, any>;
}): {
  realizedReturnPct: number | null;
  hit: boolean | null;
  absError: number | null;
  sqError: number | null;
} {
  const outcomeMetaRecord = input.asRecord(input.outcomeMeta);
  const realizedPayload = input.readRealizedPayloadFromOutcomeMeta(input.outcomeMeta);
  const nestedRealized = input.asRecord(outcomeMetaRecord.realized);
  const realizedReturnPct =
    toFiniteNumber(realizedPayload.realizedReturnPct) ??
    toFiniteNumber(nestedRealized.realizedReturnPct) ??
    toFiniteNumber(nestedRealized.returnPct) ??
    toFiniteNumber(input.outcomePnlPct);

  if (realizedReturnPct === null) {
    return {
      realizedReturnPct: null,
      hit: null,
      absError: null,
      sqError: null
    };
  }

  const storedRealizedErrorMetrics = input.asRecord(realizedPayload.errorMetrics);
  const hasStoredErrorMetrics =
    storedRealizedErrorMetrics.hit !== undefined ||
    storedRealizedErrorMetrics.absError !== undefined ||
    storedRealizedErrorMetrics.sqError !== undefined;
  const storedErrorMetrics = hasStoredErrorMetrics ? storedRealizedErrorMetrics : outcomeMetaRecord;
  const computedErrorMetrics = input.asRecord(input.computePredictionErrorMetrics({
    signal: input.signal,
    expectedMovePct: toFiniteNumber(input.expectedMovePct),
    realizedReturnPct
  }));

  return {
    realizedReturnPct,
    hit: normalizeHitValue(storedErrorMetrics.hit) ?? normalizeHitValue(computedErrorMetrics.hit),
    absError:
      toFiniteNumber(storedErrorMetrics.absError) ?? toFiniteNumber(computedErrorMetrics.absError),
    sqError:
      toFiniteNumber(storedErrorMetrics.sqError) ?? toFiniteNumber(computedErrorMetrics.sqError)
  };
}
