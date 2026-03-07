import type { BotPluginPolicySnapshot, PlanTier } from "@mm/plugin-sdk";
import {
  createNotificationIsolationState,
  ensureNotificationEnvelope,
  runNotificationProviderWithIsolation
} from "@mm/plugin-sdk";
import {
  capabilityForPlugin,
  isPlanAtLeast,
  normalizePlanTier
} from "@mm/core";
import { prisma } from "@mm/db";
import { logger } from "../logger.js";
import { resolveCapabilitiesForPlan } from "../capabilities/guard.js";
import { resolveStrategyEntitlementsForWorkspace } from "../license.js";
import {
  getNotificationDestinationsSettingsForUser,
  getNotificationPluginSettingsForUser
} from "./notificationSettings.js";
import { writeNotificationDeliveryAudit } from "./notificationAudit.js";
import { buildPluginPolicySnapshot } from "./policy.js";
import {
  TELEGRAM_NOTIFICATION_PLUGIN_ID,
  telegramNotificationPlugin
} from "./notifications/telegramNotificationPlugin.js";
import {
  WEBHOOK_NOTIFICATION_PLUGIN_ID,
  webhookNotificationPlugin
} from "./notifications/webhookNotificationPlugin.js";
import {
  getApiNotificationPluginRegistry,
  type ApiNotificationPluginRegistry
} from "./notifications/registry.js";
import type {
  ApiNotificationDestinationConfig,
  ApiNotificationDispatchResult,
  ApiNotificationEvent,
  ApiNotificationEventByType,
  ApiNotificationPayloadMap,
  ApiNotificationPlugin,
  ApiNotificationType
} from "./notifications/types.js";

type HostDependencies = {
  registry?: ApiNotificationPluginRegistry;
  resolvePlanForUserId?: (userId: string) => Promise<PlanTier>;
  resolveNotificationSettingsForUserId?: (userId: string) => Promise<{
    enabled: string[];
    disabled: string[];
    order: string[];
    destinations: ApiNotificationDestinationConfig;
  }>;
  loadExternalPlugins?: () => Promise<ApiNotificationPlugin[]>;
  now?: () => Date;
};

type DispatchOptions = {
  pluginIds?: string[];
  timeoutMs?: number;
  policySnapshot?: BotPluginPolicySnapshot;
  userId?: string;
  destinationConfig?: ApiNotificationDestinationConfig;
  trace?: {
    requestId?: string;
    workerId?: string;
    tickId?: string;
  };
};

const db = prisma as any;
const DEFAULT_TIMEOUT_MS = 2_500;
const PLAN_CACHE_TTL_MS = 60_000;
const SETTINGS_CACHE_TTL_MS = 30_000;
const DEFAULT_NOTIFICATION_PLUGIN_ALLOWLIST = "@mm/";

function normalizePluginIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseTokenList(raw: string): string[] {
  const out: string[] = [];
  for (const token of raw.split(",")) {
    const normalized = token.trim();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function isAllowedByPolicy(pluginId: string, snapshot: BotPluginPolicySnapshot | null | undefined): boolean {
  if (!snapshot) return true;
  if (snapshot.allowedPluginIds === null) return true;
  return snapshot.allowedPluginIds.includes(pluginId);
}

async function resolveWorkspaceIdForUserId(userId: string): Promise<string | null> {
  const member = await db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true }
  });
  if (!member?.workspaceId || typeof member.workspaceId !== "string") return null;
  const trimmed = member.workspaceId.trim();
  return trimmed || null;
}

function resolveTelegramDestinationFromSettings(params: {
  userId: string;
  envToken: string | null;
  envChatId: string | null;
  configToken: string | null;
  configChatId: string | null;
  userChatId: string | null;
}): { botToken: string | null; chatId: string | null } {
  const envOverrideEnabled = Boolean(params.envToken && params.envChatId);
  const botToken = envOverrideEnabled ? params.envToken : params.configToken;
  const chatId = params.userChatId ?? (envOverrideEnabled ? params.envChatId : params.configChatId);
  return {
    botToken: botToken ?? null,
    chatId: chatId ?? null
  };
}

