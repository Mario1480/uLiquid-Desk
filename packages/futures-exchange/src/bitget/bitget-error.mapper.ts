import { ExchangeError, type ExchangeErrorCode } from "../core/exchange-error.types.js";
import {
  BitgetApiError,
  BitgetAuthError,
  BitgetInvalidParamsError,
  BitgetMaintenanceError,
  BitgetRateLimitError,
  BitgetSymbolStatusError
} from "./bitget.errors.js";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown Bitget error");
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

function classifyByMessage(error: unknown): ExchangeErrorCode {
  const text = toLowerMessage(error);
  if (text.includes("network") || text.includes("fetch failed")) return "EX_NETWORK";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) return "EX_TIMEOUT";
  if (text.includes("position mode") || text.includes("unilateral") || text.includes("one-way") || text.includes("hedge")) {
    return "EX_POSITION_MODE_MISMATCH";
  }
  if (text.includes("reduceonly") || text.includes("reduce only")) return "EX_REDUCE_ONLY_REJECTED";
  if (text.includes("order not exist") || text.includes("order not found")) return "EX_ORDER_NOT_FOUND";
  if (text.includes("tick") || text.includes("step") || text.includes("precision") || text.includes("price")) {
    return "EX_PRECISION_INVALID";
  }
  if (text.includes("symbol status") || text.includes("restrictedapi")) return "EX_SYMBOL_NOT_TRADABLE";
  if (text.includes("param") || text.includes("invalid")) return "EX_INVALID_PARAMS";
  return "EX_UNKNOWN";
}

export function mapBitgetError(error: unknown): ExchangeError {
  if (error instanceof ExchangeError) return error;

  if (error instanceof BitgetAuthError) {
    return new ExchangeError({
      exchange: "bitget",
      code: "EX_AUTH",
      message: error.message,
      retryable: false,
      httpStatus: toStatus(error, 401),
      details: { bitget: error.options },
      cause: error
    });
  }

  if (error instanceof BitgetRateLimitError) {
    return new ExchangeError({
      exchange: "bitget",
      code: "EX_RATE_LIMIT",
      message: error.message,
      retryable: true,
      httpStatus: toStatus(error, 429),
      details: { bitget: error.options },
      cause: error
    });
  }

  if (error instanceof BitgetMaintenanceError) {
    return new ExchangeError({
      exchange: "bitget",
      code: "EX_UPSTREAM_UNAVAILABLE",
      message: error.message,
      retryable: true,
      httpStatus: toStatus(error, 503),
      details: { bitget: error.options },
      cause: error
    });
  }

  if (error instanceof BitgetSymbolStatusError) {
    return new ExchangeError({
      exchange: "bitget",
      code: "EX_SYMBOL_NOT_TRADABLE",
      message: error.message,
      retryable: false,
      httpStatus: toStatus(error, 409),
      details: { bitget: error.options },
      cause: error
    });
  }

  if (error instanceof BitgetInvalidParamsError) {
    const classified = classifyByMessage(error);
    const retryable = classified === "EX_TIMEOUT" || classified === "EX_NETWORK";
    return new ExchangeError({
      exchange: "bitget",
      code: classified,
      message: error.message,
      retryable,
      httpStatus: toStatus(error, classified === "EX_ORDER_NOT_FOUND" ? 404 : 400),
      details: { bitget: error.options },
      cause: error
    });
  }

  if (error instanceof BitgetApiError) {
    const classified = classifyByMessage(error);
    const retryable =
      classified === "EX_NETWORK"
      || classified === "EX_TIMEOUT"
      || classified === "EX_RATE_LIMIT"
      || classified === "EX_UPSTREAM_UNAVAILABLE";
    return new ExchangeError({
      exchange: "bitget",
      code: classified,
      message: error.message,
      retryable,
      httpStatus: toStatus(error, retryable ? 502 : 400),
      details: { bitget: error.options },
      cause: error
    });
  }

  const classified = classifyByMessage(error);
  const retryable =
    classified === "EX_NETWORK"
    || classified === "EX_TIMEOUT"
    || classified === "EX_RATE_LIMIT"
    || classified === "EX_UPSTREAM_UNAVAILABLE";

  return new ExchangeError({
    exchange: "bitget",
    code: classified,
    message: toMessage(error),
    retryable,
    httpStatus: retryable ? 502 : 500,
    cause: error
  });
}

