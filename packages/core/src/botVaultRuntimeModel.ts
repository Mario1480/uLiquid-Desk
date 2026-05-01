export const BOT_VAULT_RUNTIME_MODEL_V3 = "bot_vault_v3";
export const BOT_VAULT_RUNTIME_MODEL_V4 = "bot_vault_v4";
export const BOT_VAULT_RUNTIME_MODELS = [
  BOT_VAULT_RUNTIME_MODEL_V3,
  BOT_VAULT_RUNTIME_MODEL_V4
] as const;

export type BotVaultRuntimeModel = typeof BOT_VAULT_RUNTIME_MODELS[number];
export type BotVaultRuntimeContractVersion = "v3" | "v4";

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeStringLower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeBotVaultRuntimeModel(value: unknown): BotVaultRuntimeModel | null {
  const model = normalizeStringLower(value);
  if (model === BOT_VAULT_RUNTIME_MODEL_V3 || model === BOT_VAULT_RUNTIME_MODEL_V4) return model;
  return null;
}

export function isBotVaultRuntimeModel(value: unknown): value is BotVaultRuntimeModel {
  return normalizeBotVaultRuntimeModel(value) !== null;
}

export function normalizeBotVaultRuntimeContractVersion(value: unknown): BotVaultRuntimeContractVersion | null {
  const version = normalizeStringLower(value);
  if (version === "v3" || version === "v4") return version;
  return null;
}

export function botVaultRuntimeModelForContractVersion(
  value: unknown,
  fallback: BotVaultRuntimeModel = BOT_VAULT_RUNTIME_MODEL_V3
): BotVaultRuntimeModel {
  return normalizeBotVaultRuntimeContractVersion(value) === "v4"
    ? BOT_VAULT_RUNTIME_MODEL_V4
    : fallback;
}

export function resolveBotVaultRuntimeModel(value: unknown): BotVaultRuntimeModel | null {
  const record = toRecord(value);
  const executionMetadata = toRecord(record.executionMetadata);
  const contractVersion =
    normalizeBotVaultRuntimeContractVersion(record.contractVersion)
    ?? normalizeBotVaultRuntimeContractVersion(record.onchainContractVersion)
    ?? normalizeBotVaultRuntimeContractVersion(executionMetadata.onchainContractVersion);
  if (contractVersion === "v4") return BOT_VAULT_RUNTIME_MODEL_V4;
  if (contractVersion === "v3") return BOT_VAULT_RUNTIME_MODEL_V3;
  return normalizeBotVaultRuntimeModel(record.vaultModel ?? value);
}

export function isBotVaultRuntimeModelRow(value: unknown): boolean {
  return resolveBotVaultRuntimeModel(value) !== null;
}

export function botVaultRuntimeActionType(params: {
  runtimeModel?: unknown;
  contractVersion?: unknown;
  action: "create" | "fund";
}): "create_bot_vault_v3" | "create_bot_vault_v4" | "fund_bot_vault_v3" | "fund_bot_vault_v4" {
  const runtimeModel =
    normalizeBotVaultRuntimeModel(params.runtimeModel)
    ?? botVaultRuntimeModelForContractVersion(params.contractVersion);
  if (params.action === "create") {
    return runtimeModel === BOT_VAULT_RUNTIME_MODEL_V4 ? "create_bot_vault_v4" : "create_bot_vault_v3";
  }
  return runtimeModel === BOT_VAULT_RUNTIME_MODEL_V4 ? "fund_bot_vault_v4" : "fund_bot_vault_v3";
}

export function botVaultRuntimeReasonCode(params: {
  runtimeModel?: unknown;
  contractVersion?: unknown;
  suffix: string;
}): string {
  const runtimeModel =
    normalizeBotVaultRuntimeModel(params.runtimeModel)
    ?? botVaultRuntimeModelForContractVersion(params.contractVersion);
  return `${runtimeModel}_${params.suffix}`;
}
