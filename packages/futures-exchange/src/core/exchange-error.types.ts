export type ExchangeId = "bitget" | "mexc" | "hyperliquid" | "paper" | "binance";

export type ExchangeErrorCode =
  | "EX_AUTH"
  | "EX_RATE_LIMIT"
  | "EX_TIMEOUT"
  | "EX_NETWORK"
  | "EX_SYMBOL_NOT_TRADABLE"
  | "EX_POSITION_MODE_MISMATCH"
  | "EX_PRECISION_INVALID"
  | "EX_REDUCE_ONLY_REJECTED"
  | "EX_ORDER_NOT_FOUND"
  | "EX_INVALID_PARAMS"
  | "EX_UPSTREAM_UNAVAILABLE"
  | "EX_UNKNOWN";

export type ExchangeErrorParams = {
  exchange: ExchangeId;
  code: ExchangeErrorCode;
  message: string;
  retryable: boolean;
  httpStatus: number;
  details?: Record<string, unknown>;
  cause?: unknown;
};

export class ExchangeError extends Error {
  readonly exchange: ExchangeId;
  readonly code: ExchangeErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(params: ExchangeErrorParams) {
    super(params.message);
    this.name = "ExchangeError";
    this.exchange = params.exchange;
    this.code = params.code;
    this.retryable = params.retryable;
    this.httpStatus = params.httpStatus;
    this.details = params.details;
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}

export function isExchangeError(value: unknown): value is ExchangeError {
  return value instanceof ExchangeError;
}

