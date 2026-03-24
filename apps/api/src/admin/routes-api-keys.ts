import express from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { logger } from "../logger.js";

const openAiModelSchema = z.enum(["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "gpt-5", "gpt-5-mini", "gpt-5-nano"]);
const aiProviderSchema = z.enum(["openai", "ollama", "disabled"]);

const adminApiKeysSchema = z.object({
  aiProvider: aiProviderSchema.optional(),
  aiBaseUrl: z.string().trim().min(8).max(500).optional(),
  clearAiBaseUrl: z.boolean().default(false),
  aiApiKey: z.string().trim().min(1).max(500).optional(),
  clearAiApiKey: z.boolean().default(false),
  aiModel: z.string().trim().min(1).max(120).optional(),
  clearAiModel: z.boolean().default(false),
  openaiApiKey: z.string().trim().min(10).max(500).optional(),
  clearOpenaiApiKey: z.boolean().default(false),
  fmpApiKey: z.string().trim().min(10).max(500).optional(),
  clearFmpApiKey: z.boolean().default(false),
  openaiModel: openAiModelSchema.optional(),
  clearOpenaiModel: z.boolean().default(false),
  saladApiBaseUrl: z.string().trim().min(8).max(500).optional(),
  clearSaladApiBaseUrl: z.boolean().default(false),
  saladOrganization: z.string().trim().min(1).max(191).optional(),
  clearSaladOrganization: z.boolean().default(false),
  saladProject: z.string().trim().min(1).max(191).optional(),
  clearSaladProject: z.boolean().default(false),
  saladContainer: z.string().trim().min(1).max(191).optional(),
  clearSaladContainer: z.boolean().default(false),
  ccpayAppId: z.string().trim().min(1).max(191).optional(),
  clearCcpayAppId: z.boolean().default(false),
  ccpayAppSecret: z.string().trim().min(1).max(500).optional(),
  clearCcpayAppSecret: z.boolean().default(false),
  ccpayBaseUrl: z.string().trim().min(8).max(500).optional(),
  clearCcpayBaseUrl: z.boolean().default(false),
  ccpayPriceFiatId: z.string().trim().regex(/^\d+$/).max(64).optional(),
  clearCcpayPriceFiatId: z.boolean().default(false),
  ccpayWebBaseUrl: z.string().trim().min(8).max(500).optional(),
  clearCcpayWebBaseUrl: z.boolean().default(false)
}).refine(
  (value) =>
    value.clearOpenaiApiKey ||
    Boolean(value.openaiApiKey) ||
    value.clearFmpApiKey ||
    Boolean(value.fmpApiKey) ||
    value.clearOpenaiModel ||
    Boolean(value.openaiModel) ||
    value.clearAiApiKey ||
    Boolean(value.aiApiKey) ||
    value.clearAiModel ||
    Boolean(value.aiModel) ||
    value.clearAiBaseUrl ||
    Boolean(value.aiBaseUrl) ||
    value.clearSaladApiBaseUrl ||
    Boolean(value.saladApiBaseUrl) ||
    value.clearSaladOrganization ||
    Boolean(value.saladOrganization) ||
    value.clearSaladProject ||
    Boolean(value.saladProject) ||
    value.clearSaladContainer ||
    Boolean(value.saladContainer) ||
    value.clearCcpayAppId ||
    Boolean(value.ccpayAppId) ||
    value.clearCcpayAppSecret ||
    Boolean(value.ccpayAppSecret) ||
    value.clearCcpayBaseUrl ||
    Boolean(value.ccpayBaseUrl) ||
    value.clearCcpayPriceFiatId ||
    Boolean(value.ccpayPriceFiatId) ||
    value.clearCcpayWebBaseUrl ||
    Boolean(value.ccpayWebBaseUrl) ||
    Boolean(value.aiProvider),
  {
    message: "Provide AI/FMP/CCPay fields or set a clear flag."
  }
);

function resolveSaladRuntimeHttpStatus(result: {
  ok: boolean;
  httpStatus?: number;
  errorCode?: string;
  error?: string;
}): number {
  if (result.ok) return 200;
  if (result.error === "salad_runtime_not_configured") return 400;
  if (result.error === "missing_key") return 400;
  if (result.error === "auth_failed") return 400;
  if (result.errorCode === "auth_failed") return 401;
  if (result.errorCode === "not_found") return 404;
  if (result.errorCode === "rate_limited") return 429;
  if (result.errorCode === "upstream_error") return 502;
  if (Number.isFinite(Number(result.httpStatus))) {
    const status = Number(result.httpStatus);
    if (status >= 400 && status <= 599) return status;
  }
  return 502;
}

export type RegisterAdminApiKeyRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  externalHealthService: {
    checkAi(): Promise<any>;
    checkCcpay(): Promise<any>;
    checkFmp(): Promise<any>;
    checkSaladRuntime(): Promise<any>;
  };
  GLOBAL_SETTING_API_KEYS_KEY: string;
  getGlobalSettingValue(key: string): Promise<unknown>;
  setGlobalSettingValue(key: string, value: unknown): Promise<any>;
  parseStoredApiKeysSettings(value: unknown): any;
  toPublicApiKeysSettings(value: any): any;
  resolveEffectiveAiProvider(settings: any): { provider: string; source: string };
  resolveEffectiveAiBaseUrl(settings: any): { baseUrl: string; source: string };
  resolveEffectiveAiModel(settings: any): { model: string; source: string };
  resolveEffectiveAiApiKey(settings: any): { apiKey: string | null; source: string; decryptError: boolean };
  resolveOllamaProfileAiApiKey(settings: any): { apiKey: string | null; source: string; decryptError: boolean };
  resolveEffectiveFmpApiKey(settings: any): { apiKey: string | null; source: string; decryptError: boolean };
  normalizeProviderForProfile(provider: unknown): "openai" | "ollama";
  emptySaladRuntimeSettings(): any;
  encryptSecret(value: string): string;
  resolveCcpayConfig(): Promise<any>;
  invalidateCcpayConfigCache(): void;
  invalidateAiApiKeyCache(): void;
  invalidateAiModelCache(): void;
  fetchFmpEconomicEvents(params: { apiKey: string; baseUrl?: string; from: string; to: string; signal: AbortSignal }): Promise<any>;
  getSaladRuntimeStatus(config: any, apiKey: string): Promise<any>;
  resolveSaladRuntimeConfig(settings: any): { isConfigured: boolean; missingFields: string[]; config: any };
  startSaladContainer(config: any, apiKey: string): Promise<any>;
  stopSaladContainer(config: any, apiKey: string): Promise<any>;
  OPENAI_ADMIN_MODEL_OPTIONS: readonly string[];
  AI_PROVIDER_OPTIONS: readonly string[];
};

export function registerAdminApiKeyRoutes(app: express.Express, deps: RegisterAdminApiKeyRoutesDeps) {
  app.get("/admin/settings/api-keys", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_API_KEYS_KEY },
      select: { value: true, updatedAt: true }
    });
    const settings = deps.parseStoredApiKeysSettings(row?.value);
    const envConfigured = Boolean(process.env.AI_API_KEY?.trim());
    const fmpEnvConfigured = Boolean(process.env.FMP_API_KEY?.trim());
    const ccpayEnvConfigured = Boolean(
      process.env.CCPAY_APP_ID?.trim()
      || process.env.CCPAY_APP_SECRET?.trim()
      || process.env.CCPAY_BASE_URL?.trim()
      || process.env.CCPAY_PRICE_FIAT_ID?.trim()
      || process.env.WEB_BASE_URL?.trim()
    );
    const effectiveProvider = deps.resolveEffectiveAiProvider(settings);
    const effectiveBaseUrl = deps.resolveEffectiveAiBaseUrl(settings);
    const effectiveModel = deps.resolveEffectiveAiModel(settings);

    return res.json({
      ...deps.toPublicApiKeysSettings(settings),
      updatedAt: row?.updatedAt ?? null,
      envOverride: envConfigured,
      envOverrideFmp: fmpEnvConfigured,
      envOverrideCcpay: ccpayEnvConfigured,
      effectiveAiProvider: effectiveProvider.provider,
      effectiveAiProviderSource: effectiveProvider.source,
      effectiveAiBaseUrl: effectiveBaseUrl.baseUrl,
      effectiveAiBaseUrlSource: effectiveBaseUrl.source,
      effectiveAiModel: effectiveModel.model,
      effectiveAiModelSource: effectiveModel.source,
      effectiveOpenaiModel: effectiveModel.model,
      effectiveOpenaiModelSource: effectiveModel.source,
      modelOptions: [...deps.OPENAI_ADMIN_MODEL_OPTIONS],
      providerOptions: [...deps.AI_PROVIDER_OPTIONS, "disabled"]
    });
  });

  app.get("/admin/settings/api-keys/status", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    return res.json(await deps.externalHealthService.checkAi());
  });

  app.get("/admin/settings/api-keys/ccpay-status", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    return res.json(await deps.externalHealthService.checkCcpay());
  });

  app.get("/admin/settings/api-keys/salad-runtime/status", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const result = await deps.externalHealthService.checkSaladRuntime();
    const statusCode = resolveSaladRuntimeHttpStatus(result);
    if (result.ok) logger.info("salad_runtime_status_ok", { target: result.target, latency_ms: result.latencyMs, state: result.runtimeState });
    else logger.warn("salad_runtime_status_failed", { target: result.target, latency_ms: result.latencyMs, state: result.runtimeState, error_code: result.errorCode, http_status: result.httpStatus, message: result.message });
    return res.status(statusCode).json(result);
  });

  app.post("/admin/settings/api-keys/salad-runtime/start", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const row = await deps.db.globalSetting.findUnique({ where: { key: deps.GLOBAL_SETTING_API_KEYS_KEY }, select: { value: true } });
    const settings = deps.parseStoredApiKeysSettings(row?.value);
    const resolvedConfig = deps.resolveSaladRuntimeConfig(settings);
    if (!resolvedConfig.isConfigured) {
      return res.status(400).json({ ok: false, error: "salad_runtime_not_configured", missingFields: resolvedConfig.missingFields, target: resolvedConfig.config, checkedAt: new Date().toISOString(), message: "Salad runtime target is not fully configured." });
    }
    const resolvedKey = deps.resolveOllamaProfileAiApiKey(settings);
    if (resolvedKey.decryptError) {
      return res.status(400).json({ ok: false, error: "auth_failed", source: resolvedKey.source, target: resolvedConfig.config, checkedAt: new Date().toISOString(), message: "Stored Ollama AI key could not be decrypted." });
    }
    if (!resolvedKey.apiKey) {
      return res.status(400).json({ ok: false, error: "missing_key", source: resolvedKey.source, target: resolvedConfig.config, checkedAt: new Date().toISOString(), message: "No Ollama AI key configured for Salad runtime control." });
    }
    const actionResult = await deps.startSaladContainer(resolvedConfig.config, resolvedKey.apiKey);
    const statusAfter = actionResult.ok ? await deps.getSaladRuntimeStatus(resolvedConfig.config, resolvedKey.apiKey) : null;
    const result = actionResult.ok && statusAfter?.ok ? statusAfter : actionResult;
    const statusCode = resolveSaladRuntimeHttpStatus(result);
    if (result.ok) logger.info("salad_runtime_start_ok", { target: resolvedConfig.config, latency_ms: result.latencyMs, state: result.state });
    else logger.warn("salad_runtime_start_failed", { target: resolvedConfig.config, latency_ms: result.latencyMs, state: result.state, error_code: result.errorCode, http_status: result.httpStatus, message: result.message });
    return res.status(statusCode).json({ ...result, source: resolvedKey.source, target: resolvedConfig.config, actionAccepted: actionResult.ok });
  });

  app.post("/admin/settings/api-keys/salad-runtime/stop", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const row = await deps.db.globalSetting.findUnique({ where: { key: deps.GLOBAL_SETTING_API_KEYS_KEY }, select: { value: true } });
    const settings = deps.parseStoredApiKeysSettings(row?.value);
    const resolvedConfig = deps.resolveSaladRuntimeConfig(settings);
    if (!resolvedConfig.isConfigured) {
      return res.status(400).json({ ok: false, error: "salad_runtime_not_configured", missingFields: resolvedConfig.missingFields, target: resolvedConfig.config, checkedAt: new Date().toISOString(), message: "Salad runtime target is not fully configured." });
    }
    const resolvedKey = deps.resolveOllamaProfileAiApiKey(settings);
    if (resolvedKey.decryptError) {
      return res.status(400).json({ ok: false, error: "auth_failed", source: resolvedKey.source, target: resolvedConfig.config, checkedAt: new Date().toISOString(), message: "Stored Ollama AI key could not be decrypted." });
    }
    if (!resolvedKey.apiKey) {
      return res.status(400).json({ ok: false, error: "missing_key", source: resolvedKey.source, target: resolvedConfig.config, checkedAt: new Date().toISOString(), message: "No Ollama AI key configured for Salad runtime control." });
    }
    const actionResult = await deps.stopSaladContainer(resolvedConfig.config, resolvedKey.apiKey);
    const statusAfter = actionResult.ok ? await deps.getSaladRuntimeStatus(resolvedConfig.config, resolvedKey.apiKey) : null;
    const result = actionResult.ok && statusAfter?.ok ? statusAfter : actionResult;
    const statusCode = resolveSaladRuntimeHttpStatus(result);
    if (result.ok) logger.info("salad_runtime_stop_ok", { target: resolvedConfig.config, latency_ms: result.latencyMs, state: result.state });
    else logger.warn("salad_runtime_stop_failed", { target: resolvedConfig.config, latency_ms: result.latencyMs, state: result.state, error_code: result.errorCode, http_status: result.httpStatus, message: result.message });
    return res.status(statusCode).json({ ...result, source: resolvedKey.source, target: resolvedConfig.config, actionAccepted: actionResult.ok });
  });

  app.get("/admin/settings/api-keys/fmp-status", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    return res.json(await deps.externalHealthService.checkFmp());
  });

  app.put("/admin/settings/api-keys", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminApiKeysSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });

    const existing = deps.parseStoredApiKeysSettings(await deps.getGlobalSettingValue(deps.GLOBAL_SETTING_API_KEYS_KEY));
    const currentProviderForProfile = deps.normalizeProviderForProfile(parsed.data.aiProvider ?? existing.aiProvider);
    const nextProfiles: Record<"openai" | "ollama", any> = {
      openai: { ...existing.aiProfiles.openai },
      ollama: { ...existing.aiProfiles.ollama }
    };

    const genericApiKeySpecified = parsed.data.clearAiApiKey || Boolean(parsed.data.aiApiKey);
    if (genericApiKeySpecified) {
      nextProfiles[currentProviderForProfile].aiApiKeyEnc = parsed.data.clearAiApiKey ? null : (parsed.data.aiApiKey ? deps.encryptSecret(parsed.data.aiApiKey) : null);
    }
    const openAiApiKeySpecified = parsed.data.clearOpenaiApiKey || Boolean(parsed.data.openaiApiKey);
    if (openAiApiKeySpecified) {
      nextProfiles.openai.aiApiKeyEnc = parsed.data.clearOpenaiApiKey ? null : (parsed.data.openaiApiKey ? deps.encryptSecret(parsed.data.openaiApiKey) : null);
    }
    const genericBaseUrlSpecified = parsed.data.clearAiBaseUrl || parsed.data.aiBaseUrl !== undefined;
    if (genericBaseUrlSpecified) {
      nextProfiles[currentProviderForProfile].aiBaseUrl = parsed.data.clearAiBaseUrl ? null : (parsed.data.aiBaseUrl?.trim() || null);
    }
    const genericModelSpecified = parsed.data.clearAiModel || parsed.data.aiModel !== undefined;
    if (genericModelSpecified) {
      nextProfiles[currentProviderForProfile].aiModel = parsed.data.clearAiModel ? null : (parsed.data.aiModel?.trim() || null);
    }
    const openAiModelSpecified = parsed.data.clearOpenaiModel || parsed.data.openaiModel !== undefined;
    if (openAiModelSpecified) {
      nextProfiles.openai.aiModel = parsed.data.clearOpenaiModel ? null : (parsed.data.openaiModel?.trim() || null);
    }
    const saladRuntimeSpecified = parsed.data.clearSaladApiBaseUrl || parsed.data.saladApiBaseUrl !== undefined || parsed.data.clearSaladOrganization || parsed.data.saladOrganization !== undefined || parsed.data.clearSaladProject || parsed.data.saladProject !== undefined || parsed.data.clearSaladContainer || parsed.data.saladContainer !== undefined;
    if (saladRuntimeSpecified) {
      const currentSaladRuntime = nextProfiles.ollama.saladRuntime ?? deps.emptySaladRuntimeSettings();
      const nextSaladRuntime = { ...currentSaladRuntime };
      const saladBaseUrlSpecified = parsed.data.clearSaladApiBaseUrl || parsed.data.saladApiBaseUrl !== undefined;
      if (saladBaseUrlSpecified) nextSaladRuntime.apiBaseUrl = parsed.data.clearSaladApiBaseUrl ? null : (parsed.data.saladApiBaseUrl?.trim() || null);
      const saladOrganizationSpecified = parsed.data.clearSaladOrganization || parsed.data.saladOrganization !== undefined;
      if (saladOrganizationSpecified) nextSaladRuntime.organization = parsed.data.clearSaladOrganization ? null : (parsed.data.saladOrganization?.trim() || null);
      const saladProjectSpecified = parsed.data.clearSaladProject || parsed.data.saladProject !== undefined;
      if (saladProjectSpecified) nextSaladRuntime.project = parsed.data.clearSaladProject ? null : (parsed.data.saladProject?.trim() || null);
      const saladContainerSpecified = parsed.data.clearSaladContainer || parsed.data.saladContainer !== undefined;
      if (saladContainerSpecified) nextSaladRuntime.container = parsed.data.clearSaladContainer ? null : (parsed.data.saladContainer?.trim() || null);
      nextProfiles.ollama.saladRuntime = nextSaladRuntime;
    }
    const ccpaySpecified = parsed.data.clearCcpayAppId || Boolean(parsed.data.ccpayAppId) || parsed.data.clearCcpayAppSecret || Boolean(parsed.data.ccpayAppSecret) || parsed.data.clearCcpayBaseUrl || parsed.data.ccpayBaseUrl !== undefined || parsed.data.clearCcpayPriceFiatId || parsed.data.ccpayPriceFiatId !== undefined || parsed.data.clearCcpayWebBaseUrl || parsed.data.ccpayWebBaseUrl !== undefined;
    const currentCcpay = existing.ccpay ?? { appIdEnc: null, appSecretEnc: null, baseUrl: null, priceFiatId: null, webBaseUrl: null };
    const nextCcpay = { ...currentCcpay };
    if (parsed.data.clearCcpayAppId || parsed.data.ccpayAppId !== undefined) nextCcpay.appIdEnc = parsed.data.clearCcpayAppId ? null : (parsed.data.ccpayAppId ? deps.encryptSecret(parsed.data.ccpayAppId) : null);
    if (parsed.data.clearCcpayAppSecret || parsed.data.ccpayAppSecret !== undefined) nextCcpay.appSecretEnc = parsed.data.clearCcpayAppSecret ? null : (parsed.data.ccpayAppSecret ? deps.encryptSecret(parsed.data.ccpayAppSecret) : null);
    if (parsed.data.clearCcpayBaseUrl || parsed.data.ccpayBaseUrl !== undefined) nextCcpay.baseUrl = parsed.data.clearCcpayBaseUrl ? null : (parsed.data.ccpayBaseUrl?.trim() || null);
    if (parsed.data.clearCcpayPriceFiatId || parsed.data.ccpayPriceFiatId !== undefined) nextCcpay.priceFiatId = parsed.data.clearCcpayPriceFiatId ? null : (parsed.data.ccpayPriceFiatId?.trim() || null);
    if (parsed.data.clearCcpayWebBaseUrl || parsed.data.ccpayWebBaseUrl !== undefined) nextCcpay.webBaseUrl = parsed.data.clearCcpayWebBaseUrl ? null : (parsed.data.ccpayWebBaseUrl?.trim() || null);

    const nextProvider = parsed.data.aiProvider ?? existing.aiProvider;
    const activeProviderForTopLevel = deps.normalizeProviderForProfile(nextProvider);
    const nextValue = {
      aiProvider: nextProvider,
      aiApiKeyEnc: nextProfiles[activeProviderForTopLevel].aiApiKeyEnc ?? null,
      fmpApiKeyEnc: parsed.data.clearFmpApiKey ? null : (parsed.data.fmpApiKey ? deps.encryptSecret(parsed.data.fmpApiKey) : existing.fmpApiKeyEnc ?? null),
      openaiModel: parsed.data.clearOpenaiModel ? null : (parsed.data.openaiModel?.trim() || nextProfiles.openai.aiModel || null),
      aiBaseUrl: nextProfiles[activeProviderForTopLevel].aiBaseUrl ?? null,
      aiModel: nextProfiles[activeProviderForTopLevel].aiModel ?? null,
      aiProfiles: nextProfiles,
      ccpay: ccpaySpecified ? nextCcpay : existing.ccpay
    };

    const updated = await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_API_KEYS_KEY, nextValue);
    const settings = deps.parseStoredApiKeysSettings(updated.value);
    const effectiveProvider = deps.resolveEffectiveAiProvider(settings);
    const effectiveBaseUrl = deps.resolveEffectiveAiBaseUrl(settings);
    const effectiveModel = deps.resolveEffectiveAiModel(settings);
    deps.invalidateAiApiKeyCache();
    deps.invalidateAiModelCache();
    deps.invalidateCcpayConfigCache();

    return res.json({
      ...deps.toPublicApiKeysSettings(settings),
      updatedAt: updated.updatedAt,
      envOverride: Boolean(process.env.AI_API_KEY?.trim()),
      envOverrideFmp: Boolean(process.env.FMP_API_KEY?.trim()),
      envOverrideCcpay: Boolean(process.env.CCPAY_APP_ID?.trim() || process.env.CCPAY_APP_SECRET?.trim() || process.env.CCPAY_BASE_URL?.trim() || process.env.CCPAY_PRICE_FIAT_ID?.trim() || process.env.WEB_BASE_URL?.trim()),
      effectiveAiProvider: effectiveProvider.provider,
      effectiveAiProviderSource: effectiveProvider.source,
      effectiveAiBaseUrl: effectiveBaseUrl.baseUrl,
      effectiveAiBaseUrlSource: effectiveBaseUrl.source,
      effectiveAiModel: effectiveModel.model,
      effectiveAiModelSource: effectiveModel.source,
      effectiveOpenaiModel: effectiveModel.model,
      effectiveOpenaiModelSource: effectiveModel.source,
      modelOptions: [...deps.OPENAI_ADMIN_MODEL_OPTIONS],
      providerOptions: [...deps.AI_PROVIDER_OPTIONS, "disabled"]
    });
  });
}
