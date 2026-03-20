import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LocalStrategyRegistryStatus = "active" | "experimental" | "deprecated";
export type LocalStrategyRegistryEngine = "ts" | "python";

export type LocalStrategyCatalogItem = {
  key: string;
  type: string;
  engine: LocalStrategyRegistryEngine;
  name: string;
  version: string;
  status: LocalStrategyRegistryStatus;
  description: string | null;
  inputSchema: Record<string, unknown>;
  outputContract: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
};

type LocalStrategyCatalogDocument = {
  registryVersion: string;
  outputContract: Record<string, unknown>;
  items: LocalStrategyCatalogItem[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeObject(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

function normalizeItem(
  input: unknown,
  defaultOutputContract: Record<string, unknown>
): LocalStrategyCatalogItem | null {
  const row = asRecord(input);
  if (!row) return null;
  const key = typeof row.key === "string" ? row.key.trim() : "";
  const type = typeof row.type === "string" ? row.type.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const version = typeof row.version === "string" ? row.version.trim() : "";
  if (!key || !type || !name || !version) return null;

  const engine = row.engine === "python" ? "python" : "ts";
  const status =
    row.status === "experimental" || row.status === "deprecated"
      ? row.status
      : "active";

  return {
    key,
    type,
    engine,
    name,
    version,
    status,
    description:
      typeof row.description === "string" && row.description.trim()
        ? row.description.trim()
        : null,
    inputSchema: safeObject(row.inputSchema),
    outputContract: {
      ...defaultOutputContract,
      ...safeObject(row.outputContract)
    },
    defaultConfig: safeObject(row.defaultConfig),
    uiSchema: safeObject(row.uiSchema)
  };
}

function loadCatalog(): LocalStrategyCatalogDocument {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(here, "../../../../config/local-strategy-registry.json"),
    path.resolve(here, "../../../config/local-strategy-registry.json"),
    path.resolve(process.cwd(), "config/local-strategy-registry.json")
  ];
  const filePath = candidatePaths.find((candidate) => existsSync(candidate));
  if (!filePath) {
    throw new Error(
      `local_strategy_registry_missing:${candidatePaths.join(",")}`
    );
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  const defaultOutputContract = safeObject(parsed.outputContract);
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map((entry) => normalizeItem(entry, defaultOutputContract))
        .filter((entry): entry is LocalStrategyCatalogItem => Boolean(entry))
    : [];

  return {
    registryVersion:
      typeof parsed.registryVersion === "string" && parsed.registryVersion.trim()
        ? parsed.registryVersion.trim()
        : "unknown",
    outputContract: defaultOutputContract,
    items
  };
}

const catalog = loadCatalog();

export function getLocalStrategyRegistryVersion(): string {
  return catalog.registryVersion;
}

export function getLocalStrategyCatalogItems(): LocalStrategyCatalogItem[] {
  return catalog.items.map((item) => ({
    ...item,
    inputSchema: { ...item.inputSchema },
    outputContract: { ...item.outputContract },
    defaultConfig: { ...item.defaultConfig },
    uiSchema: { ...item.uiSchema }
  }));
}

export function getLocalStrategyCatalogItem(key: string): LocalStrategyCatalogItem | null {
  const normalized = key.trim();
  if (!normalized) return null;
  const found = catalog.items.find((item) => item.key === normalized || item.type === normalized);
  return found
    ? {
        ...found,
        inputSchema: { ...found.inputSchema },
        outputContract: { ...found.outputContract },
        defaultConfig: { ...found.defaultConfig },
        uiSchema: { ...found.uiSchema }
      }
    : null;
}

export function listLocalStrategyCatalogByEngine(
  engine: LocalStrategyRegistryEngine
): LocalStrategyCatalogItem[] {
  return getLocalStrategyCatalogItems().filter((item) => item.engine === engine);
}
