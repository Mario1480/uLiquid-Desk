import { createHash, randomUUID } from "node:crypto";
import { validateSafeOutboundUrl } from "@mm/core";
import { prisma } from "@mm/db";
import { decryptSecret } from "../secret-crypto.js";
import { logger } from "../logger.js";
import {
  estimateAiRunReservation,
  isAiCreditBillingEnabledForDatabase,
  markAiReservationForReconciliation,
  recordAiUsage,
  releaseAiReservation,
  reserveAiCredits,
  settleAiRun
} from "./credits/creditService.js";
import {
  normalizeAiModelRouting,
  routeOpenAiModel,
  type AiModelClass,
  type AiModelRouting,
  type AiRoutingDecision,
  type AiRoutingProfile
} from "./credits/modelRouter.js";
import { callOpenAiResponses, OpenAiResponsesIncompleteError } from "./credits/responsesProvider.js";
import type { AiTokenUsage } from "./credits/pricing.js";

type OpenAiErrorPayload = {
  error?: {
    message?: string;
  };
};

type ChatCompletionMessageContentPart = {
  type?: string;
  text?: string;
};

type ChatCompletionToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ChatCompletionMessage = {
  role?: string;
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: ChatCompletionToolCall[];
  [key: string]: unknown;
};

type ChatCompletionResponse = OpenAiErrorPayload & {
  choices?: Array<{
    message?: ChatCompletionMessage;
    text?: unknown;
  }>;
  message?: ChatCompletionMessage;
  response?: unknown;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type AiUsageTokens = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
};

export type AiCallResolvedMeta = {
  provider: EnabledAiProvider;
  requestedModel: string;
  modelUsed: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
};

export type AiProvider = "openai" | "ollama" | "vllm" | "disabled";
export type EnabledAiProvider = Exclude<AiProvider, "disabled">;
export type AiProviderSource = "db" | "env" | "default";
export type AiBaseUrlSource = "db" | "env" | "default";
export type AiModelSource = "db" | "env" | "default";

export const AI_PROVIDER_OPTIONS = ["openai"] as const;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_VLLM_BASE_URL = "http://localhost:8000/v1";
const AI_API_KEYS_GLOBAL_SETTING_KEY = "admin.apiKeys";
const AI_PROVIDER_SAFE_URL_TIMEOUT_MS = 5_000;

const AI_DB_KEY_CACHE_TTL_MS =
  Math.max(5, Number(process.env.AI_DB_KEY_CACHE_TTL_SEC ?? "30")) * 1000;
const AI_DB_MODEL_CACHE_TTL_MS =
  Math.max(
    5,
    Number(process.env.AI_DB_MODEL_CACHE_TTL_SEC ?? process.env.AI_DB_KEY_CACHE_TTL_SEC ?? "30")
  ) * 1000;

export const OPENAI_ADMIN_MODEL_OPTIONS = [
  "gpt-5-nano",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol"
] as const;
export type OpenAiAdminModel = (typeof OPENAI_ADMIN_MODEL_OPTIONS)[number];

const OPENAI_DEFAULT_MODEL: OpenAiAdminModel = "gpt-5.6-luna";
const OLLAMA_DEFAULT_MODEL = "qwen3:8b";
const OLLAMA_MIN_MAX_TOKENS = (() => {
  const parsed = Number(process.env.AI_OLLAMA_MIN_MAX_TOKENS ?? "900");
  if (!Number.isFinite(parsed) || parsed < 1) return 900;
  return Math.trunc(parsed);
})();
const OPENAI_ADMIN_MODEL_OPTION_SET = new Set<string>(OPENAI_ADMIN_MODEL_OPTIONS);

const db = prisma as any;

let dbAiSettingsCacheUntil = 0;
let dbAiSettingsCached: DbAiSettings | null = null;
let dbAiSettingsInFlight: Promise<DbAiSettings> | null = null;

type DbAiSettings = {
  aiApiKey: string | null;
  aiModel: string | null;
  aiProvider: AiProvider | null;
  aiBaseUrl: string | null;
  aiModelRouting: Partial<AiModelRouting>;
};

type StoredAiProviderSnapshot = {
  aiApiKey: string | null;
  aiModel: string | null;
  aiBaseUrl: string | null;
  aiModelRouting: Partial<AiModelRouting>;
};

function parseStoredAiModelRouting(value: unknown): Partial<AiModelRouting> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Partial<AiModelRouting> = {};
  for (const modelClass of ["utility", "standard", "analysis", "deep"] as const) {
    const model = typeof record[modelClass] === "string" ? record[modelClass].trim() : "";
    if (model) result[modelClass] = model.slice(0, 120);
  }
  return result;
}

