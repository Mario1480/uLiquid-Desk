import { ExchangeError } from "../core/exchange-error.types.js";

export class BingxApiError extends Error {
  constructor(
    message: string,
    public readonly options: {
      endpoint: string;
      method: string;
      status?: number;
      bingxCode?: number;
      responseBody?: unknown;
    }
  ) {
    super(message);
    this.name = "BingxApiError";
  }
}

export class BingxAuthError extends BingxApiError {
  constructor(message: string, options: ConstructorParameters<typeof BingxApiError>[1]) {
    super(message, options);
    this.name = "BingxAuthError";
  }
}

export class BingxRateLimitError extends BingxApiError {
  constructor(message: string, options: ConstructorParameters<typeof BingxApiError>[1]) {
    super(message, options);
    this.name = "BingxRateLimitError";
  }
}

export class BingxInvalidParamsError extends BingxApiError {
  constructor(message: string, options: ConstructorParameters<typeof BingxApiError>[1]) {
    super(message, options);
    this.name = "BingxInvalidParamsError";
  }
}

export class BingxUpstreamUnavailableError extends BingxApiError {
  constructor(message: string, options: ConstructorParameters<typeof BingxApiError>[1]) {
    super(message, options);
    this.name = "BingxUpstreamUnavailableError";
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isAuthCode(code?: number): boolean {
  return code === 401
    || code === 403
    || code === 100001
    || code === 100004
    || code === 100419
    || code === 100421;
}

function isRateLimitCode(code?: number): boolean {
  return code === 418 || code === 429 || code === 100410;
}

function isUpstreamCode(code?: number): boolean {
  return code === 502 || code === 503 || code === 504 || code === 80012;
}

function isInvalidParamsCode(code?: number): boolean {
  return code === 400 || code === 100400 || code === 109400 || code === 80016 || code === 101204;
}

export function toBingxError(params: {
  endpoint: string;
  method: string;
  status?: number;
  bingxCode?: number;
  message?: string;
  responseBody?: unknown;
}): BingxApiError {
  const normalizedMessage = normalize(params.message);
  const code = params.bingxCode ?? params.status;

  if (
    isAuthCode(code)
    || normalizedMessage.includes("signature")
    || normalizedMessage.includes("api key")
    || normalizedMessage.includes("apikey")
    || normalizedMessage.includes("timestamp")
    || normalizedMessage.includes("permission")
  ) {
    return new BingxAuthError(params.message ?? "BingX auth error", params);
  }

  if (isRateLimitCode(code) || normalizedMessage.includes("too many requests") || normalizedMessage.includes("rate limit")) {
    return new BingxRateLimitError(params.message ?? "BingX rate limit", params);
  }

  if (isUpstreamCode(code) || normalizedMessage.includes("service unavailable")) {
    return new BingxUpstreamUnavailableError(params.message ?? "BingX endpoint unavailable", params);
  }

  if (isInvalidParamsCode(code) || normalizedMessage.includes("invalid") || normalizedMessage.includes("not exist")) {
    return new BingxInvalidParamsError(params.message ?? "BingX invalid params", params);
  }

  return new BingxApiError(params.message ?? "BingX request failed", params);
}

export function isAlreadySetMarginTypeError(error: unknown): boolean {
  if (error instanceof BingxApiError) {
    return normalize(error.message).includes("no need") || normalize(error.message).includes("same margin");
  }
  return normalize(error).includes("no need") || normalize(error).includes("same margin");
}

export function toExchangeErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof BingxApiError) return { bingx: error.options };
  if (error instanceof ExchangeError) return error.details;
  return undefined;
}
