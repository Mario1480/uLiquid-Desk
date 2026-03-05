import type { PlanTier } from "@mm/plugin-sdk";
import type { ActiveFuturesBot } from "../db.js";
import { readExplicitExecutionModeFromBot, readExecutionSettings } from "../execution/config.js";
import { log } from "../logger.js";
import { drainRunnerPluginLoadDiagnostics, registerBuiltinRunnerPlugins } from "./loader.js";
import {
  EXECUTION_PLUGIN_ID_DCA,
  EXECUTION_PLUGIN_ID_DIP_REVERSION,
  EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY,
  EXECUTION_PLUGIN_ID_GRID,
  EXECUTION_PLUGIN_ID_PREDICTION_COPIER,
  EXECUTION_PLUGIN_ID_SIMPLE
} from "./builtin/executionPlugins.js";
import {
  SIGNAL_PLUGIN_ID_LEGACY_DUMMY,
  SIGNAL_PLUGIN_ID_PREDICTION_COPIER
} from "./builtin/signalPlugins.js";
import {
  SIGNAL_SOURCE_PLUGIN_ID_NONE,
  SIGNAL_SOURCE_PLUGIN_ID_PREDICTION_STATE
} from "./builtin/signalSourcePlugins.js";
import { readBotPluginConfig } from "./config.js";
import { getRunnerPluginRegistry } from "./registry.js";
import type {
  PluginResolutionDiagnostic,
  ResolvedRunnerPluginSelection,
  RunnerExecutionPlugin,
  RunnerSignalPlugin,
  RunnerSignalSourcePlugin
} from "./types.js";

function planRank(plan: PlanTier): number {
  if (plan === "enterprise") return 3;
  if (plan === "pro") return 2;
  return 1;
}

function isAllowedByMinPlan(minPlan: PlanTier | undefined, effectivePlan: PlanTier): boolean {
  if (!minPlan) return true;
  return planRank(effectivePlan) >= planRank(minPlan);
}

function asSignalPlugin(id: string): RunnerSignalPlugin | null {
  const item = getRunnerPluginRegistry().get(id);
  if (!item || item.manifest.kind !== "signal") return null;
  return item as RunnerSignalPlugin;
}

function asExecutionPlugin(id: string): RunnerExecutionPlugin | null {
  const item = getRunnerPluginRegistry().get(id);
  if (!item || item.manifest.kind !== "execution") return null;
  return item as RunnerExecutionPlugin;
}

function asSignalSourcePlugin(id: string): RunnerSignalSourcePlugin | null {
  const item = getRunnerPluginRegistry().get(id);
  if (!item || item.manifest.kind !== "signal_source") return null;
  return item as RunnerSignalSourcePlugin;
}

function defaultSignalPluginIdForBot(bot: ActiveFuturesBot): string {
  return bot.strategyKey === "prediction_copier"
    ? SIGNAL_PLUGIN_ID_PREDICTION_COPIER
    : SIGNAL_PLUGIN_ID_LEGACY_DUMMY;
}

function defaultExecutionPluginIdForBot(bot: ActiveFuturesBot): string {
  if (bot.strategyKey === "prediction_copier") {
    return EXECUTION_PLUGIN_ID_PREDICTION_COPIER;
  }

  const mode = readExecutionSettings(bot).mode;
  if (mode === "dca") return EXECUTION_PLUGIN_ID_DCA;
  if (mode === "grid") return EXECUTION_PLUGIN_ID_GRID;
  if (mode === "dip_reversion") return EXECUTION_PLUGIN_ID_DIP_REVERSION;
  return EXECUTION_PLUGIN_ID_SIMPLE;
}

function requestedExecutionPluginIdForBot(bot: ActiveFuturesBot): string | null {
  if (bot.strategyKey === "prediction_copier") return null;
  const explicitMode = readExplicitExecutionModeFromBot(bot);
  if (!explicitMode) return null;
  if (explicitMode === "dca") return EXECUTION_PLUGIN_ID_DCA;
  if (explicitMode === "grid") return EXECUTION_PLUGIN_ID_GRID;
  if (explicitMode === "dip_reversion") return EXECUTION_PLUGIN_ID_DIP_REVERSION;
  return EXECUTION_PLUGIN_ID_SIMPLE;
}

function defaultSignalSourcePluginIdForBot(bot: ActiveFuturesBot): string {
  return bot.strategyKey === "prediction_copier"
    ? SIGNAL_SOURCE_PLUGIN_ID_PREDICTION_STATE
    : SIGNAL_SOURCE_PLUGIN_ID_NONE;
}

function toPlanTier(value: unknown): PlanTier {
  if (value === "free" || value === "pro" || value === "enterprise") return value;
  return "pro";
}