export type CallAiOptions = {
  billingUserId: string | null;
  billingScope: string;
  systemMessage?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  onUsage?: (usage: AiUsageTokens) => void;
  onResolved?: (meta: AiCallResolvedMeta) => void;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
};

export type CallAiChatOptions = {
  billingUserId: string | null;
  billingScope: string;
  systemMessage?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  onUsage?: (usage: AiUsageTokens) => void;
  onResolved?: (meta: AiCallResolvedMeta) => void;
  tools?: ChatToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  responseFormat?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  idempotencyKey?: string;
  aiRunContext?: {
    runId: string;
    callIndex: number;
    routing: AiRoutingDecision;
  };
};

export type AiBillingAttribution = {
  userId: string | null;
  scope: string;
  mode: "user" | "platform";
};

export function resolveAiBillingAttribution(input: {
  billingUserId: string | null;
  billingScope: string;
}): AiBillingAttribution {
  const scope = typeof input.billingScope === "string" ? input.billingScope.trim() : "";
  if (!scope) throw new Error("ai_billing_scope_missing");
  const userId = typeof input.billingUserId === "string" && input.billingUserId.trim()
    ? input.billingUserId.trim()
    : null;
  return { userId, scope, mode: userId ? "user" : "platform" };
}

export type AiToolCall = {
  id: string;
  name: string;
  argumentsText: string;
};

export type AiChatResult = {
  content: string;
  toolCalls: AiToolCall[];
  usage: AiUsageTokens;
  model: string;
  provider: EnabledAiProvider;
  finishReason: string | null;
  responseId?: string | null;
  requestId?: string | null;
  serviceTier?: string | null;
};

type AiCallResult = {
  usage: AiUsageTokens;
  message: ChatCompletionMessage;
  finishReason: string | null;
  modelUsed: string;
};

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeAiProvider(value: unknown): EnabledAiProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "openai") return "openai";
  if (normalized === "ollama") return "ollama";
  if (normalized === "vllm") return "vllm";
  return null;
}

export function isSelfHostedAiProvider(provider: AiProvider | string | null | undefined): boolean {
  return provider === "ollama" || provider === "vllm";
}

export function shouldChargeAiCredits(provider: EnabledAiProvider): boolean {
  return provider === "openai";
}

function resolveProvider(value: string | undefined): AiProvider {
  const normalized = (value ?? "openai").trim().toLowerCase();
  if (normalized === "off" || normalized === "disabled" || normalized === "none") {
    return "disabled";
  }
  const provider = normalizeAiProvider(normalized);
  if (provider) return provider;
  return "openai";
}

function defaultBaseUrlForProvider(provider: EnabledAiProvider): string {
  if (provider === "ollama") return DEFAULT_OLLAMA_BASE_URL;
  if (provider === "vllm") return DEFAULT_VLLM_BASE_URL;
  return DEFAULT_OPENAI_BASE_URL;
}

function normalizeConfiguredOpenAiModel(value: unknown): OpenAiAdminModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!OPENAI_ADMIN_MODEL_OPTION_SET.has(trimmed)) {
    return null;
  }
  return trimmed as OpenAiAdminModel;
}

export function resolveAiModelFromConfig(input: {
  dbModel?: string | null;
  envModel?: string | null | undefined;
  provider?: EnabledAiProvider | null;
}): { model: string; source: AiModelSource } {
  const provider = input.provider ?? "openai";
  if (provider === "openai") {
    const dbModel = normalizeConfiguredOpenAiModel(input.dbModel);
    if (dbModel) {
      return { model: dbModel, source: "db" };
    }
    const envModel = normalizeConfiguredOpenAiModel(input.envModel);
    if (envModel) {
      return { model: envModel, source: "env" };
    }
    return { model: OPENAI_DEFAULT_MODEL, source: "default" };
  }

  const dbModel = toNonEmptyString(input.dbModel);
  if (dbModel) {
    return { model: dbModel, source: "db" };
  }
  const envModel = toNonEmptyString(input.envModel ?? null);
  if (envModel) {
    return { model: envModel, source: "env" };
  }
  if (provider === "vllm") {
    return { model: "", source: "default" };
  }
  return { model: OLLAMA_DEFAULT_MODEL, source: "default" };
}

function resolveAiBaseUrlFromConfig(input: {
  provider: EnabledAiProvider;
  dbBaseUrl?: string | null;
  envBaseUrl?: string | null | undefined;
}): { baseUrl: string; source: AiBaseUrlSource } {
  const dbBaseUrl = toNonEmptyString(input.dbBaseUrl);
  const envBaseUrl = toNonEmptyString(input.envBaseUrl ?? null);
  if (dbBaseUrl) {
    return { baseUrl: dbBaseUrl, source: "db" };
  }
  if (envBaseUrl) {
    return { baseUrl: envBaseUrl, source: "env" };
  }
  return {
    baseUrl: defaultBaseUrlForProvider(input.provider),
    source: "default"
  };
}

