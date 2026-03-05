import type { BotPluginPolicySnapshot, PlanTier } from "@mm/plugin-sdk";
import { prisma } from "@mm/db";
import { logger } from "../logger.js";
import { resolveStrategyEntitlementsForWorkspace } from "../license.js";
import { getNotificationPluginSettingsForUser } from "./notificationSettings.js";
import { buildPluginPolicySnapshot } from "./policy.js";
import {
  TELEGRAM_NOTIFICATION_PLUGIN_ID,
  telegramNotificationPlugin
} from "./notifications/telegramNotificationPlugin.js";
import {
  getApiNotificationPluginRegistry,
  type ApiNotificationPluginRegistry
} from "./notifications/registry.js";
import type {
  ApiNotificationDispatchResult,
  ApiNotificationEvent,
  ApiNotificationPlugin
} from "./notifications/types.js";

type HostDependencies = {
  registry?: ApiNotificationPluginRegistry;
  resolvePlanForUserId?: (userId: string) => Promise<PlanTier>;
  resolveNotificationSettingsForUserId?: (userId: string) => Promise<{
    enabled: string[];
    disabled: string[];
    order: string[];
  }>;
  loadExternalPlugins?: () => Promise<ApiNotificationPlugin[]>;
  now?: () => Date;
};

type DispatchOptions = {
  pluginIds?: string[];
  timeoutMs?: number;
  policySnapshot?: BotPluginPolicySnapshot;
  userId?: string;
};

const db = prisma as any;
const DEFAULT_TIMEOUT_MS = 8_000;
const PLAN_CACHE_TTL_MS = 60_000;
const SETTINGS_CACHE_TTL_MS = 30_000;
const DEFAULT_NOTIFICATION_PLUGIN_ALLOWLIST = "@mm/";

function normalizePlanTier(value: unknown): PlanTier {
  if (value === "free" || value === "pro" || value === "enterprise") return value;
  return "pro";
}

function planRank(plan: PlanTier): number {
  if (plan === "enterprise") return 3;
  if (plan === "pro") return 2;
  return 1;
}

function isAllowedByMinPlan(minPlan: PlanTier | undefined, effectivePlan: PlanTier): boolean {
  if (!minPlan) return true;
  return planRank(effectivePlan) >= planRank(minPlan);
}

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

