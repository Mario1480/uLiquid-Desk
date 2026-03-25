import { bookVaultLedgerEntry } from "./ledger.js";
import type {
  BotVaultLifecycleResolution,
  MasterVaultLifecycleResolution
} from "@mm/core";
import {
  deriveBotVaultLifecycleState,
  deriveMasterVaultLifecycleState
} from "@mm/core";
import { roundUsd } from "./profitShare.js";
import { applyFillToRealizedPnl, parseBotVaultMatchingState } from "./realizedPnl.js";
import type { ExecutionProviderOrchestrator } from "./executionProvider.orchestrator.js";
import { createMasterVaultService, type MasterVaultService } from "./masterVault.service.js";
import { createBotVaultLifecycleService, type BotVaultLifecycleService } from "./botVaultLifecycle.service.js";
import { createFeeSettlementService, type FeeSettlementService } from "./feeSettlement.service.js";
import { computeProfitOnlyWithdrawableUsd, type FeeSettlementMathResult } from "./feeSettlement.math.js";
import { createExecutionLifecycleService, type ExecutionLifecycleService } from "./executionLifecycle.service.js";
import {
  createBotVaultTradingReconciliationService,
  type BotVaultTradingReconciliationService
} from "./tradingReconciliation.service.js";
import {
  createRiskPolicyService,
  type RiskPolicyService
} from "./riskPolicy.service.js";
import type { RuntimeGuardrailEvaluation } from "./riskPolicy.types.js";
import { getEffectiveVaultExecutionMode, isOnchainMode, type VaultExecutionMode } from "./executionMode.js";
import { resolveOnchainAddressBook } from "./onchainAddressBook.js";
import {
  createOnchainPublicClient,
  readMasterVaultAddressForOwner,
  readMasterVaultProfitShareFeeRatePct,
  readMasterVaultState,
  readMasterVaultTreasuryRecipient
} from "./onchainProvider.js";

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

function normalizeSide(value: unknown): "buy" | "sell" {
  const side = String(value ?? "").trim().toLowerCase();
  return side === "sell" ? "sell" : "buy";
}

function toPositiveAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return roundUsd(parsed, 6);
}

export type BotVaultSnapshot = {
  id: string;
  userId: string;
  masterVaultId: string;
  gridInstanceId: string | null;
  botId: string | null;
  principalAllocated: number;
  principalReturned: number;
  realizedPnlNet: number;
  feePaidTotal: number;
  highWaterMark: number;
  allocatedUsd: number;
  realizedGrossUsd: number;
  realizedFeesUsd: number;
  realizedNetUsd: number;
  profitShareAccruedUsd: number;
  withdrawnUsd: number;
  availableUsd: number;
  withdrawableUsd: number;
  executionProvider: string | null;
  executionUnitId: string | null;
  executionStatus: string | null;
  executionLastSyncedAt: string | null;
  executionLastError: string | null;
  executionLastErrorAt: string | null;
  lifecycle: BotVaultLifecycleResolution & {
    pendingActionUpdatedAt: string | null;
    pendingActionKey: string | null;
  };
  providerMetadataSummary?: BotVaultProviderMetadataSummary | null;
  providerMetadataRaw?: Record<string, unknown> | null;
  status: string;
  lastAccountingAt: string | null;
  updatedAt: string;
};

type PendingOnchainActionSummary = {
  actionKey: string | null;
  actionType: string | null;
  status: string | null;
  updatedAt: string | null;
};

export type BotVaultProviderMetadataSummary = {
  providerMode: string | null;
  chain: string | null;
  marketDataExchange: string | null;
  vaultAddress: string | null;
  agentWallet: string | null;
  subaccountAddress: string | null;
  lastAction: string | null;
  providerSelectionReason: string | null;
  pilotScope: string | null;
};

export type CopyBotTemplateSnapshot = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  symbol: string;
  marketType: string;
  mode: string;
  gridMode: string;
  allocationMode: string;
  budgetSplitPolicy: string;
  longBudgetPct: number;
  shortBudgetPct: number;
  marginPolicy: string;
  autoMarginMaxUSDT: number | null;
  autoMarginTriggerType: string | null;
  autoMarginTriggerValue: number | null;
  autoMarginStepUSDT: number | null;
  autoMarginCooldownSec: number | null;
  autoReservePolicy: string;
  autoReserveFixedGridPct: number;
  autoReserveTargetLiqDistancePct: number | null;
  autoReserveMaxPreviewIterations: number;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  leverageMin: number;
  leverageMax: number;
  leverageDefault: number;
  investMinUsd: number;
  investMaxUsd: number;
  investDefaultUsd: number;
  slippageDefaultPct: number;
  slippageMinPct: number;
  slippageMaxPct: number;
  tpDefaultPct: number | null;
  slDefaultPct: number | null;
  allowAutoMargin: boolean;
  allowManualMarginAdjust: boolean;
  allowProfitWithdraw: boolean;
  isPublished: boolean;
  isArchived: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
};