export async function validateAiProviderBaseUrl(
  provider: EnabledAiProvider,
  baseUrl: string,
  options: {
    production?: boolean;
    allowPrivateOllama?: boolean;
    allowPrivateVllm?: boolean;
  } = {}
): Promise<{ ok: true; baseUrl: string; timeoutMs: number } | { ok: false; reason: string }> {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const allowPrivateSelfHosted =
    provider === "ollama"
      ? (
          options.allowPrivateOllama === true
          || process.env.AI_ALLOW_PRIVATE_OLLAMA_BASE_URL === "1"
          || (!production && options.allowPrivateOllama !== false)
        )
      : provider === "vllm"
        ? (
            options.allowPrivateVllm === true
            || process.env.AI_ALLOW_PRIVATE_VLLM_BASE_URL === "1"
            || (!production && options.allowPrivateVllm !== false)
          )
        : false;
  const safeUrl = await validateSafeOutboundUrl(baseUrl, {
    production,
    requireHttps: production && !allowPrivateSelfHosted,
    allowPrivateNetworks: allowPrivateSelfHosted,
    timeoutMs: AI_PROVIDER_SAFE_URL_TIMEOUT_MS
  });
  if (!safeUrl.ok) {
    logger.warn("unsafe_ai_base_url", {
      provider,
      reason: safeUrl.reason
    });
    return safeUrl;
  }
  return {
    ok: true,
    baseUrl: safeUrl.url,
    timeoutMs: safeUrl.timeoutMs
  };
}

function decryptStoredSecret(value: unknown): string | null {
  const encrypted = toNonEmptyString(value);
  if (!encrypted) return null;
  try {
    const decrypted = decryptSecret(encrypted).trim();
    return decrypted.length > 0 ? decrypted : null;
  } catch {
    return null;
  }
}

function normalizeProviderForStoredProfile(
  provider: AiProvider | string | null | undefined
): EnabledAiProvider {
  return provider === "ollama" || provider === "vllm" ? provider : "openai";
}

function parseStoredAiProviderSnapshot(value: unknown): StoredAiProviderSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      aiApiKey: null,
      aiModel: null,
      aiBaseUrl: null,
      aiModelRouting: {}
    };
  }

  const record = value as Record<string, unknown>;
  return {
    aiApiKey:
      decryptStoredSecret(record.aiApiKeyEnc)
      ?? decryptStoredSecret(record.openaiApiKeyEnc),
    aiModel:
      toNonEmptyString(record.aiModel)
      ?? toNonEmptyString(record.openaiModel),
    aiBaseUrl: toNonEmptyString(record.aiBaseUrl),
    aiModelRouting: parseStoredAiModelRouting(record.aiModelRouting)
  };
}

export function parseStoredAiSettings(value: unknown): DbAiSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      aiApiKey: null,
      aiModel: null,
      aiProvider: null,
      aiBaseUrl: null,
      aiModelRouting: {}
    };
  }

  const record = value as Record<string, unknown>;
  const aiProviderRaw = toNonEmptyString(record.aiProvider)?.toLowerCase() ?? "";
  const aiProvider =
    aiProviderRaw === "disabled" || aiProviderRaw === "off" || aiProviderRaw === "none"
      ? "disabled"
      : (normalizeAiProvider(aiProviderRaw) ?? null);
  const legacyAiApiKey = decryptStoredSecret(record.aiApiKeyEnc);
  const legacyOpenAiApiKey = decryptStoredSecret(record.openaiApiKeyEnc);
  const legacyAiModel =
    toNonEmptyString(record.aiModel)
    ?? toNonEmptyString(record.openaiModel);
  const legacyAiBaseUrl = toNonEmptyString(record.aiBaseUrl);

  const aiProfiles =
    record.aiProfiles && typeof record.aiProfiles === "object" && !Array.isArray(record.aiProfiles)
      ? (record.aiProfiles as Record<string, unknown>)
      : {};
  const openaiProfile = parseStoredAiProviderSnapshot(aiProfiles.openai);
  const useLegacyOpenAiFields = aiProvider === null || aiProvider === "openai" || aiProvider === "disabled";
  const selectedProfile = {
    aiApiKey: openaiProfile.aiApiKey ?? (useLegacyOpenAiFields ? legacyOpenAiApiKey ?? legacyAiApiKey : null),
    aiModel: openaiProfile.aiModel ?? (useLegacyOpenAiFields ? legacyAiModel : null),
    aiBaseUrl: openaiProfile.aiBaseUrl ?? (useLegacyOpenAiFields ? legacyAiBaseUrl : null)
  };

  return {
    aiApiKey: selectedProfile.aiApiKey,
    aiModel: selectedProfile.aiModel,
    aiProvider: aiProvider === "disabled" ? "disabled" : "openai",
    aiBaseUrl: selectedProfile.aiBaseUrl,
    aiModelRouting: openaiProfile.aiModelRouting
  };
}

