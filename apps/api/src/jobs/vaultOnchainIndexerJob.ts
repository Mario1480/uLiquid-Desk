import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, http, isAddress, parseAbi, type Hex, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BOT_VAULT_RUNTIME_MODEL_V4,
  botVaultRuntimeReasonCode,
  isBotVaultRuntimeModelRow,
  resolveBotVaultRuntimeModel
} from "@mm/core";
import { logger } from "../logger.js";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "../vaults/executionMode.js";
import {
  resolveHyperEvmWriteRpcUrl,
  resolveAllOnchainAddressBooks,
  resolveBotVaultFactoryAddress,
  resolveOnchainAddressBook
} from "../vaults/onchainAddressBook.js";
import {
  createOnchainPublicClient,
  readBotVaultV3AddressForBotId,
  formatSignedUsdFromAtomic,
  formatUsdFromAtomic,
  readBotVaultState,
  readBotVaultV3State,
  readMasterVaultAddressForOwner,
  readMasterVaultState
} from "../vaults/onchainProvider.js";
import {
    botVaultAbi,
    botVaultFactoryV3Abi,
    botVaultFactoryV4Abi,
    botVaultV2Abi,
    botVaultV3Abi,
    fundingVaultFactoryV1Abi,
    fundingVaultV1Abi,
    masterVaultAbi,
  masterVaultFactoryAbi,
  masterVaultFactoryV2Abi,
  masterVaultV2Abi
} from "../vaults/onchainAbi.js";
import { createOnchainActionService, type OnchainActionService } from "../vaults/onchainAction.service.js";
import {
  buildBotVaultFundingLifecycleTransitionPatch,
  createBotVaultFundingLifecycleMetadata,
  getBotVaultFundingLifecycleStage
} from "../vaults/botVaultRuntime.lifecycle.js";
import type { BotVaultRuntimeService } from "../vaults/botVaultRuntime.service.js";
import type { ExecutionLifecycleService } from "../vaults/executionLifecycle.service.js";
import {
  DEFAULT_SETTLEMENT_FEE_RATE_PCT
} from "../vaults/feeSettlement.math.js";
import {
  LEGACY_TREASURY_CONTRACT_VERSION,
  LEGACY_TREASURY_PAYOUT_MODEL,
  ONCHAIN_TREASURY_CONTRACT_VERSION,
  ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
  ONCHAIN_TREASURY_PAYOUT_MODEL
} from "../vaults/profitShareTreasury.settings.js";
import { sendSerializedControllerTransaction } from "../vaults/controllerTransaction.js";

const POLL_MS = Math.max(5, Number(process.env.VAULT_ONCHAIN_INDEXER_INTERVAL_SECONDS ?? "15")) * 1000;
const MAX_BLOCK_SPAN = Math.max(1, Number(process.env.VAULT_ONCHAIN_INDEXER_MAX_BLOCK_SPAN ?? "500"));
const MIN_BLOCK_SPAN = Math.max(1, Number(process.env.VAULT_ONCHAIN_INDEXER_MIN_BLOCK_SPAN ?? "25"));
const RATE_LIMIT_BACKOFF_BASE_MS = Math.max(
  POLL_MS,
  Number(process.env.VAULT_ONCHAIN_INDEXER_RATE_LIMIT_BACKOFF_SECONDS ?? "45") * 1000
);
const RATE_LIMIT_BACKOFF_MAX_MS = Math.max(
  RATE_LIMIT_BACKOFF_BASE_MS,
  Number(process.env.VAULT_ONCHAIN_INDEXER_RATE_LIMIT_MAX_SECONDS ?? "300") * 1000
);
const LAG_ALERT_SECONDS = Math.max(
  60,
  Number(process.env.VAULT_ONCHAIN_INDEXER_LAG_ALERT_SECONDS ?? "60")
);
const LAG_ALERT_BLOCKS = Math.max(
  1,
  Number(process.env.VAULT_ONCHAIN_INDEXER_LAG_ALERT_BLOCKS ?? "20")
);
const ARCHIVE_WINDOW_BLOCKS = Math.max(
  1,
  Number(process.env.VAULT_ONCHAIN_INDEXER_ARCHIVE_WINDOW_BLOCKS ?? "3000")
);
const BOT_VAULT_RUNTIME_CREATE_ACTION_TYPES = ["create_bot_vault_v3", "create_bot_vault_v4", "launch_bot_vault_from_funding_vault"] as const;
const BOT_VAULT_RUNTIME_FUND_ACTION_TYPES = ["fund_bot_vault_v3", "fund_bot_vault_v4", "fund_bot_vault_from_funding_vault"] as const;
const INDEXER_EVENT_TX_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.VAULT_ONCHAIN_INDEXER_EVENT_TX_TIMEOUT_MS ?? "60000")
);
const ACTION_POLL_LIMIT = Math.max(
  1,
  Number(process.env.VAULT_ONCHAIN_INDEXER_ACTION_POLL_LIMIT ?? "100")
);
const EPSILON = 0.000001;

export function rankSubmittedOnchainActionForIndexer(action: { actionType?: unknown } | null | undefined): number {
  const actionType = String(action?.actionType ?? "").trim();
  if (actionType === "launch_bot_vault_from_funding_vault") return 0;
  if (actionType === "fund_bot_vault_from_funding_vault") return 1;
  if (BOT_VAULT_RUNTIME_CREATE_ACTION_TYPES.includes(actionType as any)) return 2;
  if (BOT_VAULT_RUNTIME_FUND_ACTION_TYPES.includes(actionType as any)) return 3;
  if (actionType === "create_funding_vault") return 4;
  if (actionType.includes("funding_vault")) return 5;
  if (actionType.includes("master_vault")) return 6;
  return 10;
}

function isGridExecutionActive(row: any): boolean {
  const state = String(row?.state ?? "").trim().toLowerCase();
  const stateJson = row?.stateJson && typeof row.stateJson === "object" && !Array.isArray(row.stateJson)
    ? row.stateJson as Record<string, unknown>
    : {};
  const provisioning = stateJson.provisioning && typeof stateJson.provisioning === "object" && !Array.isArray(stateJson.provisioning)
    ? stateJson.provisioning as Record<string, unknown>
    : {};
  return state === "running" || String(provisioning.phase ?? "").trim().toLowerCase() === "execution_active";
}

export type VaultOnchainIndexerJobStatus = {
  enabled: boolean;
  mode: string;
  running: boolean;
  pollMs: number;
  maxBlockSpan: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastFromBlock: string | null;
  lastToBlock: string | null;
  lastFetchedLogs: number;
  lastProcessedEvents: number;
  totalCycles: number;
  totalFetchedLogs: number;
  totalProcessedEvents: number;
  totalSkippedDuplicates: number;
  totalFailedEvents: number;
  totalFailedCycles: number;
  consecutiveFailedCycles: number;
  totalLagAlerts: number;
  totalRateLimitedCycles: number;
  rateLimitedUntil: string | null;
};

type IndexerSummary = {
  enabled: boolean;
  mode: string;
  fromBlock: bigint | null;
  toBlock: bigint | null;
  fetchedLogs: number;
  processedEvents: number;
  skippedDuplicates: number;
  failedEvents: number;
};

type DecodedEvent = {
  name: string;
  args: Record<string, unknown>;
};

type AutoAdvanceBotVaultV3HypercoreFundingFn = (params: {
  mode: string;
  botVaultId: string;
  botVaultAddress: `0x${string}`;
}) => Promise<{
  activateTxHash: string | null;
  depositTxHash: string | null;
  depositedAmountAtomic: string;
  hypercoreFunded: boolean;
} | null>;

