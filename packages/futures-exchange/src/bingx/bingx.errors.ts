import { ExchangeError } from "../core/exchange-error.types.js";

export type BingxApiErrorOptions = {
  endpoint: string;
  method: string;
  status?: number;
  bingxCode?: number;
  responseBody?: unknown;
  rateLimitUntilMs?: number;
  retryAfterMs?: number;
  retryAfterAt?: string;
};

export class BingxApiError extends Error {
  constructor(
    message: string,
    public readonly options: BingxApiErrorOptions
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

function parseRateLimitTimestampFromString(value: string): number | null {
  const matches = value.match(/\b\d{13}\b/g);
  if (!matches) return null;
  for (const match of matches) {
    const parsed = Number(match);
    if (Number.isFinite(parsed) && parsed > 1_500_000_000_000) return parsed;
  }
  return null;
}

export function parseBingxRateLimitUntilMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 1_500_000_000_000) {
    return value;
  }
  if (typeof value === "string") return parseRateLimitTimestampFromString(value);
  if (value instanceof Error) {
    return parseBingxRateLimitUntilMs(value.message)
      ?? parseBingxRateLimitUntilMs((value as { options?: unknown }).options);
  }
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const key of ["rateLimitUntilMs", "retryAfterMs", "retryAfterAt", "msg", "message", "responseBody"]) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const nested = record[key];
    if (key === "retryAfterMs") {
      const retryAfter = Number(nested);
      if (Number.isFinite(retryAfter) && retryAfter > 0) return Date.now() + retryAfter;
    }
    if (key === "retryAfterAt" && typeof nested === "string") {
      const parsedDate = Date.parse(nested);
      if (Number.isFinite(parsedDate)) return parsedDate;
    }
    const parsed = parseBingxRateLimitUntilMs(nested);
    if (parsed !== null) return parsed;
  }
  return null;
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
  const rateLimitUntilMs =
    parseBingxRateLimitUntilMs(params.message)
    ?? parseBingxRateLimitUntilMs(params.responseBody);
  const enrichedParams: BingxApiErrorOptions = {
    ...params,
    ...(rateLimitUntilMs !== null
      ? {
          rateLimitUntilMs,
          retryAfterMs: Math.max(0, rateLimitUntilMs - Date.now()),
          retryAfterAt: new Date(rateLimitUntilMs).toISOString()
        }
      : {})
  };

  if (
    isAuthCode(code)
    || normalizedMessage.includes("signature")
    || normalizedMessage.includes("api key")
    || normalizedMessage.includes("apikey")
    || normalizedMessage.includes("timestamp")
    || normalizedMessage.includes("permission")
  ) {
    return new BingxAuthError(params.message ?? "BingX auth error", enrichedParams);
  }

  if (
    isRateLimitCode(code)
    || normalizedMessage.includes("100410")
    || normalizedMessage.includes("too many requests")
    || normalizedMessage.includes("rate limit")
    || normalizedMessage.includes("trigger frequency limit")
    || normalizedMessage.includes("disabled period")
  ) {
    return new BingxRateLimitError(params.message ?? "BingX rate limit", enrichedParams);
  }

  if (isUpstreamCode(code) || normalizedMessage.includes("service unavailable")) {
    return new BingxUpstreamUnavailableError(params.message ?? "BingX endpoint unavailable", enrichedParams);
  }

  if (isInvalidParamsCode(code) || normalizedMessage.includes("invalid") || normalizedMessage.includes("not exist")) {
    return new BingxInvalidParamsError(params.message ?? "BingX invalid params", enrichedParams);
  }

  return new BingxApiError(params.message ?? "BingX request failed", enrichedParams);
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