async function loadDbAiSettings(): Promise<DbAiSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: AI_API_KEYS_GLOBAL_SETTING_KEY },
    select: { value: true }
  });
  return parseStoredAiSettings(row?.value);
}

async function resolveDbAiSettings(): Promise<DbAiSettings> {
  const now = Date.now();
  if (now < dbAiSettingsCacheUntil && dbAiSettingsCached) {
    return dbAiSettingsCached;
  }

  if (!dbAiSettingsInFlight) {
    dbAiSettingsInFlight = (async () => {
      try {
        return await loadDbAiSettings();
      } catch (error) {
        logger.warn("ai_provider_settings_lookup_failed", {
          reason: String(error)
        });
        return {
          aiApiKey: null,
          aiModel: null,
          aiProvider: null,
          aiBaseUrl: null,
          aiModelRouting: {}
        } satisfies DbAiSettings;
      } finally {
        dbAiSettingsInFlight = null;
      }
    })();
  }

  dbAiSettingsCached = await dbAiSettingsInFlight;
  dbAiSettingsCacheUntil = Date.now() + Math.max(AI_DB_KEY_CACHE_TTL_MS, AI_DB_MODEL_CACHE_TTL_MS);
  return dbAiSettingsCached;
}

export function invalidateAiApiKeyCache() {
  dbAiSettingsCacheUntil = 0;
  dbAiSettingsCached = null;
  dbAiSettingsInFlight = null;
}

export function invalidateAiModelCache() {
  dbAiSettingsCacheUntil = 0;
  dbAiSettingsCached = null;
  dbAiSettingsInFlight = null;
}

export async function resolveAiProviderWithSource(): Promise<{
  provider: AiProvider;
  source: AiProviderSource;
}> {
  // This product path is intentionally OpenAI-only. Historical stored values
  // remain readable during rollout, but cannot redirect paid AI requests.
  return {
    provider: "openai",
    source: "default"
  };
}

export async function getAiProviderAsync(): Promise<AiProvider> {
  const resolved = await resolveAiProviderWithSource();
  return resolved.provider;
}

export async function resolveAiBaseUrlWithSource(): Promise<{
  baseUrl: string;
  source: AiBaseUrlSource;
}> {
  const providerResolved = await resolveAiProviderWithSource();
  const provider: EnabledAiProvider = providerResolved.provider === "disabled" ? "openai" : providerResolved.provider;
  const dbSettings = await resolveDbAiSettings();
  return resolveAiBaseUrlFromConfig({
    provider,
    dbBaseUrl: dbSettings.aiBaseUrl,
    envBaseUrl: process.env.AI_BASE_URL
  });
}

export async function resolveAiModelWithSource(): Promise<{
  model: string;
  source: AiModelSource;
}> {
  const providerResolved = await resolveAiProviderWithSource();
  const provider: EnabledAiProvider = providerResolved.provider === "disabled" ? "openai" : providerResolved.provider;
  const dbSettings = await resolveDbAiSettings();
  return resolveAiModelFromConfig({
    provider,
    dbModel: dbSettings.aiModel,
    envModel: process.env.AI_MODEL
  });
}

export async function getAiModelAsync(): Promise<string> {
  const resolved = await resolveAiModelWithSource();
  return resolved.model;
}

export async function resolveOpenAiModelRoutingWithSource(): Promise<{
  models: AiModelRouting;
  sources: Record<AiModelClass, "db" | "default">;
}> {
  const dbSettings = await resolveDbAiSettings();
  const models = normalizeAiModelRouting(dbSettings.aiModelRouting);
  return {
    models,
    sources: {
      utility: dbSettings.aiModelRouting.utility ? "db" : "default",
      standard: dbSettings.aiModelRouting.standard ? "db" : "default",
      analysis: dbSettings.aiModelRouting.analysis ? "db" : "default",
      deep: dbSettings.aiModelRouting.deep ? "db" : "default"
    }
  };
}

export function getAiModel(): string {
  const provider = resolveProvider(process.env.AI_PROVIDER);
  const normalizedProvider: EnabledAiProvider = provider === "disabled" ? "openai" : provider;
  return resolveAiModelFromConfig({
    provider: normalizedProvider,
    envModel: process.env.AI_MODEL
  }).model;
}

async function resolveAiApiKey(provider: EnabledAiProvider): Promise<string | null> {
  const dbSettings = await resolveDbAiSettings();
  if (dbSettings.aiApiKey) return dbSettings.aiApiKey;

  const envApiKey = toNonEmptyString(process.env.AI_API_KEY);
  if (envApiKey) return envApiKey;

  if (provider === "ollama") {
    return "ollama";
  }

  return null;
}

