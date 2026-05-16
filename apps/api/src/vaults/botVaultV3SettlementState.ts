export type BotVaultV3SettlementPostProcessingStep = "resync" | "apply" | "fee_event";

export type BotVaultV3SettlementPostProcessingState = {
  state: "not_started" | "pending" | "complete";
  pendingSteps: BotVaultV3SettlementPostProcessingStep[];
  lastError: string | null;
  updatedAt: string | null;
};

export type BotVaultV3ControllerSettlementState = {
  sourceAction: "close_vault" | "recover_closed_funds";
  sourceKey: string;
  feeEventSourceKey: string;
  closeTxHash: string | null;
  feeRatePct: number;
  treasuryRecipient: string | null;
  principalReturnedUsd: number;
  grossAmountUsd: number;
  feeAmountUsd: number;
  netReturnedUsd: number;
  profitComponentUsd: number;
  profitBaseUsd: number;
  realizedClosedPnlUsd: number | null;
  highWaterMarkBeforeUsd: number | null;
  highWaterMarkAfterUsd: number | null;
  excludedPrincipalUsd: number;
  stage: "prepared" | "confirmed" | "applied" | "resync_only_missing_prepare";
  preparedAt: string | null;
  confirmedAt: string | null;
  appliedAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
  postProcessing: BotVaultV3SettlementPostProcessingState;
};

export type BotVaultV3ClaimSettlementState = {
  sourceAction: "claim_profit";
  sourceKey: string;
  feeEventSourceKey: string;
  claimTxHash: string | null;
  feeRatePct: number;
  treasuryRecipient: string | null;
  grossAmountUsd: number;
  feeAmountUsd: number;
  netReturnedUsd: number;
  profitBaseUsd: number;
  realizedClosedPnlUsd: number | null;
  highWaterMarkBeforeUsd: number | null;
  highWaterMarkAfterUsd: number | null;
  excludedPrincipalUsd: number;
  stage: "prepared" | "confirmed" | "applied";
  preparedAt: string | null;
  confirmedAt: string | null;
  appliedAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
  postProcessing: BotVaultV3SettlementPostProcessingState;
};

