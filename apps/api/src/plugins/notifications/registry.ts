import type { ApiNotificationPlugin } from "./types.js";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/;

function normalizePluginId(value: string): string {
  return value.trim();
}

function assertNotificationPlugin(plugin: ApiNotificationPlugin) {
  const id = normalizePluginId(plugin.manifest.id);
  if (!id) {
    throw new Error("notification_plugin_manifest_id_required");
  }
  if (plugin.manifest.kind !== "notification") {
    throw new Error(`notification_plugin_kind_invalid:${id}`);
  }
  if (!SEMVER_PATTERN.test(String(plugin.manifest.version ?? ""))) {
    throw new Error(`notification_plugin_version_invalid:${id}`);
  }
}

export class ApiNotificationPluginRegistry {
  private readonly byId = new Map<string, ApiNotificationPlugin>();

  register(plugin: ApiNotificationPlugin): void {
    assertNotificationPlugin(plugin);
    const id = normalizePluginId(plugin.manifest.id);
    if (this.byId.has(id)) {
      throw new Error(`notification_plugin_duplicate_id:${id}`);
    }
    this.byId.set(id, plugin);
  }

  has(id: string): boolean {
    return this.byId.has(normalizePluginId(id));
  }

  get(id: string): ApiNotificationPlugin | null {
    return this.byId.get(normalizePluginId(id)) ?? null;
  }

  list(): ApiNotificationPlugin[] {
    return Array.from(this.byId.values());
  }
}

const globalNotificationPluginRegistry = new ApiNotificationPluginRegistry();

export function getApiNotificationPluginRegistry(): ApiNotificationPluginRegistry {
  return globalNotificationPluginRegistry;
}