function readProviderError(status: number, payload: unknown, prefix: string): string {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.length > 0) {
      return trimmed.slice(0, 240);
    }
  }
  if (payload && typeof payload === "object") {
    const message = (payload as OpenAiErrorPayload).error?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }
  return `${prefix}_${status}`;
}

function normalizeTokenCount(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function readChatUsage(payload: ChatCompletionResponse | null | undefined): AiUsageTokens {
  const promptTokens = normalizeTokenCount(payload?.usage?.prompt_tokens);
  const completionTokens = normalizeTokenCount(payload?.usage?.completion_tokens);
  const totalTokens =
    normalizeTokenCount(payload?.usage?.total_tokens)
    ?? (promptTokens !== null || completionTokens !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function flattenMessageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map((part) => flattenMessageText(part)).join("");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "value", "output_text", "output"]) {
      const extracted = flattenMessageText(record[key]);
      if (extracted.trim()) return extracted;
    }
    const nested = Object.values(record)
      .map((part) => flattenMessageText(part))
      .filter((part) => part.trim().length > 0);
    if (nested.length > 0) return nested.join("");
  }

  return "";
}

function readMessageContent(message: ChatCompletionMessage | null | undefined): string {
  if (!message) return "";
  const contentText = flattenMessageText(message.content).trim();
  if (contentText) return contentText;

  const reasoningText =
    flattenMessageText(message.reasoning).trim()
    || flattenMessageText(message.reasoning_content).trim();
  if (reasoningText) return reasoningText;

  return "";
}

function readToolCalls(message: ChatCompletionMessage | null | undefined): AiToolCall[] {
  const toolCallsRaw = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const out: AiToolCall[] = [];
  for (const row of toolCallsRaw) {
    const id = toNonEmptyString(row?.id);
    const name = toNonEmptyString(row?.function?.name);
    const argumentsText = typeof row?.function?.arguments === "string"
      ? row.function.arguments
      : "{}";
    if (!id || !name) continue;
    out.push({
      id,
      name,
      argumentsText
    });
  }
  return out;
}

export function hasUsableAiChatMessageOutput(message: unknown): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const normalized = message as ChatCompletionMessage;
  return readMessageContent(normalized).length > 0 || readToolCalls(normalized).length > 0;
}

function isOpenAiGpt5Model(provider: EnabledAiProvider, model: string): boolean {
  return provider === "openai" && model.startsWith("gpt-5");
}

function resolveOllamaDockerFallbackBaseUrl(baseUrl: string): string | null {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
      return null;
    }
    parsed.hostname = "host.docker.internal";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolveFallbackModel(primaryModel: string): string | null {
  const envFallback = process.env.AI_FALLBACK_MODEL?.trim() ?? "";
  const fallback = envFallback || "gpt-4o-mini";
  return fallback && fallback !== primaryModel ? fallback : null;
}

function routingProfileForScope(scope: string): AiRoutingProfile {
  if (/position|copilot/i.test(scope)) return "position_copilot";
  if (/prediction|strategy|prompt_generator/i.test(scope)) return "prediction_builder";
  if (/trade|order|draft/i.test(scope)) return "trading_assistant";
  return "market_analyst";
}

function expectedInputTokens(messages: ChatMessage[]): number {
  const characters = messages.reduce((sum, message) => {
    const toolCharacters = (message.tool_calls ?? []).reduce(
      (toolSum, toolCall) => toolSum + toolCall.function.name.length + toolCall.function.arguments.length,
      0
    );
    return sum + message.content.length + toolCharacters;
  }, 0);
  return Math.max(1_000, Math.ceil(characters / 4) + 2_000);
}

function safeInteger(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function publicUsage(usage: AiTokenUsage): AiUsageTokens {
  return {
    promptTokens: safeInteger(usage.inputTokens),
    completionTokens: safeInteger(usage.outputTokens),
    totalTokens: safeInteger(usage.inputTokens + usage.outputTokens),
    cachedInputTokens: safeInteger(usage.cachedInputTokens),
    cacheWriteTokens: safeInteger(usage.cacheWriteTokens),
    reasoningTokens: safeInteger(usage.reasoningTokens)
  };
}

function hashedSafetyIdentifier(userId: string | null): string | undefined {
  return userId
    ? createHash("sha256").update(`uliquid:${userId}`).digest("hex")
    : undefined;
}

function failureNeedsReconciliation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { responseId?: unknown; usage?: unknown };
  return Boolean(row.responseId || row.usage);
}

type AiFailureBillingSettlement = {
  chargedCredits: bigint;
  remainingBalance: bigint;
};

type AiFailureWithBillingSettlement = Error & {
  aiBillingSettlement?: AiFailureBillingSettlement;
};

