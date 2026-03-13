type RunnerExecutionDomain = "prediction_copier" | "grid";

type RunnerExecutionMetaParams = {
  domain: RunnerExecutionDomain;
  stage: string;
  symbol?: string | null;
  instanceId?: string | null;
  reason?: string | null;
  error?: unknown;
  extra?: Record<string, unknown> | null;
};

function normalizeSymbol(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function toRunnerErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function buildRunnerExecutionMeta(params: RunnerExecutionMetaParams): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    domain: params.domain,
    stage: params.stage
  };

  const symbol = normalizeSymbol(params.symbol);
  if (symbol) meta.symbol = symbol;
  if (params.instanceId) meta.instanceId = params.instanceId;
  if (params.reason) meta.reason = params.reason;
  if (params.error !== undefined) meta.error = toRunnerErrorMessage(params.error);
  if (params.extra) {
    for (const [key, value] of Object.entries(params.extra)) {
      if (value !== undefined) meta[key] = value;
    }
  }
  return meta;
}

export function buildPredictionCopierTradeMeta(params: {
  stage: string;
  symbol: string;
  reason?: string | null;
  error?: unknown;
  extra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return buildRunnerExecutionMeta({
    domain: "prediction_copier",
    stage: params.stage,
    symbol: params.symbol,
    reason: params.reason ?? null,
    error: params.error,
    extra: params.extra ?? null
  });
}

export function buildGridExecutionMeta(params: {
  stage: string;
  symbol?: string | null;
  instanceId: string;
  reason?: string | null;
  error?: unknown;
  extra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return buildRunnerExecutionMeta({
    domain: "grid",
    stage: params.stage,
    symbol: params.symbol ?? null,
    instanceId: params.instanceId,
    reason: params.reason ?? null,
    error: params.error,
    extra: params.extra ?? null
  });
}