async function resolveDefaultDestinationConfigForUser(userId: string): Promise<ApiNotificationDestinationConfig> {
  const [alertConfig, userConfig, destinations] = await Promise.all([
    db.alertConfig.findUnique({
      where: { key: "default" },
      select: { telegramBotToken: true, telegramChatId: true }
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true }
    }),
    getNotificationDestinationsSettingsForUser(userId)
  ]);

  const parseString = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  const telegram = resolveTelegramDestinationFromSettings({
    userId,
    envToken: parseString(process.env.TELEGRAM_BOT_TOKEN),
    envChatId: parseString(process.env.TELEGRAM_CHAT_ID),
    configToken: parseString(alertConfig?.telegramBotToken),
    configChatId: parseString(alertConfig?.telegramChatId),
    userChatId: parseString(userConfig?.telegramChatId)
  });

  return {
    telegram,
    webhook: {
      url: destinations.webhook.url,
      headers: { ...destinations.webhook.headers }
    }
  };
}

async function loadExternalNotificationPluginsFromEnv(): Promise<ApiNotificationPlugin[]> {
  const modules = parseTokenList(String(process.env.API_NOTIFICATION_PLUGIN_MODULES ?? ""));
  if (modules.length === 0) return [];

  const allowlistPrefixes = parseTokenList(
    String(process.env.API_NOTIFICATION_PLUGIN_ALLOWLIST_PREFIXES ?? DEFAULT_NOTIFICATION_PLUGIN_ALLOWLIST)
  );
  const prefixes = allowlistPrefixes.length > 0
    ? allowlistPrefixes
    : [DEFAULT_NOTIFICATION_PLUGIN_ALLOWLIST];

  const out: ApiNotificationPlugin[] = [];
  for (const moduleSpecifier of modules) {
    const allowed = prefixes.some((prefix) => moduleSpecifier.startsWith(prefix));
    if (!allowed) {
      logger.warn("notification plugin module blocked by allowlist", { moduleSpecifier });
      continue;
    }

    try {
      const loaded = await import(moduleSpecifier) as {
        plugins?: unknown;
        default?: unknown;
      };

      const candidates: unknown[] = [];
      if (Array.isArray(loaded.plugins)) candidates.push(...loaded.plugins);
      if (Array.isArray(loaded.default)) candidates.push(...loaded.default);
      else if (loaded.default) candidates.push(loaded.default);

      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const plugin = candidate as ApiNotificationPlugin;
        if (plugin.manifest?.kind !== "notification") continue;
        out.push(plugin);
      }
    } catch (error) {
      logger.warn("notification plugin module load failed", {
        moduleSpecifier,
        reason: String(error)
      });
    }
  }

  return out;
}

type UserNotificationSettings = {
  enabled: string[];
  disabled: string[];
  order: string[];
  destinations: ApiNotificationDestinationConfig;
};

type BuildApiEventParams<TType extends ApiNotificationType> = {
  type: TType;
  payload: ApiNotificationPayloadMap[TType];
  userId: string;
  now: Date;
  trace?: DispatchOptions["trace"];
};

