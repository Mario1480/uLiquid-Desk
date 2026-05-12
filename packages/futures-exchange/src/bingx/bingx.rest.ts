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

function readPositiveMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  return fallback;
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

type BingxReadCacheEntry = {
  value?: unknown;
  expiresAt: number;
  staleUntil: number;
  inFlight?: Promise<unknown>;
};

export class BingxRestClient {
  private static readonly endpointCooldowns = new Map<string, number>();
  private static readonly readCache = new Map<string, BingxReadCacheEntry>();

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

  private isOpenOrdersRead(params: { method: HttpMethod; endpoint: string }): boolean {
    return params.method === "GET" && params.endpoint === "/openApi/swap/v2/trade/openOrders";
  }

  private readCacheTtlMs(): number {
    return readPositiveMs(process.env.BINGX_OPEN_ORDERS_CACHE_TTL_MS, 60_000);
  }

  private readCacheStaleMs(): number {
    return readPositiveMs(process.env.BINGX_OPEN_ORDERS_CACHE_STALE_MS, 10 * 60_000);
  }

  private readCacheKey(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
  }): string {
    const queryString = buildBingxQueryString(
      (params.query ?? {}) as Record<string, string | number | boolean | undefined | null>
    );
    return `${this.apiKey ?? "public"}|${params.method}|${params.endpoint}|${queryString}`;
  }

  private getCachedRead<T>(
    params: {
      method: HttpMethod;
      endpoint: string;
      query?: Record<string, unknown>;
    },
    mode: "fresh" | "stale"
  ): T | null {
    if (!this.isOpenOrdersRead(params)) return null;
    const cached = BingxRestClient.readCache.get(this.readCacheKey(params));
    if (!cached || cached.value === undefined) return null;
    const now = Date.now();
    if (mode === "fresh" && cached.expiresAt > now) return cached.value as T;
    if (mode === "stale" && cached.staleUntil > now) return cached.value as T;
    if (cached.staleUntil <= now && !cached.inFlight) {
      BingxRestClient.readCache.delete(this.readCacheKey(params));
    }
    return null;
  }

  private getCachedReadInFlight<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
  }): Promise<T> | null {
    if (!this.isOpenOrdersRead(params)) return null;
    const cached = BingxRestClient.readCache.get(this.readCacheKey(params));
    return cached?.inFlight ? cached.inFlight as Promise<T> : null;
  }

  private rememberCachedRead<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
  }, value: T): void {
    if (!this.isOpenOrdersRead(params)) return;
    const now = Date.now();
    BingxRestClient.readCache.set(this.readCacheKey(params), {
      value,
      expiresAt: now + this.readCacheTtlMs(),
      staleUntil: now + this.readCacheStaleMs()
    });
  }

  private rememberCachedReadInFlight<T>(params: {
    method: HttpMethod;
    endpoint: string;
    query?: Record<string, unknown>;
  }, inFlight: Promise<T>): void {
    if (!this.isOpenOrdersRead(params)) return;
    const key = this.readCacheKey(params);
    const current = BingxRestClient.readCache.get(key);
    BingxRestClient.readCache.set(key, {
      value: current?.value,
      expiresAt: current?.expiresAt ?? 0,
      staleUntil: current?.staleUntil ?? 0,
      inFlight
    });
    void inFlight.finally(() => {
      const latest = BingxRestClient.readCache.get(key);
      if (latest?.inFlight === inFlight) {
        delete latest.inFlight;
        if (latest.value === undefined && latest.staleUntil <= Date.now()) {
          BingxRestClient.readCache.delete(key);
        }
      }
    }).catch(() => undefined);
  }

  private clearOpenOrdersReadCache(): void {
    const prefix = `${this.apiKey ?? "public"}|GET|/openApi/swap/v2/trade/openOrders|`;
    for (const key of BingxRestClient.readCache.keys()) {
      if (key.startsWith(prefix)) BingxRestClient.readCache.delete(key);
    }
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
    const freshCache = this.getCachedRead<T>(params, "fresh");
    if (freshCache !== null) return freshCache;

    const inFlight = this.getCachedReadInFlight<T>(params);
    if (inFlight) return inFlight;

    const activeCooldown = this.activeEndpointCooldownError(params);
    if (activeCooldown) {
      const staleCache = this.getCachedRead<T>(params, "stale");
      if (staleCache !== null) return staleCache;
      throw activeCooldown;
    }

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
        const staleCache = this.getCachedRead<T>(params, "stale");
        if (staleCache !== null) return staleCache;
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
      const value = (Object.prototype.hasOwnProperty.call(obj, "data") ? obj.data : json) as T;
      this.rememberCachedRead(params, value);
      if (params.method !== "GET") this.clearOpenOrdersReadCache();
      return value;
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
    const operation = `${params.method} ${params.endpoint}`;
    const run = this.withRetry({
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
    if (this.isOpenOrdersRead(params)) this.rememberCachedReadInFlight(params, run);
    if (params.method !== "GET" && operation.includes("/openApi/swap/v2/trade/")) {
      void run.then(() => this.clearOpenOrdersReadCache(), () => undefined);
    }
    return run;
  }
}
