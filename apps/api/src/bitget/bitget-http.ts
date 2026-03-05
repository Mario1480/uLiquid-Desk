import crypto from "node:crypto";

export type BitgetHttpMethod = "GET" | "POST" | "DELETE";
export type BitgetQuery = Record<string, unknown>;

export type BitgetAuthConfig = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};

export type BitgetResponseEnvelope<T> = {
  code?: string;
  msg?: string;
  data?: T;
};

export type BitgetHttpErrorCode =
  | "bitget_auth_failed"
  | "bitget_rate_limited"
  | "bitget_timeout"
  | "bitget_network_error"
  | "bitget_bad_response"
  | "bitget_endpoint_not_found"
  | "bitget_upstream_error"
  | "bitget_request_failed";

export class BitgetHttpError extends Error {
  readonly status: number;
  readonly code: BitgetHttpErrorCode;
  readonly endpoint: string;
  readonly method: BitgetHttpMethod;
  readonly retryable: boolean;
  readonly responseCode?: string;
  readonly responseMessage?: string;

  constructor(params: {
    status: number;
    code: BitgetHttpErrorCode;
    message: string;
    endpoint: string;
    method: BitgetHttpMethod;
    retryable: boolean;
    responseCode?: string;
    responseMessage?: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "BitgetHttpError";
    this.status = params.status;
    this.code = params.code;
    this.endpoint = params.endpoint;
    this.method = params.method;
    this.retryable = params.retryable;
    this.responseCode = params.responseCode;
    this.responseMessage = params.responseMessage;
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}

export function isBitgetHttpError(error: unknown): error is BitgetHttpError {
  return error instanceof BitgetHttpError;
}

export function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);

  const encode = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((row) => encode(row));
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input).sort()) {
        const item = (input as Record<string, unknown>)[key];
        if (item === undefined) continue;
        out[key] = encode(item);
      }
      return out;
    }
    return input;
  };

  return JSON.stringify(encode(value));
}