function collectOrderedCandidates(enabled: string[], order: string[]): string[] {
  if (enabled.length === 0) return [];
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

function isAllowedByPolicy(pluginId: string, allowedPluginIds: string[] | null): boolean {
  if (!allowedPluginIds) return true;
  return allowedPluginIds.includes(pluginId);
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

function pickSignalPlugin(params: {
  bot: ActiveFuturesBot;
  diagnostics: PluginResolutionDiagnostic[];
}): { selectedPluginId: string; fallbackPluginId: string; plugin: RunnerSignalPlugin; fallbackPlugin: RunnerSignalPlugin } {
  const config = readBotPluginConfig(params.bot);
  const defaultId = defaultSignalPluginIdForBot(params.bot);
  const fallbackId = SIGNAL_PLUGIN_ID_LEGACY_DUMMY;
  const effectivePlan = getEffectivePlan(params.bot);
  const allowedPluginIds = config.policySnapshot?.allowedPluginIds ?? null;

  const candidates = collectOrderedCandidates(config.enabled, config.order);
  let selectedId = defaultId;
  for (const candidate of candidates) {
    const plugin = asSignalPlugin(candidate);
    if (!plugin) continue;
    selectedId = candidate;
    break;
  }

  if (config.disabled.includes(selectedId)) {
    params.diagnostics.push({
      type: "PLUGIN_FALLBACK_USED",
      message: "signal plugin disabled in bot config",
      meta: {
        pluginId: selectedId,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const selectedPlugin = asSignalPlugin(selectedId);
  if (!selectedPlugin) {
    params.diagnostics.push({
      type: "PLUGIN_LOAD_ERROR",
      message: "signal plugin is not registered",
      meta: {
        pluginId: selectedId,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const selectedResolved = asSignalPlugin(selectedId) ?? asSignalPlugin(fallbackId);
  const fallbackResolved = asSignalPlugin(fallbackId);
  if (!selectedResolved || !fallbackResolved) {
    throw new Error("runner_signal_plugins_missing");
  }

  if (!isAllowedByPolicy(selectedId, allowedPluginIds)) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: "signal plugin disabled by policy snapshot",
      meta: {
        pluginId: selectedId,
        plan: config.policySnapshot?.plan ?? effectivePlan,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const finalSelected = asSignalPlugin(selectedId) ?? fallbackResolved;

  if (!isAllowedByMinPlan(finalSelected.manifest.minPlan, effectivePlan)) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: "signal plugin disabled by min plan",
      meta: {
        pluginId: finalSelected.manifest.id,
        minPlan: finalSelected.manifest.minPlan ?? null,
        effectivePlan,
        fallbackPluginId: fallbackId
      }
    });
    return {
      selectedPluginId: fallbackResolved.manifest.id,
      fallbackPluginId: fallbackResolved.manifest.id,
      plugin: fallbackResolved,
      fallbackPlugin: fallbackResolved
    };
  }

  return {
    selectedPluginId: finalSelected.manifest.id,
    fallbackPluginId: fallbackResolved.manifest.id,
    plugin: finalSelected,
    fallbackPlugin: fallbackResolved
  };
}

function pickExecutionPlugin(params: {
  bot: ActiveFuturesBot;
  diagnostics: PluginResolutionDiagnostic[];
}): { selectedPluginId: string; fallbackPluginId: string; plugin: RunnerExecutionPlugin; fallbackPlugin: RunnerExecutionPlugin } {
  const config = readBotPluginConfig(params.bot);
  const defaultId = defaultExecutionPluginIdForBot(params.bot);
  const requestedByMode = requestedExecutionPluginIdForBot(params.bot);
  const fallbackId = EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY;
  const effectivePlan = getEffectivePlan(params.bot);
  const allowedPluginIds = config.policySnapshot?.allowedPluginIds ?? null;

  const candidates = collectOrderedCandidates(config.enabled, config.order);
  let selectedId = requestedByMode ?? defaultId;

  if (!requestedByMode) {
    for (const candidate of candidates) {
      const plugin = asExecutionPlugin(candidate);
      if (!plugin) continue;
      selectedId = candidate;
      break;
    }
  }

  if (config.disabled.includes(selectedId)) {
    params.diagnostics.push({
      type: "PLUGIN_FALLBACK_USED",
      message: "execution plugin disabled in bot config",
      meta: {
        pluginId: selectedId,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const selectedPlugin = asExecutionPlugin(selectedId);
  if (!selectedPlugin) {
    params.diagnostics.push({
      type: "PLUGIN_LOAD_ERROR",
      message: "execution plugin is not registered",
      meta: {
        pluginId: selectedId,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const selectedResolved = asExecutionPlugin(selectedId) ?? asExecutionPlugin(fallbackId);
  const fallbackResolved = asExecutionPlugin(fallbackId);
  if (!selectedResolved || !fallbackResolved) {
    throw new Error("runner_execution_plugins_missing");
  }

  if (!isAllowedByPolicy(selectedId, allowedPluginIds)) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: "execution plugin disabled by policy snapshot",
      meta: {
        pluginId: selectedId,
        plan: config.policySnapshot?.plan ?? effectivePlan,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const finalSelected = asExecutionPlugin(selectedId) ?? fallbackResolved;

  if (!isAllowedByMinPlan(finalSelected.manifest.minPlan, effectivePlan)) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: "execution plugin disabled by min plan",
      meta: {
        pluginId: finalSelected.manifest.id,
        minPlan: finalSelected.manifest.minPlan ?? null,
        effectivePlan,
        fallbackPluginId: fallbackId
      }
    });
    return {
      selectedPluginId: fallbackResolved.manifest.id,
      fallbackPluginId: fallbackResolved.manifest.id,
      plugin: fallbackResolved,
      fallbackPlugin: fallbackResolved
    };
  }

  return {
    selectedPluginId: finalSelected.manifest.id,
    fallbackPluginId: fallbackResolved.manifest.id,
    plugin: finalSelected,
    fallbackPlugin: fallbackResolved
  };
}

function pickSignalSourcePlugin(params: {
  bot: ActiveFuturesBot;
  diagnostics: PluginResolutionDiagnostic[];
}): {
  selectedPluginId: string;
  fallbackPluginId: string;
  plugin: RunnerSignalSourcePlugin;
  fallbackPlugin: RunnerSignalSourcePlugin;
} {
  const config = readBotPluginConfig(params.bot);
  const defaultId = defaultSignalSourcePluginIdForBot(params.bot);
  const fallbackId = SIGNAL_SOURCE_PLUGIN_ID_NONE;
  const effectivePlan = getEffectivePlan(params.bot);
  const allowedPluginIds = config.policySnapshot?.allowedPluginIds ?? null;

  const candidates = collectOrderedCandidates(config.enabled, config.order);
  let selectedId = defaultId;
  for (const candidate of candidates) {
    const plugin = asSignalSourcePlugin(candidate);
    if (!plugin) continue;
    selectedId = candidate;
    break;
  }

  if (config.disabled.includes(selectedId)) {
    params.diagnostics.push({
      type: "PLUGIN_FALLBACK_USED",
      message: "signal source plugin disabled in bot config",
      meta: {
        pluginId: selectedId,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const selectedPlugin = asSignalSourcePlugin(selectedId);
  if (!selectedPlugin) {
    params.diagnostics.push({
      type: "PLUGIN_LOAD_ERROR",
      message: "signal source plugin is not registered",
      meta: {
        pluginId: selectedId,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const selectedResolved = asSignalSourcePlugin(selectedId) ?? asSignalSourcePlugin(fallbackId);
  const fallbackResolved = asSignalSourcePlugin(fallbackId);
  if (!selectedResolved || !fallbackResolved) {
    throw new Error("runner_signal_source_plugins_missing");
  }

  if (!isAllowedByPolicy(selectedId, allowedPluginIds)) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: "signal source plugin disabled by policy snapshot",
      meta: {
        pluginId: selectedId,
        plan: config.policySnapshot?.plan ?? effectivePlan,
        fallbackPluginId: fallbackId
      }
    });
    selectedId = fallbackId;
  }

  const finalSelected = asSignalSourcePlugin(selectedId) ?? fallbackResolved;
  if (!isAllowedByMinPlan(finalSelected.manifest.minPlan, effectivePlan)) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: "signal source plugin disabled by min plan",
      meta: {
        pluginId: finalSelected.manifest.id,
        minPlan: finalSelected.manifest.minPlan ?? null,
        effectivePlan,
        fallbackPluginId: fallbackId
      }
    });
    return {
      selectedPluginId: fallbackResolved.manifest.id,
      fallbackPluginId: fallbackResolved.manifest.id,
      plugin: fallbackResolved,
      fallbackPlugin: fallbackResolved
    };
  }

  return {
    selectedPluginId: finalSelected.manifest.id,
    fallbackPluginId: fallbackResolved.manifest.id,
    plugin: finalSelected,
    fallbackPlugin: fallbackResolved
  };
}

export function resolveRunnerPluginsForBot(bot: ActiveFuturesBot): ResolvedRunnerPluginSelection {
  registerBuiltinRunnerPlugins();

  const diagnostics: PluginResolutionDiagnostic[] = [
    ...drainRunnerPluginLoadDiagnostics()
  ];
  const signal = pickSignalPlugin({ bot, diagnostics });
  const execution = pickExecutionPlugin({ bot, diagnostics });
  const signalSource = pickSignalSourcePlugin({ bot, diagnostics });

  if (diagnostics.length > 0) {
    log.warn({ botId: bot.id, diagnostics }, "runner plugin diagnostics emitted");
  }

  return {
    signal,
    execution,
    signalSource,
    diagnostics
  };
}
