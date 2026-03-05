import type { RunnerPlugin } from "./types.js";
import { log } from "../logger.js";
import { builtinExecutionPlugins } from "./builtin/executionPlugins.js";
import { builtinSignalPlugins } from "./builtin/signalPlugins.js";
import { builtinSignalSourcePlugins } from "./builtin/signalSourcePlugins.js";
import { getRunnerPluginRegistry } from "./registry.js";
import type { PluginResolutionDiagnostic } from "./types.js";

type RunnerPluginModule = {
  plugins?: RunnerPlugin[];
  default?: RunnerPlugin | RunnerPlugin[] | { plugins?: RunnerPlugin[] };
};

let builtinsRegistered = false;
let externalLoadCompleted = false;
const loadDiagnostics: PluginResolutionDiagnostic[] = [];

function asRunnerPluginList(value: unknown): RunnerPlugin[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as RunnerPlugin[];
  if (typeof value === "object") {
    const row = value as { plugins?: unknown };
    if (Array.isArray(row.plugins)) return row.plugins as RunnerPlugin[];
  }
  return [];
}

function parseExternalPluginModules(): string[] {
  const raw = String(process.env.RUNNER_PLUGIN_MODULES ?? "");
  if (!raw.trim()) return [];
  const out: string[] = [];
  for (const token of raw.split(",")) {
    const normalized = token.trim();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function parseAllowlistPrefixes(): string[] {
  const raw = String(process.env.RUNNER_PLUGIN_ALLOWLIST_PREFIXES ?? "@mm/");
  const out: string[] = [];
  for (const token of raw.split(",")) {
    const normalized = token.trim();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out.length > 0 ? out : ["@mm/"];
}

function isAllowedModuleSpecifier(specifier: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => specifier.startsWith(prefix));
}

function registerPlugins(plugins: RunnerPlugin[]) {
  const registry = getRunnerPluginRegistry();
  for (const plugin of plugins) {
    if (!plugin?.manifest?.id) continue;
    if (registry.has(plugin.manifest.id)) continue;
    registry.register(plugin);
  }
}

export function registerBuiltinRunnerPlugins(): void {
  if (builtinsRegistered) return;
  registerPlugins([
    ...builtinSignalPlugins,
    ...builtinExecutionPlugins,
    ...builtinSignalSourcePlugins
  ]);
  builtinsRegistered = true;
}

export function drainRunnerPluginLoadDiagnostics(): PluginResolutionDiagnostic[] {
  if (loadDiagnostics.length === 0) return [];
  const out = [...loadDiagnostics];
  loadDiagnostics.length = 0;
  return out;
}

export async function initializeRunnerPlugins(): Promise<void> {
  registerBuiltinRunnerPlugins();
  if (externalLoadCompleted) return;

  const modules = parseExternalPluginModules();
  const allowlistPrefixes = parseAllowlistPrefixes();

  for (const moduleSpecifier of modules) {
    if (!isAllowedModuleSpecifier(moduleSpecifier, allowlistPrefixes)) {
      log.warn({ moduleSpecifier }, "runner plugin module blocked by allowlist");
      loadDiagnostics.push({
        type: "PLUGIN_LOAD_ERROR",
        message: "runner plugin module blocked by allowlist",
        meta: { moduleSpecifier }
      });
      continue;
    }

    try {
      const loaded = await import(moduleSpecifier) as RunnerPluginModule;
      const plugins = [
        ...asRunnerPluginList(loaded.plugins),
        ...asRunnerPluginList(loaded.default)
      ];
      registerPlugins(plugins);
      log.info({ moduleSpecifier, count: plugins.length }, "runner external plugin module loaded");
    } catch (error) {
      log.warn({ moduleSpecifier, err: String(error) }, "runner external plugin module load failed");
      loadDiagnostics.push({
        type: "PLUGIN_LOAD_ERROR",
        message: "runner external plugin module load failed",
        meta: {
          moduleSpecifier,
          reason: String(error)
        }
      });
    }
  }

  externalLoadCompleted = true;
}
