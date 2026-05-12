import {
  BINGX_USDM_DEFAULT_RECV_WINDOW_MS,
  BINGX_USDM_DEFAULT_REST_BASE_URL,
  BINGX_USDM_DEFAULT_RETRY_ATTEMPTS,
  BINGX_USDM_DEFAULT_RETRY_BASE_DELAY_MS,
  BINGX_USDM_DEFAULT_TIMEOUT_MS
} from "./bingx.constants.js";
import { mapBingxError } from "./bingx-error.mapper.js";
import { parseBingxRateLimitUntilMs, toBingxError, type BingxApiError } from "./bingx.errors.js";
import {
  buildBingxQueryString,
  buildSignedBingxJsonBody,
  buildSignedBingxQuery
} from "./bingx.signing.js";
import { computeRetryDelayMs, shouldRetryExchangeError } from "../core/retry-policy.js";
import type { BingxAdapterConfig, BingxLogEntry, HttpMethod } from "./bingx.types.js";

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

export type BingxRestClientOptions = Pick<
  BingxAdapterConfig,
  | "apiKey"
  | "apiSecret"
  | "restBaseUrl"
  | "recvWindowMs"
  | "timeoutMs"
  | "retryAttempts"
  | "retryBaseDelayMs"
  | "log"
>;

export class BingxRestClient {
  private static readonly endpointCooldowns = new Map<string, number>();

  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly recvWindowMs: number;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBaseDelayMs: number;