const erc20BalanceOfAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeAddress(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function readDeferredProvisioningAllocationUsd(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const provisioning = (value as Record<string, unknown>).provisioning;
  if (!provisioning || typeof provisioning !== "object" || Array.isArray(provisioning)) return 0;
  const parsed = Number((provisioning as Record<string, unknown>).allocationUsd ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function requiresDeferredReserve(botVault: {
  principalAllocated?: unknown;
  allocatedUsd?: unknown;
  executionMetadata?: unknown;
} | null | undefined): boolean {
  if (!botVault) return false;
  const allocationUsd = readDeferredProvisioningAllocationUsd(botVault.executionMetadata);
  if (allocationUsd <= 0) return false;
  const principalAllocated = Number(botVault.principalAllocated ?? 0);
  const allocatedUsd = Number(botVault.allocatedUsd ?? 0);
  return principalAllocated <= 0 && allocatedUsd <= 0;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readGridMarginTransferAmountUsd(row: unknown): number {
  const gridInstance = toRecord(toRecord(row).gridInstance);
  const investUsd = readPositiveNumber(gridInstance.investUsd, 0);
  const extraMarginUsd = readPositiveNumber(gridInstance.extraMarginUsd, 0);
  const amountUsd = investUsd + extraMarginUsd;
  return Number.isFinite(amountUsd) && amountUsd > EPSILON ? amountUsd : 0;
}

function normalizeExecutionStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isBotVaultV4ReadyForExecution(row: unknown): boolean {
  const normalizedRow = toRecord(row);
  if (resolveBotVaultRuntimeModel(normalizedRow) !== BOT_VAULT_RUNTIME_MODEL_V4) return false;
  return getBotVaultFundingLifecycleStage(normalizedRow) === "execution_ready";
}

async function markGridProvisioningPendingReserve(params: {
  tx: any;
  botVaultId: string;
  gridInstanceId?: string | null;
  txHash: string;
  allocationUsd: number;
}) {
  const now = new Date().toISOString();
  const botVault = await params.tx.botVault.findUnique({
    where: { id: params.botVaultId },
    select: {
      executionMetadata: true
    }
  });
  const existingMetadata = botVault?.executionMetadata && typeof botVault.executionMetadata === "object" && !Array.isArray(botVault.executionMetadata)
    ? botVault.executionMetadata as Record<string, unknown>
    : {};
  const existingProvisioning = existingMetadata.provisioning && typeof existingMetadata.provisioning === "object" && !Array.isArray(existingMetadata.provisioning)
    ? existingMetadata.provisioning as Record<string, unknown>
    : {};
  await params.tx.botVault.update({
    where: { id: params.botVaultId },
    data: {
      executionMetadata: {
        ...existingMetadata,
        provisioning: {
          ...existingProvisioning,
          phase: "pending_reserve_signature",
          reason: "bot_vault_created_reserve_required",
          allocationUsd: params.allocationUsd,
          completedAt: now,
          txHash: params.txHash
        }
      }
    }
  });

  if (!params.gridInstanceId) return;
  const instance = await params.tx.gridBotInstance.findUnique({
    where: { id: String(params.gridInstanceId) },
    select: {
      id: true,
      state: true,
      stateJson: true,
      botId: true
    }
  });
  if (!instance) return;
  if (isGridExecutionActive(instance)) return;
  const provisioningState = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
    ? instance.stateJson as Record<string, unknown>
    : {};
  await params.tx.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "created",
      stateJson: {
        ...provisioningState,
        provisioning: {
          phase: "pending_reserve_signature",
          reason: "bot_vault_created_reserve_required",
          allocationUsd: params.allocationUsd,
          completedAt: now,
          txHash: params.txHash
        }
      }
    }
  });
  if (instance.botId) {
    await params.tx.bot.update({
      where: { id: String(instance.botId) },
      data: {
        status: "stopped",
        lastError: null
      }
    }).catch(() => undefined);
  }
}

async function markGridProvisioningPendingHypercoreFunding(params: {
  tx: any;
  botVaultId: string;
  gridInstanceId?: string | null;
  txHash: string;
  allocationUsd: number;
}) {
  const now = new Date().toISOString();
  const botVault = await params.tx.botVault.findUnique({
    where: { id: params.botVaultId },
    select: {
      executionMetadata: true
    }
  });
  const existingMetadata = botVault?.executionMetadata && typeof botVault.executionMetadata === "object" && !Array.isArray(botVault.executionMetadata)
    ? botVault.executionMetadata as Record<string, unknown>
    : {};
  const existingProvisioning = existingMetadata.provisioning && typeof existingMetadata.provisioning === "object" && !Array.isArray(existingMetadata.provisioning)
    ? existingMetadata.provisioning as Record<string, unknown>
    : {};
  await params.tx.botVault.update({
    where: { id: params.botVaultId },
    data: {
      executionMetadata: {
        ...existingMetadata,
        provisioning: {
          ...existingProvisioning,
          phase: "pending_hypercore_funding_signature",
          reason: "bot_vault_reserve_confirmed_hypercore_funding_required",
          allocationUsd: params.allocationUsd,
          completedAt: now,
          txHash: params.txHash
        }
      }
    }
  });

  if (!params.gridInstanceId) return;
  const instance = await params.tx.gridBotInstance.findUnique({
    where: { id: String(params.gridInstanceId) },
    select: {
      id: true,
      state: true,
      stateJson: true,
      botId: true
    }
  });
  if (!instance) return;
  if (isGridExecutionActive(instance)) return;
  const provisioningState = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
    ? instance.stateJson as Record<string, unknown>
    : {};
  await params.tx.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "created",
      stateJson: {
        ...provisioningState,
        provisioning: {
          phase: "pending_hypercore_funding_signature",
          reason: "bot_vault_reserve_confirmed_hypercore_funding_required",
          allocationUsd: params.allocationUsd,
          completedAt: now,
          txHash: params.txHash
        }
      }
    }
  });
  if (instance.botId) {
    await params.tx.bot.update({
      where: { id: String(instance.botId) },
      data: {
        status: "stopped",
        lastError: null
      }
    }).catch(() => undefined);
  }
}

async function markGridProvisioningSubmittedHypercoreFunding(params: {
  tx: any;
  botVaultId: string;
  gridInstanceId?: string | null;
  txHash?: string | null;
  allocationUsd: number;
  runtimeModel?: unknown;
}) {
  const now = new Date().toISOString();
  const pendingReason = botVaultRuntimeReasonCode({
    runtimeModel: resolveBotVaultRuntimeModel(params.runtimeModel) ?? BOT_VAULT_RUNTIME_MODEL_V4,
    suffix: "hypercore_transfer_pending"
  });
  const botVault = await params.tx.botVault.findUnique({
    where: { id: params.botVaultId },
    select: {
      executionMetadata: true
    }
  });
  const existingMetadata = botVault?.executionMetadata && typeof botVault.executionMetadata === "object" && !Array.isArray(botVault.executionMetadata)
    ? botVault.executionMetadata as Record<string, unknown>
    : {};
  const existingProvisioning = existingMetadata.provisioning && typeof existingMetadata.provisioning === "object" && !Array.isArray(existingMetadata.provisioning)
    ? existingMetadata.provisioning as Record<string, unknown>
    : {};
  await params.tx.botVault.update({
    where: { id: params.botVaultId },
    data: {
      executionMetadata: {
        ...existingMetadata,
        provisioning: {
          ...existingProvisioning,
          phase: "submitted_waiting_hypercore_funding_indexer",
          reason: pendingReason,
          allocationUsd: params.allocationUsd,
          completedAt: now,
          txHash: params.txHash ?? null
        }
      }
    }
  });

  if (!params.gridInstanceId) return;
  const instance = await params.tx.gridBotInstance.findUnique({
    where: { id: String(params.gridInstanceId) },
    select: {
      id: true,
      state: true,
      stateJson: true,
      botId: true
    }
  });
  if (!instance) return;
  if (isGridExecutionActive(instance)) return;
  const provisioningState = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
    ? instance.stateJson as Record<string, unknown>
    : {};
  await params.tx.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "created",
      stateJson: {
        ...provisioningState,
        provisioning: {
          phase: "submitted_waiting_hypercore_funding_indexer",
          reason: pendingReason,
          allocationUsd: params.allocationUsd,
          completedAt: now,
          txHash: params.txHash ?? null
        }
      }
    }
  });
  if (instance.botId) {
    await params.tx.bot.update({
      where: { id: String(instance.botId) },
      data: {
        status: "stopped",
        lastError: null
      }
    }).catch(() => undefined);
  }
}

async function promoteBotVaultExecutionActive(params: {
  tx: any;
  executionLifecycleService: Pick<ExecutionLifecycleService, "startExecution"> | null;
  botVault: {
    id: string;
    userId: string;
    gridInstanceId?: string | null;
    status?: string | null;
    executionStatus?: string | null;
  };
  txHash: string;
  reason: string;
}) {
  const shouldAutoStart =
    String(params.botVault.status ?? "").trim().toUpperCase() === "ACTIVE"
    && !["running", "close_only", "closed"].includes(String(params.botVault.executionStatus ?? "").trim().toLowerCase());
  if (!shouldAutoStart || !params.executionLifecycleService) return;
  const now = new Date().toISOString();

  await params.executionLifecycleService.startExecution({
    tx: params.tx,
    userId: String(params.botVault.userId),
    botVaultId: String(params.botVault.id),
    sourceKey: `bot_vault:${params.botVault.id}:${params.reason}:${params.txHash}`,
    reason: params.reason,
    metadata: {
      sourceType: params.reason,
      txHash: params.txHash
    }
  });

  const botVault = await params.tx.botVault.findUnique({
    where: { id: String(params.botVault.id) },
    select: {
      executionMetadata: true
    }
  }).catch(() => null);
  const existingMetadata = toRecord(botVault?.executionMetadata);
  const existingProvisioning = toRecord(existingMetadata.provisioning);
  await params.tx.botVault.update({
    where: { id: String(params.botVault.id) },
    data: {
      executionMetadata: mergeBotVaultExecutionMetadata(botVault?.executionMetadata, {
        provisioning: {
          ...existingProvisioning,
          phase: "execution_active",
          reason: params.reason,
          completedAt: now,
          txHash: params.txHash
        }
      })
    }
  }).catch(() => undefined);

  if (!params.botVault.gridInstanceId) return;
  const instance = await params.tx.gridBotInstance.findUnique({
    where: { id: String(params.botVault.gridInstanceId) },
    select: {
      id: true,
      botId: true,
      stateJson: true
    }
  });
  if (!instance) return;
  const provisioningState = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
    ? instance.stateJson as Record<string, unknown>
    : {};
  const executionProviderState = toRecord(provisioningState.executionProvider);
  await params.tx.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "running",
      stateJson: {
        ...provisioningState,
        executionProvider: {
          ...executionProviderState,
          lastError: null,
          lastErrorAt: null
        },
        provisioning: {
          phase: "execution_active",
          reason: params.reason,
          completedAt: now,
          txHash: params.txHash
        }
      }
    }
  });
  if (instance.botId) {
    await params.tx.bot.update({
      where: { id: String(instance.botId) },
      data: {
        status: "running",
        lastError: null
      }
    }).catch(() => undefined);
  }
}

