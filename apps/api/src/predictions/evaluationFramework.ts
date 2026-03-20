import { buildPredictionMetricsSummary, normalizeConfidencePct } from "../jobs/predictionEvaluatorJob.js";

type PredictionSignalSource = "local" | "ai";

type StoredAiExplainMeta = {
  provider: string | null;
  model: string | null;
  promptTemplateId: string | null;
  promptTemplateName: string | null;
  analysisMode: string | null;
  payloadBytes: number | null;
  estimatedTokens: number | null;
  trimFlags: string[];
  maxPayloadBytes: number | null;
  maxHistoryBytes: number | null;
  toolCallsUsed: number | null;
  historyContextHash: string | null;
  overBudget: boolean | null;
  cacheHit: boolean | null;
  fallbackUsed: boolean | null;
  rateLimited: boolean | null;
};

export type PredictionEvaluation = {
  version: "ai_evaluation_v1";
  signalSource: PredictionSignalSource;
  directionCorrect: boolean | null;
  confidencePct: number | null;
  calibrationGapPct: number | null;
  riskAdjustedUsefulness: number | null;
  usefulnessBand: "positive" | "neutral" | "negative" | "unavailable";
  realizedReturnPct: number | null;
  riskReferencePct: number | null;
  stalePrediction: {
    detected: boolean;
    ageMs: number | null;
    thresholdMs: number | null;
    reason: string | null;
  };
  costFootprint: {
    aiUsed: boolean;
    provider: string | null;
    model: string | null;
    promptTemplateId: string | null;
    promptTemplateName: string | null;
    analysisMode: string | null;
    payloadBytes: number | null;
    estimatedTokens: number | null;
    trimFlags: string[];
    maxPayloadBytes: number | null;
    maxHistoryBytes: number | null;
    toolCallsUsed: number | null;
    historyContextHash: string | null;
    overBudget: boolean | null;
    cacheHit: boolean | null;
    fallbackUsed: boolean | null;
    rateLimited: boolean | null;
  };
};

export type PredictionEvaluationSummary = {
  version: "ai_evaluation_v1";
  evaluatedCount: number;
  directionalCount: number;
  directionCorrectCount: number;
  directionCorrectRatePct: number | null;
  avgCalibrationGapPct: number | null;
  avgRiskAdjustedUsefulness: number | null;
  staleCount: number;
  staleRatePct: number | null;
  usefulness: {
    positive: number;
    neutral: number;
    negative: number;
    unavailable: number;
  };
  costFootprint: {
    aiEvaluatedCount: number;
    avgPayloadBytes: number | null;
    avgEstimatedTokens: number | null;
    totalEstimatedTokens: number;
    avgToolCallsUsed: number | null;
    cacheHitRatePct: number | null;
    fallbackRatePct: number | null;
    overBudgetRatePct: number | null;
  };
  bySignalSource: {
    local: PredictionEvaluationSourceSummary;
    ai: PredictionEvaluationSourceSummary;
  };
};

type PredictionEvaluationSourceSummary = {
  evaluatedCount: number;
  directionCorrectRatePct: number | null;
  avgCalibrationGapPct: number | null;
  avgRiskAdjustedUsefulness: number | null;
  staleRatePct: number | null;
  aiEvaluatedCount: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return null;
}

