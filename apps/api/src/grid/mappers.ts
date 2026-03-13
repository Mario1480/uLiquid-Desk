import {
  extractBotVaultProviderMetadataRaw,
  mapBotVaultSnapshot,
  summarizeBotVaultProviderMetadata
} from "../vaults/service.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

export function mergeExecutionStateIntoBotVault(
  botVault: Record<string, unknown> | null,
  executionState: Record<string, unknown> | null,
  includeProviderMetadataRaw: boolean
): Record<string, unknown> | null {
  if (!botVault) return null;
  if (!executionState) return botVault;
  const providerMetadataRaw = extractBotVaultProviderMetadataRaw(asRecord(executionState).providerMetadata);
  return {
    ...botVault,
    executionStatus: toNullableString(executionState.status) ?? botVault.executionStatus ?? null,
    executionLastSyncedAt: toNullableString(executionState.observedAt) ?? botVault.executionLastSyncedAt ?? null,
    providerMetadataSummary: summarizeBotVaultProviderMetadata(providerMetadataRaw) ?? botVault.providerMetadataSummary ?? null,
    providerMetadataRaw: includeProviderMetadataRaw ? (providerMetadataRaw ?? botVault.providerMetadataRaw ?? null) : null
  };
}

export function buildGridPilotStatus(params: {
  botVault: Record<string, unknown> | null;
  currentPilotAccess?: { allowed: boolean; reason: string; scope: string } | null;
}): Record<string, unknown> | null {
  const botVault = params.botVault ? asRecord(params.botVault) : null;
  const provider = toNullableString(botVault?.executionProvider);
  const executionLastErrorAt = toNullableString(botVault?.executionLastErrorAt);
  const summary = asRecord(botVault?.providerMetadataSummary);
  const providerSelectionReason = toNullableString(summary.providerSelectionReason);
  const pilotScope = toNullableString(summary.pilotScope) ?? params.currentPilotAccess?.scope ?? "none";
  const isDemoProvider = provider === "hyperliquid_demo";
  const isLiveProvider = provider === "hyperliquid";
  const allowState = isLiveProvider || isDemoProvider || Boolean(params.currentPilotAccess?.allowed);
  if (!provider && !params.currentPilotAccess && !isDemoProvider && !isLiveProvider) return null;
  return {
    allowed: allowState,
    reason: allowState
      ? (
          isLiveProvider
            ? "live_provider"
            : (params.currentPilotAccess?.reason ?? (isDemoProvider ? "allowlist" : "not_listed"))
        )
      : (params.currentPilotAccess?.reason ?? "not_listed"),
    provider,
    providerSelectionReason,
    scope: pilotScope,
    lastBlockAt: null,
    lastSyncErrorAt: executionLastErrorAt
  };
}