async function accelerateBotVaultV4PostFunding(params: {
  db: any;
  botVaultRuntimeService: Pick<BotVaultRuntimeService, "finalizeBotVaultMarginAdd" | "finalizeBotVaultV4MarginAdd"> | null;
  executionLifecycleService: Pick<ExecutionLifecycleService, "startExecution"> | null;
  botVaultId: string;
  txHash: string;
  runtimeModel: unknown;
}) {
  if (resolveBotVaultRuntimeModel(params.runtimeModel) !== BOT_VAULT_RUNTIME_MODEL_V4) return;
  const finalizeMarginAdd =
    params.botVaultRuntimeService?.finalizeBotVaultV4MarginAdd
    ?? params.botVaultRuntimeService?.finalizeBotVaultMarginAdd;
  if (typeof finalizeMarginAdd !== "function") return;

  const row = await params.db.botVault.findUnique({
    where: { id: params.botVaultId },
    select: {
      id: true,
      userId: true,
      gridInstanceId: true,
      vaultModel: true,
      status: true,
      executionStatus: true,
      fundingStatus: true,
      hypercoreFundingStatus: true,
      executionMetadata: true,
      gridInstance: {
        select: {
          id: true,
          investUsd: true,
          extraMarginUsd: true
        }
      }
    }
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_indexer_v4_post_funding_row_read_failed", {
      botVaultId: params.botVaultId,
      txHash: params.txHash,
      error: String(error)
    });
    return null;
  });
  if (!row) return;

  const lifecycleStage = getBotVaultFundingLifecycleStage(row);
  const shouldFinalizeInitialMargin =
    String(row.status ?? "").trim().toUpperCase() === "ACTIVE"
    && ["hypercore_funded", "perp_margin_transferred", "hype_reserve_ready"].includes(lifecycleStage)
    && ["", "created", "funded"].includes(normalizeExecutionStatus(row.executionStatus));
  if (shouldFinalizeInitialMargin) {
    const amountUsd = readGridMarginTransferAmountUsd(row);
    if (amountUsd > EPSILON) {
      await finalizeMarginAdd.call(params.botVaultRuntimeService, {
        userId: String(row.userId),
        botVaultId: String(row.id),
        amountUsd
      }).catch((error: unknown) => {
        logger.warn("vault_onchain_indexer_v4_initial_margin_finalize_failed", {
          botVaultId: params.botVaultId,
          txHash: params.txHash,
          amountUsd,
          lifecycleStage,
          error: String(error)
        });
      });
    }
  }

  if (!params.executionLifecycleService) return;
  const latest = await params.db.botVault.findUnique({
    where: { id: params.botVaultId },
    select: {
      id: true,
      userId: true,
      gridInstanceId: true,
      vaultModel: true,
      status: true,
      executionStatus: true,
      fundingStatus: true,
      hypercoreFundingStatus: true,
      executionMetadata: true
    }
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_indexer_v4_post_finalize_row_read_failed", {
      botVaultId: params.botVaultId,
      txHash: params.txHash,
      error: String(error)
    });
    return null;
  });
  if (!latest) return;
  if (
    String(latest.status ?? "").trim().toUpperCase() !== "ACTIVE"
    || !isBotVaultV4ReadyForExecution(latest)
    || !["", "created", "funded"].includes(normalizeExecutionStatus(latest.executionStatus))
  ) {
    return;
  }

  await params.db.$transaction(async (tx: any) => {
    await promoteBotVaultExecutionActive({
      tx,
      executionLifecycleService: params.executionLifecycleService,
      botVault: {
        id: String(latest.id),
        userId: String(latest.userId),
        gridInstanceId: latest.gridInstanceId ? String(latest.gridInstanceId) : null,
        status: String(latest.status ?? "ACTIVE"),
        executionStatus: String(latest.executionStatus ?? "")
      },
      txHash: params.txHash,
      reason: "bot_vault_onchain_indexer_autostart"
    });
  }, {
    maxWait: 5_000,
    timeout: INDEXER_EVENT_TX_TIMEOUT_MS
  }).catch((error: unknown) => {
    logger.warn("vault_onchain_indexer_v4_autostart_failed", {
      botVaultId: params.botVaultId,
      txHash: params.txHash,
      error: String(error)
    });
  });
}

export function mergeBotVaultExecutionMetadata(
  current: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const existing = toRecord(current);
  const providerState = toRecord(existing.providerState);
  const merged = {
    ...existing,
    ...patch
  };
  if (Object.keys(providerState).length > 0) {
    merged.providerState = providerState;
  }
  return merged;
}

export function shouldQueueBotVaultV3AutoActivate(input: {
  vaultModel: unknown;
  executionMetadata: unknown;
}): boolean {
  if (!isBotVaultRuntimeModelRow(input)) return false;
  const metadata = toRecord(input.executionMetadata);
  const activateStatus = String(metadata.autoActivateStatus ?? "").trim().toLowerCase();
  const hypercoreStatus = String(metadata.autoHypercoreFundingStatus ?? "").trim().toLowerCase();
  if (hypercoreStatus === "confirmed") return false;
  if (activateStatus === "submitted" && hypercoreStatus === "submitted") return false;
  return true;
}

function createDefaultAutoAdvanceBotVaultV3HypercoreFunding(): AutoAdvanceBotVaultV3HypercoreFundingFn {
  return async (params) => {
    const privateKeyRaw = String(process.env.CONTRACTS_PRIVATE_KEY ?? "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKeyRaw) && !/^[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
      logger.warn("vault_onchain_indexer_v3_hypercore_advance_missing_private_key", {
        botVaultId: params.botVaultId,
        botVaultAddress: params.botVaultAddress
      });
      return null;
    }
    const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as `0x${string}`;
    const addressBook = resolveOnchainAddressBook({ mode: params.mode as any, contractVersion: "v3" });
    const rpcUrl = resolveHyperEvmWriteRpcUrl(addressBook.rpcUrl);
    const account = privateKeyToAccount(privateKey);
    const chain = defineChain({
      id: addressBook.chainId,
      name: addressBook.chainId === 999 ? "HyperEVM" : `EVM-${addressBook.chainId}`,
      nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
      rpcUrls: {
        default: {
          http: [rpcUrl]
        }
      }
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    });

    const readStatus = async () => Number(await publicClient.readContract({
      address: params.botVaultAddress,
      abi: botVaultV3Abi,
      functionName: "status"
    }));
    const readUsdcBalance = async () => BigInt(await publicClient.readContract({
      address: addressBook.usdcAddress,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [params.botVaultAddress]
    }));

    let activateTxHash: string | null = null;
    let depositTxHash: string | null = null;

    const statusBefore = await readStatus();
    if (statusBefore === 1) {
      try {
        activateTxHash = await sendSerializedControllerTransaction({
          account,
          chain,
          publicClient,
          walletClient
        }, {
          to: params.botVaultAddress,
          data: encodeFunctionData({
            abi: botVaultV3Abi,
            functionName: "activate",
            args: []
          })
        });
        const activateReceipt = await publicClient.waitForTransactionReceipt({
          hash: activateTxHash as `0x${string}`,
          confirmations: 1
        });
        if (activateReceipt.status !== "success") throw new Error("bot_vault_v3_activate_tx_failed");
      } catch (error) {
        if (!String(error ?? "").toLowerCase().includes("invalid_transition")) throw error;
        activateTxHash = null;
      }
    }

    const balanceBeforeDeposit = await readUsdcBalance();
    if (balanceBeforeDeposit > 0n) {
      depositTxHash = await sendSerializedControllerTransaction({
        account,
        chain,
        publicClient,
        walletClient
      }, {
        to: params.botVaultAddress,
        data: encodeFunctionData({
          abi: botVaultV3Abi,
          functionName: "depositUsdcToHyperCore",
          args: [balanceBeforeDeposit]
        })
      });
      const depositReceipt = await publicClient.waitForTransactionReceipt({
        hash: depositTxHash as `0x${string}`,
        confirmations: 1
      });
      if (depositReceipt.status !== "success") throw new Error("bot_vault_v3_deposit_hypercore_tx_failed");
    }

    const balanceAfterDeposit = await readUsdcBalance();
    return {
      activateTxHash,
      depositTxHash,
      depositedAmountAtomic: balanceBeforeDeposit.toString(),
      hypercoreFunded: balanceAfterDeposit === 0n
    };
  };
}