  constructor(private readonly options: BingxRestClientOptions = {}) {
    this.baseUrl = (options.restBaseUrl ?? process.env.BINGX_REST_BASE_URL ?? BINGX_USDM_DEFAULT_REST_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.recvWindowMs = options.recvWindowMs ?? Number(process.env.BINGX_RECV_WINDOW_MS ?? BINGX_USDM_DEFAULT_RECV_WINDOW_MS);
    this.timeoutMs = options.timeoutMs ?? BINGX_USDM_DEFAULT_TIMEOUT_MS;
    this.retryAttempts = options.retryAttempts ?? BINGX_USDM_DEFAULT_RETRY_ATTEMPTS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? BINGX_USDM_DEFAULT_RETRY_BASE_DELAY_MS;
  }

  private log(entry: Omit<BingxLogEntry, "at">) {
    if (!this.options.log) return;
    this.options.log({ at: nowIso(), ...entry });
  }

  private endpointCooldownKey(params: { method: HttpMethod; endpoint: string }): string {
    return `${this.apiKey ?? "public"}|${params.method}|${params.endpoint}`;
  }

  private activeEndpointCooldownError(params: { method: HttpMethod; endpoint: string }): BingxApiError | null {
    const cooldownKey = this.endpointCooldownKey(params);
    const cooldownUntilMs = BingxRestClient.endpointCooldowns.get(cooldownKey) ?? 0;
    const now = Date.now();
    if (cooldownUntilMs <= now) {
      if (cooldownUntilMs > 0) BingxRestClient.endpointCooldowns.delete(cooldownKey);
      return null;
    }

    return toBingxError({
      endpoint: params.endpoint,
      method: params.method,
      status: 429,
      bingxCode: 100410,
      message: `BingX endpoint rate limit cooldown active until ${new Date(cooldownUntilMs).toISOString()}`,
      responseBody: {
        localCooldown: true,
        rateLimitUntilMs: cooldownUntilMs,
        retryAfterMs: cooldownUntilMs - now
      }
    });
  }

  private rememberEndpointCooldown(params: { method: HttpMethod; endpoint: string }, error: BingxApiError): void {
    const cooldownUntilMs =
      error.options.rateLimitUntilMs
      ?? parseBingxRateLimitUntilMs(error.options.responseBody)
      ?? parseBingxRateLimitUntilMs(error.message);
    if (cooldownUntilMs === null || cooldownUntilMs <= Date.now()) return;
    BingxRestClient.endpointCooldowns.set(this.endpointCooldownKey(params), cooldownUntilMs);
  }

  private async doRequest<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
    privateAuth: boolean;
    apiKeyAuth?: boolean;
    bodyFormat?: "query" | "json";
  }): Promise<T> {
    const start = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const activeCooldown = this.activeEndpointCooldownError(params);
    if (activeCooldown) throw activeCooldown;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json"
    };

    let body: string | undefined;
    let queryString = buildBingxQueryString(
      (params.query ?? {}) as Record<string, string | number | boolean | undefined | null>
    );
    if (params.privateAuth) {
      if (!this.apiKey || !this.apiSecret) {
        throw toBingxError({
          endpoint: params.endpoint,
          method: params.method,
          message: "Missing BingX API credentials"
        });
      }
      headers["X-BX-APIKEY"] = this.apiKey;
      if (params.bodyFormat === "json") {
        body = JSON.stringify(buildSignedBingxJsonBody({
          params: params.query as Record<string, string | number | boolean | undefined | null>,
          secret: this.apiSecret,
          timestampMs: Date.now(),
          recvWindowMs: this.recvWindowMs
        }));
        queryString = "";
      } else {
        queryString = buildSignedBingxQuery({
          params: params.query as Record<string, string | number | boolean | undefined | null>,
          secret: this.apiSecret,
          timestampMs: Date.now(),
          recvWindowMs: this.recvWindowMs
        });
      }
    } else if (params.apiKeyAuth) {
      if (!this.apiKey) {
        throw toBingxError({
          endpoint: params.endpoint,
          method: params.method,
          message: "Missing BingX API key"
        });
      }
      headers["X-BX-APIKEY"] = this.apiKey;
    }

    const url = `${this.baseUrl}${params.endpoint}${queryString ? `?${queryString}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: params.method,
        headers,
        body,
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
      const rawCode = obj.code;
      const bingxCode = rawCode === undefined ? undefined : Number(rawCode);
      const okByCode = bingxCode === undefined || bingxCode === 0;
      const ok = res.ok && okByCode;

      if (!ok) {
        const apiError = toBingxError({
          endpoint: params.endpoint,
          method: params.method,
          status: res.status,
          bingxCode,
          message: typeof obj.msg === "string" ? obj.msg : typeof obj.message === "string" ? obj.message : `HTTP ${res.status}`,
          responseBody: json
        });
        this.rememberEndpointCooldown(params, apiError);
        throw apiError;
      }

      this.log({
        endpoint: params.endpoint,
        method: params.method,
        durationMs: Date.now() - start,
        status: res.status,
        bingxCode,
        ok: true,
        requestId
      });
      return (Object.prototype.hasOwnProperty.call(obj, "data") ? obj.data : json) as T;
    } catch (error) {
      const err = error as BingxApiError;
      this.log({
        endpoint: params.endpoint,
        method: params.method,
        durationMs: Date.now() - start,
        status: err?.options?.status,
        bingxCode: err?.options?.bingxCode,
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
        const mapped = mapBingxError(error);
        const cooldownUntilMs = parseBingxRateLimitUntilMs(error);
        if (cooldownUntilMs !== null && cooldownUntilMs > Date.now()) break;
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
      fn: () => this.doRequest<T>({ method, endpoint, query, privateAuth: false })
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
      fn: () => this.doRequest<T>({ method, endpoint, query, privateAuth: false, apiKeyAuth: true })
    });
  }

  async requestPrivate<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
    bodyFormat?: "query" | "json";
  }): Promise<T> {
    return this.withRetry({
      operation: `${params.method} ${params.endpoint}`,
      idempotent: params.method === "GET",
      fn: () => this.doRequest<T>({
        method: params.method,
        endpoint: params.endpoint,
        query: params.query,
        bodyFormat: params.bodyFormat,
        privateAuth: true
      })
    });
  }
}
