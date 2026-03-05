import type { PlanTier } from "@mm/plugin-sdk";
import type { TradeIntent } from "@mm/futures-core";
import type { ActiveFuturesBot, RiskEventType } from "../db.js";
import { readBotPluginConfig } from "./config.js";
import { getRunnerPluginRegistry } from "./registry.js";
import type { RunnerExchangeExtensionPlugin, RunnerPlugin } from "./types.js";

type ExchangeExtensionDiagnostic = {
  type: RiskEventType;
  message: string;
  meta: Record<string, unknown>;
};

type ApplyExchangeExtensionsParams = {
  bot: ActiveFuturesBot;
  intent: TradeIntent;
  now: Date;
};

function planRank(plan: PlanTier): number {
  if (plan === "enterprise") return 3;
  if (plan === "pro") return 2;
  return 1;
}

function isAllowedByMinPlan(minPlan: PlanTier | undefined, effectivePlan: PlanTier): boolean {
  if (!minPlan) return true;
  return planRank(effectivePlan) >= planRank(minPlan);
}

function toPlanTier(value: unknown): PlanTier {
  if (value === "free" || value === "pro" || value === "enterprise") return value;
  return "pro";
}

function getEffectivePlan(bot: ActiveFuturesBot): PlanTier {
  const params = bot.paramsJson;
  if (!params || typeof params !== "object" || Array.isArray(params)) return "pro";
  const row = params as Record<string, unknown>;
  const plugins = row.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return "pro";
  const policy = (plugins as Record<string, unknown>).policySnapshot;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return "pro";
  return toPlanTier((policy as Record<string, unknown>).plan);
}

function collectOrderedPluginIds(enabled: string[], order: string[]): string[] {
  const out: string[] = [];
  for (const id of order) {
    if (!enabled.includes(id) || out.includes(id)) continue;
    out.push(id);
  }
  for (const id of enabled) {
    if (out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function isExchangeExtensionPlugin(plugin: RunnerPlugin | null): plugin is RunnerExchangeExtensionPlugin {
  return Boolean(plugin && plugin.manifest.kind === "exchange_extension");
}

export async function applyExchangeExtensionsForIntent(
  params: ApplyExchangeExtensionsParams
): Promise<{
  intent: TradeIntent;
  appliedPluginIds: string[];
  diagnostics: ExchangeExtensionDiagnostic[];
}> {
  const config = readBotPluginConfig(params.bot);
  const orderedIds = collectOrderedPluginIds(config.enabled, config.order);
  const diagnostics: ExchangeExtensionDiagnostic[] = [];
  const appliedPluginIds: string[] = [];

  if (orderedIds.length === 0) {
    return {
      intent: params.intent,
      appliedPluginIds,
      diagnostics
    };
  }

  const allowedPluginIds = config.policySnapshot?.allowedPluginIds ?? null;
  const effectivePlan = getEffectivePlan(params.bot);
  let intent = params.intent;

  for (const pluginId of orderedIds) {
    if (config.disabled.includes(pluginId)) continue;
    if (allowedPluginIds && !allowedPluginIds.includes(pluginId)) {
      diagnostics.push({
        type: "PLUGIN_DISABLED_BY_POLICY",
        message: "exchange extension disabled by policy snapshot",
        meta: {
          pluginId,
          plan: config.policySnapshot?.plan ?? effectivePlan
        }
      });
      continue;
    }

    const plugin = getRunnerPluginRegistry().get(pluginId);
    if (!isExchangeExtensionPlugin(plugin)) continue;

    if (!isAllowedByMinPlan(plugin.manifest.minPlan, effectivePlan)) {
      diagnostics.push({
        type: "PLUGIN_DISABLED_BY_POLICY",
        message: "exchange extension disabled by min plan",
        meta: {
          pluginId,
          minPlan: plugin.manifest.minPlan ?? null,
          effectivePlan
        }
      });
      continue;
    }

    try {
      const result = await plugin.apply({
        exchange: params.bot.exchange,
        symbol: params.bot.symbol,
        payload: {
          intent
        }
      }, {
        botId: params.bot.id,
        now: params.now
      });
      const payload = result?.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const maybeIntent = (payload as Record<string, unknown>).intent;
        if (maybeIntent && typeof maybeIntent === "object" && !Array.isArray(maybeIntent)) {
          intent = maybeIntent as TradeIntent;
          appliedPluginIds.push(pluginId);
        }
      }
    } catch (error) {
      diagnostics.push({
        type: "PLUGIN_RUNTIME_ERROR",
        message: String(error),
        meta: {
          pluginId,
          stage: "exchange_extension"
        }
      });
    }
  }

  return {
    intent,
    appliedPluginIds,
    diagnostics
  };
}
