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

function mergeNullableStringField(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  field: string
): string | null {
  return toNullableString(incoming[field]) ?? toNullableString(current[field]) ?? null;
}

function mergeBotVaultProviderMetadataSummary(
  current: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null
): Record<string, unknown> | null {
  const currentRecord = current ? asRecord(current) : {};
  const incomingRecord = incoming ? asRecord(incoming) : {};
  const merged = {
    providerMode: mergeNullableStringField(currentRecord, incomingRecord, "providerMode"),
    chain: mergeNullableStringField(currentRecord, incomingRecord, "chain"),
    marketDataExchange: mergeNullableStringField(currentRecord, incomingRecord, "marketDataExchange"),
    vaultAddress: mergeNullableStringField(currentRecord, incomingRecord, "vaultAddress"),
    agentWallet: mergeNullableStringField(currentRecord, incomingRecord, "agentWallet"),
    subaccountAddress: mergeNullableStringField(currentRecord, incomingRecord, "subaccountAddress"),
    lastAction: mergeNullableStringField(currentRecord, incomingRecord, "lastAction"),
    providerSelectionReason: mergeNullableStringField(currentRecord, incomingRecord, "providerSelectionReason"),
    pilotScope: mergeNullableStringField(currentRecord, incomingRecord, "pilotScope")
  };
  return Object.values(merged).some((value) => value !== null) ? merged : null;
}

export function deriveHasOnchainBotVault(botVault: Record<string, unknown> | null): boolean {
  if (!botVault) return false;
  if (toNullableString(botVault.onchainVaultAddress)) {
    return true;
  }

  const lifecycle = asRecord(botVault.lifecycle);
  const lifecycleState = String(lifecycle.state ?? "").trim().toLowerCase();
  if (lifecycleState === "close_only" || lifecycleState === "closed" || lifecycleState === "settling") {
    return true;
  }

  const executionStatus = String(botVault.executionStatus ?? "").trim().toLowerCase();
  if (executionStatus === "close_only" || executionStatus === "closed") {
    return true;
  }

  return false;
}

function normalizeCrossSideCandidate(
  side: unknown,
  fallback: { lowerPrice: number; upperPrice: number; gridCount: number }
) {
  const record = side && typeof side === "object" && !Array.isArray(side)
    ? side as Record<string, unknown>
    : {};
  const lowerPrice = Number(record.lowerPrice);
  const upperPrice = Number(record.upperPrice);
  const gridCount = Math.trunc(Number(record.gridCount));
  const candidate = {
    lowerPrice: Number.isFinite(lowerPrice) && lowerPrice > 0 ? lowerPrice : fallback.lowerPrice,
    upperPrice: Number.isFinite(upperPrice) && upperPrice > 0 ? upperPrice : fallback.upperPrice,
    gridCount: Number.isFinite(gridCount) && gridCount >= 2 && gridCount <= 500 ? gridCount : fallback.gridCount,
  };
  if (candidate.upperPrice <= candidate.lowerPrice) {
    return fallback;
  }
  return candidate;
}

function normalizeCrossSideConfig(row: any) {
  if (String(row?.mode ?? "").trim() !== "cross") return null;
  const fallback = {
    lowerPrice: Number(row?.lowerPrice),
    upperPrice: Number(row?.upperPrice),
    gridCount: Math.trunc(Number(row?.gridCount)),
  };
  if (
    !Number.isFinite(fallback.lowerPrice) || fallback.lowerPrice <= 0
    || !Number.isFinite(fallback.upperPrice) || fallback.upperPrice <= fallback.lowerPrice
    || !Number.isFinite(fallback.gridCount) || fallback.gridCount < 2 || fallback.gridCount > 500
  ) {
    return null;
  }
  const rawConfig = row?.crossSideConfig && typeof row.crossSideConfig === "object" && !Array.isArray(row.crossSideConfig)
    ? row.crossSideConfig as Record<string, unknown>
    : {};
  return {
    long: normalizeCrossSideCandidate(rawConfig.long ?? {
      lowerPrice: row?.crossLongLowerPrice,
      upperPrice: row?.crossLongUpperPrice,
      gridCount: row?.crossLongGridCount,
    }, fallback),
    short: normalizeCrossSideCandidate(rawConfig.short ?? {
      lowerPrice: row?.crossShortLowerPrice,
      upperPrice: row?.crossShortUpperPrice,
      gridCount: row?.crossShortGridCount,
    }, fallback),
  };
}

export function mergeExecutionStateIntoBotVault(
  botVault: Record<string, unknown> | null,
  executionState: Record<string, unknown> | null,
  includeProviderMetadataRaw: boolean
): Record<string, unknown> | null {
  if (!botVault) return null;
  if (!executionState) return botVault;
  const providerMetadataRaw = extractBotVaultProviderMetadataRaw(asRecord(executionState).providerMetadata);
  const mergedProviderMetadataSummary = mergeBotVaultProviderMetadataSummary(
    asRecord(botVault.providerMetadataSummary),
    summarizeBotVaultProviderMetadata(providerMetadataRaw)
  );
  return {
    ...botVault,
    executionStatus: toNullableString(executionState.status) ?? botVault.executionStatus ?? null,
    executionLastSyncedAt: toNullableString(executionState.observedAt) ?? botVault.executionLastSyncedAt ?? null,
    providerMetadataSummary: mergedProviderMetadataSummary,
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
  const crossSideConfig = normalizeCrossSideConfig(row);
  const derivedLowerPrice = crossSideConfig
    ? Math.min(crossSideConfig.long.lowerPrice, crossSideConfig.short.lowerPrice)
    : row.lowerPrice;
  const derivedUpperPrice = crossSideConfig
    ? Math.max(crossSideConfig.long.upperPrice, crossSideConfig.short.upperPrice)
    : row.upperPrice;
  const derivedGridCount = crossSideConfig
    ? Math.max(crossSideConfig.long.gridCount, crossSideConfig.short.gridCount)
    : row.gridCount;
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
    lowerPrice: derivedLowerPrice,
    upperPrice: derivedUpperPrice,
    gridCount: derivedGridCount,
    crossSideConfig,
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
  const hasOnchainBotVault = deriveHasOnchainBotVault(
    botVault ? (botVault as Record<string, unknown>) : null
  );
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
    hasOnchainBotVault,
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
          runtime: row.bot.runtime
            ? {
                mid: row.bot.runtime.mid ?? null,
                bid: row.bot.runtime.bid ?? null,
                ask: row.bot.runtime.ask ?? null,
                updatedAt: row.bot.runtime.updatedAt ?? null,
                status: row.bot.runtime.status ?? null,
                reason: row.bot.runtime.reason ?? null,
                lastError: row.bot.runtime.lastError ?? null
              }
            : null,
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
