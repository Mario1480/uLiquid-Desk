import type {
  BotPluginConfig,
  ExchangeExtensionContext,
  ExchangeExtensionInput,
  ExchangeExtensionOutput,
  NotificationDispatchContext,
  NotificationEventEnvelope,
  NotificationProvider,
  PluginManifest
} from "@mm/plugin-sdk";
import type { ExecutionMode } from "../execution/types.js";
import type { SignalSourceProvider } from "./signalSource.js";
import type { SignalEngine } from "../signal/types.js";

export type RunnerSignalPlugin = {
  manifest: PluginManifest & { kind: "signal" };
  create(): SignalEngine;
};

export type RunnerExecutionPlugin = {
  manifest: PluginManifest & { kind: "execution" };
  create(): ExecutionMode;
};

export interface RunnerNotificationPlugin extends NotificationProvider<NotificationEventEnvelope, NotificationDispatchContext> {
  manifest: PluginManifest & { kind: "notification" };
}

export type RunnerExchangeExtensionPlugin = {
  manifest: PluginManifest & { kind: "exchange_extension" };
  apply(input: ExchangeExtensionInput, ctx: ExchangeExtensionContext): Promise<ExchangeExtensionOutput>;
};

export type RunnerSignalSourcePlugin = {
  manifest: PluginManifest & { kind: "signal_source" };
  create(): SignalSourceProvider;
};

export type RunnerPlugin =
  | RunnerSignalPlugin
  | RunnerExecutionPlugin
  | RunnerNotificationPlugin
  | RunnerExchangeExtensionPlugin
  | RunnerSignalSourcePlugin;

export type RunnerExternalPluginModule = {
  plugins?: RunnerPlugin[];
  default?: RunnerPlugin | RunnerPlugin[] | { plugins?: RunnerPlugin[] };
};

export type RunnerBotPluginConfig = BotPluginConfig;

export type PluginResolutionDiagnostic = {
  type: "PLUGIN_LOAD_ERROR" | "PLUGIN_DISABLED_BY_POLICY" | "PLUGIN_FALLBACK_USED";
  message: string;
  meta: Record<string, unknown>;
};

export type ResolvedRunnerPluginSelection = {
  signal: {
    selectedPluginId: string;
    fallbackPluginId: string;
    plugin: RunnerSignalPlugin;
    fallbackPlugin: RunnerSignalPlugin;
  };
  execution: {
    selectedPluginId: string;
    fallbackPluginId: string;
    plugin: RunnerExecutionPlugin;
    fallbackPlugin: RunnerExecutionPlugin;
  };
  signalSource: {
    selectedPluginId: string;
    fallbackPluginId: string;
    plugin: RunnerSignalSourcePlugin;
    fallbackPlugin: RunnerSignalSourcePlugin;
  };
  diagnostics: PluginResolutionDiagnostic[];
};
