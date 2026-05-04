import { ExchangeError } from "../core/exchange-error.types.js";

export class BinanceApiError extends Error {
  constructor(
    message: string,
    public readonly options: {
      endpoint: string;
      method: string;
      status?: number;
      binanceCode?: number;
      responseBody?: unknown;
    }
  ) {
    super(message);
    this.name = "BinanceApiError";
  }
}

export class BinanceAuthError extends BinanceApiError {
  constructor(message: string, options: ConstructorParameters<typeof BinanceApiError>[1]) {
    super(message, options);
    this.name = "BinanceAuthError";
  }
}

export class BinanceRateLimitError extends BinanceApiError {
  constructor(message: string, options: ConstructorParameters<typeof BinanceApiError>[1]) {
    super(message, options);
    this.name = "BinanceRateLimitError";
  }
}

export class BinanceInvalidParamsError extends BinanceApiError {
  constructor(message: string, options: ConstructorParameters<typeof BinanceApiError>[1]) {
    super(message, options);
    this.name = "BinanceInvalidParamsError";
  }
}

export class BinanceUpstreamUnavailableError extends BinanceApiError {
  constructor(message: string, options: ConstructorParameters<typeof BinanceApiError>[1]) {
    super(message, options);
    this.name = "BinanceUpstreamUnavailableError";
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isAuthCode(code?: number): boolean {
  return code === 401 || code === 403 || code === -2014 || code === -2015 || code === -1022 || code === -1021;
}

function isRateLimitCode(code?: number): boolean {
  return code === 418 || code === 429 || code === -1003;
}

function isUpstreamCode(code?: number): boolean {
  return code === 502 || code === 503 || code === 504 || code === -1000 || code === -1001 || code === -1007;
}

function isInvalidParamsCode(code?: number): boolean {
  return code === 400 || code === -1100 || code === -1101 || code === -1102 || code === -1111 || code === -2011 || code === -2022 || code === -4164 || code === -4061;
}

export function toBinanceError(params: {
  endpoint: string;
  method: string;
  status?: number;
  binanceCode?: number;
  message?: string;
  responseBody?: unknown;
}): BinanceApiError {
  const normalizedMessage = normalize(params.message);
  const code = params.binanceCode ?? params.status;

  if (
    isAuthCode(code)
    || normalizedMessage.includes("signature")
    || normalizedMessage.includes("api-key")
    || normalizedMessage.includes("apikey")
    || normalizedMessage.includes("timestamp")
  ) {
    return new BinanceAuthError(params.message ?? "Binance auth error", params);
  }

  if (isRateLimitCode(code) || normalizedMessage.includes("too many requests") || normalizedMessage.includes("rate limit")) {
    return new BinanceRateLimitError(params.message ?? "Binance rate limit", params);
  }

  if (isUpstreamCode(code) || normalizedMessage.includes("service unavailable")) {
    return new BinanceUpstreamUnavailableError(params.message ?? "Binance endpoint unavailable", params);
  }

  if (isInvalidParamsCode(code) || normalizedMessage.includes("invalid") || normalizedMessage.includes("filter")) {
    return new BinanceInvalidParamsError(params.message ?? "Binance invalid params", params);
  }

  return new BinanceApiError(params.message ?? "Binance request failed", params);
}

export function isAlreadySetMarginTypeError(error: unknown): boolean {
  if (error instanceof BinanceApiError) {
    return error.options.binanceCode === -4046 || normalize(error.message).includes("no need to change margin type");
  }
  return normalize(error).includes("no need to change margin type");
}

export function toExchangeErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof BinanceApiError) return { binance: error.options };
  if (error instanceof ExchangeError) return error.details;
  return undefined;
}