export function mapGridTemplateRow(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description ?? null,
    symbol: row.symbol,
    marketType: row.marketType,
    mode: row.mode,
    gridMode: row.gridMode,
    allocationMode: row.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: row.budgetSplitPolicy ?? "FIXED_50_50",
    longBudgetPct: Number.isFinite(Number(row.longBudgetPct)) ? Number(row.longBudgetPct) : 50,
    shortBudgetPct: Number.isFinite(Number(row.shortBudgetPct)) ? Number(row.shortBudgetPct) : 50,
    marginPolicy: row.marginPolicy ?? (row.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"),
    autoMarginMaxUSDT: Number.isFinite(Number(row.autoMarginMaxUSDT)) ? Number(row.autoMarginMaxUSDT) : null,
    autoMarginTriggerType: row.autoMarginTriggerType ?? null,
    autoMarginTriggerValue: Number.isFinite(Number(row.autoMarginTriggerValue)) ? Number(row.autoMarginTriggerValue) : null,
    autoMarginStepUSDT: Number.isFinite(Number(row.autoMarginStepUSDT)) ? Number(row.autoMarginStepUSDT) : null,
    autoMarginCooldownSec: Number.isFinite(Number(row.autoMarginCooldownSec)) ? Number(row.autoMarginCooldownSec) : null,
    autoReservePolicy: row.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: Number.isFinite(Number(row.autoReserveFixedGridPct)) ? Number(row.autoReserveFixedGridPct) : 70,
    autoReserveTargetLiqDistancePct: Number.isFinite(Number(row.autoReserveTargetLiqDistancePct)) ? Number(row.autoReserveTargetLiqDistancePct) : null,
    autoReserveMaxPreviewIterations: Number.isFinite(Number(row.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.autoReserveMaxPreviewIterations)) : 8,
    initialSeedEnabled: typeof row.initialSeedEnabled === "boolean" ? row.initialSeedEnabled : true,
    initialSeedPct: Number.isFinite(Number(row.initialSeedPct)) ? Number(row.initialSeedPct) : 30,
    activeOrderWindowSize: Number.isFinite(Number(row.activeOrderWindowSize)) ? Math.trunc(Number(row.activeOrderWindowSize)) : 100,
    recenterDriftLevels: Number.isFinite(Number(row.recenterDriftLevels)) ? Math.trunc(Number(row.recenterDriftLevels)) : 1,
    lowerPrice: row.lowerPrice,
    upperPrice: row.upperPrice,
    gridCount: row.gridCount,
    leverageMin: row.leverageMin,
    leverageMax: row.leverageMax,
    leverageDefault: row.leverageDefault,
    investMaxUsd: row.investMaxUsd,
    investDefaultUsd: row.investDefaultUsd,
    slippageDefaultPct: row.slippageDefaultPct,
    slippageMinPct: row.slippageMinPct,
    slippageMaxPct: row.slippageMaxPct,
    tpDefaultPct: row.tpDefaultPct ?? null,
    slDefaultPrice: row.slDefaultPrice ?? null,
    allowAutoMargin: row.allowAutoMargin,
    allowManualMarginAdjust: row.allowManualMarginAdjust,
    allowProfitWithdraw: row.allowProfitWithdraw,
    isPublished: row.isPublished,
    isArchived: row.isArchived,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapGridInstanceRow(
  row: any,
  options?: {
    includeProviderMetadataRaw?: boolean;
    currentPilotAccess?: { allowed: boolean; reason: string; scope: string } | null;
  }
) {
  const botVault = row.botVault
    ? mapBotVaultSnapshot(row.botVault, { includeProviderMetadataRaw: options?.includeProviderMetadataRaw })
    : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    exchangeAccountId: row.exchangeAccountId,
    templateId: row.templateId,
    botId: row.botId,
    state: row.state,
    isArchived: String(row.state ?? "").trim().toLowerCase() === "archived",
    archivedAt: row.archivedAt ?? null,
    archivedReason: row.archivedReason ?? null,
    restartable: String(row.state ?? "").trim().toLowerCase() !== "archived",
    allocationMode: row.allocationMode ?? row.template?.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: row.budgetSplitPolicy ?? row.template?.budgetSplitPolicy ?? "FIXED_50_50",
    longBudgetPct: Number.isFinite(Number(row.longBudgetPct)) ? Number(row.longBudgetPct) : Number(row.template?.longBudgetPct ?? 50),
    shortBudgetPct: Number.isFinite(Number(row.shortBudgetPct)) ? Number(row.shortBudgetPct) : Number(row.template?.shortBudgetPct ?? 50),
    marginPolicy: row.marginPolicy ?? row.template?.marginPolicy ?? (row.template?.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"),
    marginMode: row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL"),
    autoMarginMaxUSDT: Number.isFinite(Number(row.autoMarginMaxUSDT)) ? Number(row.autoMarginMaxUSDT) : Number.isFinite(Number(row.template?.autoMarginMaxUSDT)) ? Number(row.template?.autoMarginMaxUSDT) : null,
    autoMarginTriggerType: row.autoMarginTriggerType ?? row.template?.autoMarginTriggerType ?? null,
    autoMarginTriggerValue: Number.isFinite(Number(row.autoMarginTriggerValue)) ? Number(row.autoMarginTriggerValue) : Number.isFinite(Number(row.template?.autoMarginTriggerValue)) ? Number(row.template?.autoMarginTriggerValue) : null,
    autoMarginStepUSDT: Number.isFinite(Number(row.autoMarginStepUSDT)) ? Number(row.autoMarginStepUSDT) : Number.isFinite(Number(row.template?.autoMarginStepUSDT)) ? Number(row.template?.autoMarginStepUSDT) : null,
    autoMarginCooldownSec: Number.isFinite(Number(row.autoMarginCooldownSec)) ? Number(row.autoMarginCooldownSec) : Number.isFinite(Number(row.template?.autoMarginCooldownSec)) ? Number(row.template?.autoMarginCooldownSec) : null,
    autoReservePolicy: row.autoReservePolicy ?? row.template?.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: Number.isFinite(Number(row.autoReserveFixedGridPct)) ? Number(row.autoReserveFixedGridPct) : Number.isFinite(Number(row.template?.autoReserveFixedGridPct)) ? Number(row.template?.autoReserveFixedGridPct) : 70,
    autoReserveTargetLiqDistancePct: Number.isFinite(Number(row.autoReserveTargetLiqDistancePct)) ? Number(row.autoReserveTargetLiqDistancePct) : Number.isFinite(Number(row.template?.autoReserveTargetLiqDistancePct)) ? Number(row.template?.autoReserveTargetLiqDistancePct) : null,
    autoReserveMaxPreviewIterations: Number.isFinite(Number(row.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.autoReserveMaxPreviewIterations)) : Number.isFinite(Number(row.template?.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.template?.autoReserveMaxPreviewIterations)) : 8,
    initialSeedEnabled: typeof row.initialSeedEnabled === "boolean"
      ? row.initialSeedEnabled
      : typeof row.template?.initialSeedEnabled === "boolean"
        ? row.template.initialSeedEnabled
        : true,
    initialSeedPct: Number.isFinite(Number(row.initialSeedPct))
      ? Number(row.initialSeedPct)
      : Number.isFinite(Number(row.template?.initialSeedPct))
        ? Number(row.template.initialSeedPct)
        : 30,
    activeOrderWindowSize: Number.isFinite(Number(row.activeOrderWindowSize))
      ? Math.trunc(Number(row.activeOrderWindowSize))
      : Number.isFinite(Number(row.template?.activeOrderWindowSize))
        ? Math.trunc(Number(row.template?.activeOrderWindowSize))
        : 100,
    recenterDriftLevels: Number.isFinite(Number(row.recenterDriftLevels))
      ? Math.trunc(Number(row.recenterDriftLevels))
      : Number.isFinite(Number(row.template?.recenterDriftLevels))
        ? Math.trunc(Number(row.template?.recenterDriftLevels))
        : 1,
    autoMarginUsedUSDT: Number.isFinite(Number(row.autoMarginUsedUSDT)) ? Number(row.autoMarginUsedUSDT) : 0,
    lastAutoMarginAt: row.lastAutoMarginAt ?? null,
    investUsd: row.investUsd,
    leverage: row.leverage,
    extraMarginUsd: row.extraMarginUsd,
    triggerPrice: row.triggerPrice ?? null,
    slippagePct: row.slippagePct,
    tpPct: row.tpPct ?? null,
    slPrice: row.slPrice ?? null,
    autoMarginEnabled: row.autoMarginEnabled,
    stateJson: row.stateJson ?? {},
    metricsJson: row.metricsJson ?? {},
    lastPlanAt: row.lastPlanAt ?? null,
    lastPlanError: row.lastPlanError ?? null,
    lastPlanVersion: row.lastPlanVersion ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    botVault,
    pilotStatus: buildGridPilotStatus({
      botVault: botVault ? (botVault as Record<string, unknown>) : null,
      currentPilotAccess: options?.currentPilotAccess ?? null
    }),
    template: row.template ? mapGridTemplateRow(row.template) : null,
    bot: row.bot
      ? {
          id: row.bot.id,
          name: row.bot.name,
          symbol: row.bot.symbol,
          status: row.bot.status,
          exchange: row.bot.exchange,
          exchangeAccount: row.bot.exchangeAccount
            ? {
                id: row.bot.exchangeAccount.id,
                exchange: row.bot.exchangeAccount.exchange,
                label: row.bot.exchangeAccount.label
              }
            : null
        }
      : null
  };
}