export function buildBitgetQueryString(query: BitgetQuery | undefined): string {
  if (!query) return "";
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export function signBitgetRequest(params: {
  timestamp: string;
  method: BitgetHttpMethod;
  path: string;
  query?: BitgetQuery;
  body?: unknown;
  secretKey: string;
}): string {
  const queryString = buildBitgetQueryString(params.query);
  const bodyString = params.method === "POST" ? stableStringify(params.body) : "";
  const prehash = `${params.timestamp}${params.method}${params.path}${queryString ? `?${queryString}` : ""}${bodyString}`;
  return crypto.createHmac("sha256", params.secretKey).update(prehash).digest("base64");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(params: {
  attempt: number;
  attempts: number;
  method: BitgetHttpMethod;
  retryMode: "never" | "safe_get" | "always";
  error: BitgetHttpError;
}): boolean {
  if (params.attempt >= params.attempts) return false;
  if (!params.error.retryable) return false;
  if (params.retryMode === "always") return true;
  if (params.retryMode === "never") return false;
  return params.method === "GET";
}

function classifyErrorFromResponse(params: {
  status: number;
  endpoint: string;
  method: BitgetHttpMethod;
  responseCode: string;
  responseMessage: string;
}): BitgetHttpError {
  const lower = params.responseMessage.toLowerCase();
  const auth =
    params.status === 401 ||
    params.status === 403 ||
    params.responseCode === "40001" ||
    params.responseCode === "40002" ||
    params.responseCode === "40003" ||
    /auth|signature|apikey|api key|passphrase|permission|invalid/i.test(lower);
  if (auth) {
    return new BitgetHttpError({
      status: 401,
      code: "bitget_auth_failed",
      message: `Bitget request failed: ${params.responseMessage}`,
      endpoint: params.endpoint,
      method: params.method,
      retryable: false,
      responseCode: params.responseCode,
      responseMessage: params.responseMessage
    });
  }

  const notFound = params.status === 404 || /404|path|endpoint/.test(lower);
  if (notFound) {
    return new BitgetHttpError({
      status: 404,
      code: "bitget_endpoint_not_found",
      message: `Bitget request failed: ${params.responseMessage}`,
      endpoint: params.endpoint,
      method: params.method,
      retryable: false,
      responseCode: params.responseCode,
      responseMessage: params.responseMessage
    });
  }

  const rateLimited = params.status === 429 || /rate limit|too many requests|too many/.test(lower);
  if (rateLimited) {
    return new BitgetHttpError({
      status: 429,
      code: "bitget_rate_limited",
      message: `Bitget request failed: ${params.responseMessage}`,
      endpoint: params.endpoint,
      method: params.method,
      retryable: true,
      responseCode: params.responseCode,
      responseMessage: params.responseMessage
    });
  }

  const upstream = params.status >= 500;
  if (upstream) {
    return new BitgetHttpError({
      status: 502,
      code: "bitget_upstream_error",
      message: `Bitget request failed: ${params.responseMessage}`,
      endpoint: params.endpoint,
      method: params.method,
      retryable: true,
      responseCode: params.responseCode,
      responseMessage: params.responseMessage
    });
  }

  return new BitgetHttpError({
    status: 400,
    code: "bitget_request_failed",
    message: `Bitget request failed: ${params.responseMessage}`,
    endpoint: params.endpoint,
    method: params.method,
    retryable: false,
    responseCode: params.responseCode,
    responseMessage: params.responseMessage
  });
}

export async function requestBitgetApi<T>(params: {
  baseUrl: string;
  path: string;
  method?: BitgetHttpMethod;
  query?: BitgetQuery;
  body?: unknown;
  auth?: BitgetAuthConfig;
  timeoutMs?: number;
  retryMode?: "never" | "safe_get" | "always";
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<T> {
  const method = params.method ?? "GET";
  const timeoutMs = Number.isFinite(Number(params.timeoutMs)) ? Math.max(500, Number(params.timeoutMs)) : 12_000;
  const retryMode = params.retryMode ?? "safe_get";
  const maxAttempts = Number.isFinite(Number(params.maxAttempts)) ? Math.max(1, Number(params.maxAttempts)) : 2;
  const retryDelayMs = Number.isFinite(Number(params.retryDelayMs)) ? Math.max(50, Number(params.retryDelayMs)) : 250;
  const queryString = buildBitgetQueryString(params.query);
  const url = `${params.baseUrl}${params.path}${queryString ? `?${queryString}` : ""}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (params.auth) {
        const timestamp = String(Date.now());
        const signature = signBitgetRequest({
          timestamp,
          method,
          path: params.path,
          query: params.query,
          body: params.body,
          secretKey: params.auth.apiSecret
        });
        headers["ACCESS-KEY"] = params.auth.apiKey;
        headers["ACCESS-SIGN"] = signature;
        headers["ACCESS-TIMESTAMP"] = timestamp;
        headers["ACCESS-PASSPHRASE"] = params.auth.apiPassphrase;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: method === "POST" ? stableStringify(params.body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      let payload: BitgetResponseEnvelope<T> = {};
      if (text) {
        try {
          payload = JSON.parse(text) as BitgetResponseEnvelope<T>;
        } catch {
          throw new BitgetHttpError({
            status: 502,
            code: "bitget_bad_response",
            message: "Bitget returned an invalid JSON response.",
            endpoint: params.path,
            method,
            retryable: false
          });
        }
      }

      if (!response.ok || String(payload.code ?? "") !== "00000") {
        const responseCode = String(payload.code ?? "");
        const responseMessage = String(payload.msg ?? response.statusText ?? `HTTP ${response.status}`);
        throw classifyErrorFromResponse({
          status: response.status,
          endpoint: params.path,
          method,
          responseCode,
          responseMessage
        });
      }

      return payload.data as T;
    } catch (error) {
      if (isBitgetHttpError(error)) {
        if (shouldRetry({ attempt, attempts: maxAttempts, method, retryMode, error })) {
          await wait(retryDelayMs * attempt);
          continue;
        }
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        const timeoutError = new BitgetHttpError({
          status: 504,
          code: "bitget_timeout",
          message: "Bitget request timed out.",
          endpoint: params.path,
          method,
          retryable: true,
          cause: error
        });
        if (shouldRetry({ attempt, attempts: maxAttempts, method, retryMode, error: timeoutError })) {
          await wait(retryDelayMs * attempt);
          continue;
        }
        throw timeoutError;
      }
      const networkError = new BitgetHttpError({
        status: 502,
        code: "bitget_network_error",
        message: "Bitget request failed due to network error.",
        endpoint: params.path,
        method,
        retryable: true,
        cause: error
      });
      if (shouldRetry({ attempt, attempts: maxAttempts, method, retryMode, error: networkError })) {
        await wait(retryDelayMs * attempt);
        continue;
      }
      throw networkError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new BitgetHttpError({
    status: 502,
    code: "bitget_request_failed",
    message: "Bitget request failed.",
    endpoint: params.path,
    method,
    retryable: false
  });
}

