type ExternalHealthState = "healthy" | "unhealthy" | "skipped";

export type ExternalHealthCheckId = "ai" | "saladRuntime" | "fmp" | "ccpay";

export type ExternalHealthCheckResult = {
  id: ExternalHealthCheckId;
  state: ExternalHealthState;
  message: string;
  checkedAt: string;
  latencyMs?: number;
  source?: string | null;
  httpStatus?: number;
  details?: Record<string, unknown>;
};

export type AiHealthCheckResponse = {
  ok: boolean;
  status: "ok" | "missing_key" | "error";
  state: ExternalHealthState;
  source: string;
  checkedAt: string;
  latencyMs?: number;
  message: string;
  model: string;
  provider: string;
  baseUrl: string;
  httpStatus?: number;
};

export type CcpayHealthCheckResponse = {
  ok: boolean;
  status: "ok" | "missing_config" | "error";
  state: ExternalHealthState;
  source: string;
  checkedAt: string;
  message: string;
  hasAppId: boolean;
  hasAppSecret: boolean;
  baseUrl: string;
  priceFiatId: string;
  webBaseUrl: string;
  sources: {
    appId: string;
    appSecret: string;
    baseUrl: string;
    priceFiatId: string;
    webBaseUrl: string;
  };
  missingFields: string[];
};

export type FmpHealthCheckResponse = {
  ok: boolean;
  status: "ok" | "missing_key" | "error";
  state: ExternalHealthState;
  source: string;
  checkedAt: string;
  latencyMs?: number;
  message: string;
  httpStatus?: number;
};

export type SaladRuntimeHealthCheckResponse = {
  ok: boolean;
  state: ExternalHealthState;
  checkedAt: string;
  latencyMs?: number;
  message: string;
  source?: string;
  target: any;
  runtimeState?: string;
  httpStatus?: number;
  error?: string;
  errorCode?: string;
  missingFields?: string[];
};

export type ExternalHealthSnapshot = {
  ai: AiHealthCheckResponse;
  saladRuntime: SaladRuntimeHealthCheckResponse;
  fmp: FmpHealthCheckResponse;
  ccpay: CcpayHealthCheckResponse;
};

export type ExternalHealthServiceDeps = {
  db: any;
  GLOBAL_SETTING_API_KEYS_KEY: string;
  parseStoredApiKeysSettings(value: unknown): any;
  resolveEffectiveAiProvider(settings: any): { provider: string; source: string };
  resolveEffectiveAiBaseUrl(settings: any): { baseUrl: string; source: string };
  resolveEffectiveAiModel(settings: any): { model: string; source: string };
  resolveEffectiveAiApiKey(settings: any): { apiKey: string | null; source: string; decryptError: boolean };
  resolveOllamaProfileAiApiKey(settings: any): { apiKey: string | null; source: string; decryptError: boolean };
  resolveEffectiveFmpApiKey(settings: any): { apiKey: string | null; source: string; decryptError: boolean };
  resolveCcpayConfig(): Promise<{
    appId: string | null;
    appSecret: string | null;
    baseUrl: string;
    priceFiatId: string;
    webBaseUrl: string;
    appIdSource: string;
    appSecretSource: string;
    baseUrlSource: string;
    priceFiatIdSource: string;
    webBaseUrlSource: string;
    source: string;
    decryptError: boolean;
    isConfigured: boolean;
  }>;
  fetchFmpEconomicEvents(params: {
    apiKey: string;
    baseUrl?: string;
    from: string;
    to: string;
    signal: AbortSignal;
  }): Promise<any>;
  getSaladRuntimeStatus(config: any, apiKey: string): Promise<any>;
  resolveSaladRuntimeConfig(settings: any): {
    isConfigured: boolean;
    missingFields: string[];
    config: any;
  };
};

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.trunc(parsed);
}

function readAiStatusErrorMessage(status: number, payload: unknown): string {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.length > 0) return trimmed.slice(0, 240);
  }
  if (payload && typeof payload === "object") {
    const message = (payload as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message.trim().length > 0) return message.trim();
  }
  return `ai_http_${status}`;
}