function mapBotVaultStatus(statusIndex: number): string {
  if (statusIndex === 0) return "ACTIVE";
  if (statusIndex === 1) return "PAUSED";
  if (statusIndex === 2) return "CLOSE_ONLY";
  if (statusIndex === 3) return "CLOSED";
  return "ERROR";
}

function mapBotVaultV3Status(statusIndex: number): string {
  if (statusIndex === 0) return "ACTIVE";
  if (statusIndex === 1) return "ACTIVE";
  if (statusIndex === 2) return "ACTIVE";
  if (statusIndex === 3) return "PAUSED";
  if (statusIndex === 4) return "CLOSE_ONLY";
  if (statusIndex === 5) return "CLOSED";
  return "ERROR";
}

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => serialize(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = serialize(item);
    }
    return out;
  }
  return value;
}

function buildProfitShareSourceKey(chainId: number, txHash: string, botVaultIdOrAddress: string): string {
  return `${chainId}:${txHash.toLowerCase()}:profit_share:${normalizeAddress(botVaultIdOrAddress)}`;
}

function isRateLimitError(error: unknown): boolean {
  const raw = String(error ?? "").toLowerCase();
  return raw.includes("limitexceededrpcerror")
    || raw.includes("rate limit")
    || raw.includes("rate limited")
    || raw.includes("too many requests");
}

function isInvalidBlockRangeError(error: unknown): boolean {
  const raw = String(error ?? "").toLowerCase();
  return raw.includes("invalid block range");
}

function trimLogsToBlock(logs: Log[], toBlock: bigint): Log[] {
  return logs.filter((entry) => (entry.blockNumber ?? 0n) <= toBlock);
}

export function filterLogsFromBlock(logs: Log[], fromBlock: bigint): Log[] {
  return logs.filter((entry) => (entry.blockNumber ?? 0n) >= fromBlock);
}