async function withTimeout<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.max(300, Math.trunc(timeoutMs)) : DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`notification_plugin_timeout_after_${ms}ms`));
      }, ms);
    });
    return await Promise.race([run(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

export function createApiNotificationHost(deps: HostDependencies = {}) {
  const registry = deps.registry ?? getApiNotificationPluginRegistry();
  const planCache = new Map<string, { expiresAt: number; plan: PlanTier }>();
  const settingsCache = new Map<string, { expiresAt: number; enabled: string[]; disabled: string[]; order: string[] }>();
  let builtinsRegistered = false;
  let externalLoaded = false;

  function registerBuiltins() {
    if (builtinsRegistered) return;
    if (!registry.has(telegramNotificationPlugin.manifest.id)) {
      registry.register(telegramNotificationPlugin);
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

  async function resolveUserNotificationPluginSettings(userId: string): Promise<{
    enabled: string[];
    disabled: string[];
    order: string[];
  }> {
    const normalizedUserId = String(userId ?? "").trim();
    if (!normalizedUserId) {
      return {
        enabled: [TELEGRAM_NOTIFICATION_PLUGIN_ID],
        disabled: [],
        order: [TELEGRAM_NOTIFICATION_PLUGIN_ID]
      };
    }

    const now = Date.now();
    const cached = settingsCache.get(normalizedUserId);
    if (cached && cached.expiresAt > now) {
      return {
        enabled: [...cached.enabled],
        disabled: [...cached.disabled],
        order: [...cached.order]
      };
    }

    const settings = deps.resolveNotificationSettingsForUserId
      ? await deps.resolveNotificationSettingsForUserId(normalizedUserId)
      : await getNotificationPluginSettingsForUser(normalizedUserId);
    const next = {
      enabled: [...settings.enabled],
      disabled: [...settings.disabled],
      order: [...settings.order]
    };
    settingsCache.set(normalizedUserId, {
      ...next,
      expiresAt: now + SETTINGS_CACHE_TTL_MS
    });
    return next;
  }

  function buildCandidatesFromUserSettings(settings: {
    enabled: string[];
    disabled: string[];
    order: string[];
  }): string[] {
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

  async function dispatchEvent(
    event: ApiNotificationEvent,
    options: DispatchOptions = {}
  ): Promise<ApiNotificationDispatchResult> {
    registerBuiltins();
    await loadExternalPlugins();

    const userId = String(options.userId ?? (event.payload as { userId?: unknown }).userId ?? "").trim();
    const plan = await resolvePlanForUserId(userId);
    const policySnapshot = options.policySnapshot ?? buildPluginPolicySnapshot(plan);
    const candidates = options.pluginIds && options.pluginIds.length > 0
      ? normalizePluginIdList(options.pluginIds)
      : buildCandidatesFromUserSettings(await resolveUserNotificationPluginSettings(userId));

    for (const pluginId of candidates) {
      const plugin = registry.get(pluginId);
      if (!plugin) {
        logger.warn("notification plugin not registered", {
          pluginId,
          eventType: event.type
        });
        continue;
      }

      if (!isAllowedByPolicy(pluginId, policySnapshot)) {
        logger.info("notification plugin disabled by policy", {
          pluginId,
          eventType: event.type,
          plan: policySnapshot.plan
        });
        continue;
      }

      if (!isAllowedByMinPlan(plugin.manifest.minPlan, plan)) {
        logger.info("notification plugin skipped by min plan", {
          pluginId,
          eventType: event.type,
          minPlan: plugin.manifest.minPlan ?? null,
          plan
        });
        continue;
      }

      try {
        const result = await withTimeout(
          () => plugin.notify(event, {
            userId,
            plan,
            now: deps.now?.() ?? new Date()
          }),
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        );
        if (result.handled && result.success) {
          return result;
        }
      } catch (error) {
        logger.warn("notification plugin runtime failed", {
          pluginId,
          eventType: event.type,
          reason: String(error)
        });
      }
    }

    return {
      handled: false,
      success: false,
      pluginId: "none",
      outcomeSent: false
    };
  }

  async function dispatchTradablePredictionNotification(
    payload: Extract<ApiNotificationEvent, { type: "prediction_tradable" }>[
      "payload"
    ],
    options: DispatchOptions = {}
  ): Promise<void> {
    await dispatchEvent({ type: "prediction_tradable", payload }, {
      ...options,
      userId: payload.userId
    });
  }

  async function dispatchMarketAnalysisUpdateNotification(
    payload: Extract<ApiNotificationEvent, { type: "market_analysis_update" }>[
      "payload"
    ],
    options: DispatchOptions = {}
  ): Promise<void> {
    await dispatchEvent({ type: "market_analysis_update", payload }, {
      ...options,
      userId: payload.userId
    });
  }

  async function dispatchPredictionOutcomeNotification(
    payload: Extract<ApiNotificationEvent, { type: "prediction_outcome" }>[
      "payload"
    ],
    options: DispatchOptions = {}
  ): Promise<boolean> {
    const result = await dispatchEvent({ type: "prediction_outcome", payload }, {
      ...options,
      userId: payload.userId
    });
    return result.outcomeSent === true;
  }

  return {
    dispatchEvent,
    dispatchTradablePredictionNotification,
    dispatchMarketAnalysisUpdateNotification,
    dispatchPredictionOutcomeNotification
  };
}

const defaultNotificationHost = createApiNotificationHost({
  loadExternalPlugins: loadExternalNotificationPluginsFromEnv
});

export async function dispatchTradablePredictionNotification(
  payload: Extract<ApiNotificationEvent, { type: "prediction_tradable" }>["payload"],
  options: DispatchOptions = {}
): Promise<void> {
  await defaultNotificationHost.dispatchTradablePredictionNotification(payload, options);
}

export async function dispatchMarketAnalysisUpdateNotification(
  payload: Extract<ApiNotificationEvent, { type: "market_analysis_update" }>["payload"],
  options: DispatchOptions = {}
): Promise<void> {
  await defaultNotificationHost.dispatchMarketAnalysisUpdateNotification(payload, options);
}

export async function dispatchPredictionOutcomeNotification(
  payload: Extract<ApiNotificationEvent, { type: "prediction_outcome" }>["payload"],
  options: DispatchOptions = {}
): Promise<boolean> {
  return defaultNotificationHost.dispatchPredictionOutcomeNotification(payload, options);
}