export function buildOllamaProxyHealthUrl(baseUrl: string): string | null {
  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = normalizedPath.endsWith("/v1")
      ? `${normalizedPath.slice(0, -3) || ""}/health`
      : "/health";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function probeOllamaProxyHealth(baseUrl: string, signal: AbortSignal): Promise<boolean> {
  const healthUrl = buildOllamaProxyHealthUrl(baseUrl);
  if (!healthUrl) return false;
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function describeOllamaHealthFailure(params: {
  httpStatus: number;
  payload: unknown;
  baseUrl: string;
  model: string;
  proxyHealthy?: boolean;
}): string {
  const providerMessage = readAiStatusErrorMessage(params.httpStatus, params.payload);
  if (params.httpStatus === 404 && params.proxyHealthy) {
    return `salad_proxy_healthy_but_chat_404: configured model "${params.model}" not available; check AI model, base URL, or Salad upstream host`;
  }
  return providerMessage;
}

async function loadApiKeySettings(deps: ExternalHealthServiceDeps): Promise<any> {
  const row = await deps.db.globalSetting.findUnique({
    where: { key: deps.GLOBAL_SETTING_API_KEYS_KEY },
    select: { value: true }
  });
  return deps.parseStoredApiKeysSettings(row?.value);
}

export function toExternalHealthCheckResult(input: {
  id: ExternalHealthCheckId;
  state: ExternalHealthState;
  message: string;
  checkedAt: string;
  latencyMs?: number;
  source?: string | null;
  httpStatus?: number;
  details?: Record<string, unknown>;
}): ExternalHealthCheckResult {
  return {
    id: input.id,
    state: input.state,
    message: input.message,
    checkedAt: input.checkedAt,
    ...(typeof input.latencyMs === "number" ? { latencyMs: input.latencyMs } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(typeof input.httpStatus === "number" ? { httpStatus: input.httpStatus } : {}),
    ...(input.details ? { details: input.details } : {})
  };
}

export function createExternalHealthService(deps: ExternalHealthServiceDeps) {
  async function checkAi(): Promise<AiHealthCheckResponse> {
    const settings = await loadApiKeySettings(deps);
    const effectiveProvider = deps.resolveEffectiveAiProvider(settings);
    const effectiveBaseUrl = deps.resolveEffectiveAiBaseUrl(settings);
    const resolved = deps.resolveEffectiveAiApiKey(settings);
    const effectiveModel = deps.resolveEffectiveAiModel(settings);
    const checkedAt = new Date().toISOString();

    if (effectiveProvider.provider === "disabled") {
      return {
        ok: false,
        status: "error",
        state: "skipped",
        source: resolved.source,
        checkedAt,
        message: "AI provider is disabled.",
        model: effectiveModel.model,
        provider: effectiveProvider.provider,
        baseUrl: effectiveBaseUrl.baseUrl
      };
    }
    if (resolved.decryptError) {
      return {
        ok: false,
        status: "error",
        state: "skipped",
        source: resolved.source,
        checkedAt,
        message: "Stored AI key could not be decrypted.",
        model: effectiveModel.model,
        provider: effectiveProvider.provider,
        baseUrl: effectiveBaseUrl.baseUrl
      };
    }
    if (!resolved.apiKey) {
      return {
        ok: false,
        status: "missing_key",
        state: "skipped",
        source: resolved.source,
        checkedAt,
        message: "No AI API key configured.",
        model: effectiveModel.model,
        provider: effectiveProvider.provider,
        baseUrl: effectiveBaseUrl.baseUrl
      };
    }

    const healthTimeoutMs = effectiveProvider.provider === "ollama"
      ? parsePositiveIntEnv(process.env.SYSTEM_HEALTH_AI_OLLAMA_TIMEOUT_MS, 20_000)
      : parsePositiveIntEnv(process.env.SYSTEM_HEALTH_AI_TIMEOUT_MS, 8_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), healthTimeoutMs);
    const startedAt = Date.now();
    try {
      const endpoint = `${effectiveBaseUrl.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const isOpenAiGpt5Model =
        effectiveProvider.provider === "openai" && effectiveModel.model.startsWith("gpt-5");
      const healthPayload: Record<string, unknown> = {
        model: effectiveModel.model,
        messages: [{ role: "user", content: "ping" }],
        ...(isOpenAiGpt5Model ? { max_completion_tokens: 1 } : { temperature: 0, max_tokens: 1 })
      };
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.apiKey}`
      };
      const body = JSON.stringify(healthPayload);
      const doFetch = (url: string) => fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal
      });
      let response: Response;
      try {
        response = await doFetch(endpoint);
      } catch (error) {
        const tryDockerFallback =
          effectiveProvider.provider === "ollama"
          && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(effectiveBaseUrl.baseUrl)
          && !controller.signal.aborted;
        if (!tryDockerFallback) throw error;
        const fallbackEndpoint = endpoint
          .replace("://localhost", "://host.docker.internal")
          .replace("://127.0.0.1", "://host.docker.internal")
          .replace("://[::1]", "://host.docker.internal");
        response = await doFetch(fallbackEndpoint);
      }
      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        try {
          payload = await response.text();
        } catch {
          payload = null;
        }
      }
      if (response.ok) {
        return {
          ok: true,
          status: "ok",
          state: "healthy",
          source: resolved.source,
          checkedAt,
          latencyMs: Date.now() - startedAt,
          message: `${effectiveProvider.provider} connection is healthy.`,
          model: effectiveModel.model,
          provider: effectiveProvider.provider,
          baseUrl: effectiveBaseUrl.baseUrl
        };
      }
      const proxyHealthy =
        effectiveProvider.provider === "ollama" && response.status === 404
          ? await probeOllamaProxyHealth(effectiveBaseUrl.baseUrl, controller.signal)
          : false;
      const providerMessage =
        effectiveProvider.provider === "ollama"
          ? describeOllamaHealthFailure({
              httpStatus: response.status,
              payload,
              baseUrl: effectiveBaseUrl.baseUrl,
              model: effectiveModel.model,
              proxyHealthy
            })
          : readAiStatusErrorMessage(response.status, payload);
      return {
        ok: false,
        status: "error",
        state: "unhealthy",
        source: resolved.source,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        httpStatus: response.status,
        message: providerMessage,
        model: effectiveModel.model,
        provider: effectiveProvider.provider,
        baseUrl: effectiveBaseUrl.baseUrl
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        status: "error",
        state: "unhealthy",
        source: resolved.source,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: isAbort ? "Connection timed out." : String(error),
        model: effectiveModel.model,
        provider: effectiveProvider.provider,
        baseUrl: effectiveBaseUrl.baseUrl
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function checkCcpay(): Promise<CcpayHealthCheckResponse> {
    const checkedAt = new Date().toISOString();
    const resolved = await deps.resolveCcpayConfig();
    const missingFields: string[] = [];
    if (!resolved.appId) missingFields.push("app_id");
    if (!resolved.appSecret) missingFields.push("app_secret");
    if (resolved.decryptError) {
      return {
        ok: false,
        status: "error",
        state: "skipped",
        source: resolved.source,
        checkedAt,
        message: "Stored CCPay credentials could not be decrypted.",
        hasAppId: Boolean(resolved.appId),
        hasAppSecret: Boolean(resolved.appSecret),
        baseUrl: resolved.baseUrl,
        priceFiatId: resolved.priceFiatId,
        webBaseUrl: resolved.webBaseUrl,
        sources: {
          appId: resolved.appIdSource,
          appSecret: resolved.appSecretSource,
          baseUrl: resolved.baseUrlSource,
          priceFiatId: resolved.priceFiatIdSource,
          webBaseUrl: resolved.webBaseUrlSource
        },
        missingFields
      };
    }
    if (!resolved.isConfigured) {
      return {
        ok: false,
        status: "missing_config",
        state: "skipped",
        source: resolved.source,
        checkedAt,
        message: "CCPayments configuration is incomplete.",
        hasAppId: Boolean(resolved.appId),
        hasAppSecret: Boolean(resolved.appSecret),
        baseUrl: resolved.baseUrl,
        priceFiatId: resolved.priceFiatId,
        webBaseUrl: resolved.webBaseUrl,
        sources: {
          appId: resolved.appIdSource,
          appSecret: resolved.appSecretSource,
          baseUrl: resolved.baseUrlSource,
          priceFiatId: resolved.priceFiatIdSource,
          webBaseUrl: resolved.webBaseUrlSource
        },
        missingFields
      };
    }
    return {
      ok: true,
      status: "ok",
      state: "healthy",
      source: resolved.source,
      checkedAt,
      message: "CCPayments configuration is ready.",
      hasAppId: true,
      hasAppSecret: true,
      baseUrl: resolved.baseUrl,
      priceFiatId: resolved.priceFiatId,
      webBaseUrl: resolved.webBaseUrl,
      sources: {
        appId: resolved.appIdSource,
        appSecret: resolved.appSecretSource,
        baseUrl: resolved.baseUrlSource,
        priceFiatId: resolved.priceFiatIdSource,
        webBaseUrl: resolved.webBaseUrlSource
      },
      missingFields
    };
  }

  async function checkFmp(): Promise<FmpHealthCheckResponse> {
    const settings = await loadApiKeySettings(deps);
    const resolved = deps.resolveEffectiveFmpApiKey(settings);
    const checkedAt = new Date().toISOString();
    if (resolved.decryptError) {
      return {
        ok: false,
        status: "error",
        state: "skipped",
        source: resolved.source,
        checkedAt,
        message: "Stored FMP key could not be decrypted."
      };
    }
    if (!resolved.apiKey) {
      return {
        ok: false,
        status: "missing_key",
        state: "skipped",
        source: resolved.source,
        checkedAt,
        message: "No FMP API key configured."
      };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const startedAt = Date.now();
    try {
      await deps.fetchFmpEconomicEvents({
        apiKey: resolved.apiKey,
        baseUrl: process.env.FMP_BASE_URL,
        from: "2026-01-01",
        to: "2026-01-02",
        signal: controller.signal
      });
      return {
        ok: true,
        status: "ok",
        state: "healthy",
        source: resolved.source,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: "FMP connection is healthy."
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const raw = String(error ?? "").trim();
      const normalizedReason = raw.startsWith("Error: ") ? raw.slice(7) : raw;
      let message = isAbort ? "Connection timed out." : normalizedReason;
      let httpStatus: number | undefined;
      const httpMatch = normalizedReason.match(/^http_(\d{3})$/i);
      if (httpMatch) {
        httpStatus = Number(httpMatch[1]);
        if (httpStatus === 401) message = "FMP authentication failed (401). Verify API key.";
        else if (httpStatus === 402) message = "FMP returned 402 (payment/plan required). Check your FMP subscription tier for Economic Calendar endpoints.";
        else if (httpStatus === 403) message = "FMP request forbidden (403). Check key permissions/IP restrictions.";
        else message = `fmp_http_${httpStatus}`;
      }
      return {
        ok: false,
        status: "error",
        state: "unhealthy",
        source: resolved.source,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        ...(httpStatus ? { httpStatus } : {}),
        message
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function checkSaladRuntime(): Promise<SaladRuntimeHealthCheckResponse> {
    const settings = await loadApiKeySettings(deps);
    const resolvedConfig = deps.resolveSaladRuntimeConfig(settings);
    if (!resolvedConfig.isConfigured) {
      return {
        ok: false,
        error: "salad_runtime_not_configured",
        state: "skipped",
        missingFields: resolvedConfig.missingFields,
        target: resolvedConfig.config,
        checkedAt: new Date().toISOString(),
        message: "Salad runtime target is not fully configured."
      };
    }
    const resolvedKey = deps.resolveOllamaProfileAiApiKey(settings);
    if (resolvedKey.decryptError) {
      return {
        ok: false,
        error: "auth_failed",
        state: "skipped",
        source: resolvedKey.source,
        target: resolvedConfig.config,
        checkedAt: new Date().toISOString(),
        message: "Stored Ollama AI key could not be decrypted."
      };
    }
    if (!resolvedKey.apiKey) {
      return {
        ok: false,
        error: "missing_key",
        state: "skipped",
        source: resolvedKey.source,
        target: resolvedConfig.config,
        checkedAt: new Date().toISOString(),
        message: "No Ollama AI key configured for Salad runtime control."
      };
    }
    const result = await deps.getSaladRuntimeStatus(resolvedConfig.config, resolvedKey.apiKey);
    return {
      ok: Boolean(result.ok),
      state: result.ok ? "healthy" : "unhealthy",
      checkedAt: result.checkedAt,
      latencyMs: result.latencyMs,
      message: String(result.message ?? ""),
      source: resolvedKey.source,
      target: resolvedConfig.config,
      runtimeState: result.state,
      httpStatus: result.httpStatus,
      ...(result.ok ? {} : {
        error: String(result.errorCode ?? "request_failed"),
        errorCode: result.errorCode
      })
    };
  }

  async function checkAll(): Promise<ExternalHealthSnapshot> {
    const [ai, saladRuntime, fmp, ccpay] = await Promise.all([
      checkAi(),
      checkSaladRuntime(),
      checkFmp(),
      checkCcpay()
    ]);
    return { ai, saladRuntime, fmp, ccpay };
  }

  return {
    checkAi,
    checkCcpay,
    checkFmp,
    checkSaladRuntime,
    checkAll
  };
}
