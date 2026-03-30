import {
  createNotificationIsolationState,
  ensureNotificationEnvelope,
  runNotificationProviderWithIsolation
} from "@mm/plugin-sdk";
import { prisma } from "@mm/db";
import type { ActiveFuturesBot, RiskEventType } from "../db.js";
import { log } from "../logger.js";
import {
  isAllowedByMinPlan,
  isAllowedByPolicySnapshot,
  isPluginCapabilityAllowed,
  readRunnerCapabilityPolicy
} from "../capabilities/guard.js";
import { registerBuiltinRunnerPlugins } from "../plugins/loader.js";
import { getRunnerPluginRegistry } from "../plugins/registry.js";
import type { RunnerNotificationPlugin } from "../plugins/types.js";
import {
  NOTIFICATION_PLUGIN_ID_TELEGRAM
} from "../plugins/builtin/notificationPlugins.js";
import { writeRunnerNotificationDeliveryAudit } from "./deliveryAudit.js";

const db = prisma as any;
const NOTIFICATION_PLUGIN_SETTINGS_KEY_PREFIX = "settings.alerts.notificationPlugins.v1:";
const NOTIFICATION_DESTINATIONS_SETTINGS_KEY_PREFIX = "settings.alerts.notificationDestinations.v1:";
const SETTINGS_CACHE_TTL_MS = 30_000;
const isolationState = createNotificationIsolationState();

type RunnerNotificationSettings = {
  enabled: string[];
  disabled: string[];
  order: string[];
  destinations: {
    telegram: {
      botToken: string | null;
      chatId: string | null;
    };
    webhook: {
      url: string | null;
      headers: Record<string, string>;
    };
  };
};

const settingsCache = new Map<string, { expiresAt: number; value: RunnerNotificationSettings }>();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeStringList(value: unknown, limit = 100): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeHeaders(value: unknown): Record<string, string> {
  const row = asRecord(value);
  if (!row) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(row)) {
    const header = String(key ?? "").trim();
    const val = String(raw ?? "").trim();
    if (!header || !val) continue;
    out[header] = val;
    if (Object.keys(out).length >= 20) break;
  }
  return out;
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parsePluginSettings(value: unknown): {
  enabled: string[];
  disabled: string[];
  order: string[];
} {
  const row = asRecord(value);
  if (!row) {
    return {
      enabled: [NOTIFICATION_PLUGIN_ID_TELEGRAM],
      disabled: [],
      order: [NOTIFICATION_PLUGIN_ID_TELEGRAM]
    };
  }
  const enabled = normalizeStringList(row.enabled);
  const disabled = normalizeStringList(row.disabled);
  const effectiveEnabled = enabled.filter((id) => !disabled.includes(id));
  const order = normalizeStringList(row.order).filter((id) => effectiveEnabled.includes(id));
  for (const id of effectiveEnabled) {
    if (order.includes(id)) continue;
    order.push(id);
  }
  return {
    enabled: effectiveEnabled,
    disabled,
    order
  };
}