function toApiNotificationEvent<TType extends ApiNotificationType>(
  params: BuildApiEventParams<TType>
): ApiNotificationEventByType<TType> {
  const scope = {
    userId: params.userId,
    botId:
      typeof (params.payload as { botId?: unknown }).botId === "string"
        ? ((params.payload as { botId?: string }).botId ?? undefined)
        : undefined,
    exchange:
      typeof (params.payload as { exchange?: unknown }).exchange === "string"
        ? ((params.payload as { exchange?: string }).exchange ?? undefined)
        : undefined,
    symbol:
      typeof (params.payload as { symbol?: unknown }).symbol === "string"
        ? ((params.payload as { symbol?: string }).symbol ?? undefined)
        : undefined
  };

  const titleByType: Record<ApiNotificationType, string> = {
    "prediction.tradable": "Tradable prediction detected",
    "prediction.market_analysis_update": "Market analysis update",
    "prediction.outcome": "Prediction outcome",
    "manual_trading.error": "Manual trading error"
  };

  const categoryByType: Record<ApiNotificationType, ApiNotificationEvent["category"]> = {
    "prediction.tradable": "trade",
    "prediction.market_analysis_update": "trade",
    "prediction.outcome": "trade",
    "manual_trading.error": "error"
  };

  const severityByType: Record<ApiNotificationType, ApiNotificationEvent["severity"]> = {
    "prediction.tradable": "info",
    "prediction.market_analysis_update": "info",
    "prediction.outcome": "info",
    "manual_trading.error": "error"
  };

  return ensureNotificationEnvelope({
    source: "api",
    type: params.type,
    category: categoryByType[params.type],
    severity: severityByType[params.type],
    title: titleByType[params.type],
    message:
      typeof (params.payload as { message?: unknown }).message === "string"
        ? (params.payload as { message: string }).message
        : undefined,
    tags: Array.isArray((params.payload as { tags?: unknown }).tags)
      ? (params.payload as { tags?: unknown[] }).tags
          ?.map((tag) => String(tag ?? "").trim())
          .filter(Boolean)
          .slice(0, 12)
      : undefined,
    payload: params.payload as unknown as Record<string, unknown>,
    scope,
    correlationId:
      typeof (params.payload as { requestId?: unknown }).requestId === "string"
        ? ((params.payload as { requestId?: string }).requestId ?? undefined)
        : undefined
  }, params.now) as ApiNotificationEventByType<TType>;
}