function computeWithdrawableUsd(row: {
  availableUsd: number;
  principalAllocated: number;
  principalReturned: number;
}): number {
  const availableUsd = Number(row.availableUsd ?? 0);
  const principalOutstandingUsd = Math.max(
    0,
    Number(row.principalAllocated ?? 0) - Number(row.principalReturned ?? 0)
  );
  return computeProfitOnlyWithdrawableUsd({
    availableUsd,
    principalOutstandingUsd
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function extractPendingOnchainAction(row: any): PendingOnchainActionSummary | null {
  const source = Array.isArray(row?.onchainActions) ? row.onchainActions[0] : row?.pendingOnchainAction;
  if (!source || typeof source !== "object") return null;
  return {
    actionKey: source.actionKey ? String(source.actionKey) : null,
    actionType: source.actionType ? String(source.actionType) : null,
    status: source.status ? String(source.status) : null,
    updatedAt: source.updatedAt instanceof Date ? source.updatedAt.toISOString() : toNullableString(source.updatedAt)
  };
}

function mapBotVaultLifecycle(row: any): BotVaultSnapshot["lifecycle"] {
  const pendingAction = extractPendingOnchainAction(row);
  const lifecycle = deriveBotVaultLifecycleState({
    status: row?.status,
    executionStatus: row?.executionStatus,
    executionLastError: row?.executionLastError,
    executionMetadata: row?.executionMetadata,
    pendingActionType: pendingAction?.actionType,
    pendingActionStatus: pendingAction?.status
  });
  return {
    ...lifecycle,
    pendingActionUpdatedAt: pendingAction?.updatedAt ?? null,
    pendingActionKey: pendingAction?.actionKey ?? null
  };
}

async function findLatestPendingAction(
  db: any,
  where: Record<string, unknown>,
  actionTypes?: string[]
): Promise<PendingOnchainActionSummary | null> {
  if (!db?.onchainAction?.findFirst) return null;
  const row = await db.onchainAction.findFirst({
    where: {
      ...where,
      status: { in: ["prepared", "submitted"] },
      ...(actionTypes?.length ? { actionType: { in: actionTypes } } : {})
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      actionKey: true,
      actionType: true,
      status: true,
      updatedAt: true
    }
  }).catch(() => null);
  return row ? extractPendingOnchainAction({ pendingOnchainAction: row }) : null;
}

export function summarizeBotVaultProviderMetadata(value: unknown): BotVaultProviderMetadataSummary | null {
  const metadata = toRecord(value);
  const nestedProviderState = toRecord(metadata.providerState);
  const providerMetadata = {
    ...nestedProviderState,
    ...metadata
  };
  if (Object.keys(providerMetadata).length === 0) return null;
  return {
    providerMode: toNullableString(providerMetadata.providerMode),
    chain: toNullableString(providerMetadata.chain),
    marketDataExchange: toNullableString(providerMetadata.marketDataExchange),
    vaultAddress: toNullableString(providerMetadata.vaultAddress),
    agentWallet: toNullableString(providerMetadata.agentWallet),
    subaccountAddress: toNullableString(providerMetadata.subaccountAddress),
    lastAction: toNullableString(providerMetadata.lastAction ?? nestedProviderState.lastAction),
    providerSelectionReason: toNullableString(providerMetadata.providerSelectionReason),
    pilotScope: toNullableString(providerMetadata.pilotScope)
  };
}

export function extractBotVaultProviderMetadataRaw(value: unknown): Record<string, unknown> | null {
  const metadata = toRecord(value);
  const nestedProviderState = toRecord(metadata.providerState);
  const providerMetadata = Object.keys(metadata).length > 0 || Object.keys(nestedProviderState).length > 0
    ? {
        ...nestedProviderState,
        ...metadata,
        ...(Object.keys(nestedProviderState).length > 0 ? { providerState: nestedProviderState } : {})
      }
    : {};
  return Object.keys(providerMetadata).length > 0 ? providerMetadata : null;
}

export function mapBotVaultSnapshot(
  row: any,
  options?: { includeProviderMetadataRaw?: boolean }
): BotVaultSnapshot {
  const providerMetadataRaw = extractBotVaultProviderMetadataRaw(row?.executionMetadata);
  const providerMetadataSummaryBase = summarizeBotVaultProviderMetadata(providerMetadataRaw);
  const providerMetadataSummary = providerMetadataSummaryBase
    ? {
        ...providerMetadataSummaryBase,
        vaultAddress: providerMetadataSummaryBase.vaultAddress ?? toNullableString(row?.vaultAddress),
        agentWallet: providerMetadataSummaryBase.agentWallet ?? toNullableString(row?.agentWallet)
      }
    : (toNullableString(row?.vaultAddress) || toNullableString(row?.agentWallet))
        ? {
            providerMode: null,
            chain: null,
            marketDataExchange: null,
            vaultAddress: toNullableString(row?.vaultAddress),
            agentWallet: toNullableString(row?.agentWallet),
            subaccountAddress: null,
            lastAction: null,
            providerSelectionReason: null,
            pilotScope: null
          }
        : null;
  return {
    id: String(row.id),
    userId: String(row.userId),
    masterVaultId: String(row.masterVaultId),
    gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null,
    botId: row.botId ? String(row.botId) : null,
    principalAllocated: Number(row.principalAllocated ?? 0),
    principalReturned: Number(row.principalReturned ?? 0),
    realizedPnlNet: Number(row.realizedPnlNet ?? row.realizedNetUsd ?? 0),
    feePaidTotal: Number(row.feePaidTotal ?? row.profitShareAccruedUsd ?? 0),
    highWaterMark: Number(row.highWaterMark ?? 0),
    allocatedUsd: Number(row.allocatedUsd ?? 0),
    realizedGrossUsd: Number(row.realizedGrossUsd ?? 0),
    realizedFeesUsd: Number(row.realizedFeesUsd ?? 0),
    realizedNetUsd: Number(row.realizedNetUsd ?? 0),
    profitShareAccruedUsd: Number(row.profitShareAccruedUsd ?? 0),
    withdrawnUsd: Number(row.withdrawnUsd ?? 0),
    availableUsd: Number(row.availableUsd ?? 0),
    withdrawableUsd: computeWithdrawableUsd({
      availableUsd: Number(row.availableUsd ?? 0),
      principalAllocated: Number(row.principalAllocated ?? 0),
      principalReturned: Number(row.principalReturned ?? 0)
    }),
    executionProvider: row.executionProvider ? String(row.executionProvider) : null,
    executionUnitId: row.executionUnitId ? String(row.executionUnitId) : null,
    executionStatus: row.executionStatus ? String(row.executionStatus) : null,
    executionLastSyncedAt: row.executionLastSyncedAt instanceof Date ? row.executionLastSyncedAt.toISOString() : null,
    executionLastError: row.executionLastError ? String(row.executionLastError) : null,
    executionLastErrorAt: row.executionLastErrorAt instanceof Date ? row.executionLastErrorAt.toISOString() : null,
    lifecycle: mapBotVaultLifecycle(row),
    providerMetadataSummary,
    providerMetadataRaw: options?.includeProviderMetadataRaw ? providerMetadataRaw : null,
    status: String(row.status ?? "active"),
    lastAccountingAt: row.lastAccountingAt instanceof Date ? row.lastAccountingAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date().toISOString()
  };
}

type EnsureMasterVaultParams = {
  userId: string;
  tx?: any;
};

type EnsureBotVaultParams = {
  userId: string;
  gridInstanceId: string;
  allocatedUsd?: number;
  tx?: any;
};

type WithdrawParams = {
  userId: string;
  gridInstanceId: string;
  amountUsd: number;
  sourceKey?: string;
};

export type WithdrawFromGridInstanceResult = {
  botVault: BotVaultSnapshot;
  settlement: FeeSettlementMathResult;
};

type MasterVaultCashMutationParams = {
  userId: string;
  amountUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

type CreateVaultServiceDeps = {
  executionOrchestrator?: ExecutionProviderOrchestrator | null;
  masterVaultService?: MasterVaultService | null;
  botVaultLifecycleService?: BotVaultLifecycleService | null;
  feeSettlementService?: FeeSettlementService | null;
  tradingReconciliationService?: BotVaultTradingReconciliationService | null;
  executionLifecycleService?: ExecutionLifecycleService | null;
  riskPolicyService?: RiskPolicyService | null;
  readOnchainMasterVaultForOwner?: ((input: {
    ownerAddress: `0x${string}`;
    mode: VaultExecutionMode;
  }) => Promise<`0x${string}` | null>) | null;
  readOnchainMasterVaultState?: ((input: {
    masterVaultAddress: `0x${string}`;
    mode: VaultExecutionMode;
  }) => Promise<{
    freeBalance: number;
    reservedBalance: number;
  }>) | null;
};

export type BotVaultRiskEvaluationResult = {
  userId: string;
  botVaultId: string;
  gridInstanceId: string | null;
  botId: string | null;
  evaluation: RuntimeGuardrailEvaluation;
};

export type RuntimeGuardrailEnforcementSummary = {
  scanned: number;
  breached: number;
  paused: number;
  failed: number;
};

export function createVaultService(db: any, deps?: CreateVaultServiceDeps) {
  const executionOrchestrator = deps?.executionOrchestrator ?? null;
  const masterVaultService = deps?.masterVaultService ?? createMasterVaultService(db);
  const tradingReconciliationService = deps?.tradingReconciliationService
    ?? createBotVaultTradingReconciliationService(db);
  const feeSettlementService = deps?.feeSettlementService
    ?? createFeeSettlementService(db, { masterVaultService, tradingReconciliationService });
  const riskPolicyService = deps?.riskPolicyService
    ?? createRiskPolicyService(db);
  const executionLifecycleService = deps?.executionLifecycleService
    ?? createExecutionLifecycleService(db, { executionOrchestrator, riskPolicyService });
  const botVaultLifecycleService = deps?.botVaultLifecycleService
    ?? createBotVaultLifecycleService(db, {
      executionOrchestrator,
      masterVaultService,
      feeSettlementService,
      executionLifecycleService,
      riskPolicyService
    });
  const readOnchainMasterVaultForOwner = deps?.readOnchainMasterVaultForOwner
    ?? (async ({ ownerAddress, mode }: { ownerAddress: `0x${string}`; mode: VaultExecutionMode }) => {
      const addressBook = resolveOnchainAddressBook(mode);
      const publicClient = createOnchainPublicClient(addressBook);
      return readMasterVaultAddressForOwner(publicClient, addressBook.factoryAddress, ownerAddress);
    });
  const readOnchainMasterVaultStateForAddress = deps?.readOnchainMasterVaultState
    ?? (async ({ masterVaultAddress, mode }: { masterVaultAddress: `0x${string}`; mode: VaultExecutionMode }) => {
      const addressBook = resolveOnchainAddressBook(mode);
      const publicClient = createOnchainPublicClient(addressBook);
      return readMasterVaultState(publicClient, masterVaultAddress);
    });

  async function resolveMasterVaultBalances(masterVault: any) {
    const dbBalances = {
      freeBalance: Number(masterVault.freeBalance ?? 0),
      reservedBalance: Number(masterVault.reservedBalance ?? 0)
    };
    const onchainAddress = String(masterVault?.onchainAddress ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(onchainAddress)) {
      return dbBalances;
    }

    const vaultExecutionMode = await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow");
    if (!isOnchainMode(vaultExecutionMode as VaultExecutionMode)) {
      return dbBalances;
    }

    try {
      return await readOnchainMasterVaultStateForAddress({
        masterVaultAddress: onchainAddress as `0x${string}`,
        mode: vaultExecutionMode as VaultExecutionMode
      });
    } catch {
      return dbBalances;
    }
  }

  async function ensureMasterVault(params: EnsureMasterVaultParams): Promise<any> {
    const client = params.tx ?? db;
    const existing = await client.masterVault.findUnique({
      where: { userId: params.userId }
    });
    if (existing) return existing;
    try {
      const created = await client.masterVault.create({
        data: {
          userId: params.userId
        }
      });
      if (executionOrchestrator) {
        await executionOrchestrator.safeCreateUserVault({
          userId: params.userId,
          masterVaultId: String(created.id)
        });
      }
      return created;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await client.masterVault.findUnique({
        where: { userId: params.userId }
      });
      if (!raced) throw error;
      return raced;
    }
  }

  async function ensureMasterVaultExplicit(params: { userId: string }) {
    const masterVault = await syncMasterVaultFromOnchainForUser({ userId: params.userId });
    const balances = await resolveMasterVaultBalances(masterVault);
    const botVaultCount = await db.botVault.count({
      where: {
        userId: params.userId
      }
    });
    const pendingAction = await findLatestPendingAction(db, { masterVaultId: masterVault.id }, [
      "create_master_vault",
      "deposit_master_vault",
      "withdraw_master_vault"
    ]);
    const lifecycle: MasterVaultLifecycleResolution & {
      pendingActionUpdatedAt: string | null;
      pendingActionKey: string | null;
    } = {
      ...deriveMasterVaultLifecycleState({
        status: masterVault.status,
        pendingActionType: pendingAction?.actionType,
        pendingActionStatus: pendingAction?.status
      }),
      pendingActionUpdatedAt: pendingAction?.updatedAt ?? null,
      pendingActionKey: pendingAction?.actionKey ?? null
    };
    return {
      id: String(masterVault.id),
      userId: String(masterVault.userId),
      onchainAddress: masterVault.onchainAddress ? String(masterVault.onchainAddress) : null,
      freeBalance: balances.freeBalance,
      reservedBalance: balances.reservedBalance,
      withdrawableBalance: balances.freeBalance,
      totalDeposited: Number(masterVault.totalDeposited ?? 0),
      totalWithdrawn: Number(masterVault.totalWithdrawn ?? 0),
      totalAllocatedUsd: Number(masterVault.totalAllocatedUsd ?? 0),
      totalRealizedNetUsd: Number(masterVault.totalRealizedNetUsd ?? 0),
      totalProfitShareAccruedUsd: Number(masterVault.totalProfitShareAccruedUsd ?? 0),
      totalWithdrawnUsd: Number(masterVault.totalWithdrawnUsd ?? 0),
      availableUsd: Number(masterVault.availableUsd ?? 0),
      status: String(masterVault.status ?? "active"),
      lifecycle,
      botVaultCount,
      updatedAt: masterVault.updatedAt instanceof Date ? masterVault.updatedAt.toISOString() : null
    };
  }

  async function ensureBotVaultForGridInstance(params: EnsureBotVaultParams): Promise<any> {
    const client = params.tx ?? db;
    const existing = await client.botVault.findUnique({
      where: { gridInstanceId: params.gridInstanceId }
    });
    if (existing) return existing;

    let allocationUsd = toPositiveAmount(params.allocatedUsd ?? 0);
    if (allocationUsd <= 0) {
      const instance = await client.gridBotInstance.findUnique({
        where: { id: params.gridInstanceId },
        select: {
          id: true,
          userId: true,
          investUsd: true,
          extraMarginUsd: true
        }
      });
      if (!instance) throw new Error("grid_instance_not_found");
      if (String(instance.userId) !== String(params.userId)) throw new Error("grid_instance_user_mismatch");
      allocationUsd = roundUsd(Number(instance.investUsd ?? 0) + Number(instance.extraMarginUsd ?? 0), 4);
    }

    const allocationSourceKey = `grid_instance:${params.gridInstanceId}:allocation:v1`;
    return botVaultLifecycleService.create({
      tx: client,
      userId: params.userId,
      gridInstanceId: params.gridInstanceId,
      allocationUsd,
      idempotencyKey: allocationSourceKey,
      metadata: {
        sourceType: "grid_instance_create"
      }
    });
  }

  async function topUpBotVaultForGridInstance(params: {
    userId: string;
    gridInstanceId: string;
    amountUsd: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findUnique({
      where: { gridInstanceId: params.gridInstanceId }
    });
    if (!botVault) throw new Error("bot_vault_not_found");
    if (String(botVault.userId) !== String(params.userId)) throw new Error("bot_vault_user_mismatch");
    return botVaultLifecycleService.topUp({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id),
      amountUsd: params.amountUsd,
      idempotencyKey: params.idempotencyKey,
      metadata: params.metadata
    });
  }

  async function pauseBotVaultForGridInstance(params: {
    userId: string;
    gridInstanceId: string;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findUnique({
      where: { gridInstanceId: params.gridInstanceId }
    });
    if (!botVault) return null;
    if (String(botVault.userId) !== String(params.userId)) throw new Error("bot_vault_user_mismatch");
    return botVaultLifecycleService.pause({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
  }

  async function activateBotVaultForGridInstance(params: {
    userId: string;
    gridInstanceId: string;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findUnique({
      where: { gridInstanceId: params.gridInstanceId }
    });
    if (!botVault) return null;
    if (String(botVault.userId) !== String(params.userId)) throw new Error("bot_vault_user_mismatch");
    return botVaultLifecycleService.activate({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
  }

  async function setBotVaultCloseOnlyForGridInstance(params: {
    userId: string;
    gridInstanceId: string;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findUnique({
      where: { gridInstanceId: params.gridInstanceId }
    });
    if (!botVault) return null;
    if (String(botVault.userId) !== String(params.userId)) throw new Error("bot_vault_user_mismatch");
    return botVaultLifecycleService.setCloseOnly({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
  }

  async function closeBotVaultForGridInstance(params: {
    userId: string;
    gridInstanceId: string;
    idempotencyKey: string;
    forceClose?: boolean;
    metadata?: Record<string, unknown>;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findUnique({
      where: { gridInstanceId: params.gridInstanceId }
    });
    if (!botVault) return null;
    if (String(botVault.userId) !== String(params.userId)) throw new Error("bot_vault_user_mismatch");
    return botVaultLifecycleService.close({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id),
      idempotencyKey: params.idempotencyKey,
      forceClose: params.forceClose,
      metadata: params.metadata
    });
  }

  function deriveGridInitialSeedMatchingState(metricsJson: unknown): ReturnType<typeof parseBotVaultMatchingState> | null {
    const metrics = metricsJson && typeof metricsJson === "object" && !Array.isArray(metricsJson)
      ? (metricsJson as Record<string, unknown>)
      : null;
    const initialSeedRaw = metrics?.initialSeed;
    if (!initialSeedRaw || typeof initialSeedRaw !== "object" || Array.isArray(initialSeedRaw)) return null;
    const initialSeed = initialSeedRaw as Record<string, unknown>;
    const enabled = initialSeed.enabled !== false;
    const seedSide = String(initialSeed.seedSide ?? "").trim().toLowerCase();
    const seedQty = Number(initialSeed.seedQty ?? NaN);
    const seedNotionalUsd = Number(initialSeed.seedNotionalUsd ?? NaN);
    if (!enabled) return null;
    if (!Number.isFinite(seedQty) || seedQty <= 0) return null;
    if (seedSide !== "buy" && seedSide !== "sell" && seedSide !== "long" && seedSide !== "short") return null;
    const impliedPrice = Number.isFinite(seedNotionalUsd) && seedNotionalUsd > 0
      ? seedNotionalUsd / seedQty
      : Number(initialSeed.seedPrice ?? NaN);
    if (!Number.isFinite(impliedPrice) || impliedPrice <= 0) return null;
    const seededLot = {
      qty: Number(seedQty.toFixed(12)),
      price: Number(impliedPrice.toFixed(12)),
      feePerUnit: 0,
    };
    return seedSide === "sell" || seedSide === "short"
      ? parseBotVaultMatchingState({ version: 1, longLots: [], shortLots: [seededLot] })
      : parseBotVaultMatchingState({ version: 1, longLots: [seededLot], shortLots: [] });
  }

  async function processGridFillEvent(fillEventId: string): Promise<{
    processed: boolean;
    realizedNetUsd: number;
    profitShareFeeUsd: number;
  }> {
    return db.$transaction(async (tx: any) => {
      const fill = await tx.gridBotFillEvent.findUnique({
        where: { id: fillEventId },
        select: {
          id: true,
          instanceId: true,
          side: true,
          fillPrice: true,
          fillQty: true,
          feeUsd: true,
          fillTs: true,
          isAccounted: true
        }
      });
      if (!fill) return { processed: false, realizedNetUsd: 0, profitShareFeeUsd: 0 };
      if (fill.isAccounted) return { processed: false, realizedNetUsd: 0, profitShareFeeUsd: 0 };

      const instance = await tx.gridBotInstance.findUnique({
        where: { id: fill.instanceId },
        select: {
          id: true,
          userId: true,
          investUsd: true,
          extraMarginUsd: true,
          metricsJson: true,
          exchangeAccount: {
            select: {
              exchange: true
            }
          }
        }
      });
      if (!instance) {
        await tx.gridBotFillEvent.update({
          where: { id: fill.id },
          data: {
            isAccounted: true,
            accountedAt: new Date()
          }
        });
        return { processed: false, realizedNetUsd: 0, profitShareFeeUsd: 0 };
      }

      const botVault = await ensureBotVaultForGridInstance({
        tx,
        userId: instance.userId,
        gridInstanceId: instance.id,
        allocatedUsd: Number(instance.investUsd ?? 0) + Number(instance.extraMarginUsd ?? 0)
      });
      const vaultExecutionMode = await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow");
      const isHyperliquidReconciliationOnly =
        isOnchainMode(vaultExecutionMode as any)
        && String(instance.exchangeAccount?.exchange ?? "").trim().toLowerCase() === "hyperliquid";

      if (isHyperliquidReconciliationOnly) {
        await tx.botVault.update({
          where: { id: botVault.id },
          data: {
            lastAccountingAt: new Date()
          }
        });
        await tx.gridBotFillEvent.update({
          where: { id: fill.id },
          data: {
            isAccounted: true,
            accountedAt: new Date()
          }
        });
        return { processed: true, realizedNetUsd: 0, profitShareFeeUsd: 0 };
      }
      const masterVault = await ensureMasterVault({
        tx,
        userId: instance.userId
      });
      let currentState = parseBotVaultMatchingState(botVault.matchingStateJson);
      if (currentState.longLots.length === 0 && currentState.shortLots.length === 0) {
        const seededState = deriveGridInitialSeedMatchingState(instance.metricsJson);
        if (seededState) {
          currentState = seededState;
        }
      }
      const realized = applyFillToRealizedPnl(currentState, {
        side: normalizeSide(fill.side),
        price: Number(fill.fillPrice ?? 0),
        qty: Number(fill.fillQty ?? 0),
        feeUsd: Number(fill.feeUsd ?? 0)
      });

      const realizedGrossUsd = roundUsd(realized.realizedGrossUsd, 4);
      const realizedFeesUsd = roundUsd(realized.realizedFeesUsd, 4);
      const realizedNetUsd = roundUsd(realized.realizedNetUsd, 4);

      let realizedBooked = false;
      if (realizedNetUsd !== 0) {
        const realizedLedger = await bookVaultLedgerEntry({
          tx,
          userId: instance.userId,
          masterVaultId: masterVault.id,
          botVaultId: botVault.id,
          gridInstanceId: instance.id,
          entryType: "REALIZED_PNL",
          amountUsd: realizedNetUsd,
          sourceType: "grid_fill_realized_pnl",
          sourceKey: `grid_fill:${fill.id}:realized`,
          sourceTs: fill.fillTs instanceof Date ? fill.fillTs : new Date(fill.fillTs),
          metadataJson: {
            fillEventId: fill.id,
            realizedGrossUsd,
            realizedFeesUsd
          }
        });
        realizedBooked = realizedLedger.created;
      }

      const botAvailableDelta = roundUsd(realizedBooked ? realizedNetUsd : 0, 4);

      await tx.botVault.update({
        where: { id: botVault.id },
        data: {
          matchingStateJson: realized.nextState,
          lastAccountingAt: new Date(),
          ...(realizedBooked
            ? {
                realizedGrossUsd: { increment: realizedGrossUsd },
                realizedFeesUsd: { increment: realizedFeesUsd },
                realizedNetUsd: { increment: realizedNetUsd },
                realizedPnlNet: { increment: realizedNetUsd }
              }
            : {}),
          ...(botAvailableDelta !== 0
            ? {
                availableUsd: { increment: botAvailableDelta }
              }
            : {})
        }
      });

      if (realizedBooked) {
        await tx.masterVault.update({
          where: { id: masterVault.id },
          data: {
            totalRealizedNetUsd: { increment: realizedNetUsd },
            ...(botAvailableDelta !== 0
              ? {
                  availableUsd: { increment: botAvailableDelta }
                }
              : {})
          }
        });
      }

      await tx.gridBotFillEvent.update({
        where: { id: fill.id },
        data: {
          isAccounted: true,
          accountedAt: new Date()
        }
      });

      return {
        processed: true,
        realizedNetUsd: realizedBooked ? realizedNetUsd : 0,
        profitShareFeeUsd: 0
      };
    });
  }

  async function processPendingGridFillEvents(params?: { limit?: number }) {
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(params?.limit ?? 100))));
    const rows = await db.gridBotFillEvent.findMany({
      where: {
        isAccounted: false
      },
      select: {
        id: true
      },
      orderBy: [
        { fillTs: "asc" },
        { createdAt: "asc" }
      ],
      take: limit
    });

    let processed = 0;
    let realizedEvents = 0;
    let realizedNetUsd = 0;
    let profitShareFeeUsd = 0;
    for (const row of rows) {
      const event = await processGridFillEvent(String(row.id));
      if (!event.processed) continue;
      processed += 1;
      if (event.realizedNetUsd !== 0) realizedEvents += 1;
      realizedNetUsd = roundUsd(realizedNetUsd + event.realizedNetUsd, 4);
      profitShareFeeUsd = roundUsd(profitShareFeeUsd + event.profitShareFeeUsd, 4);
    }
    return {
      processed,
      realizedEvents,
      realizedNetUsd,
      profitShareFeeUsd
    };
  }

  async function withdrawFromGridInstance(params: WithdrawParams): Promise<WithdrawFromGridInstanceResult> {
    const amountUsd = toPositiveAmount(params.amountUsd);
    if (amountUsd <= 0) throw new Error("invalid_withdraw_amount");

    return db.$transaction(async (tx: any) => {
      const instance = await tx.gridBotInstance.findFirst({
        where: {
          id: params.gridInstanceId,
          userId: params.userId
        },
        select: {
          id: true,
          userId: true
        }
      });
      if (!instance) throw new Error("grid_instance_not_found");

      let botVault = await tx.botVault.findUnique({
        where: { gridInstanceId: instance.id }
      });
      if (!botVault) {
        botVault = await ensureBotVaultForGridInstance({
          tx,
          userId: params.userId,
          gridInstanceId: instance.id
        });
      }

      const withdrawableUsd = computeWithdrawableUsd(botVault);
      if (amountUsd > withdrawableUsd + 0.0000001) {
        throw new Error("insufficient_withdrawable_profit");
      }

      const sourceKey = params.sourceKey
        ?? `grid_instance:${instance.id}:withdraw:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

      const settlement = await feeSettlementService.settleProfitWithdraw({
        tx,
        userId: params.userId,
        botVaultId: String(botVault.id),
        requestedGrossUsd: amountUsd,
        idempotencyKey: sourceKey,
        metadata: {
          gridInstanceId: instance.id,
          sourceType: "grid_withdraw_profit",
          withdrawableBeforeUsd: withdrawableUsd
        }
      });

      return {
        botVault: mapBotVaultSnapshot(settlement.botVaultSnapshotAfter),
        settlement: settlement.settlementBreakdown
      };
    });
  }

  async function getMasterVaultSummary(params: { userId: string }) {
    const masterVault = await syncMasterVaultFromOnchainForUser({ userId: params.userId });
    const balances = await resolveMasterVaultBalances(masterVault);
    const onchainProfile = masterVault.onchainAddress && isOnchainMode(await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow"))
      ? await (async () => {
          try {
            const mode = await getEffectiveVaultExecutionMode(db);
            const addressBook = resolveOnchainAddressBook(mode);
            const publicClient = createOnchainPublicClient(addressBook);
            const [treasuryRecipient, feeRatePct] = await Promise.all([
              readMasterVaultTreasuryRecipient(publicClient, String(masterVault.onchainAddress) as `0x${string}`),
              readMasterVaultProfitShareFeeRatePct(publicClient, String(masterVault.onchainAddress) as `0x${string}`)
            ]);
            return {
              treasuryRecipient,
              feeRatePct
            };
          } catch {
            return {
              treasuryRecipient: null,
              feeRatePct: null
            };
          }
        })()
      : {
          treasuryRecipient: null,
          feeRatePct: null
        };
    const botVaultCount = await db.botVault.count({
      where: { userId: params.userId }
    });
    const pendingAction = await findLatestPendingAction(db, { masterVaultId: masterVault.id }, [
      "create_master_vault",
      "deposit_master_vault",
      "withdraw_master_vault"
    ]);
    const lifecycle: MasterVaultLifecycleResolution & {
      pendingActionUpdatedAt: string | null;
      pendingActionKey: string | null;
    } = {
      ...deriveMasterVaultLifecycleState({
        status: masterVault.status,
        pendingActionType: pendingAction?.actionType,
        pendingActionStatus: pendingAction?.status
      }),
      pendingActionUpdatedAt: pendingAction?.updatedAt ?? null,
      pendingActionKey: pendingAction?.actionKey ?? null
    };
    return {
      id: String(masterVault.id),
      userId: String(masterVault.userId),
      onchainAddress: masterVault.onchainAddress ? String(masterVault.onchainAddress) : null,
      treasuryRecipient: onchainProfile.treasuryRecipient,
      feeRatePct: Number.isFinite(Number(onchainProfile.feeRatePct)) ? Number(onchainProfile.feeRatePct) : 30,
      freeBalance: balances.freeBalance,
      reservedBalance: balances.reservedBalance,
      withdrawableBalance: balances.freeBalance,
      totalDeposited: Number(masterVault.totalDeposited ?? 0),
      totalWithdrawn: Number(masterVault.totalWithdrawn ?? 0),
      totalAllocatedUsd: Number(masterVault.totalAllocatedUsd ?? 0),
      totalRealizedNetUsd: Number(masterVault.totalRealizedNetUsd ?? 0),
      totalProfitShareAccruedUsd: Number(masterVault.totalProfitShareAccruedUsd ?? 0),
      totalWithdrawnUsd: Number(masterVault.totalWithdrawnUsd ?? 0),
      availableUsd: Number(masterVault.availableUsd ?? 0),
      status: String(masterVault.status ?? "active"),
      lifecycle,
      botVaultCount,
      updatedAt: masterVault.updatedAt instanceof Date ? masterVault.updatedAt.toISOString() : null
    };
  }

  async function listBotVaults(params: { userId: string; gridInstanceId?: string }) {
    const rows = await db.botVault.findMany({
      where: {
        userId: params.userId,
        ...(params.gridInstanceId ? { gridInstanceId: params.gridInstanceId } : {})
      },
      include: {
        onchainActions: {
          where: {
            status: { in: ["prepared", "submitted"] }
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
          select: {
            actionKey: true,
            actionType: true,
            status: true,
            updatedAt: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }]
    });
    return rows.map((row: any) => mapBotVaultSnapshot(row));
  }

  async function listCopyBotTemplates(_params: { userId: string }) {
    const rows = await db.gridBotTemplate.findMany({
      where: {
        isPublished: true,
        isArchived: false
      },
      orderBy: [{ updatedAt: "desc" }]
    });
    return rows.map((row: any): CopyBotTemplateSnapshot => ({
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      name: String(row.name),
      description: row.description == null ? null : String(row.description),
      symbol: String(row.symbol),
      marketType: String(row.marketType ?? "perp"),
      mode: String(row.mode),
      gridMode: String(row.gridMode),
      allocationMode: String(row.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID"),
      budgetSplitPolicy: String(row.budgetSplitPolicy ?? "FIXED_50_50"),
      longBudgetPct: Number.isFinite(Number(row.longBudgetPct)) ? Number(row.longBudgetPct) : 50,
      shortBudgetPct: Number.isFinite(Number(row.shortBudgetPct)) ? Number(row.shortBudgetPct) : 50,
      marginPolicy: String(row.marginPolicy ?? (row.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY")),
      autoMarginMaxUSDT: Number.isFinite(Number(row.autoMarginMaxUSDT)) ? Number(row.autoMarginMaxUSDT) : null,
      autoMarginTriggerType: row.autoMarginTriggerType == null ? null : String(row.autoMarginTriggerType),
      autoMarginTriggerValue: Number.isFinite(Number(row.autoMarginTriggerValue)) ? Number(row.autoMarginTriggerValue) : null,
      autoMarginStepUSDT: Number.isFinite(Number(row.autoMarginStepUSDT)) ? Number(row.autoMarginStepUSDT) : null,
      autoMarginCooldownSec: Number.isFinite(Number(row.autoMarginCooldownSec)) ? Number(row.autoMarginCooldownSec) : null,
      autoReservePolicy: String(row.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID"),
      autoReserveFixedGridPct: Number.isFinite(Number(row.autoReserveFixedGridPct)) ? Number(row.autoReserveFixedGridPct) : 70,
      autoReserveTargetLiqDistancePct: Number.isFinite(Number(row.autoReserveTargetLiqDistancePct)) ? Number(row.autoReserveTargetLiqDistancePct) : null,
      autoReserveMaxPreviewIterations: Number.isFinite(Number(row.autoReserveMaxPreviewIterations))
        ? Math.trunc(Number(row.autoReserveMaxPreviewIterations))
        : 8,
      lowerPrice: Number(row.lowerPrice ?? 0),
      upperPrice: Number(row.upperPrice ?? 0),
      gridCount: Number(row.gridCount ?? 0),
      leverageMin: Number(row.leverageMin ?? 1),
      leverageMax: Number(row.leverageMax ?? 1),
      leverageDefault: Number(row.leverageDefault ?? 1),
      investMinUsd: Number(row.investMinUsd ?? 0),
      investMaxUsd: Number(row.investMaxUsd ?? 0),
      investDefaultUsd: Number(row.investDefaultUsd ?? 0),
      slippageDefaultPct: Number(row.slippageDefaultPct ?? 0),
      slippageMinPct: Number(row.slippageMinPct ?? 0),
      slippageMaxPct: Number(row.slippageMaxPct ?? 0),
      tpDefaultPct: row.tpDefaultPct == null ? null : Number(row.tpDefaultPct),
      slDefaultPct: row.slDefaultPct == null ? null : Number(row.slDefaultPct),
      allowAutoMargin: Boolean(row.allowAutoMargin),
      allowManualMarginAdjust: Boolean(row.allowManualMarginAdjust),
      allowProfitWithdraw: Boolean(row.allowProfitWithdraw),
      isPublished: Boolean(row.isPublished),
      isArchived: Boolean(row.isArchived),
      version: Number(row.version ?? 1),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
    }));
  }

  async function getBotVaultByGridInstance(params: { userId: string; gridInstanceId: string }) {
    const row = await db.botVault.findUnique({
      where: { gridInstanceId: params.gridInstanceId },
      include: {
        onchainActions: {
          where: {
            status: { in: ["prepared", "submitted"] }
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
          select: {
            actionKey: true,
            actionType: true,
            status: true,
            updatedAt: true
          }
        }
      }
    });
    if (!row) return null;
    if (String(row.userId) !== String(params.userId)) return null;
    return mapBotVaultSnapshot(row);
  }

  async function listBotVaultLedger(params: { userId: string; botVaultId: string; limit?: number }) {
    const botVault = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: { id: true }
    });
    if (!botVault) return [];
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(params.limit ?? 200))));
    return db.vaultLedgerEntry.findMany({
      where: {
        userId: params.userId,
        botVaultId: botVault.id
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit
    });
  }

  async function listFeeEvents(params: { userId: string; botVaultId: string; limit?: number }) {
    const botVault = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: { id: true }
    });
    if (!botVault) return [];
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(params.limit ?? 200))));
    return db.feeEvent.findMany({
      where: { botVaultId: botVault.id },
      orderBy: [{ createdAt: "desc" }],
      take: limit
    });
  }

  async function listBotExecutionEvents(params: { userId: string; botVaultId: string; limit?: number }) {
    return executionLifecycleService.listExecutionEvents({
      userId: params.userId,
      botVaultId: params.botVaultId,
      limit: params.limit
    });
  }

  async function getExecutionStateForGridInstance(params: {
    userId: string;
    gridInstanceId: string;
    sourceKey?: string;
  }) {
    const botVault = await db.botVault.findFirst({
      where: {
        userId: params.userId,
        gridInstanceId: params.gridInstanceId
      },
      select: { id: true }
    });
    if (!botVault) return null;
    return executionLifecycleService.syncExecutionState({
      userId: params.userId,
      botVaultId: String(botVault.id),
      sourceKey: params.sourceKey
        ?? `grid_instance:${params.gridInstanceId}:execution_state:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    });
  }

  async function syncBotVaultExecutionState(params: {
    userId: string;
    botVaultId: string;
    sourceKey?: string;
  }) {
    return executionLifecycleService.syncExecutionState({
      userId: params.userId,
      botVaultId: params.botVaultId,
      sourceKey: params.sourceKey
        ?? `bot_vault:${params.botVaultId}:execution_state:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    });
  }

  async function pauseBotVault(params: {
    userId: string;
    botVaultId: string;
    reason?: string;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: { id: true }
    });
    if (!botVault) return null;
    return botVaultLifecycleService.pause({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id),
      reason: params.reason
    });
  }

  async function activateBotVault(params: {
    userId: string;
    botVaultId: string;
    reason?: string;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: { id: true }
    });
    if (!botVault) return null;
    return botVaultLifecycleService.activate({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id),
      reason: params.reason
    });
  }

  async function setBotVaultCloseOnly(params: {
    userId: string;
    botVaultId: string;
    reason?: string;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: {
        id: true
      }
    });
    if (!botVault) return null;
    return botVaultLifecycleService.setCloseOnly({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id),
      reason: params.reason
    });
  }

  async function closeBotVault(params: {
    userId: string;
    botVaultId: string;
    idempotencyKey: string;
    forceClose?: boolean;
    metadata?: Record<string, unknown>;
    tx?: any;
  }) {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: { id: true }
    });
    if (!botVault) return null;
    return botVaultLifecycleService.close({
      tx: client,
      userId: params.userId,
      botVaultId: String(botVault.id),
      idempotencyKey: params.idempotencyKey,
      forceClose: params.forceClose,
      metadata: params.metadata
    });
  }

  async function getBotVaultLifecycleSnapshot(params: {
    botVaultId: string;
    userId?: string;
  }): Promise<BotVaultSnapshot | null> {
    const row = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        ...(params.userId ? { userId: params.userId } : {})
      },
      include: {
        onchainActions: {
          where: {
            status: { in: ["prepared", "submitted"] }
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
          select: {
            actionKey: true,
            actionType: true,
            status: true,
            updatedAt: true
          }
        }
      }
    });
    if (!row) return null;
    return mapBotVaultSnapshot(row, { includeProviderMetadataRaw: true });
  }

  async function evaluateBotVaultRisk(params: {
    userId: string;
    botVaultId: string;
    includeExecutionState?: boolean;
    sourceKey?: string;
    tx?: any;
  }): Promise<BotVaultRiskEvaluationResult | null> {
    const client = params.tx ?? db;
    const botVault = await client.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: {
        id: true,
        userId: true,
        templateId: true,
        principalAllocated: true,
        gridInstanceId: true,
        botId: true,
        bot: {
          select: {
            id: true,
            symbol: true,
            exchange: true,
            futuresConfig: {
              select: {
                leverage: true
              }
            }
          }
        },
        gridInstance: {
          select: {
            id: true,
            botId: true,
            leverage: true,
            template: {
              select: {
                symbol: true
              }
            }
          }
        }
      }
    });
    if (!botVault) return null;

    if (params.includeExecutionState) {
      await executionLifecycleService.syncExecutionState({
        tx: client,
        userId: params.userId,
        botVaultId: String(botVault.id),
        sourceKey: params.sourceKey
          ?? `bot_vault:${botVault.id}:risk_sync:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        metadata: {
          sourceType: "runtime_risk_evaluation"
        }
      });
    }

    const evaluation = await riskPolicyService.evaluateRuntimeGuardrails({
      tx: client,
      templateId: String(botVault.templateId ?? "legacy_grid_default"),
      symbol: String(botVault.gridInstance?.template?.symbol ?? botVault.bot?.symbol ?? ""),
      leverage: Number(botVault.gridInstance?.leverage ?? botVault.bot?.futuresConfig?.leverage ?? 1),
      allocationUsd: Number(botVault.principalAllocated ?? 0)
    });

    return {
      userId: String(botVault.userId),
      botVaultId: String(botVault.id),
      gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
      botId: botVault.botId
        ? String(botVault.botId)
        : botVault.gridInstance?.botId ? String(botVault.gridInstance.botId) : null,
      evaluation
    };
  }

  async function enforceRuntimeGuardrailsForActiveVaults(params?: { limit?: number }) {
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(params?.limit ?? 100))));
    const rows = await db.botVault.findMany({
      where: {
        status: {
          in: ["ACTIVE", "PAUSED", "ERROR"]
        }
      },
      select: {
        id: true,
        userId: true,
        status: true,
        templateId: true,
        principalAllocated: true,
        botId: true,
        bot: {
          select: {
            id: true,
            status: true,
            symbol: true,
            futuresConfig: {
              select: {
                leverage: true
              }
            }
          }
        },
        gridInstance: {
          select: {
            id: true,
            state: true,
            botId: true,
            leverage: true,
            template: {
              select: {
                symbol: true
              }
            }
          }
        }
      },
      orderBy: [{ updatedAt: "asc" }],
      take: limit
    });

    let scanned = 0;
    let breached = 0;
    let paused = 0;
    let failed = 0;

    for (const row of rows) {
      const isGridRunning = row.gridInstance
        ? String(row.gridInstance.state ?? "").trim().toLowerCase() === "running"
        : false;
      const isBotRunning = row.bot
        ? String(row.bot.status ?? "").trim().toLowerCase() === "running"
        : false;
      if (!isGridRunning && !isBotRunning) continue;

      scanned += 1;
      try {
        const evaluation = await riskPolicyService.evaluateRuntimeGuardrails({
          templateId: String(row.templateId ?? "legacy_grid_default"),
          symbol: String(row.gridInstance?.template?.symbol ?? row.bot?.symbol ?? ""),
          leverage: Number(row.gridInstance?.leverage ?? row.bot?.futuresConfig?.leverage ?? 1),
          allocationUsd: Number(row.principalAllocated ?? 0)
        });

        if (!evaluation.breached) continue;
        breached += 1;

        if (evaluation.action !== "pause") continue;

        await db.$transaction(async (tx: any) => {
          await botVaultLifecycleService.pause({
            tx,
            userId: String(row.userId),
            botVaultId: String(row.id),
            reason: "risk_guardrail_emergency_pause"
          });

          if (row.gridInstance?.id && tx?.gridBotInstance?.update) {
            await tx.gridBotInstance.update({
              where: { id: row.gridInstance.id },
              data: {
                state: "paused"
              }
            });
          }

          const attachedBotId = row.bot?.id ?? row.gridInstance?.botId ?? null;
          if (attachedBotId && tx?.bot?.update) {
            await tx.bot.update({
              where: { id: attachedBotId },
              data: {
                status: "stopped"
              }
            });
          }

          if (attachedBotId && tx?.riskEvent?.create) {
            await tx.riskEvent.create({
              data: {
                botId: attachedBotId,
                type: "bot_vault_guardrail_emergency_pause",
                message: evaluation.violations.map((entry) => entry.code).join(","),
                meta: {
                  botVaultId: row.id,
                  templateId: row.templateId,
                  violations: evaluation.violations
                }
              }
            });
          }
        });
        paused += 1;
      } catch {
        failed += 1;
      }
    }

    const summary: RuntimeGuardrailEnforcementSummary = {
      scanned,
      breached,
      paused,
      failed
    };
    return summary;
  }

  async function listProfitShareAccruals(params: { userId: string; botVaultId?: string; limit?: number }) {
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(params.limit ?? 200))));
    return db.profitShareAccrual.findMany({
      where: {
        userId: params.userId,
        ...(params.botVaultId ? { botVaultId: params.botVaultId } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit
    });
  }

  async function depositToMasterVault(params: MasterVaultCashMutationParams) {
    return masterVaultService.deposit({
      userId: params.userId,
      amountUsd: params.amountUsd,
      idempotencyKey: params.idempotencyKey,
      metadata: params.metadata
    });
  }

  async function validateMasterVaultWithdraw(params: { userId: string; amountUsd: number }) {
    return masterVaultService.validateWithdraw({
      userId: params.userId,
      amountUsd: params.amountUsd
    });
  }

  async function withdrawFromMasterVault(params: MasterVaultCashMutationParams) {
    return masterVaultService.withdraw({
      userId: params.userId,
      amountUsd: params.amountUsd,
      idempotencyKey: params.idempotencyKey,
      metadata: params.metadata
    });
  }

  async function reconcileTradingBotVaults(params?: { limit?: number }) {
    return tradingReconciliationService.reconcileHyperliquidBotVaults({
      limit: params?.limit
    });
  }

  async function getBotVaultPnlReport(params: {
    userId: string;
    botVaultId: string;
    fillsLimit?: number;
  }) {
    return tradingReconciliationService.getBotVaultPnlReport(params);
  }

  async function getBotVaultAudit(params: {
    userId: string;
    botVaultId: string;
    limit?: number;
    cursor?: string;
  }) {
    return tradingReconciliationService.getBotVaultAudit(params);
  }

  async function setAllUserBotVaultsCloseOnly(params: {
    userId: string;
    actorUserId?: string | null;
    reason?: string | null;
    idempotencyKeyPrefix: string;
  }) {
    const rows = await db.botVault.findMany({
      where: {
        userId: params.userId,
        status: {
          in: ["ACTIVE", "PAUSED", "ERROR", "STOPPED"]
        }
      },
      select: {
        id: true,
        gridInstanceId: true
      }
    });

    let updated = 0;
    const failed: Array<{ botVaultId: string; reason: string }> = [];
    for (const row of rows) {
      try {
        await botVaultLifecycleService.setCloseOnly({
          userId: params.userId,
          botVaultId: String(row.id),
          reason: `${params.reason ?? "admin_close_only_all"}:${params.idempotencyKeyPrefix}`
        });
        updated += 1;
      } catch (error) {
        failed.push({
          botVaultId: String(row.id),
          reason: String(error)
        });
      }
    }

    return {
      userId: params.userId,
      actorUserId: params.actorUserId ?? null,
      scanned: rows.length,
      updated,
      failed
    };
  }

  async function syncMasterVaultFromOnchainForUser(params: { userId: string; tx?: any }) {
    const client = params.tx ?? db;
    const masterVault = await ensureMasterVault({ userId: params.userId, tx: client });
    if (masterVault?.onchainAddress) return masterVault;

    const user = await client.user.findUnique({
      where: { id: params.userId },
      select: { walletAddress: true }
    });
    const ownerAddress = String(user?.walletAddress ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(ownerAddress)) {
      return masterVault;
    }

    const vaultExecutionMode = await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow");
    if (!isOnchainMode(vaultExecutionMode as VaultExecutionMode)) {
      return masterVault;
    }

    let resolvedAddress: `0x${string}` | null = null;
    try {
      resolvedAddress = await readOnchainMasterVaultForOwner({
        ownerAddress: ownerAddress as `0x${string}`,
        mode: vaultExecutionMode as VaultExecutionMode
      });
    } catch {
      return masterVault;
    }

    if (!resolvedAddress) {
      return masterVault;
    }

    const conflict = await client.masterVault.findFirst({
      where: {
        onchainAddress: resolvedAddress,
        userId: { not: params.userId }
      },
      select: { id: true }
    });
    if (conflict) {
      return masterVault;
    }

    try {
      return await client.masterVault.update({
        where: { id: masterVault.id },
        data: { onchainAddress: resolvedAddress }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await client.masterVault.findUnique({
        where: { userId: params.userId }
      });
      return raced ?? masterVault;
    }
  }

  return {
    ensureMasterVault,
    ensureMasterVaultExplicit,
    syncMasterVaultFromOnchainForUser,
    ensureBotVaultForGridInstance,
    topUpBotVaultForGridInstance,
    pauseBotVaultForGridInstance,
    activateBotVaultForGridInstance,
    setBotVaultCloseOnlyForGridInstance,
    closeBotVaultForGridInstance,
    processGridFillEvent,
    processPendingGridFillEvents,
    withdrawFromGridInstance,
    getMasterVaultSummary,
    listCopyBotTemplates,
    listBotVaults,
    getBotVaultByGridInstance,
    listBotVaultLedger,
    listFeeEvents,
    listBotExecutionEvents,
    listProfitShareAccruals,
    getExecutionStateForGridInstance,
    syncBotVaultExecutionState,
    pauseBotVault,
    activateBotVault,
    setBotVaultCloseOnly,
    closeBotVault,
    getBotVaultLifecycleSnapshot,
    evaluateBotVaultRisk,
    enforceRuntimeGuardrailsForActiveVaults,
    depositToMasterVault,
    validateMasterVaultWithdraw,
    withdrawFromMasterVault,
    reconcileTradingBotVaults,
    getBotVaultPnlReport,
    getBotVaultAudit,
    setAllUserBotVaultsCloseOnly
  };
}

export type VaultService = ReturnType<typeof createVaultService>;