export function getAiFailureBillingSettlement(error: unknown): AiFailureBillingSettlement | null {
  if (!(error instanceof Error)) return null;
  const settlement = (error as AiFailureWithBillingSettlement).aiBillingSettlement;
  if (!settlement || typeof settlement.chargedCredits !== "bigint" || typeof settlement.remainingBalance !== "bigint") {
    return null;
  }
  return settlement;
}

type AiIncompleteFailureBillingDeps = {
  recordUsage: typeof recordAiUsage;
  settleRun: typeof settleAiRun;
};

export async function settleIncompleteAiFailureUsage(params: {
  database: any;
  error: unknown;
  runId: string;
  callIndex: number;
  routing: AiRoutingDecision;
  latencyMs: number;
}, deps: AiIncompleteFailureBillingDeps = {
  recordUsage: recordAiUsage,
  settleRun: settleAiRun
}): Promise<AiFailureBillingSettlement | null> {
  if (!(params.error instanceof OpenAiResponsesIncompleteError) || !params.error.usage) return null;
  await deps.recordUsage({
    database: params.database,
    agentRunId: params.runId,
    callIndex: params.callIndex,
    routing: params.routing,
    usage: params.error.usage,
    responseId: params.error.responseId,
    requestId: params.error.requestId,
    serviceTier: params.error.serviceTier,
    latencyMs: params.latencyMs,
    status: "FAILED",
    errorCode: params.error.message.slice(0, 191)
  });
  const settlement = await deps.settleRun({ database: params.database, agentRunId: params.runId });
  if (settlement) {
    (params.error as AiFailureWithBillingSettlement).aiBillingSettlement = settlement;
  }
  return settlement;
}