function round(value: number | null, decimals: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function normalizeSignalSource(value: unknown): PredictionSignalSource {
  return value === "ai" ? "ai" : "local";
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function readStoredAiExplainMeta(featuresSnapshot: unknown): StoredAiExplainMeta {
  const snapshot = asRecord(featuresSnapshot);
  const raw = asRecord(snapshot.aiExplainMeta);
  const trimFlags = Array.isArray(raw.trimFlags)
    ? raw.trimFlags.map((value) => String(value)).filter((value) => value.trim().length > 0)
    : [];

  return {
    provider: typeof raw.provider === "string" && raw.provider.trim() ? raw.provider : null,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model : null,
    promptTemplateId:
      typeof raw.promptTemplateId === "string" && raw.promptTemplateId.trim()
        ? raw.promptTemplateId
        : (typeof snapshot.aiPromptTemplateId === "string" && snapshot.aiPromptTemplateId.trim()
          ? snapshot.aiPromptTemplateId
          : null),
    promptTemplateName:
      typeof raw.promptTemplateName === "string" && raw.promptTemplateName.trim()
        ? raw.promptTemplateName
        : (typeof snapshot.aiPromptTemplateName === "string" && snapshot.aiPromptTemplateName.trim()
          ? snapshot.aiPromptTemplateName
          : null),
    analysisMode:
      typeof raw.analysisMode === "string" && raw.analysisMode.trim() ? raw.analysisMode : null,
    payloadBytes: toFiniteNumber(raw.payloadBytes),
    estimatedTokens: toFiniteNumber(raw.estimatedTokens),
    trimFlags,
    maxPayloadBytes: toFiniteNumber(raw.maxPayloadBytes),
    maxHistoryBytes: toFiniteNumber(raw.maxHistoryBytes),
    toolCallsUsed: toFiniteNumber(raw.toolCallsUsed),
    historyContextHash:
      typeof raw.historyContextHash === "string" && raw.historyContextHash.trim()
        ? raw.historyContextHash
        : null,
    overBudget: normalizeBoolean(raw.overBudget),
    cacheHit: normalizeBoolean(raw.cacheHit),
    fallbackUsed: normalizeBoolean(raw.fallbackUsed),
    rateLimited: normalizeBoolean(raw.rateLimited)
  };
}

function buildCostFootprint(
  featuresSnapshot: unknown,
  signalSource: PredictionSignalSource
): PredictionEvaluation["costFootprint"] {
  const meta = readStoredAiExplainMeta(featuresSnapshot);
  const aiUsed =
    meta.provider !== null ||
    meta.model !== null ||
    meta.payloadBytes !== null ||
    meta.estimatedTokens !== null ||
    meta.toolCallsUsed !== null ||
    signalSource === "ai";

  return {
    aiUsed,
    provider: meta.provider,
    model: meta.model,
    promptTemplateId: meta.promptTemplateId,
    promptTemplateName: meta.promptTemplateName,
    analysisMode: meta.analysisMode,
    payloadBytes: meta.payloadBytes,
    estimatedTokens: meta.estimatedTokens,
    trimFlags: meta.trimFlags,
    maxPayloadBytes: meta.maxPayloadBytes,
    maxHistoryBytes: meta.maxHistoryBytes,
    toolCallsUsed: meta.toolCallsUsed,
    historyContextHash: meta.historyContextHash,
    overBudget: meta.overBudget,
    cacheHit: meta.cacheHit,
    fallbackUsed: meta.fallbackUsed,
    rateLimited: meta.rateLimited
  };
}

function buildStalePredictionStatus(input: {
  tsCreated: unknown;
  outcomeEvaluatedAt: unknown;
  timeframeMs: number;
  horizonMs?: unknown;
}): PredictionEvaluation["stalePrediction"] {
  const tsCreated = toDate(input.tsCreated);
  const outcomeEvaluatedAt = toDate(input.outcomeEvaluatedAt);
  const timeframeMs = Math.max(0, Math.trunc(Number(input.timeframeMs) || 0));
  const explicitHorizonMs = toFiniteNumber(input.horizonMs);
  const expectedHorizonMs =
    explicitHorizonMs !== null && explicitHorizonMs > 0 ? Math.trunc(explicitHorizonMs) : timeframeMs;
  const thresholdMs = expectedHorizonMs > 0 ? expectedHorizonMs + timeframeMs : null;

  if (!tsCreated || !outcomeEvaluatedAt || thresholdMs === null) {
    return {
      detected: false,
      ageMs: null,
      thresholdMs,
      reason: null
    };
  }

  const ageMs = outcomeEvaluatedAt.getTime() - tsCreated.getTime();
  const detected = ageMs > thresholdMs;
  return {
    detected,
    ageMs,
    thresholdMs,
    reason: detected ? "evaluation_lag_exceeded_expected_horizon" : null
  };
}

function buildUsefulnessBand(
  score: number | null
): PredictionEvaluation["usefulnessBand"] {
  if (score === null) return "unavailable";
  if (score >= 0.25) return "positive";
  if (score <= -0.25) return "negative";
  return "neutral";
}

export function readPredictionEvaluationFromOutcomeMeta(
  outcomeMeta: unknown
): PredictionEvaluation | null {
  const meta = asRecord(outcomeMeta);
  const stored = asRecord(meta.aiEvaluation);
  if (stored.version !== "ai_evaluation_v1") return null;
  return stored as unknown as PredictionEvaluation;
}

export function buildPredictionEvaluation(input: {
  signalSource: unknown;
  confidence: unknown;
  realizedReturnPct: unknown;
  directionCorrect: unknown;
  expectedMovePct: unknown;
  maxAdversePct?: unknown;
  featuresSnapshot: unknown;
  tsCreated: unknown;
  outcomeEvaluatedAt: unknown;
  timeframeMs: number;
  horizonMs?: unknown;
}): PredictionEvaluation | null {
  const realizedReturnPct = toFiniteNumber(input.realizedReturnPct);
  if (realizedReturnPct === null) return null;

  const signalSource = normalizeSignalSource(input.signalSource);
  const confidencePct = round(normalizeConfidencePct(Number(input.confidence)), 2);
  const directionCorrect = normalizeBoolean(input.directionCorrect);
  const calibrationGapPct =
    confidencePct !== null && typeof directionCorrect === "boolean"
      ? round(Math.abs(confidencePct - (directionCorrect ? 100 : 0)), 2)
      : null;
  const expectedMovePct = Math.abs(toFiniteNumber(input.expectedMovePct) ?? 0);
  const maxAdversePct = Math.abs(toFiniteNumber(input.maxAdversePct) ?? 0);
  const riskReferencePct = Math.max(0.25, expectedMovePct, maxAdversePct);
  const confidenceWeight = confidencePct !== null ? confidencePct / 100 : 0.5;
  const rawUsefulness = (realizedReturnPct / riskReferencePct) * confidenceWeight;
  const riskAdjustedUsefulness = round(Math.max(-5, Math.min(5, rawUsefulness)), 4);
  const stalePrediction = buildStalePredictionStatus({
    tsCreated: input.tsCreated,
    outcomeEvaluatedAt: input.outcomeEvaluatedAt,
    timeframeMs: input.timeframeMs,
    horizonMs: input.horizonMs
  });

  return {
    version: "ai_evaluation_v1",
    signalSource,
    directionCorrect,
    confidencePct,
    calibrationGapPct,
    riskAdjustedUsefulness,
    usefulnessBand: buildUsefulnessBand(riskAdjustedUsefulness),
    realizedReturnPct: round(realizedReturnPct, 4),
    riskReferencePct: round(riskReferencePct, 4),
    stalePrediction,
    costFootprint: buildCostFootprint(input.featuresSnapshot, signalSource)
  };
}

function toPct(count: number, total: number): number | null {
  if (total <= 0) return null;
  return Number(((count / total) * 100).toFixed(2));
}

function summarizeSource(items: PredictionEvaluation[]): PredictionEvaluationSourceSummary {
  let directionalCount = 0;
  let directionCorrectCount = 0;
  let calibrationGapSum = 0;
  let calibrationGapCount = 0;
  let usefulnessSum = 0;
  let usefulnessCount = 0;
  let staleCount = 0;
  let aiEvaluatedCount = 0;

  for (const item of items) {
    if (typeof item.directionCorrect === "boolean") {
      directionalCount += 1;
      if (item.directionCorrect) directionCorrectCount += 1;
    }
    if (typeof item.calibrationGapPct === "number") {
      calibrationGapSum += item.calibrationGapPct;
      calibrationGapCount += 1;
    }
    if (typeof item.riskAdjustedUsefulness === "number") {
      usefulnessSum += item.riskAdjustedUsefulness;
      usefulnessCount += 1;
    }
    if (item.stalePrediction.detected) staleCount += 1;
    if (item.costFootprint.aiUsed) aiEvaluatedCount += 1;
  }

  return {
    evaluatedCount: items.length,
    directionCorrectRatePct: toPct(directionCorrectCount, directionalCount),
    avgCalibrationGapPct:
      calibrationGapCount > 0 ? Number((calibrationGapSum / calibrationGapCount).toFixed(2)) : null,
    avgRiskAdjustedUsefulness:
      usefulnessCount > 0 ? Number((usefulnessSum / usefulnessCount).toFixed(4)) : null,
    staleRatePct: toPct(staleCount, items.length),
    aiEvaluatedCount
  };
}

export function buildPredictionEvaluationSummary(
  items: PredictionEvaluation[]
): PredictionEvaluationSummary {
  let directionalCount = 0;
  let directionCorrectCount = 0;
  let calibrationGapSum = 0;
  let calibrationGapCount = 0;
  let usefulnessSum = 0;
  let usefulnessCount = 0;
  let staleCount = 0;
  let aiEvaluatedCount = 0;
  let payloadBytesSum = 0;
  let payloadBytesCount = 0;
  let estimatedTokensTotal = 0;
  let estimatedTokensCount = 0;
  let toolCallsSum = 0;
  let toolCallsCount = 0;
  let cacheHitCount = 0;
  let cacheHitKnownCount = 0;
  let fallbackCount = 0;
  let fallbackKnownCount = 0;
  let overBudgetCount = 0;
  let overBudgetKnownCount = 0;
  const usefulness = {
    positive: 0,
    neutral: 0,
    negative: 0,
    unavailable: 0
  };

  for (const item of items) {
    if (typeof item.directionCorrect === "boolean") {
      directionalCount += 1;
      if (item.directionCorrect) directionCorrectCount += 1;
    }
    if (typeof item.calibrationGapPct === "number") {
      calibrationGapSum += item.calibrationGapPct;
      calibrationGapCount += 1;
    }
    if (typeof item.riskAdjustedUsefulness === "number") {
      usefulnessSum += item.riskAdjustedUsefulness;
      usefulnessCount += 1;
    }
    if (item.stalePrediction.detected) staleCount += 1;
    usefulness[item.usefulnessBand] += 1;

    if (item.costFootprint.aiUsed) aiEvaluatedCount += 1;
    if (typeof item.costFootprint.payloadBytes === "number") {
      payloadBytesSum += item.costFootprint.payloadBytes;
      payloadBytesCount += 1;
    }
    if (typeof item.costFootprint.estimatedTokens === "number") {
      estimatedTokensTotal += item.costFootprint.estimatedTokens;
      estimatedTokensCount += 1;
    }
    if (typeof item.costFootprint.toolCallsUsed === "number") {
      toolCallsSum += item.costFootprint.toolCallsUsed;
      toolCallsCount += 1;
    }
    if (typeof item.costFootprint.cacheHit === "boolean") {
      cacheHitKnownCount += 1;
      if (item.costFootprint.cacheHit) cacheHitCount += 1;
    }
    if (typeof item.costFootprint.fallbackUsed === "boolean") {
      fallbackKnownCount += 1;
      if (item.costFootprint.fallbackUsed) fallbackCount += 1;
    }
    if (typeof item.costFootprint.overBudget === "boolean") {
      overBudgetKnownCount += 1;
      if (item.costFootprint.overBudget) overBudgetCount += 1;
    }
  }

  return {
    version: "ai_evaluation_v1",
    evaluatedCount: items.length,
    directionalCount,
    directionCorrectCount,
    directionCorrectRatePct: toPct(directionCorrectCount, directionalCount),
    avgCalibrationGapPct:
      calibrationGapCount > 0 ? Number((calibrationGapSum / calibrationGapCount).toFixed(2)) : null,
    avgRiskAdjustedUsefulness:
      usefulnessCount > 0 ? Number((usefulnessSum / usefulnessCount).toFixed(4)) : null,
    staleCount,
    staleRatePct: toPct(staleCount, items.length),
    usefulness,
    costFootprint: {
      aiEvaluatedCount,
      avgPayloadBytes:
        payloadBytesCount > 0 ? Number((payloadBytesSum / payloadBytesCount).toFixed(2)) : null,
      avgEstimatedTokens:
        estimatedTokensCount > 0
          ? Number((estimatedTokensTotal / estimatedTokensCount).toFixed(2))
          : null,
      totalEstimatedTokens: estimatedTokensTotal,
      avgToolCallsUsed:
        toolCallsCount > 0 ? Number((toolCallsSum / toolCallsCount).toFixed(2)) : null,
      cacheHitRatePct: toPct(cacheHitCount, cacheHitKnownCount),
      fallbackRatePct: toPct(fallbackCount, fallbackKnownCount),
      overBudgetRatePct: toPct(overBudgetCount, overBudgetKnownCount)
    },
    bySignalSource: {
      local: summarizeSource(items.filter((item) => item.signalSource === "local")),
      ai: summarizeSource(items.filter((item) => item.signalSource === "ai"))
    }
  };
}

export function buildPredictionEvaluationDashboardSummary(input: {
  evaluations: PredictionEvaluation[];
  metricsSamples: Array<{
    confidence: number;
    signal: "up" | "down" | "neutral";
    expectedMovePct: number | null;
    realizedReturnPct: number;
    hit: boolean | null;
    absError: number | null;
    sqError: number | null;
  }>;
  bins: number;
}) {
  return {
    evaluationSummary: buildPredictionEvaluationSummary(input.evaluations),
    metricsSummary: buildPredictionMetricsSummary(input.metricsSamples, input.bins)
  };
}