function roundUsd(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function toNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function buildBotVaultV3ControllerSettlementSourceKey(
  botVaultId: string,
  sourceAction: "close_vault" | "recover_closed_funds"
): string {
  return `bot_vault_v3:${String(botVaultId)}:${sourceAction}:settlement`;
}

export function buildBotVaultV3ClaimSettlementSourceKey(botVaultId: string, claimTxHash: string): string {
  return `bot_vault_v3:${String(botVaultId)}:claim_profit:${String(claimTxHash).toLowerCase()}:settlement`;
}

function normalizeBotVaultV3SettlementPendingSteps(value: unknown): BotVaultV3SettlementPostProcessingStep[] {
  if (!Array.isArray(value)) return [];
  const steps = new Set<BotVaultV3SettlementPostProcessingStep>();
  for (const entry of value) {
    const stepRaw = String(entry ?? "").trim().toLowerCase();
    if (stepRaw === "resync" || stepRaw === "apply" || stepRaw === "fee_event") {
      steps.add(stepRaw as BotVaultV3SettlementPostProcessingStep);
    }
  }
  return [...steps];
}

export function buildBotVaultV3SettlementPostProcessingState(params: {
  state: BotVaultV3SettlementPostProcessingState["state"];
  pendingSteps?: BotVaultV3SettlementPostProcessingStep[];
  lastError?: string | null;
  updatedAt?: string | null;
}): BotVaultV3SettlementPostProcessingState {
  return {
    state: params.state,
    pendingSteps: normalizeBotVaultV3SettlementPendingSteps(params.pendingSteps),
    lastError: toNullableString(params.lastError) ?? null,
    updatedAt: toNullableString(params.updatedAt) ?? new Date().toISOString()
  };
}

function deriveDefaultBotVaultV3SettlementPostProcessingState(params: {
  stage: "prepared" | "confirmed" | "applied" | "resync_only_missing_prepare";
  feeAmountUsd: number;
  lastError?: string | null;
}): BotVaultV3SettlementPostProcessingState {
  if (params.stage === "prepared") {
    return buildBotVaultV3SettlementPostProcessingState({
      state: "not_started",
      pendingSteps: [],
      lastError: params.lastError ?? null
    });
  }
  if (params.stage === "applied") {
    return buildBotVaultV3SettlementPostProcessingState({
      state: "complete",
      pendingSteps: [],
      lastError: null
    });
  }
  const pendingSteps: BotVaultV3SettlementPostProcessingStep[] = ["resync", "apply"];
  if (params.feeAmountUsd > 0) pendingSteps.push("fee_event");
  return buildBotVaultV3SettlementPostProcessingState({
    state: "pending",
    pendingSteps,
    lastError: params.lastError ?? null
  });
}

function readBotVaultV3SettlementPostProcessingState(params: {
  raw: unknown;
  stage: "prepared" | "confirmed" | "applied" | "resync_only_missing_prepare";
  feeAmountUsd: number;
  lastError?: string | null;
}): BotVaultV3SettlementPostProcessingState {
  const raw = toRecord(params.raw);
  const stateRaw = String(raw.state ?? "").trim().toLowerCase();
  const state = stateRaw === "not_started" || stateRaw === "pending" || stateRaw === "complete"
    ? stateRaw as BotVaultV3SettlementPostProcessingState["state"]
    : null;
  const pendingSteps = normalizeBotVaultV3SettlementPendingSteps(raw.pendingSteps);
  if (!state) {
    return deriveDefaultBotVaultV3SettlementPostProcessingState({
      stage: params.stage,
      feeAmountUsd: params.feeAmountUsd,
      lastError: params.lastError ?? null
    });
  }
  return {
    state,
    pendingSteps,
    lastError: toNullableString(raw.lastError) ?? toNullableString(params.lastError) ?? null,
    updatedAt: toNullableString(raw.updatedAt)
  };
}

export function hasPendingBotVaultV3SettlementPostProcessing(
  value: BotVaultV3SettlementPostProcessingState | null | undefined
): boolean {
  return value?.state === "pending" && value.pendingSteps.length > 0;
}

export function clearBotVaultV3SettlementPendingStep(
  current: BotVaultV3SettlementPostProcessingState,
  step: BotVaultV3SettlementPostProcessingStep,
  options?: { lastError?: string | null }
): BotVaultV3SettlementPostProcessingState {
  const nextPendingSteps = current.pendingSteps.filter((entry) => entry !== step);
  return buildBotVaultV3SettlementPostProcessingState({
    state: nextPendingSteps.length > 0 ? "pending" : "complete",
    pendingSteps: nextPendingSteps,
    lastError: nextPendingSteps.length > 0 ? (toNullableString(options?.lastError) ?? current.lastError) : null
  });
}

export function readBotVaultV3ControllerSettlementState(params: {
  executionMetadata: unknown;
  metadataKey: "closeSettlement" | "recoverySettlement";
  sourceAction: "close_vault" | "recover_closed_funds";
}): BotVaultV3ControllerSettlementState | null {
  const { executionMetadata, metadataKey, sourceAction } = params;
  const metadata = toRecord(executionMetadata);
  const settlement = toRecord(metadata[metadataKey]);
  if (String(settlement.sourceAction ?? "").trim().toLowerCase() !== sourceAction) return null;
  const sourceKey = toNullableString(settlement.sourceKey);
  if (!sourceKey) return null;
  const stageRaw = String(settlement.stage ?? "").trim().toLowerCase();
  const stage = stageRaw === "prepared"
    || stageRaw === "confirmed"
    || stageRaw === "applied"
    || stageRaw === "resync_only_missing_prepare"
    ? stageRaw as BotVaultV3ControllerSettlementState["stage"]
    : "prepared";
  const principalReturnedUsd = roundUsd(toNonNegativeNumber(settlement.principalReturnedUsd), 6);
  const grossAmountUsd = roundUsd(toNonNegativeNumber(settlement.grossAmountUsd), 6);
  const feeAmountUsd = roundUsd(toNonNegativeNumber(settlement.feeAmountUsd), 6);
  const profitComponentUsd = roundUsd(Math.max(0, grossAmountUsd - principalReturnedUsd), 6);
  const lastError = toNullableString(settlement.lastError);
  return {
    sourceAction,
    sourceKey,
    feeEventSourceKey: toNullableString(settlement.feeEventSourceKey) ?? `${sourceKey}:fee_event`,
    closeTxHash: toNullableString(settlement.closeTxHash),
    feeRatePct: roundUsd(toNonNegativeNumber(settlement.feeRatePct), 6),
    treasuryRecipient: toNullableString(settlement.treasuryRecipient),
    principalReturnedUsd,
    grossAmountUsd,
    feeAmountUsd,
    netReturnedUsd: roundUsd(Math.max(0, grossAmountUsd - feeAmountUsd), 6),
    profitComponentUsd,
    profitBaseUsd: roundUsd(toNonNegativeNumber(settlement.profitBaseUsd ?? profitComponentUsd), 6),
    realizedClosedPnlUsd: Number.isFinite(Number(settlement.realizedClosedPnlUsd))
      ? roundUsd(Number(settlement.realizedClosedPnlUsd), 6)
      : null,
    highWaterMarkBeforeUsd: Number.isFinite(Number(settlement.highWaterMarkBeforeUsd))
      ? roundUsd(toNonNegativeNumber(settlement.highWaterMarkBeforeUsd), 6)
      : null,
    highWaterMarkAfterUsd: Number.isFinite(Number(settlement.highWaterMarkAfterUsd))
      ? roundUsd(toNonNegativeNumber(settlement.highWaterMarkAfterUsd), 6)
      : null,
    excludedPrincipalUsd: roundUsd(toNonNegativeNumber(settlement.excludedPrincipalUsd), 6),
    stage,
    preparedAt: toNullableString(settlement.preparedAt),
    confirmedAt: toNullableString(settlement.confirmedAt),
    appliedAt: toNullableString(settlement.appliedAt),
    updatedAt: toNullableString(settlement.updatedAt),
    lastError,
    postProcessing: readBotVaultV3SettlementPostProcessingState({
      raw: settlement.postProcessing,
      stage,
      feeAmountUsd,
      lastError
    })
  };
}

export function readBotVaultV3ClaimSettlementState(executionMetadata: unknown): BotVaultV3ClaimSettlementState | null {
  const metadata = toRecord(executionMetadata);
  const settlement = toRecord(metadata.claimSettlement);
  if (String(settlement.sourceAction ?? "").trim().toLowerCase() !== "claim_profit") return null;
  const sourceKey = toNullableString(settlement.sourceKey);
  if (!sourceKey) return null;
  const stageRaw = String(settlement.stage ?? "").trim().toLowerCase();
  const stage = stageRaw === "prepared"
    || stageRaw === "confirmed"
    || stageRaw === "applied"
    ? stageRaw as BotVaultV3ClaimSettlementState["stage"]
    : "prepared";
  const grossAmountUsd = roundUsd(toNonNegativeNumber(settlement.grossAmountUsd), 6);
  const feeAmountUsd = roundUsd(toNonNegativeNumber(settlement.feeAmountUsd), 6);
  const lastError = toNullableString(settlement.lastError);
  return {
    sourceAction: "claim_profit",
    sourceKey,
    feeEventSourceKey: toNullableString(settlement.feeEventSourceKey) ?? `${sourceKey}:fee_event`,
    claimTxHash: toNullableString(settlement.claimTxHash),
    feeRatePct: roundUsd(toNonNegativeNumber(settlement.feeRatePct), 6),
    treasuryRecipient: toNullableString(settlement.treasuryRecipient),
    grossAmountUsd,
    feeAmountUsd,
    netReturnedUsd: roundUsd(Math.max(0, grossAmountUsd - feeAmountUsd), 6),
    profitBaseUsd: roundUsd(toNonNegativeNumber(settlement.profitBaseUsd ?? grossAmountUsd), 6),
    realizedClosedPnlUsd: Number.isFinite(Number(settlement.realizedClosedPnlUsd))
      ? roundUsd(Number(settlement.realizedClosedPnlUsd), 6)
      : null,
    highWaterMarkBeforeUsd: Number.isFinite(Number(settlement.highWaterMarkBeforeUsd))
      ? roundUsd(toNonNegativeNumber(settlement.highWaterMarkBeforeUsd), 6)
      : null,
    highWaterMarkAfterUsd: Number.isFinite(Number(settlement.highWaterMarkAfterUsd))
      ? roundUsd(toNonNegativeNumber(settlement.highWaterMarkAfterUsd), 6)
      : null,
    excludedPrincipalUsd: roundUsd(toNonNegativeNumber(settlement.excludedPrincipalUsd), 6),
    stage,
    preparedAt: toNullableString(settlement.preparedAt),
    confirmedAt: toNullableString(settlement.confirmedAt),
    appliedAt: toNullableString(settlement.appliedAt),
    updatedAt: toNullableString(settlement.updatedAt),
    lastError,
    postProcessing: readBotVaultV3SettlementPostProcessingState({
      raw: settlement.postProcessing,
      stage,
      feeAmountUsd,
      lastError
    })
  };
}