function parseDestinationSettings(value: unknown): RunnerNotificationSettings["destinations"] {
  const row = asRecord(value);
  const webhook = asRecord(row?.webhook);
  return {
    telegram: {
      botToken: null,
      chatId: null
    },
    webhook: {
      url: normalizeUrl(webhook?.url) ?? normalizeUrl(process.env.NOTIFICATION_WEBHOOK_URL) ?? null,
      headers: normalizeHeaders(webhook?.headers)
    }
  };
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function notificationPluginSettingsKey(userId: string): string {
  return `${NOTIFICATION_PLUGIN_SETTINGS_KEY_PREFIX}${userId}`;
}

function notificationDestinationSettingsKey(userId: string): string {
  return `${NOTIFICATION_DESTINATIONS_SETTINGS_KEY_PREFIX}${userId}`;
}

async function resolveNotificationSettingsForUser(bot: ActiveFuturesBot): Promise<RunnerNotificationSettings> {
  const cached = settingsCache.get(bot.userId);
  const nowMs = Date.now();
  if (cached && cached.expiresAt > nowMs) {
    return cached.value;
  }

  const [pluginsRow, destinationsRow, alertConfig, userConfig] = await Promise.all([
    db.globalSetting.findUnique({
      where: { key: notificationPluginSettingsKey(bot.userId) },
      select: { value: true }
    }),
    db.globalSetting.findUnique({
      where: { key: notificationDestinationSettingsKey(bot.userId) },
      select: { value: true }
    }),
    db.alertConfig.findUnique({
      where: { key: "default" },
      select: {
        telegramBotToken: true,
        telegramChatId: true
      }
    }),
    db.user.findUnique({
      where: { id: bot.userId },
      select: {
        telegramChatId: true
      }
    })
  ]);

  const pluginSettings = parsePluginSettings(pluginsRow?.value);
  const destinations = parseDestinationSettings(destinationsRow?.value);
  const envToken = toStringOrNull(process.env.TELEGRAM_BOT_TOKEN);
  const envChatId = toStringOrNull(process.env.TELEGRAM_CHAT_ID);
  const envOverride = Boolean(envToken && envChatId);

  destinations.telegram.botToken = envOverride
    ? envToken
    : toStringOrNull(alertConfig?.telegramBotToken);
  destinations.telegram.chatId = toStringOrNull(userConfig?.telegramChatId)
    ?? (envOverride ? envChatId : toStringOrNull(alertConfig?.telegramChatId));

  const next: RunnerNotificationSettings = {
    enabled: pluginSettings.enabled,
    disabled: pluginSettings.disabled,
    order: pluginSettings.order,
    destinations
  };

  settingsCache.set(bot.userId, {
    expiresAt: nowMs + SETTINGS_CACHE_TTL_MS,
    value: next
  });

  return next;
}

function mapRiskEventToEnvelope(params: {
  bot: ActiveFuturesBot;
  type: RiskEventType;
  message: string;
  meta: Record<string, unknown>;
  now: Date;
}) {
  const status = String(params.meta.status ?? "").trim().toLowerCase();
  const blocked = status === "blocked" || String(params.meta.reason ?? "").includes("block");

  let category: "trade" | "error" | "risk" | "lock" | "warning" = "warning";
  let severity: "info" | "warn" | "error" | "critical" = "info";
  let eventType: string = `runner.${params.type.toLowerCase()}`;
  let title: string = params.type;

  if (params.type === "EXECUTION_DECISION" && !blocked && status === "executed") {
    category = "trade";
    severity = "info";
    eventType = "trade.executed";
    title = "Trade execution decision";
  } else if (params.type === "EXECUTION_DECISION" && blocked) {
    category = "risk";
    severity = "warn";
    eventType = "risk.guard_block";
    title = "Execution blocked";
  } else if (params.type === "SIGNAL_DECISION") {
    const signalBlocked = params.meta.blockedBySignal === true;
    category = signalBlocked ? "risk" : "warning";
    severity = signalBlocked ? "warn" : "info";
    eventType = signalBlocked ? "risk.signal_blocked" : "signal.decision";
    title = signalBlocked ? "Signal blocked" : "Signal decision";
  } else if (
    params.type === "CIRCUIT_BREAKER_TRIPPED"
    || params.type === "KILL_SWITCH_BLOCK"
  ) {
    category = "lock";
    severity = "critical";
    eventType = "lock.trading_guard";
    title = "Trading lock event";
  } else if (
    params.type === "BOT_ERROR"
    || params.type === "PLUGIN_RUNTIME_ERROR"
    || params.type === "PLUGIN_LOAD_ERROR"
  ) {
    category = "error";
    severity = "error";
    eventType = "error.runtime";
    title = "Runner runtime error";
  } else if (params.type === "PLUGIN_DISABLED_BY_POLICY" || params.type === "PLUGIN_FALLBACK_USED") {
    category = "warning";
    severity = "warn";
    eventType = "warning.plugin_policy";
    title = "Plugin policy/fallback event";
  } else if (
    params.type === "PREDICTION_GATE_BLOCK"
    || params.type === "PREDICTION_GATE_FAIL_OPEN"
    || params.type === "EXECUTION_GUARD_BLOCK"
  ) {
    category = "risk";
    severity = "warn";
    eventType = "risk.guard_event";
    title = "Risk guard event";
  }

  return ensureNotificationEnvelope({
    source: "runner",
    category,
    type: eventType,
    severity,
    title,
    message: params.message || undefined,
    payload: {
      riskEventType: params.type,
      ...params.meta
    },
    scope: {
      userId: params.bot.userId,
      botId: params.bot.id,
      exchange: params.bot.exchange,
      symbol: params.bot.symbol
    },
    tags: [params.type.toLowerCase()]
  }, params.now);
}

function shouldSuppressTelegramRiskEvent(params: {
  bot: ActiveFuturesBot;
  type: RiskEventType;
  message: string;
}): boolean {
  const normalizedMessage = String(params.message ?? "").trim();
  if (params.type === "PLUGIN_DISABLED_BY_POLICY") return true;
  if (params.type === "PLUGIN_FALLBACK_USED") return true;
  if (params.bot.exchange === "paper" && params.type === "EXECUTION_DECISION" && normalizedMessage === "noop") return true;
  if (params.bot.exchange === "paper" && params.type === "SIGNAL_DECISION" && normalizedMessage === "signal_ready") return true;
  if (params.bot.strategyKey !== "futures_grid") return false;
  if (params.type === "EXECUTION_DECISION" && normalizedMessage === "noop") return true;
  if (params.type === "EXECUTION_DECISION" && normalizedMessage === "grid_no_order_changes") return true;
  if (params.type === "EXECUTION_DECISION" && normalizedMessage === "grid_plan_executed") return true;
  if (params.type === "EXECUTION_DECISION" && normalizedMessage === "grid_missing_mark_price") return true;
  if (params.type === "EXECUTION_DECISION" && normalizedMessage === "grid_initial_seed_confirmation_pending") return true;
  if (params.type === "EXECUTION_DECISION" && normalizedMessage === "grid_initial_core_spot_funding_pending") return true;
  if (params.type === "EXECUTION_DECISION" && normalizedMessage === "grid_initial_perp_funding_pending") return true;
  if (params.type === "EXECUTION_DECISION" && normalizedMessage.startsWith("grid_initial_seed_failed:")) return true;
  if (params.type === "GRID_PLAN_APPLIED" && normalizedMessage === "grid_window_no_change") return true;
  if (params.type === "GRID_PLAN_BLOCKED" && normalizedMessage === "grid initial seed failed") return true;
  if (params.type === "GRID_PLAN_BLOCKED" && normalizedMessage === "grid_initial_seed_confirmation_pending") return true;
  if (params.type === "SIGNAL_DECISION" && normalizedMessage === "signal_ready") return true;
  return false;
}

export async function publishRunnerRiskEventNotification(params: {
  bot: ActiveFuturesBot;
  type: RiskEventType;
  message: string;
  meta: Record<string, unknown>;
  workerId?: string | null;
}): Promise<void> {
  try {
    registerBuiltinRunnerPlugins();
    const settings = await resolveNotificationSettingsForUser(params.bot);
    const policy = readRunnerCapabilityPolicy(params.bot);
    const now = new Date();
    const event = mapRiskEventToEnvelope({
      bot: params.bot,
      type: params.type,
      message: params.message,
      meta: params.meta,
      now
    });
    const runProvider = async (provider: RunnerNotificationPlugin) => {
      const first = await runNotificationProviderWithIsolation({
        provider,
        event,
        ctx: {
          now,
          userId: params.bot.userId,
          botId: params.bot.id,
          planTier: policy.plan,
          destinationConfig: settings.destinations,
          trace: {
            workerId: params.workerId ?? undefined
          }
        },
        state: isolationState
      });
      if (
        (first.status === "failed" || first.status === "timeout")
        && first.retryable === true
      ) {
        const second = await runNotificationProviderWithIsolation({
          provider,
          event,
          ctx: {
            now,
            userId: params.bot.userId,
            botId: params.bot.id,
            planTier: policy.plan,
            destinationConfig: settings.destinations,
            trace: {
              workerId: params.workerId ?? undefined
            }
          },
          state: isolationState
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

    const enabled = settings.enabled.filter((id) => !settings.disabled.includes(id));
    const candidates: string[] = [];
    for (const id of settings.order) {
      if (!enabled.includes(id) || candidates.includes(id)) continue;
      candidates.push(id);
    }
    for (const id of enabled) {
      if (candidates.includes(id)) continue;
      candidates.push(id);
    }
    if (candidates.length === 0 && !settings.disabled.includes(NOTIFICATION_PLUGIN_ID_TELEGRAM)) {
      candidates.push(NOTIFICATION_PLUGIN_ID_TELEGRAM);
    }

    const registry = getRunnerPluginRegistry();
    for (const candidateId of candidates) {
      const item = registry.get(candidateId);
      if (!item || item.manifest.kind !== "notification") continue;
      const provider = item as RunnerNotificationPlugin;

      if (
        provider.manifest.id === NOTIFICATION_PLUGIN_ID_TELEGRAM
        && shouldSuppressTelegramRiskEvent({
          bot: params.bot,
          type: params.type,
          message: params.message
        })
      ) {
        await writeRunnerNotificationDeliveryAudit({
          eventId: event.eventId,
          providerId: provider.manifest.id,
          status: "skipped",
          reason: "suppressed_grid_noise_event",
          retryable: false,
          latencyMs: 0,
          createdAt: now.toISOString(),
          scope: event.scope,
          type: event.type,
          category: event.category,
          source: event.source,
          correlationId: event.correlationId ?? null
        });
        continue;
      }

      if (!isAllowedByPolicySnapshot(provider.manifest.id, policy.allowedPluginIds)) {
        await writeRunnerNotificationDeliveryAudit({
          eventId: event.eventId,
          providerId: provider.manifest.id,
          status: "policy_blocked",
          reason: "provider_blocked_by_policy",
          retryable: false,
          latencyMs: 0,
          createdAt: now.toISOString(),
          scope: event.scope,
          type: event.type,
          category: event.category,
          source: event.source,
          correlationId: event.correlationId ?? null
        });
        continue;
      }

      const capabilityCheck = isPluginCapabilityAllowed({
        pluginId: provider.manifest.id,
        kind: provider.manifest.kind,
        capabilities: policy.capabilities
      });
      if (!capabilityCheck.allowed) {
        await writeRunnerNotificationDeliveryAudit({
          eventId: event.eventId,
          providerId: provider.manifest.id,
          status: "policy_blocked",
          reason: "provider_blocked_by_capability",
          retryable: false,
          latencyMs: 0,
          createdAt: now.toISOString(),
          scope: event.scope,
          type: event.type,
          category: event.category,
          source: event.source,
          correlationId: event.correlationId ?? null,
          metadata: {
            capability: capabilityCheck.capability,
            plan: policy.plan
          }
        });
        continue;
      }

      if (!isAllowedByMinPlan(provider.manifest.minPlan, policy.plan)) {
        await writeRunnerNotificationDeliveryAudit({
          eventId: event.eventId,
          providerId: provider.manifest.id,
          status: "policy_blocked",
          reason: "provider_blocked_by_min_plan",
          retryable: false,
          latencyMs: 0,
          createdAt: now.toISOString(),
          scope: event.scope,
          type: event.type,
          category: event.category,
          source: event.source,
          correlationId: event.correlationId ?? null
        });
        continue;
      }

      const result = await runProvider(provider);

      await writeRunnerNotificationDeliveryAudit({
        eventId: event.eventId,
        providerId: result.providerId,
        status: result.status,
        reason: result.reason,
        retryable: result.retryable === true,
        latencyMs: result.latencyMs,
        createdAt: now.toISOString(),
        scope: event.scope,
        type: event.type,
        category: event.category,
        source: event.source,
        correlationId: event.correlationId ?? null,
        metadata: result.metadata ?? null
      });

      if (result.status === "sent") {
        return;
      }
    }
  } catch (error) {
    log.warn(
      {
        botId: params.bot.id,
        userId: params.bot.userId,
        eventType: params.type,
        err: String(error)
      },
      "runner notification publish failed"
    );
  }
}
