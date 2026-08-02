export type PredictionEvaluationState = "running" | "final";

export function buildPredictionCopierReviewHref(input: {
  localePath: string;
  stateId: string;
  accountId?: string | null;
}): string {
  const params = new URLSearchParams({
    review: "1",
    strategy: "prediction_copier",
    sourceStateId: input.stateId
  });
  if (input.accountId) params.set("exchangeAccountId", input.accountId);
  return `${input.localePath}?${params.toString()}`;
}

export function predictionEvaluationState(input: {
  outcomeStatus?: string | null;
  evaluatedAt?: string | null;
}): PredictionEvaluationState {
  return input.outcomeStatus === "closed" && Boolean(input.evaluatedAt) ? "final" : "running";
}

export function averageConfidence(values: number[]): number | null {
  const normalized = values
    .map((value) => value <= 1 ? value * 100 : value)
    .filter((value) => Number.isFinite(value));
  if (normalized.length === 0) return null;
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
}

export type SeparatedPerformance = {
  prediction: { directionAccuracy: number | null; sampleSize: number };
  copier: { executionReturnPct: number | null; executions: number | null };
};

export function separatePredictionAndCopierMetrics(input: {
  directionAccuracy: number | null;
  sampleSize: number;
  copierExecutionReturnPct?: number | null;
  copierExecutions?: number | null;
}): SeparatedPerformance {
  return {
    prediction: {
      directionAccuracy: input.directionAccuracy,
      sampleSize: input.sampleSize
    },
    copier: {
      executionReturnPct: input.copierExecutionReturnPct ?? null,
      executions: input.copierExecutions ?? null
    }
  };
}
