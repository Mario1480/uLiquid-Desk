import { ExchangeError, type ExchangeErrorCode } from "../core/exchange-error.types.js";
import {
  BingxApiError,
  BingxAuthError,
  BingxInvalidParamsError,
  BingxRateLimitError,
  BingxUpstreamUnavailableError,
  toExchangeErrorDetails
} from "./bingx.errors.js";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown BingX error");
}

function toLowerMessage(error: unknown): string {
  return toMessage(error).toLowerCase();
}

function toStatus(error: unknown, fallback: number): number {
  const value =
    (error as { options?: { status?: unknown }; status?: unknown })?.options?.status
    ?? (error as { status?: unknown })?.status;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 400 && parsed < 600) return parsed;
  return fallback;
}

export function classifyBingxErrorCode(error: unknown): ExchangeErrorCode {
  if (error instanceof BingxAuthError) return "EX_AUTH";
  if (error instanceof BingxRateLimitError) return "EX_RATE_LIMIT";
  if (error instanceof BingxUpstreamUnavailableError) return "EX_UPSTREAM_UNAVAILABLE";
  if (error instanceof BingxInvalidParamsError) {
    const text = toLowerMessage(error);
    if (text.includes("order not") || text.includes("not exist") || text.includes("80016")) return "EX_ORDER_NOT_FOUND";
    if (text.includes("reduceonly") || text.includes("reduce only")) return "EX_REDUCE_ONLY_REJECTED";
    if (text.includes("position side") || text.includes("position mode") || text.includes("hedge")) return "EX_POSITION_MODE_MISMATCH";
    if (text.includes("precision") || text.includes("tick") || text.includes("step") || text.includes("min")) {
      return "EX_PRECISION_INVALID";
    }
    return "EX_INVALID_PARAMS";
  }

  const text = toLowerMessage(error);
  if (text.includes("network") || text.includes("fetch failed") || text.includes("econn")) return "EX_NETWORK";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) return "EX_TIMEOUT";
  if (
    text.includes("rate limit")
    || text.includes("too many")
    || text.includes("429")
    || text.includes("418")
    || text.includes("100410")
    || text.includes("trigger frequency limit")
    || text.includes("disabled period")
  ) return "EX_RATE_LIMIT";
  if (text.includes("service unavailable") || text.includes("upstream")) return "EX_UPSTREAM_UNAVAILABLE";
  if (text.includes("order not") || text.includes("not exist")) return "EX_ORDER_NOT_FOUND";
  if (text.includes("reduceonly") || text.includes("reduce only")) return "EX_REDUCE_ONLY_REJECTED";
  if (text.includes("position side") || text.includes("position mode") || text.includes("hedge")) return "EX_POSITION_MODE_MISMATCH";
  if (text.includes("precision") || text.includes("tick") || text.includes("step") || text.includes("min notional")) {
    return "EX_PRECISION_INVALID";
  }
  if (text.includes("param") || text.includes("invalid")) return "EX_INVALID_PARAMS";
  return "EX_UNKNOWN";
}

export function mapBingxError(error: unknown): ExchangeError {
  if (error instanceof ExchangeError) return error;
  const code = classifyBingxErrorCode(error);
  const retryable =
    code === "EX_NETWORK"
    || code === "EX_TIMEOUT"
    || code === "EX_RATE_LIMIT"
    || code === "EX_UPSTREAM_UNAVAILABLE";

  return new ExchangeError({
    exchange: "bingx",
    code,
    message: toMessage(error),
    retryable,
    httpStatus: code === "EX_RATE_LIMIT"
      ? 429
      : toStatus(
          error,
          code === "EX_AUTH" ? 401 : retryable ? 502 : code === "EX_ORDER_NOT_FOUND" ? 404 : 400
        ),
    details: error instanceof BingxApiError ? toExchangeErrorDetails(error) : undefined,
    cause: error
  });
}