export function createApiNotificationHost(deps: HostDependencies = {}) {
  const registry = deps.registry ?? getApiNotificationPluginRegistry();
  const planCache = new Map<string, { expiresAt: number; plan: PlanTier }>();
  const settingsCache = new Map<string, { expiresAt: number; value: UserNotificationSettings }>();
  const isolationState = createNotificationIsolationState();
  let builtinsRegistered = false;
  let externalLoaded = false;

  function registerBuiltins() {
    if (builtinsRegistered) return;
    if (!registry.has(telegramNotificationPlugin.manifest.id)) {
      registry.register(telegramNotificationPlugin);
    }
    if (!registry.has(webhookNotificationPlugin.manifest.id)) {
      registry.register(webhookNotificationPlugin);
    }
    builtinsRegistered = true;
  }

  async function loadExternalPlugins() {
    if (externalLoaded) return;
    if (!deps.loadExternalPlugins) {
      externalLoaded = true;
      return;
    }

    try {
      const plugins = await deps.loadExternalPlugins();
      for (const plugin of plugins) {
        if (!registry.has(plugin.manifest.id)) {
          registry.register(plugin);
        }
      }
    } catch (error) {
      logger.warn("notification plugin external loader failed", {
        reason: String(error)
      });
    }

    externalLoaded = true;
  }

  async function resolvePlanForUserId(userId: string): Promise<PlanTier> {
    const normalizedUserId = String(userId ?? "").trim();
    if (!normalizedUserId) return "pro";

    const now = Date.now();
    const cached = planCache.get(normalizedUserId);
    if (cached && cached.expiresAt > now) {
      return cached.plan;
    }

    let plan: PlanTier = "pro";
    try {
      if (deps.resolvePlanForUserId) {
        plan = normalizePlanTier(await deps.resolvePlanForUserId(normalizedUserId));
      } else {
        const workspaceId = await resolveWorkspaceIdForUserId(normalizedUserId);
        const entitlements = await resolveStrategyEntitlementsForWorkspace({
          workspaceId: workspaceId ?? "unknown"
        });
        plan = normalizePlanTier(entitlements.plan);
      }
    } catch {
      plan = "pro";
    }

    planCache.set(normalizedUserId, {
      plan,
      expiresAt: now + PLAN_CACHE_TTL_MS
    });
    return plan;
  }

  async function resolveUserNotificationSettings(userId: string): Promise<UserNotificationSettings> {
    const normalizedUserId = String(userId ?? "").trim();
    if (!normalizedUserId) {
      return {
        enabled: [TELEGRAM_NOTIFICATION_PLUGIN_ID],
        disabled: [],
        order: [TELEGRAM_NOTIFICATION_PLUGIN_ID],
        destinations: {
          telegram: { botToken: null, chatId: null },
          webhook: { url: null, headers: {} }
        }
      };
    }

    const now = Date.now();
    const cached = settingsCache.get(normalizedUserId);
    if (cached && cached.expiresAt > now) {
      return {
        enabled: [...cached.value.enabled],
        disabled: [...cached.value.disabled],
        order: [...cached.value.order],
        destinations: {
          telegram: { ...cached.value.destinations.telegram },
          webhook: {
            ...cached.value.destinations.webhook,
            headers: { ...cached.value.destinations.webhook.headers }
          }
        }
      };
    }

    const resolved = deps.resolveNotificationSettingsForUserId
      ? await deps.resolveNotificationSettingsForUserId(normalizedUserId)
      : await Promise.all([
          getNotificationPluginSettingsForUser(normalizedUserId),
          resolveDefaultDestinationConfigForUser(normalizedUserId)
        ]).then(([plugins, destinations]) => ({
          enabled: plugins.enabled,
          disabled: plugins.disabled,
          order: plugins.order,
          destinations
        }));

    const next: UserNotificationSettings = {
      enabled: [...resolved.enabled],
      disabled: [...resolved.disabled],
      order: [...resolved.order],
      destinations: {
        telegram: { ...resolved.destinations.telegram },
        webhook: {
          ...resolved.destinations.webhook,
          headers: { ...resolved.destinations.webhook.headers }
        }
      }
    };
    settingsCache.set(normalizedUserId, {
      value: next,
      expiresAt: now + SETTINGS_CACHE_TTL_MS
    });
    return next;
  }

  function buildCandidatesFromUserSettings(settings: UserNotificationSettings): string[] {
    const enabled = settings.enabled.filter((pluginId) => !settings.disabled.includes(pluginId));
    if (enabled.length === 0) {
      if (settings.disabled.includes(TELEGRAM_NOTIFICATION_PLUGIN_ID)) {
        return [];
      }
      return [TELEGRAM_NOTIFICATION_PLUGIN_ID];
    }

    const ordered: string[] = [];
    for (const id of settings.order) {
      if (!enabled.includes(id) || ordered.includes(id)) continue;
      ordered.push(id);
    }
    for (const id of enabled) {
      if (ordered.includes(id)) continue;
      ordered.push(id);
    }
    return ordered;
  }

  async function auditDelivery(event: ApiNotificationEvent, delivery: {
    providerId: string;
    status: "sent" | "skipped" | "failed" | "policy_blocked" | "timeout";
    reason: string;
    retryable?: boolean;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await writeNotificationDeliveryAudit({
        eventId: event.eventId,
        providerId: delivery.providerId,
        status: delivery.status,
        reason: delivery.reason,
        retryable: delivery.retryable === true,
        latencyMs: Number.isFinite(delivery.latencyMs) ? Math.max(0, Math.trunc(delivery.latencyMs ?? 0)) : 0,
        createdAt: deps.now?.().toISOString() ?? new Date().toISOString(),
        scope: event.scope,
        type: event.type,
        category: event.category,
        source: event.source,
        correlationId: event.correlationId ?? null,
        metadata: delivery.metadata ?? null
      });
    } catch (error) {
      logger.warn("notification delivery audit write failed", {
        eventId: event.eventId,
        providerId: delivery.providerId,
        reason: String(error)
      });
    }
  }

  async function dispatchEvent(
    event: ApiNotificationEvent,
    options: DispatchOptions = {}
  ): Promise<ApiNotificationDispatchResult> {
    registerBuiltins();
    await loadExternalPlugins();

    const now = deps.now?.() ?? new Date();
    const normalizedEvent = ensureNotificationEnvelope(event, now) as ApiNotificationEvent;
    const userId = String(options.userId ?? normalizedEvent.scope.userId ?? "").trim();
    const plan = await resolvePlanForUserId(userId);
    const resolvedCapabilities = await resolveCapabilitiesForPlan({
      plan,
      policySnapshot: options.policySnapshot ?? null,
      now
    });
    const policySnapshot = options.policySnapshot
      ? {
          ...options.policySnapshot,
          capabilitySnapshot:
            options.policySnapshot.capabilitySnapshot ?? resolvedCapabilities.capabilitySnapshot
        }
      : buildPluginPolicySnapshot(plan, resolvedCapabilities.capabilitySnapshot);
    const settings = await resolveUserNotificationSettings(userId);
    const destinationConfig = options.destinationConfig ?? settings.destinations;
    const candidates = options.pluginIds && options.pluginIds.length > 0
      ? normalizePluginIdList(options.pluginIds)
      : buildCandidatesFromUserSettings(settings);
    const deliveries: ApiNotificationDispatchResult["deliveries"] = [];

    const runProvider = async (plugin: ApiNotificationPlugin) => {
      const first = await runNotificationProviderWithIsolation({
        provider: plugin,
        event: normalizedEvent,
        ctx: {
          userId,
          now,
          planTier: plan,
          policySnapshot,
          destinationConfig,
          trace: options.trace,
          botId: normalizedEvent.scope.botId
        },
        state: isolationState,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      });
      if (
        (first.status === "failed" || first.status === "timeout")
        && first.retryable === true
      ) {
        const second = await runNotificationProviderWithIsolation({
          provider: plugin,
          event: normalizedEvent,
          ctx: {
            userId,
            now,
            planTier: plan,
            policySnapshot,
            destinationConfig,
            trace: options.trace,
            botId: normalizedEvent.scope.botId
          },
          state: isolationState,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        });
        return {
          ...second,
          metadata: {
            ...(second.metadata ?? {}),
            retryAttempted: true,
            firstAttemptStatus: first.status,
            firstAttemptReason: first.reason
          }
        };
      }
      return first;
    };

    if (candidates.length === 0) {
      return {
        eventId: normalizedEvent.eventId,
        sent: false,
        providerId: null,
        deliveries
      };
    }

    for (const pluginId of candidates) {
      const plugin = registry.get(pluginId);
      if (!plugin) {
        const missing = {
          status: "skipped" as const,
          providerId: pluginId,
          reason: "provider_not_registered",
          retryable: false,
          latencyMs: 0
        };
        deliveries.push(missing);
        await auditDelivery(normalizedEvent, missing);
        continue;
      }

      if (!isAllowedByPolicy(pluginId, policySnapshot)) {
        const blocked = {
          status: "policy_blocked" as const,
          providerId: pluginId,
          reason: "provider_blocked_by_policy",
          retryable: false,
          latencyMs: 0,
          metadata: {
            plan: policySnapshot.plan
          }
        };
        deliveries.push(blocked);
        await auditDelivery(normalizedEvent, blocked);
        continue;
      }

      const pluginCapability = capabilityForPlugin({
        pluginId,
        kind: plugin.manifest.kind
      });
      if (pluginCapability && resolvedCapabilities.capabilities[pluginCapability] !== true) {
        const blocked = {
          status: "policy_blocked" as const,
          providerId: pluginId,
          reason: "provider_blocked_by_capability",
          retryable: false,
          latencyMs: 0,
          metadata: {
            capability: pluginCapability,
            plan
          }
        };
        deliveries.push(blocked);
        await auditDelivery(normalizedEvent, blocked);
        continue;
      }

      if (!isPlanAtLeast(plan, plugin.manifest.minPlan)) {
        const blocked = {
          status: "policy_blocked" as const,
          providerId: pluginId,
          reason: "provider_blocked_by_min_plan",
          retryable: false,
          latencyMs: 0,
          metadata: {
            minPlan: plugin.manifest.minPlan ?? null,
            plan
          }
        };
        deliveries.push(blocked);
        await auditDelivery(normalizedEvent, blocked);
        continue;
      }

      const result = await runProvider(plugin);

      deliveries.push(result);
      await auditDelivery(normalizedEvent, result);

      if (result.status === "sent") {
        return {
          eventId: normalizedEvent.eventId,
          sent: true,
          providerId: result.providerId,
          deliveries
        };
      }
    }

    return {
      eventId: normalizedEvent.eventId,
      sent: false,
      providerId: null,
      deliveries
    };
  }

  async function dispatchApiEvent<TType extends ApiNotificationType>(
    type: TType,
    payload: ApiNotificationPayloadMap[TType],
    options: DispatchOptions = {}
  ): Promise<ApiNotificationDispatchResult> {
    const userId = String(
      options.userId
      ?? (payload as { userId?: string }).userId
      ?? ""
    ).trim();
    const now = deps.now?.() ?? new Date();
    const event = toApiNotificationEvent({
      type,
      payload,
      userId,
      now,
      trace: options.trace
    });
    return dispatchEvent(event as ApiNotificationEvent, {
      ...options,
      userId
    });
  }

  async function dispatchTradablePredictionNotification(
    payload: ApiNotificationPayloadMap["prediction.tradable"],
    options: DispatchOptions = {}
  ): Promise<void> {
    await dispatchApiEvent("prediction.tradable", payload, options);
  }

  async function dispatchMarketAnalysisUpdateNotification(
    payload: ApiNotificationPayloadMap["prediction.market_analysis_update"],
    options: DispatchOptions = {}
  ): Promise<void> {
    await dispatchApiEvent("prediction.market_analysis_update", payload, options);
  }

  async function dispatchPredictionOutcomeNotification(
    payload: ApiNotificationPayloadMap["prediction.outcome"],
    options: DispatchOptions = {}
  ): Promise<boolean> {
    const result = await dispatchApiEvent("prediction.outcome", payload, options);
    return result.sent;
  }

  async function dispatchManualTradingErrorNotification(
    payload: ApiNotificationPayloadMap["manual_trading.error"],
    options: DispatchOptions = {}
  ): Promise<void> {
    await dispatchApiEvent("manual_trading.error", payload, options);
  }

  return {
    dispatchEvent,
    dispatchTradablePredictionNotification,
    dispatchMarketAnalysisUpdateNotification,
    dispatchPredictionOutcomeNotification,
    dispatchManualTradingErrorNotification
  };
}

const defaultNotificationHost = createApiNotificationHost({
  loadExternalPlugins: loadExternalNotificationPluginsFromEnv
});

export async function dispatchTradablePredictionNotification(
  payload: ApiNotificationPayloadMap["prediction.tradable"],
  options: DispatchOptions = {}
): Promise<void> {
  await defaultNotificationHost.dispatchTradablePredictionNotification(payload, options);
}

export async function dispatchMarketAnalysisUpdateNotification(
  payload: ApiNotificationPayloadMap["prediction.market_analysis_update"],
  options: DispatchOptions = {}
): Promise<void> {
  await defaultNotificationHost.dispatchMarketAnalysisUpdateNotification(payload, options);
}

export async function dispatchPredictionOutcomeNotification(
  payload: ApiNotificationPayloadMap["prediction.outcome"],
  options: DispatchOptions = {}
): Promise<boolean> {
  return defaultNotificationHost.dispatchPredictionOutcomeNotification(payload, options);
}

export async function dispatchManualTradingErrorNotification(
  payload: ApiNotificationPayloadMap["manual_trading.error"],
  options: DispatchOptions = {}
): Promise<void> {
  await defaultNotificationHost.dispatchManualTradingErrorNotification(payload, options);
}
