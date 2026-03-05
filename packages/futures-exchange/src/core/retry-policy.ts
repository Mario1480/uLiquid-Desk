import type { ExchangeErrorCode } from "./exchange-error.types.js";

export type RetryContext = {
  attempt: number;
  maxAttempts: number;
  operation: string;
  idempotent: boolean;
};

export function shouldRetryExchangeError(
  code: ExchangeErrorCode,
  context: RetryContext
): boolean {
  if (context.attempt >= context.maxAttempts) return false;
  if (!context.idempotent) {
    return code === "EX_NETWORK" || code === "EX_TIMEOUT" || code === "EX_UPSTREAM_UNAVAILABLE";
  }

  return (
    code === "EX_NETWORK" ||
    code === "EX_TIMEOUT" ||
    code === "EX_RATE_LIMIT" ||
    code === "EX_UPSTREAM_UNAVAILABLE"
  );
}

export function computeRetryDelayMs(attempt: number, baseDelayMs = 300, maxDelayMs = 8_000): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  const raw = baseDelayMs * 2 ** (safeAttempt - 1);
  return Math.min(maxDelayMs, raw);
}

