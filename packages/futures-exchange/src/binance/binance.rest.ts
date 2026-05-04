import {
  BINANCE_USDM_DEFAULT_RECV_WINDOW_MS,
  BINANCE_USDM_DEFAULT_REST_BASE_URL,
  BINANCE_USDM_DEFAULT_RETRY_ATTEMPTS,
  BINANCE_USDM_DEFAULT_RETRY_BASE_DELAY_MS,
  BINANCE_USDM_DEFAULT_TIMEOUT_MS
} from "./binance.constants.js";
import { mapBinanceError } from "./binance-error.mapper.js";
import { toBinanceError, type BinanceApiError } from "./binance.errors.js";
import { buildBinanceQueryString, buildSignedBinanceQuery } from "./binance.signing.js";
import { computeRetryDelayMs, shouldRetryExchangeError } from "../core/retry-policy.js";
import type { BinanceAdapterConfig, BinanceLogEntry, HttpMethod } from "./binance.types.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

export type BinanceRestClientOptions = Pick<
  BinanceAdapterConfig,
  | "apiKey"
  | "apiSecret"
  | "restBaseUrl"
  | "recvWindowMs"
  | "timeoutMs"
  | "retryAttempts"
  | "retryBaseDelayMs"
  | "log"
>;

export class BinanceRestClient {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly recvWindowMs: number;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBaseDelayMs: number;

  constructor(private readonly options: BinanceRestClientOptions = {}) {
    this.baseUrl = (options.restBaseUrl ?? process.env.BINANCE_PERP_BASE_URL ?? BINANCE_USDM_DEFAULT_REST_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.recvWindowMs = options.recvWindowMs ?? Number(process.env.BINANCE_RECV_WINDOW ?? BINANCE_USDM_DEFAULT_RECV_WINDOW_MS);
    this.timeoutMs = options.timeoutMs ?? BINANCE_USDM_DEFAULT_TIMEOUT_MS;
    this.retryAttempts = options.retryAttempts ?? BINANCE_USDM_DEFAULT_RETRY_ATTEMPTS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? BINANCE_USDM_DEFAULT_RETRY_BASE_DELAY_MS;
  }

  private log(entry: Omit<BinanceLogEntry, "at">) {
    if (!this.options.log) return;
    this.options.log({
      at: nowIso(),
      ...entry
    });
  }

  private async doRequest<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
    privateAuth: boolean;
    apiKeyAuth?: boolean;
  }): Promise<T> {
    const start = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json"
    };

    let queryString = buildBinanceQueryString(
      (params.query ?? {}) as Record<string, string | number | boolean | undefined | null>
    );
    if (params.privateAuth) {
      if (!this.apiKey || !this.apiSecret) {
        throw toBinanceError({
          endpoint: params.endpoint,
          method: params.method,
          message: "Missing Binance API credentials"
        });
      }
      headers["X-MBX-APIKEY"] = this.apiKey;
      queryString = buildSignedBinanceQuery({
        params: params.query as Record<string, string | number | boolean | undefined | null>,
        secret: this.apiSecret,
        timestampMs: Date.now(),
        recvWindowMs: this.recvWindowMs
      });
    } else if (params.apiKeyAuth) {
      if (!this.apiKey) {
        throw toBinanceError({
          endpoint: params.endpoint,
          method: params.method,
          message: "Missing Binance API key"
        });
      }
      headers["X-MBX-APIKEY"] = this.apiKey;
    }

    const url = `${this.baseUrl}${params.endpoint}${queryString ? `?${queryString}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: params.method,
        headers,
        signal: controller.signal
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { msg: text };
      }

      const obj = asRecord(json);
      const binanceCode = typeof obj.code === "number" ? obj.code : undefined;
      const okByCode = binanceCode === undefined || binanceCode === 0;
      const ok = res.ok && okByCode;

      if (!ok) {
        throw toBinanceError({
          endpoint: params.endpoint,
          method: params.method,
          status: res.status,
          binanceCode,
          message: typeof obj.msg === "string" ? obj.msg : typeof obj.message === "string" ? obj.message : `HTTP ${res.status}`,
          responseBody: json
        });
      }

      this.log({
        endpoint: params.endpoint,
        method: params.method,
        durationMs: Date.now() - start,
        status: res.status,
        binanceCode,
        ok: true,
        requestId
      });
      return json as T;
    } catch (error) {
      const err = error as BinanceApiError;
      this.log({
        endpoint: params.endpoint,
        method: params.method,
        durationMs: Date.now() - start,
        status: err?.options?.status,
        binanceCode: err?.options?.binanceCode,
        ok: false,
        message: String(error),
        requestId
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async withRetry<T>(params: {
    operation: string;
    idempotent: boolean;
    fn: () => Promise<T>;
  }): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt < this.retryAttempts) {
      attempt += 1;
      try {
        return await params.fn();
      } catch (error) {
        lastError = error;
        const mapped = mapBinanceError(error);
        const retry = shouldRetryExchangeError(mapped.code, {
          attempt,
          maxAttempts: this.retryAttempts,
          operation: params.operation,
          idempotent: params.idempotent
        });
        if (!retry) break;
        const delay = computeRetryDelayMs(attempt, this.retryBaseDelayMs);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  async requestPublic<T>(
    method: HttpMethod,
    endpoint: string,
    query?: Record<string, unknown>
  ): Promise<T> {
    return this.withRetry({
      operation: `${method} ${endpoint}`,
      idempotent: method === "GET",
      fn: () => this.doRequest<T>({
        method,
        endpoint,
        query,
        privateAuth: false
      })
    });
  }

  async requestApiKey<T>(
    method: HttpMethod,
    endpoint: string,
    query?: Record<string, unknown>
  ): Promise<T> {
    return this.withRetry({
      operation: `${method} ${endpoint}`,
      idempotent: method === "GET" || method === "PUT",
      fn: () => this.doRequest<T>({
        method,
        endpoint,
        query,
        privateAuth: false,
        apiKeyAuth: true
      })
    });
  }

  async requestPrivate<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
  }): Promise<T> {
    return this.withRetry({
      operation: `${params.method} ${params.endpoint}`,
      idempotent: params.method === "GET",
      fn: () => this.doRequest<T>({
        method: params.method,
        endpoint: params.endpoint,
        query: params.query,
        privateAuth: true
      })
    });
  }
}