async function callChatCompletions(params: {
  provider: EnabledAiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  responseFormat?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  signal: AbortSignal;
}): Promise<AiCallResult> {
  const requestedMaxTokensRaw = params.maxTokens ?? 220;
  const requestedMaxTokens = isSelfHostedAiProvider(params.provider)
    ? Math.max(OLLAMA_MIN_MAX_TOKENS, requestedMaxTokensRaw)
    : requestedMaxTokensRaw;
  const completionTokensParam = isOpenAiGpt5Model(params.provider, params.model)
    ? { max_completion_tokens: requestedMaxTokens }
    : { max_tokens: requestedMaxTokens };
  const temperatureParam = isOpenAiGpt5Model(params.provider, params.model)
    ? {}
    : { temperature: params.temperature ?? 0.1 };
  const reasoningEffortParam = isOpenAiGpt5Model(params.provider, params.model) && params.reasoningEffort
    ? { reasoning_effort: params.reasoningEffort }
    : {};

  const safeBaseUrl = await validateAiProviderBaseUrl(params.provider, params.baseUrl);
  if (!safeBaseUrl.ok) {
    throw Object.assign(new Error("ai_provider_unavailable"), {
      status: 503,
      code: "unsafe_ai_base_url",
      reason: safeBaseUrl.reason
    });
  }
  const endpoint = `${safeBaseUrl.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: params.model,
    ...temperatureParam,
    ...completionTokensParam,
    ...reasoningEffortParam,
    messages: params.messages,
    stream: false
  };

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
    body.tool_choice = params.toolChoice ?? "auto";
  }
  if (params.responseFormat) {
    body.response_format = params.responseFormat;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (params.apiKey.trim()) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const bodyText = JSON.stringify(body);
  const doFetch = (url: string) =>
    fetch(url, {
      method: "POST",
      redirect: "error",
      headers,
      body: bodyText,
      signal: params.signal
    });

  let response: Response;
  try {
    response = await doFetch(endpoint);
  } catch (error) {
    const fallbackBaseUrl =
      params.provider === "ollama" ? resolveOllamaDockerFallbackBaseUrl(params.baseUrl) : null;
    if (!fallbackBaseUrl || params.signal.aborted) {
      throw error;
    }
    const safeFallbackBaseUrl = await validateAiProviderBaseUrl(params.provider, fallbackBaseUrl);
    if (!safeFallbackBaseUrl.ok) {
      logger.warn("unsafe_ai_base_url", {
        provider: params.provider,
        reason: safeFallbackBaseUrl.reason,
        fallback: true
      });
      throw error;
    }
    const fallbackEndpoint = `${safeFallbackBaseUrl.baseUrl.replace(/\/$/, "")}/chat/completions`;
    logger.info("ai_provider_ollama_docker_fallback", {
      from_base_url: params.baseUrl,
      to_base_url: safeFallbackBaseUrl.baseUrl
    });
    response = await doFetch(fallbackEndpoint);
  }

  let payload: ChatCompletionResponse | null = null;
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    try {
      payload = (await response.text()) as unknown as ChatCompletionResponse;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new Error(readProviderError(response.status, payload, `${params.provider}_chat_completions_http`));
  }

  const messageFromChoice = payload?.choices?.[0]?.message;
  const messageFromTopLevel = payload?.message;
  const textFromChoice = flattenMessageText(payload?.choices?.[0]?.text).trim();
  const textFromTopLevel = flattenMessageText(payload?.response).trim();
  const message = messageFromChoice
    ?? messageFromTopLevel
    ?? (textFromChoice
      ? {
          role: "assistant",
          content: textFromChoice
        }
      : textFromTopLevel
        ? {
            role: "assistant",
            content: textFromTopLevel
          }
        : null);
  const finishReason = typeof (payload as any)?.choices?.[0]?.finish_reason === "string"
    ? String((payload as any).choices[0].finish_reason)
    : null;
  if (!message || !hasUsableAiChatMessageOutput(message)) {
    const usage = readChatUsage(payload);
    const details = [
      finishReason ? `finish_reason:${finishReason}` : null,
      usage.completionTokens !== null ? `completion_tokens:${usage.completionTokens}` : null
    ].filter(Boolean).join(",");
    throw new Error(details ? `ai_empty_response:${details}` : "ai_empty_response");
  }

  return {
    usage: readChatUsage(payload),
    message,
    modelUsed: params.model,
    finishReason
  };
}

export async function callAiChat(
  messages: ChatMessage[],
  options: CallAiChatOptions
): Promise<AiChatResult> {
  const provider: EnabledAiProvider = "openai";
  const key = await resolveAiApiKey(provider);
  if (!key) throw new Error("ai_api_key_missing");

  const baseUrlResolved = await resolveAiBaseUrlWithSource();
  const safeBaseUrl = await validateAiProviderBaseUrl(provider, baseUrlResolved.baseUrl);
  if (!safeBaseUrl.ok) {
    throw Object.assign(new Error("ai_provider_unavailable"), {
      status: 503,
      code: "unsafe_ai_base_url",
      reason: safeBaseUrl.reason
    });
  }

  const timeoutMs = Number(options.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? "15000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  const startedAt = Date.now();

  const billingAttribution = resolveAiBillingAttribution(options);
  const billingUserId = billingAttribution.userId;
  const billingScope = billingAttribution.scope;
  const configuredModelRouting = await resolveOpenAiModelRoutingWithSource();
  const routing = options.aiRunContext?.routing ?? routeOpenAiModel({
    scope: billingScope,
    profile: routingProfileForScope(billingScope),
    requestedSymbols: 1,
    requestedAccounts: 1,
    enabledSkills: (options.tools ?? []).map((tool) => tool.function.name),
    createsTradingDraft: /trade|order|draft/i.test(billingScope),
    expectedInputTokens: expectedInputTokens(messages),
    allowDeep: process.env.AI_DEEP_ANALYSIS_ENABLED === "true"
  }, configuredModelRouting.models);
  const model = routing.model;
  const billingEnabled = Boolean(billingUserId && await isAiCreditBillingEnabledForDatabase(db));
  const runId = options.aiRunContext?.runId ?? (billingEnabled ? randomUUID() : null);
  const callIndex = options.aiRunContext?.callIndex ?? 0;
  let standaloneRunId: string | null = null;
  let standaloneReservationCreated = false;

  if (billingEnabled && billingUserId && runId && !options.aiRunContext) {
    standaloneRunId = runId;
    const reservation = await estimateAiRunReservation({
      database: db,
      routing,
      expectedInputTokens: expectedInputTokens(messages)
    });
    const idempotencyKey = options.idempotencyKey ?? `ai-call:${billingUserId}:${randomUUID()}`;
    await db.aiAgentRun.create({
      data: {
        id: runId,
        userId: billingUserId,
        scope: billingScope,
        status: "running",
        profileSnapshot: { profile: routingProfileForScope(billingScope) },
        contextSnapshot: {
          promptCharacters: messages.reduce((sum, row) => sum + row.content.length, 0)
        },
        provider: "openai",
        model,
        modelClass: routing.modelClass,
        routingDecision: routing,
        idempotencyKey
      }
    });
    await reserveAiCredits({
      database: db,
      userId: billingUserId,
      agentRunId: runId,
      credits: reservation.credits,
      idempotencyKey: `${idempotencyKey}:reserve`
    });
    standaloneReservationCreated = true;
  }

  try {
    const result = await callOpenAiResponses({
      apiKey: key,
      baseUrl: safeBaseUrl.baseUrl,
      model,
      messages,
      maxOutputTokens: Math.min(options.maxTokens ?? routing.maxOutputTokens, routing.maxOutputTokens),
      reasoningEffort: options.reasoningEffort ?? routing.reasoningEffort,
      tools: options.tools,
      toolChoice: options.toolChoice,
      responseFormat: options.responseFormat,
      signal: controller.signal,
      safetyIdentifier: hashedSafetyIdentifier(billingUserId)
    });
    const usage = publicUsage(result.usage);

    if (billingEnabled && runId) {
      await recordAiUsage({
        database: db,
        agentRunId: runId,
        callIndex,
        routing,
        usage: result.usage,
        responseId: result.responseId,
        requestId: result.requestId,
        serviceTier: result.serviceTier,
        latencyMs: Date.now() - startedAt
      });
      if (standaloneRunId) {
        const settled = await settleAiRun({ database: db, agentRunId: standaloneRunId });
        await db.aiAgentRun.update({
          where: { id: standaloneRunId },
          data: {
            status: "completed",
            completedAt: new Date(),
            latencyMs: Date.now() - startedAt,
            usageTotalTokens: usage.totalTokens,
            chargedCredits: settled?.chargedCredits ?? 0n
          }
        });
      }
    }

    if (options.onUsage) {
      options.onUsage(usage);
    }
    if (options.onResolved) {
      options.onResolved({
        provider,
        requestedModel: model,
        modelUsed: result.model,
        fallbackUsed: false,
        fallbackReason: null
      });
    }

    return {
      content: result.content,
      toolCalls: result.toolCalls,
      usage,
      model: result.model,
      provider,
      finishReason: result.finishReason,
      responseId: result.responseId,
      requestId: result.requestId,
      serviceTier: result.serviceTier
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    let failureSettlement: AiFailureBillingSettlement | null = null;
    if (billingEnabled && runId) {
      try {
        failureSettlement = await settleIncompleteAiFailureUsage({
          database: db,
          error,
          runId,
          callIndex,
          routing,
          latencyMs: Date.now() - startedAt
        });
      } catch (billingError) {
        logger.warn("ai_incomplete_usage_settlement_failed", {
          ai_provider: provider,
          ai_model: model,
          ai_call_ms: Date.now() - startedAt,
          reason: billingError instanceof Error ? billingError.message : String(billingError)
        });
      }
    }
    if (billingEnabled && options.aiRunContext && !failureSettlement && failureNeedsReconciliation(error)) {
      await markAiReservationForReconciliation({
        database: db,
        agentRunId: options.aiRunContext.runId,
        reason: isAbort ? "provider_timeout_after_dispatch" : "provider_usage_ambiguous"
      }).catch(() => undefined);
    }
    if (standaloneRunId && standaloneReservationCreated) {
      const reconciliationRequired = !failureSettlement && failureNeedsReconciliation(error);
      if (reconciliationRequired) {
        await markAiReservationForReconciliation({
          database: db,
          agentRunId: standaloneRunId,
          reason: isAbort ? "provider_timeout_after_dispatch" : "provider_usage_ambiguous"
        });
      } else if (!failureSettlement) {
        await releaseAiReservation({
          database: db,
          agentRunId: standaloneRunId,
          reason: isAbort ? "provider_timeout_without_usage" : "provider_failed_without_usage"
        });
      }
      await db.aiAgentRun.update({
        where: { id: standaloneRunId },
        data: {
          status: reconciliationRequired ? "reconciliation_required" : "failed",
          chargedCredits: failureSettlement?.chargedCredits ?? 0n,
          errorCode: String(error).slice(0, 191),
          completedAt: new Date(),
          latencyMs: Date.now() - startedAt
        }
      }).catch(() => undefined);
    }
    logger.warn("ai_provider_call_failed", {
      ai_provider: provider,
      ai_base_url: baseUrlResolved.baseUrl,
      ai_model: model,
      ai_call_ms: Date.now() - startedAt,
      reason: isAbort ? "timeout" : String(error)
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callAi(prompt: string, options: CallAiOptions): Promise<string> {
  const messages: ChatMessage[] = [
    ...(options.systemMessage
      ? [{ role: "system" as const, content: options.systemMessage }]
      : []),
    { role: "user" as const, content: prompt }
  ];

  const result = await callAiChat(messages, {
    systemMessage: undefined,
    model: options.model,
    timeoutMs: options.timeoutMs,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    billingUserId: options.billingUserId,
    billingScope: options.billingScope,
    onUsage: options.onUsage,
    onResolved: options.onResolved
  });

  const text = result.content.trim();
  if (!text) {
    const reasonBits = [
      result.finishReason ? `finish_reason:${result.finishReason}` : null,
      result.toolCalls.length > 0 ? `tool_calls:${result.toolCalls.length}` : null
    ].filter(Boolean);
    if (reasonBits.length > 0) {
      throw new Error(`ai_empty_response:${reasonBits.join(",")}`);
    }
    throw new Error("ai_empty_response");
  }
  return text;
}