function toRpcBlockHex(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

function normalizeRpcLog(log: Record<string, unknown>): Log {
  const blockNumberRaw = typeof log.blockNumber === "string" ? log.blockNumber : "0x0";
  const logIndexRaw = typeof log.logIndex === "string" ? log.logIndex : "0x0";
  return {
    ...log,
    address: String(log.address ?? "") as `0x${string}`,
    data: String(log.data ?? "0x") as Hex,
    topics: Array.isArray(log.topics) ? log.topics.map((topic) => String(topic) as Hex) : [],
    blockNumber: BigInt(blockNumberRaw),
    logIndex: Number.parseInt(logIndexRaw, 16),
    transactionHash: typeof log.transactionHash === "string" ? log.transactionHash as Hex : null
  } as Log;
}

async function requestLogs(
  client: ReturnType<typeof createOnchainPublicClient>,
  params: {
    address: `0x${string}` | `0x${string}`[];
    fromBlock: bigint;
    toBlock: bigint;
  }
): Promise<Log[]> {
  const response = await client.request({
    method: "eth_getLogs",
    params: [
      {
        address: params.address,
        fromBlock: toRpcBlockHex(params.fromBlock),
        toBlock: toRpcBlockHex(params.toBlock)
      }
    ]
  }) as Array<Record<string, unknown>>;
  return Array.isArray(response) ? response.map((entry) => normalizeRpcLog(entry)) : [];
}

function decodeKnownEvent(log: Log): DecodedEvent | null {
  const topics = (log.topics ?? []) as [] | [Hex, ...Hex[]];
  const data = (log.data ?? "0x") as Hex;

  for (const abi of [
    masterVaultFactoryAbi,
    masterVaultFactoryV2Abi,
      botVaultFactoryV3Abi,
      botVaultFactoryV4Abi,
      fundingVaultFactoryV1Abi,
      fundingVaultV1Abi,
      masterVaultAbi,
    masterVaultV2Abi,
    botVaultAbi,
    botVaultV2Abi,
    botVaultV3Abi
  ]) {
    try {
      const decoded = decodeEventLog({ abi, topics, data, strict: false });
      return {
        name: decoded.eventName,
        args: toRecord(decoded.args)
      };
    } catch {
      // try next ABI
    }
  }

  return null;
}

async function findMasterVaultByAddress(tx: any, address: string): Promise<any | null> {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  return tx.masterVault.findFirst({
    where: {
      onchainAddress: {
        equals: normalized,
        mode: "insensitive"
      }
    }
  });
}

async function findBotVaultByAddress(tx: any, address: string): Promise<any | null> {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  return tx.botVault.findFirst({
    where: {
      vaultAddress: {
        equals: normalized,
        mode: "insensitive"
      }
    }
  });
}

function isReceiptPendingError(error: unknown): boolean {
  const raw = String(error ?? "").toLowerCase();
  return raw.includes("transactionreceiptnotfounderror")
    || raw.includes("receipt for transaction")
    || raw.includes("not found");
}

function isReceiptSuccessful(status: unknown): boolean {
  return status === "success" || status === "0x1" || status === 1 || status === 1n;
}

function resolveActionContractVersion(actionType: string, metadata: Record<string, unknown>, fallback?: unknown): "v1" | "v2" | "v3" | "v4" {
  const explicit = String(metadata.contractVersion ?? fallback ?? "").trim().toLowerCase();
  if (explicit === "v1" || explicit === "v2" || explicit === "v3" || explicit === "v4") return explicit;
  if (actionType === "create_master_vault" || actionType === "fund_bot_vault_hypercore") return "v2";
  if (actionType === "create_bot_vault_v3" || actionType === "fund_bot_vault_v3") return "v3";
  if (
    actionType === "create_bot_vault_v4"
    || actionType === "fund_bot_vault_v4"
    || actionType === "launch_bot_vault_from_funding_vault"
    || actionType === "fund_bot_vault_from_funding_vault"
  ) return "v4";
  return "v1";
}

function findDecodedReceiptEvent(
  receipt: { logs?: Log[] },
  eventName: string,
  address?: string | null
): { log: Log; decoded: DecodedEvent } | null {
  const normalizedAddress = normalizeAddress(address);
  for (const log of receipt.logs ?? []) {
    if (normalizedAddress && normalizeAddress(log.address) !== normalizedAddress) continue;
    const decoded = decodeKnownEvent(log);
    if (decoded?.name === eventName) {
      return { log, decoded };
    }
  }
  return null;
}

async function syncMasterVaultFromChain(params: {
  tx: any;
  client: ReturnType<typeof createOnchainPublicClient>;
  masterVaultId: string;
  address: `0x${string}`;
}) {
  const state = await readMasterVaultState(params.client, params.address).catch(() => null);
  if (!state) return;
  await params.tx.masterVault.update({
    where: { id: params.masterVaultId },
    data: {
      freeBalance: state.freeBalance,
      reservedBalance: state.reservedBalance,
      availableUsd: state.freeBalance
    }
  }).catch(() => undefined);
}

async function syncBotVaultFromChain(params: {
  tx: any;
  client: ReturnType<typeof createOnchainPublicClient>;
  botVault: {
    id: string;
    vaultModel?: string | null;
    executionMetadata?: unknown;
  };
  address: `0x${string}`;
  patch?: Record<string, unknown>;
}) {
  const isV3 = isBotVaultRuntimeModelRow(params.botVault);
  const state = isV3
    ? await readBotVaultV3State(params.client, params.address).catch(() => null)
    : await readBotVaultState(params.client, params.address).catch(() => null);
  if (!state) return;
  await params.tx.botVault.update({
    where: { id: params.botVault.id },
    data: {
      principalAllocated: state.principalAllocated,
      allocatedUsd: state.principalAllocated,
      principalReturned: state.principalReturned,
      realizedPnlNet: state.realizedPnlNet,
      realizedNetUsd: state.realizedPnlNet,
      feePaidTotal: state.feePaidTotal,
      highWaterMark: state.highWaterMark,
      status: isV3 ? mapBotVaultV3Status(state.status) : mapBotVaultStatus(state.status),
      ...(params.patch ?? {})
    }
  }).catch(() => undefined);
}

export function createVaultOnchainIndexerJob(
  db: any,
  deps?: {
    onchainActionService?: OnchainActionService;
    executionLifecycleService?: Pick<ExecutionLifecycleService, "startExecution"> | null;
    botVaultRuntimeService?: Pick<BotVaultRuntimeService, "finalizeBotVaultMarginAdd" | "finalizeBotVaultV4MarginAdd"> | null;
    autoAdvanceBotVaultV3HypercoreFunding?: AutoAdvanceBotVaultV3HypercoreFundingFn | null;
  }
) {
  const onchainActionService = deps?.onchainActionService ?? createOnchainActionService(db);
  const executionLifecycleService = deps?.executionLifecycleService ?? null;
  const botVaultRuntimeService = deps?.botVaultRuntimeService ?? null;
  const autoAdvanceBotVaultV3HypercoreFunding =
    deps?.autoAdvanceBotVaultV3HypercoreFunding ?? createDefaultAutoAdvanceBotVaultV3HypercoreFunding();

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastFromBlock: bigint | null = null;
  let lastToBlock: bigint | null = null;
  let lastFetchedLogs = 0;
  let lastProcessedEvents = 0;
  let totalCycles = 0;
  let totalFetchedLogs = 0;
  let totalProcessedEvents = 0;
  let totalSkippedDuplicates = 0;
  let totalFailedEvents = 0;
  let totalFailedCycles = 0;
  let consecutiveFailedCycles = 0;
  let totalLagAlerts = 0;
  let totalRateLimitedCycles = 0;
  let lastMode = "offchain_shadow";
  let started = false;
  let currentPollMs = POLL_MS;
  let currentMaxBlockSpan = MAX_BLOCK_SPAN;
  let rateLimitedUntil: Date | null = null;

  function scheduleNextRun(delayMs = currentPollMs) {
    if (!started) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      await runCycle("scheduled");
      scheduleNextRun(currentPollMs);
    }, delayMs);
  }

  function resetAdaptiveRateLimitState() {
    currentPollMs = POLL_MS;
    currentMaxBlockSpan = MAX_BLOCK_SPAN;
    rateLimitedUntil = null;
  }

  function applyRateLimitBackoff(params: {
    reason: "startup" | "scheduled" | "manual";
    stage: "block_number" | "factory_state" | "get_logs" | "receipt";
    error: unknown;
    fromBlock?: bigint | null;
    toBlock?: bigint | null;
  }) {
    totalRateLimitedCycles += 1;
    currentPollMs = Math.min(RATE_LIMIT_BACKOFF_MAX_MS, Math.max(RATE_LIMIT_BACKOFF_BASE_MS, currentPollMs * 2));
    currentMaxBlockSpan = Math.max(MIN_BLOCK_SPAN, Math.floor(currentMaxBlockSpan / 2));
    rateLimitedUntil = new Date(Date.now() + currentPollMs);
    logger.warn("vault_onchain_indexer_rate_limited", {
      reason: params.reason,
      stage: params.stage,
      fromBlock: params.fromBlock == null ? null : params.fromBlock.toString(),
      toBlock: params.toBlock == null ? null : params.toBlock.toString(),
      nextPollMs: currentPollMs,
      nextMaxBlockSpan: currentMaxBlockSpan,
      retryAfter: rateLimitedUntil.toISOString(),
      error: String(params.error)
    });
  }

  async function getLogsWithAdaptiveRange(
    client: ReturnType<typeof createOnchainPublicClient>,
    params: {
      address: `0x${string}` | `0x${string}`[];
      fromBlock: bigint;
      toBlock: bigint;
    }
  ): Promise<{ logs: Log[]; toBlock: bigint }> {
    let effectiveToBlock = params.toBlock;

    for (;;) {
      try {
        return {
          logs: await requestLogs(client, {
            address: params.address,
            fromBlock: params.fromBlock,
            toBlock: effectiveToBlock
          }),
          toBlock: effectiveToBlock
        };
      } catch (error) {
        const rateLimited = isRateLimitError(error);
        const invalidBlockRange = isInvalidBlockRangeError(error);
        const shouldShrinkRange = rateLimited || invalidBlockRange;
        if (!shouldShrinkRange) throw error;

        const currentSpan = Number(effectiveToBlock - params.fromBlock + 1n);
        if (invalidBlockRange && currentSpan === 1 && params.fromBlock > 0n) {
          const fallbackFromBlock = params.fromBlock - 1n;
          logger.warn("vault_onchain_indexer_backtracking_single_block_query", {
            fromBlock: params.fromBlock.toString(),
            toBlock: effectiveToBlock.toString(),
            fallbackFromBlock: fallbackFromBlock.toString(),
            error: String(error)
          });
          return {
            logs: filterLogsFromBlock(await requestLogs(client, {
              address: params.address,
              fromBlock: fallbackFromBlock,
              toBlock: effectiveToBlock
            }), params.fromBlock),
            toBlock: effectiveToBlock
          };
        }

        const minSpan = invalidBlockRange ? 1 : MIN_BLOCK_SPAN;
        const nextSpan = Math.max(minSpan, Math.floor(currentSpan / 2));
        if (nextSpan >= currentSpan) {
          throw error;
        }

        const nextToBlock = params.fromBlock + BigInt(nextSpan - 1);
        currentMaxBlockSpan = invalidBlockRange
          ? Math.max(1, Math.min(currentMaxBlockSpan, nextSpan))
          : Math.max(MIN_BLOCK_SPAN, Math.min(currentMaxBlockSpan, nextSpan));
        logger.warn("vault_onchain_indexer_shrinking_block_span", {
          fromBlock: params.fromBlock.toString(),
          requestedToBlock: effectiveToBlock.toString(),
          nextToBlock: nextToBlock.toString(),
          nextMaxBlockSpan: currentMaxBlockSpan,
          reason: rateLimited ? "rate_limit" : "invalid_block_range",
          error: String(error)
        });
        effectiveToBlock = nextToBlock;
      }
    }
  }

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled"): Promise<IndexerSummary> {
    if (running) {
      return {
        enabled: false,
        mode: lastMode,
        fromBlock: null,
        toBlock: null,
        fetchedLogs: 0,
        processedEvents: 0,
        skippedDuplicates: 0,
        failedEvents: 0
      };
    }

    running = true;
    totalCycles += 1;
    lastStartedAt = new Date();

    try {
      const mode = await getEffectiveVaultExecutionMode(db);
      lastMode = mode;
      if (!isOnchainMode(mode)) {
        lastError = null;
        lastErrorAt = null;
        resetAdaptiveRateLimitState();
        return {
          enabled: false,
          mode,
          fromBlock: null,
          toBlock: null,
          fetchedLogs: 0,
          processedEvents: 0,
          skippedDuplicates: 0,
          failedEvents: 0
        };
      }

      const submittedActions = await db.onchainAction.findMany({
        where: {
          status: "submitted",
          txHash: { not: null }
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: ACTION_POLL_LIMIT,
        select: {
          id: true,
          userId: true,
          actionType: true,
          txHash: true,
          metadata: true,
          masterVaultId: true,
          fundingVaultId: true,
          botVaultId: true,
            masterVault: {
              select: {
                id: true,
                onchainAddress: true,
                contractVersion: true
              }
            },
            fundingVault: {
              select: {
                id: true,
                onchainAddress: true,
                userId: true,
                contractVersion: true,
                freeBalance: true,
                reservedBalance: true
              }
            },
            botVault: {
            select: {
              id: true,
              userId: true,
              botId: true,
              masterVaultId: true,
              gridInstanceId: true,
              vaultModel: true,
              vaultAddress: true,
              beneficiaryAddress: true,
              agentWallet: true,
              status: true,
              executionStatus: true,
              executionMetadata: true
            }
          }
        }
      });
      const actions = [...submittedActions].sort(
        (left, right) => rankSubmittedOnchainActionForIndexer(left) - rankSubmittedOnchainActionForIndexer(right)
      );

      let processedEvents = 0;
      let skippedDuplicates = 0;
      let failedEvents = 0;
      let rateLimitedThisCycle = false;

      for (const action of actions) {
        const txHash = String(action.txHash ?? "").trim().toLowerCase();
        if (!txHash) continue;
        const metadata = toRecord(action.metadata);
        const contractVersion = resolveActionContractVersion(
          String(action.actionType),
          metadata,
          action.masterVault?.contractVersion
        );
        const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
        const client = createOnchainPublicClient(addressBook);

        if (BOT_VAULT_RUNTIME_CREATE_ACTION_TYPES.includes(action.actionType as any) && action.botVault) {
          const botId = String(action.botVault.botId ?? "").trim();
          const runtimeModel = resolveBotVaultRuntimeModel({
            vaultModel: action.botVault.vaultModel,
            executionMetadata: action.botVault.executionMetadata,
            contractVersion
          }) ?? BOT_VAULT_RUNTIME_MODEL_V4;
          const factoryAddress = resolveBotVaultFactoryAddress(
            mode,
            contractVersion === "v4" ? "v4" : "v3"
          );
          if (botId && factoryAddress && isAddress(factoryAddress)) {
            let factoryStateRateLimited = false;
            const resolvedVaultAddress = await readBotVaultV3AddressForBotId(
              client,
              factoryAddress,
              botId
            ).catch((error: unknown) => {
              if (isRateLimitError(error)) {
                rateLimitedThisCycle = true;
                factoryStateRateLimited = true;
                failedEvents += 1;
                applyRateLimitBackoff({ reason, stage: "factory_state", error });
                logger.warn("vault_onchain_indexer_factory_state_rate_limited", {
                  reason,
                  actionId: action.id,
                  actionType: action.actionType,
                  txHash,
                  botId,
                  factoryAddress,
                  error: String(error)
                });
              }
              return null;
            });
            if (factoryStateRateLimited) break;
            if (resolvedVaultAddress) {
              try {
                await db.$transaction(async (tx: any) => {
                  await tx.botVault.update({
                    where: { id: String(action.botVault?.id) },
                    data: {
                      vaultAddress: resolvedVaultAddress,
                      beneficiaryAddress: action.botVault?.beneficiaryAddress ? String(action.botVault.beneficiaryAddress) : null,
                      fundingStatus: "deployed",
                      hypercoreFundingStatus: "not_funded",
                      executionMetadata: mergeBotVaultExecutionMetadata(action.botVault?.executionMetadata, {
                        ...createBotVaultFundingLifecycleMetadata("deployed"),
                        vaultAddress: resolvedVaultAddress,
                        beneficiaryAddress: action.botVault?.beneficiaryAddress ? String(action.botVault.beneficiaryAddress) : null,
                        chain: String(addressBook.chainId),
                        runtimeModel,
                        lastAction: `polled_${runtimeModel}_created_from_factory`
                      })
                    }
                  });
                  await onchainActionService.markActionConfirmedByTxHash({
                    txHash,
                    status: "confirmed"
                  }).catch(() => undefined);
                    if (String(action.actionType) === "launch_bot_vault_from_funding_vault") {
                      await syncBotVaultFromChain({
                        tx,
                        client,
                        botVault: action.botVault,
                        address: resolvedVaultAddress
                      }).catch(() => undefined);
                      const allocationUsd = Number(metadata.amountUsd ?? readDeferredProvisioningAllocationUsd(action.botVault?.executionMetadata) ?? 0);
                      await markGridProvisioningPendingHypercoreFunding({
                        tx,
                        botVaultId: String(action.botVault?.id),
                        gridInstanceId: action.botVault?.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                        txHash,
                        allocationUsd
                      });
                      if (action.fundingVault?.id && Number.isFinite(allocationUsd) && allocationUsd > 0) {
                        const currentFreeBalance = Number(action.fundingVault.freeBalance ?? 0);
                        const currentReservedBalance = Number(action.fundingVault.reservedBalance ?? 0);
                        const nextFreeBalance = currentFreeBalance - currentReservedBalance >= -1e-9
                          ? Math.max(0, currentFreeBalance - allocationUsd)
                          : currentFreeBalance;
                        const nextReservedBalance = Math.max(0, currentReservedBalance - allocationUsd);
                        await tx.fundingVault.update({
                          where: { id: String(action.fundingVault.id) },
                          data: {
                            freeBalance: nextFreeBalance,
                            reservedBalance: nextReservedBalance,
                            lastSyncedAt: new Date()
                          }
                        }).catch(() => undefined);
                      }
                    } else {
                      await markGridProvisioningPendingReserve({
                        tx,
                        botVaultId: String(action.botVault?.id),
                        gridInstanceId: action.botVault?.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                        txHash,
                        allocationUsd: readDeferredProvisioningAllocationUsd(action.botVault?.executionMetadata)
                      });
                    }
                }, {
                  maxWait: 5_000,
                  timeout: INDEXER_EVENT_TX_TIMEOUT_MS
                });
                processedEvents += 1;
                continue;
              } catch (error) {
                failedEvents += 1;
                logger.warn("vault_onchain_indexer_v3_factory_state_confirm_failed", {
                  reason,
                  actionId: action.id,
                  txHash,
                  botId,
                  resolvedVaultAddress,
                  error: String(error)
                });
                continue;
              }
            }
          }
        }

        let receipt: any;
        try {
          receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
        } catch (error) {
          if (isReceiptPendingError(error)) continue;
          if (isRateLimitError(error)) {
            rateLimitedThisCycle = true;
            applyRateLimitBackoff({ reason, stage: "receipt", error });
            failedEvents += 1;
            logger.warn("vault_onchain_indexer_receipt_rate_limited", {
              reason,
              actionId: action.id,
              actionType: action.actionType,
              txHash,
              error: String(error)
            });
            break;
          }
          failedEvents += 1;
          logger.warn("vault_onchain_indexer_receipt_poll_failed", {
            reason,
            actionId: action.id,
            actionType: action.actionType,
            txHash,
            error: String(error)
          });
          continue;
        }

        if (!isReceiptSuccessful(receipt?.status)) {
          await onchainActionService.markActionFailed({
            userId: String(action.userId),
            actionId: String(action.id),
            txHash
          }).catch(() => undefined);
          processedEvents += 1;
          continue;
        }

        const postCommitTasks: Array<() => Promise<void>> = [];
        try {
          await db.$transaction(async (tx: any) => {
            if (action.actionType === "create_master_vault" && action.masterVaultId) {
              const ownerAddressRaw = String(metadata.ownerAddress ?? "").trim().toLowerCase();
              const ownerAddress = ownerAddressRaw && isAddress(ownerAddressRaw) ? ownerAddressRaw as `0x${string}` : null;
              let masterVaultAddress = ownerAddress
                ? await readMasterVaultAddressForOwner(client, addressBook.factoryAddress, ownerAddress).catch(() => null)
                : null;
              if (!masterVaultAddress) {
                const createdEvent = findDecodedReceiptEvent(receipt, "MasterVaultCreated", addressBook.factoryAddress);
                const candidate = normalizeAddress(createdEvent?.decoded.args.masterVault);
                masterVaultAddress = candidate && isAddress(candidate) ? candidate as `0x${string}` : null;
              }
              if (masterVaultAddress) {
                await tx.masterVault.update({
                  where: { id: String(action.masterVaultId) },
                  data: {
                    onchainAddress: masterVaultAddress,
                    contractVersion
                  }
                }).catch(() => undefined);
                await syncMasterVaultFromChain({
                  tx,
                  client,
                  masterVaultId: String(action.masterVaultId),
                  address: masterVaultAddress
                });
                }
              }

              if (action.actionType === "create_funding_vault" && action.fundingVaultId) {
                const factoryAddress = normalizeAddress(metadata.factoryAddress);
                const createdEvent = findDecodedReceiptEvent(receipt, "FundingVaultCreated", factoryAddress);
                const fundingVaultAddress = normalizeAddress(createdEvent?.decoded.args.fundingVault);
                const operatorAddress = normalizeAddress(createdEvent?.decoded.args.operator ?? metadata.operatorAddress);
                if (fundingVaultAddress) {
                  await tx.fundingVault.update({
                    where: { id: String(action.fundingVaultId) },
                    data: {
                      onchainAddress: fundingVaultAddress,
                      factoryAddress: factoryAddress || null,
                      operatorAddress: operatorAddress || undefined,
                      contractVersion: "v1",
                      status: "active",
                      lastSyncedAt: new Date()
                    }
                  }).catch(() => undefined);
                }
              }

              if (action.actionType === "create_bot_vault" && action.botVault) {
              const createdEvent = findDecodedReceiptEvent(receipt, "BotVaultCreated");
              const botAddress = normalizeAddress(createdEvent?.decoded.args.botVault ?? action.botVault.vaultAddress);
              const agentWallet = normalizeAddress(createdEvent?.decoded.args.agentWallet ?? action.botVault.agentWallet);
              if (botAddress) {
                await tx.botVault.update({
                  where: { id: String(action.botVault.id) },
                  data: {
                    vaultAddress: botAddress,
                    ...(agentWallet && agentWallet !== "0x0000000000000000000000000000000000000000"
                      ? { agentWallet }
                      : {}),
                    executionMetadata: mergeBotVaultExecutionMetadata(action.botVault.executionMetadata, {
                      vaultAddress: botAddress,
                      chain: String(addressBook.chainId),
                      lastAction: "polled_bot_vault_created",
                      ...(agentWallet && agentWallet !== "0x0000000000000000000000000000000000000000"
                        ? { agentWallet }
                        : {})
                    })
                  }
                });
                await syncBotVaultFromChain({
                  tx,
                  client,
                  botVault: action.botVault,
                  address: botAddress as `0x${string}`
                });
              }
              if (action.masterVault?.id && action.masterVault.onchainAddress && isAddress(String(action.masterVault.onchainAddress))) {
                await syncMasterVaultFromChain({
                  tx,
                  client,
                  masterVaultId: String(action.masterVault.id),
                  address: String(action.masterVault.onchainAddress).toLowerCase() as `0x${string}`
                });
              }
              if (requiresDeferredReserve(action.botVault)) {
                await markGridProvisioningPendingReserve({
                  tx,
                  botVaultId: String(action.botVault.id),
                  gridInstanceId: action.botVault.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                  txHash,
                  allocationUsd: readDeferredProvisioningAllocationUsd(action.botVault.executionMetadata)
                });
              } else {
                await promoteBotVaultExecutionActive({
                  tx,
                  executionLifecycleService,
                  botVault: {
                    id: String(action.botVault.id),
                    userId: String(action.botVault.userId),
                    gridInstanceId: action.botVault.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                    status: String(action.botVault.status ?? "ACTIVE"),
                    executionStatus: String(action.botVault.executionStatus ?? "")
                  },
                  txHash,
                  reason: "bot_vault_onchain_create_confirmed"
                });
              }
            }

            if (BOT_VAULT_RUNTIME_CREATE_ACTION_TYPES.includes(action.actionType as any) && action.botVault) {
              const contractVersion = resolveActionContractVersion(
                action.actionType,
                toRecord(action.metadata),
                toRecord(action.botVault.executionMetadata).onchainContractVersion
              );
              const runtimeModel = resolveBotVaultRuntimeModel({
                vaultModel: action.botVault.vaultModel,
                executionMetadata: action.botVault.executionMetadata,
                contractVersion
              }) ?? BOT_VAULT_RUNTIME_MODEL_V4;
              const createdEvent = findDecodedReceiptEvent(
                receipt,
                "BotVaultV3Created",
                resolveBotVaultFactoryAddress(mode, contractVersion === "v4" ? "v4" : "v3")
              );
              const botAddress = normalizeAddress(createdEvent?.decoded.args.vaultAddress ?? action.botVault.vaultAddress);
              const beneficiaryAddress = normalizeAddress(createdEvent?.decoded.args.beneficiary ?? action.botVault.beneficiaryAddress);
              if (botAddress) {
                await tx.botVault.update({
                  where: { id: String(action.botVault.id) },
                  data: {
                    vaultAddress: botAddress,
                    beneficiaryAddress: beneficiaryAddress || null,
                    fundingStatus: "deployed",
                    hypercoreFundingStatus: "not_funded",
                    executionMetadata: mergeBotVaultExecutionMetadata(action.botVault.executionMetadata, {
                      ...createBotVaultFundingLifecycleMetadata("deployed"),
                      vaultAddress: botAddress,
                      beneficiaryAddress,
                      chain: String(addressBook.chainId),
                      runtimeModel,
                      lastAction: `polled_${runtimeModel}_created`
                    })
                  }
                });
              }
              if (String(action.actionType) === "launch_bot_vault_from_funding_vault") {
                const allocationUsd = Number(metadata.amountUsd ?? readDeferredProvisioningAllocationUsd(action.botVault.executionMetadata) ?? 0);
                await markGridProvisioningPendingHypercoreFunding({
                  tx,
                  botVaultId: String(action.botVault.id),
                  gridInstanceId: action.botVault.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                  txHash,
                  allocationUsd
                });
                if (action.fundingVault?.id && Number.isFinite(allocationUsd) && allocationUsd > 0) {
                  const currentFreeBalance = Number(action.fundingVault.freeBalance ?? 0);
                  const currentReservedBalance = Number(action.fundingVault.reservedBalance ?? 0);
                  const nextFreeBalance = currentFreeBalance - currentReservedBalance >= -1e-9
                    ? Math.max(0, currentFreeBalance - allocationUsd)
                    : currentFreeBalance;
                  const nextReservedBalance = Math.max(0, currentReservedBalance - allocationUsd);
                  await tx.fundingVault.update({
                    where: { id: String(action.fundingVault.id) },
                    data: {
                      freeBalance: nextFreeBalance,
                      reservedBalance: nextReservedBalance,
                      lastSyncedAt: new Date()
                    }
                  }).catch(() => undefined);
                }
              } else {
                await markGridProvisioningPendingReserve({
                  tx,
                  botVaultId: String(action.botVault.id),
                  gridInstanceId: action.botVault.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                  txHash,
                  allocationUsd: readDeferredProvisioningAllocationUsd(action.botVault.executionMetadata)
                });
              }
            }

            if (action.actionType === "reserve_for_bot_vault" && action.botVault && action.masterVault?.id) {
              const masterAddress = String(action.masterVault.onchainAddress ?? "").trim().toLowerCase();
              const botAddress = String(action.botVault.vaultAddress ?? "").trim().toLowerCase();
              if (masterAddress && isAddress(masterAddress)) {
                await syncMasterVaultFromChain({
                  tx,
                  client,
                  masterVaultId: String(action.masterVault.id),
                  address: masterAddress as `0x${string}`
                });
              }
              if (botAddress && isAddress(botAddress)) {
                await syncBotVaultFromChain({
                  tx,
                  client,
                  botVault: action.botVault,
                  address: botAddress as `0x${string}`
                });
              }
              if (String(action.masterVault.contractVersion ?? "v1").trim().toLowerCase() === "v2") {
                await markGridProvisioningPendingHypercoreFunding({
                  tx,
                  botVaultId: String(action.botVault.id),
                  gridInstanceId: action.botVault.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                  txHash,
                  allocationUsd: Number(metadata.amountUsd ?? readDeferredProvisioningAllocationUsd(action.botVault.executionMetadata) ?? 0)
                });
              } else {
                await promoteBotVaultExecutionActive({
                  tx,
                  executionLifecycleService,
                  botVault: {
                    id: String(action.botVault.id),
                    userId: String(action.botVault.userId),
                    gridInstanceId: action.botVault.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                    status: String(action.botVault.status ?? "ACTIVE"),
                    executionStatus: String(action.botVault.executionStatus ?? "")
                  },
                  txHash,
                  reason: "bot_vault_onchain_reserve_confirmed"
                });
              }
            }

            if (BOT_VAULT_RUNTIME_FUND_ACTION_TYPES.includes(action.actionType as any) && action.botVault) {
              const runtimeModel = resolveBotVaultRuntimeModel({
                vaultModel: action.botVault.vaultModel,
                executionMetadata: action.botVault.executionMetadata,
                contractVersion
              }) ?? BOT_VAULT_RUNTIME_MODEL_V4;
              const botAddress = String(action.botVault.vaultAddress ?? "").trim().toLowerCase();
              const lifecyclePatch = buildBotVaultFundingLifecycleTransitionPatch({
                row: action.botVault,
                targetStage: "hyper_evm_confirmed",
                source: "vault_onchain_indexer",
                reason: "funding_receipt_confirmed",
                detail: txHash
              });
              const nextMetadata = mergeBotVaultExecutionMetadata(action.botVault.executionMetadata, {
                fundingLifecycle: toRecord(lifecyclePatch.executionMetadata).fundingLifecycle,
                chain: String(addressBook.chainId),
                runtimeModel,
                lastAction: `polled_${runtimeModel}_funded`,
                autoActivateStatus: "pending",
                autoActivateRequestedAt: new Date().toISOString(),
                autoHypercoreFundingStatus: "pending",
                autoHypercoreFundingRequestedAt: new Date().toISOString()
              });
              if (botAddress && isAddress(botAddress)) {
                await syncBotVaultFromChain({
                  tx,
                  client,
                  botVault: action.botVault,
                  address: botAddress as `0x${string}`,
                  patch: {
                    ...lifecyclePatch,
                    executionMetadata: nextMetadata
                  }
                });
              }
              await markGridProvisioningSubmittedHypercoreFunding({
                tx,
                botVaultId: String(action.botVault.id),
                gridInstanceId: action.botVault.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                txHash,
                allocationUsd: Number(metadata.amountUsd ?? readDeferredProvisioningAllocationUsd(action.botVault.executionMetadata) ?? 0),
                runtimeModel
              });
              if (String(action.actionType) === "fund_bot_vault_from_funding_vault" && action.fundingVault?.id) {
                const allocationUsd = Number(metadata.amountUsd ?? readDeferredProvisioningAllocationUsd(action.botVault.executionMetadata) ?? 0);
                if (Number.isFinite(allocationUsd) && allocationUsd > 0) {
                  const currentFreeBalance = Number(action.fundingVault.freeBalance ?? 0);
                  const currentReservedBalance = Number(action.fundingVault.reservedBalance ?? 0);
                  const nextFreeBalance = currentFreeBalance - currentReservedBalance >= -1e-9
                    ? Math.max(0, currentFreeBalance - allocationUsd)
                    : currentFreeBalance;
                  const nextReservedBalance = Math.max(0, currentReservedBalance - allocationUsd);
                  await tx.fundingVault.update({
                    where: { id: String(action.fundingVault.id) },
                    data: {
                      freeBalance: nextFreeBalance,
                      reservedBalance: nextReservedBalance,
                      lastSyncedAt: new Date()
                    }
                  }).catch(() => undefined);
                }
              }
              if (botAddress && isAddress(botAddress) && shouldQueueBotVaultV3AutoActivate({
                vaultModel: action.botVault.vaultModel,
                executionMetadata: action.botVault.executionMetadata
              })) {
                const botVaultId = String(action.botVault.id);
                postCommitTasks.push(async () => {
                  const advancement = await autoAdvanceBotVaultV3HypercoreFunding({
                    mode,
                    botVaultId,
                    botVaultAddress: botAddress as `0x${string}`
                  }).catch(() => null);
                  const existing = await db.botVault.findUnique({
                    where: { id: botVaultId },
                    select: {
                      executionMetadata: true,
                      userId: true,
                      gridInstanceId: true,
                      status: true,
                      executionStatus: true
                    }
                  }).catch(() => null);
                  const metadataPatch = {
                    autoActivateStatus: advancement?.activateTxHash ? "confirmed" : "skipped",
                    autoActivateSubmittedAt: advancement?.activateTxHash ? new Date().toISOString() : null,
                    autoActivateTxHash: advancement?.activateTxHash ?? null,
                    autoHypercoreFundingStatus: advancement?.hypercoreFunded ? "confirmed" : "pending",
                    autoHypercoreFundingSubmittedAt: advancement?.depositTxHash ? new Date().toISOString() : null,
                    autoHypercoreFundingTxHash: advancement?.depositTxHash ?? null,
                    autoHypercoreFundingAmountAtomic: advancement?.depositedAmountAtomic ?? "0",
                    lastAction: advancement?.depositTxHash
                      ? `onchain_${runtimeModel}_deposit_hypercore_confirmed`
                      : advancement?.activateTxHash
                        ? `onchain_${runtimeModel}_activate_confirmed`
                        : `onchain_${runtimeModel}_hypercore_advance_skipped`
                  };
                  const lifecyclePatch = buildBotVaultFundingLifecycleTransitionPatch({
                    row: {
                      ...existing,
                      fundingStatus: "hyper_evm_confirmed_onchain",
                      hypercoreFundingStatus: "not_funded",
                      executionStatus: existing?.executionStatus,
                      status: existing?.status,
                      executionMetadata: mergeBotVaultExecutionMetadata(existing?.executionMetadata, metadataPatch)
                    },
                    targetStage: advancement?.hypercoreFunded ? "hypercore_funded" : "hyper_evm_confirmed",
                    source: "vault_onchain_indexer",
                    reason: advancement?.hypercoreFunded ? "hypercore_deposit_confirmed" : "hypercore_deposit_pending",
                    detail: String(advancement?.depositTxHash ?? advancement?.activateTxHash ?? txHash)
                  });
                  await db.botVault.update({
                    where: { id: botVaultId },
                    data: {
                      ...lifecyclePatch,
                      executionMetadata: mergeBotVaultExecutionMetadata(existing?.executionMetadata, {
                        ...metadataPatch,
                        fundingLifecycle: toRecord(lifecyclePatch.executionMetadata).fundingLifecycle
                      })
                    }
                  }).catch(() => undefined);
                  if (advancement?.hypercoreFunded) {
                    await accelerateBotVaultV4PostFunding({
                      db,
                      botVaultRuntimeService,
                      executionLifecycleService,
                      botVaultId,
                      txHash,
                      runtimeModel
                    });
                  }
                });
              }
            }

            if (action.actionType === "fund_bot_vault_hypercore" && action.botVault && action.masterVault?.id) {
              const masterAddress = String(action.masterVault.onchainAddress ?? "").trim().toLowerCase();
              const botAddress = String(action.botVault.vaultAddress ?? "").trim().toLowerCase();
              if (masterAddress && isAddress(masterAddress)) {
                await syncMasterVaultFromChain({
                  tx,
                  client,
                  masterVaultId: String(action.masterVault.id),
                  address: masterAddress as `0x${string}`
                });
              }
              if (botAddress && isAddress(botAddress)) {
                await syncBotVaultFromChain({
                  tx,
                  client,
                  botVault: action.botVault,
                  address: botAddress as `0x${string}`
                });
              }
              await promoteBotVaultExecutionActive({
                tx,
                executionLifecycleService,
                botVault: {
                  id: String(action.botVault.id),
                  userId: String(action.botVault.userId),
                  gridInstanceId: action.botVault.gridInstanceId ? String(action.botVault.gridInstanceId) : null,
                  status: String(action.botVault.status ?? "ACTIVE"),
                  executionStatus: String(action.botVault.executionStatus ?? "")
                },
                txHash,
                reason: "bot_vault_hypercore_funding_confirmed"
              });
            }

            await onchainActionService.markActionConfirmedByTxHash({
              txHash,
              status: "confirmed"
            }).catch(() => undefined);
          }, {
            maxWait: 5_000,
            timeout: INDEXER_EVENT_TX_TIMEOUT_MS
          });

          processedEvents += 1;
          for (const task of postCommitTasks) {
            await task();
          }
        } catch (error) {
          failedEvents += 1;
          logger.warn("vault_onchain_indexer_action_failed", {
            reason,
            actionId: action.id,
            actionType: action.actionType,
            txHash,
            error: String(error)
          });
        }
      }

      lastFromBlock = null;
      lastToBlock = null;
      lastFetchedLogs = actions.length;
      lastProcessedEvents = processedEvents;
      totalFetchedLogs += actions.length;
      totalProcessedEvents += processedEvents;
      totalSkippedDuplicates += skippedDuplicates;
      totalFailedEvents += failedEvents;
      consecutiveFailedCycles = 0;
      lastError = null;
      lastErrorAt = null;
      if (!rateLimitedThisCycle) resetAdaptiveRateLimitState();

      if (processedEvents > 0 || failedEvents > 0) {
        logger.info("vault_onchain_indexer_cycle", {
          reason,
          mode,
          fetchedLogs: actions.length,
          processedEvents,
          skippedDuplicates,
          failedEvents
        });
      }

      return {
        enabled: true,
        mode,
        fromBlock: null,
        toBlock: null,
        fetchedLogs: actions.length,
        processedEvents,
        skippedDuplicates,
        failedEvents
      };
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      totalFailedCycles += 1;
      consecutiveFailedCycles += 1;
      logger.warn("vault_onchain_indexer_cycle_failed", {
        reason,
        error: lastError
      });
      if (consecutiveFailedCycles >= 3) {
        totalLagAlerts += 1;
        logger.warn("vault_event_indexing_lag", {
          mode: lastMode,
          consecutiveFailedCycles,
          error: lastError,
          thresholdBlocks: LAG_ALERT_BLOCKS,
          thresholdSeconds: LAG_ALERT_SECONDS
        });
      }
      return {
        enabled: false,
        mode: lastMode,
        fromBlock: null,
        toBlock: null,
        fetchedLogs: 0,
        processedEvents: 0,
        skippedDuplicates: 0,
        failedEvents: 0
      };
    } finally {
      lastFinishedAt = new Date();
      running = false;
    }
  }


  function start() {
    if (started) return;
    started = true;
    void runCycle("startup").finally(() => {
      scheduleNextRun(currentPollMs);
    });
  }

  function stop() {
    started = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function getStatus(): VaultOnchainIndexerJobStatus {
    return {
      enabled: isOnchainMode((lastMode as any) ?? "offchain_shadow"),
      mode: lastMode,
      running,
      pollMs: currentPollMs,
      maxBlockSpan: currentMaxBlockSpan,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastFromBlock: lastFromBlock == null ? null : lastFromBlock.toString(),
      lastToBlock: lastToBlock == null ? null : lastToBlock.toString(),
      lastFetchedLogs,
      lastProcessedEvents,
      totalCycles,
      totalFetchedLogs,
      totalProcessedEvents,
      totalSkippedDuplicates,
      totalFailedEvents,
      totalFailedCycles,
      consecutiveFailedCycles,
      totalLagAlerts,
      totalRateLimitedCycles,
      rateLimitedUntil: rateLimitedUntil ? rateLimitedUntil.toISOString() : null
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
