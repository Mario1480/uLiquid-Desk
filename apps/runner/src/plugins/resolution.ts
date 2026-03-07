import type { ActiveFuturesBot } from "../db.js";
import { readExplicitExecutionModeFromBot, readExecutionSettings } from "../execution/config.js";
import { log } from "../logger.js";
import {
  isAllowedByMinPlan,
  isAllowedByPolicySnapshot,
  isPluginCapabilityAllowed,
  readRunnerCapabilityPolicy,
  type RunnerCapabilityPolicy
} from "../capabilities/guard.js";
import { drainRunnerPluginLoadDiagnostics, registerBuiltinRunnerPlugins } from "./loader.js";
import {
  EXECUTION_PLUGIN_ID_DCA,
  EXECUTION_PLUGIN_ID_DIP_REVERSION,
  EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY,
  EXECUTION_PLUGIN_ID_FUTURES_GRID,
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
  if (bot.strategyKey === "futures_grid") {
    return EXECUTION_PLUGIN_ID_FUTURES_GRID;
  }
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
  if (bot.strategyKey === "prediction_copier" || bot.strategyKey === "futures_grid") return null;
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

function resolveAllowedPluginIds(
  policy: RunnerCapabilityPolicy,
  bot: ActiveFuturesBot
): string[] | null {
  const config = readBotPluginConfig(bot);
  return config.policySnapshot?.allowedPluginIds ?? policy.allowedPluginIds;
}

function enforcePluginPolicy(params: {
  selectedId: string;
  pluginKind: "signal" | "execution" | "signal_source";
  plugin: RunnerSignalPlugin | RunnerExecutionPlugin | RunnerSignalSourcePlugin;
  fallbackPluginId: string;
  allowedPluginIds: string[] | null;
  policy: RunnerCapabilityPolicy;
  diagnostics: PluginResolutionDiagnostic[];
}): string {
  if (!isAllowedByPolicySnapshot(params.selectedId, params.allowedPluginIds)) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: `${params.pluginKind} plugin disabled by policy snapshot`,
      meta: {
        pluginId: params.selectedId,
        plan: params.policy.plan,
        fallbackPluginId: params.fallbackPluginId
      }
    });
    return params.fallbackPluginId;
  }

  const capabilityCheck = isPluginCapabilityAllowed({
    pluginId: params.plugin.manifest.id,
    kind: params.plugin.manifest.kind,
    capabilities: params.policy.capabilities
  });
  if (!capabilityCheck.allowed) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: `${params.pluginKind} plugin disabled by capability`,
      meta: {
        pluginId: params.plugin.manifest.id,
        capability: capabilityCheck.capability,
        plan: params.policy.plan,
        fallbackPluginId: params.fallbackPluginId
      }
    });
    return params.fallbackPluginId;
  }

  if (!isAllowedByMinPlan(params.plugin.manifest.minPlan, params.policy.plan)) {
    params.diagnostics.push({
      type: "PLUGIN_DISABLED_BY_POLICY",
      message: `${params.pluginKind} plugin disabled by min plan`,
      meta: {
        pluginId: params.plugin.manifest.id,
        minPlan: params.plugin.manifest.minPlan ?? null,
        effectivePlan: params.policy.plan,
        fallbackPluginId: params.fallbackPluginId
      }
    });
    return params.fallbackPluginId;
  }

  return params.selectedId;
}

function pickSignalPlugin(params: {
  bot: ActiveFuturesBot;
  diagnostics: PluginResolutionDiagnostic[];
  policy: RunnerCapabilityPolicy;
}): { selectedPluginId: string; fallbackPluginId: string; plugin: RunnerSignalPlugin; fallbackPlugin: RunnerSignalPlugin } {
  const config = readBotPluginConfig(params.bot);
  const defaultId = defaultSignalPluginIdForBot(params.bot);
  const fallbackId = SIGNAL_PLUGIN_ID_LEGACY_DUMMY;
  const allowedPluginIds = resolveAllowedPluginIds(params.policy, params.bot);

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

  selectedId = enforcePluginPolicy({
    selectedId,
    pluginKind: "signal",
    plugin: selectedResolved,
    fallbackPluginId: fallbackId,
    allowedPluginIds,
    policy: params.policy,
    diagnostics: params.diagnostics
  });

  const finalSelected = asSignalPlugin(selectedId) ?? fallbackResolved;

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
  policy: RunnerCapabilityPolicy;
}): { selectedPluginId: string; fallbackPluginId: string; plugin: RunnerExecutionPlugin; fallbackPlugin: RunnerExecutionPlugin } {
  const config = readBotPluginConfig(params.bot);
  const defaultId = defaultExecutionPluginIdForBot(params.bot);
  const requestedByMode = requestedExecutionPluginIdForBot(params.bot);
  const fallbackId = EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY;
  const allowedPluginIds = resolveAllowedPluginIds(params.policy, params.bot);

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

  selectedId = enforcePluginPolicy({
    selectedId,
    pluginKind: "execution",
    plugin: selectedResolved,
    fallbackPluginId: fallbackId,
    allowedPluginIds,
    policy: params.policy,
    diagnostics: params.diagnostics
  });

  const finalSelected = asExecutionPlugin(selectedId) ?? fallbackResolved;

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
  policy: RunnerCapabilityPolicy;
}): {
  selectedPluginId: string;
  fallbackPluginId: string;
  plugin: RunnerSignalSourcePlugin;
  fallbackPlugin: RunnerSignalSourcePlugin;
} {
  const config = readBotPluginConfig(params.bot);
  const defaultId = defaultSignalSourcePluginIdForBot(params.bot);
  const fallbackId = SIGNAL_SOURCE_PLUGIN_ID_NONE;
  const allowedPluginIds = resolveAllowedPluginIds(params.policy, params.bot);

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

  selectedId = enforcePluginPolicy({
    selectedId,
    pluginKind: "signal_source",
    plugin: selectedResolved,
    fallbackPluginId: fallbackId,
    allowedPluginIds,
    policy: params.policy,
    diagnostics: params.diagnostics
  });

  const finalSelected = asSignalSourcePlugin(selectedId) ?? fallbackResolved;
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
  const policy = readRunnerCapabilityPolicy(bot);
  const signal = pickSignalPlugin({ bot, diagnostics, policy });
  const execution = pickExecutionPlugin({ bot, diagnostics, policy });
  const signalSource = pickSignalSourcePlugin({ bot, diagnostics, policy });

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
