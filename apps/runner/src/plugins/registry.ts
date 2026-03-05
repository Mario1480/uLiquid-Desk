import type { PluginKind } from "@mm/plugin-sdk";
import type { RunnerPlugin } from "./types.js";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/;

function normalizePluginId(value: string): string {
  return value.trim();
}

function assertPluginManifest(plugin: RunnerPlugin) {
  const id = normalizePluginId(plugin.manifest.id);
  if (!id) {
    throw new Error("plugin_manifest_id_required");
  }
  if (!SEMVER_PATTERN.test(String(plugin.manifest.version ?? ""))) {
    throw new Error(`plugin_manifest_version_invalid:${id}`);
  }
  const kind = plugin.manifest.kind;
  if (
    kind !== "signal"
    && kind !== "execution"
    && kind !== "notification"
    && kind !== "exchange_extension"
    && kind !== "signal_source"
  ) {
    throw new Error(`plugin_manifest_kind_invalid:${id}`);
  }
}

export class RunnerPluginRegistry {
  private readonly byId = new Map<string, RunnerPlugin>();
  private readonly byKind = new Map<PluginKind, Map<string, RunnerPlugin>>();

  register(plugin: RunnerPlugin): void {
    assertPluginManifest(plugin);
    const id = normalizePluginId(plugin.manifest.id);
    if (this.byId.has(id)) {
      throw new Error(`plugin_duplicate_id:${id}`);
    }

    this.byId.set(id, plugin);

    const kind = plugin.manifest.kind;
    const existing = this.byKind.get(kind) ?? new Map<string, RunnerPlugin>();
    existing.set(id, plugin);
    this.byKind.set(kind, existing);
  }

  has(id: string): boolean {
    return this.byId.has(normalizePluginId(id));
  }

  get(id: string): RunnerPlugin | null {
    return this.byId.get(normalizePluginId(id)) ?? null;
  }

  list(): RunnerPlugin[] {
    return Array.from(this.byId.values());
  }

  listByKind(kind: PluginKind): RunnerPlugin[] {
    return Array.from(this.byKind.get(kind)?.values() ?? []);
  }
}

const globalRegistry = new RunnerPluginRegistry();

export function getRunnerPluginRegistry(): RunnerPluginRegistry {
  return globalRegistry;
}
