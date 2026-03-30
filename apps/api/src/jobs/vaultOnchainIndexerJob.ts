import { createWalletClient, decodeEventLog, defineChain, encodeFunctionData, http, type Hex, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../logger.js";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "../vaults/executionMode.js";
import {
  resolveAllOnchainAddressBooks,
  resolveBotVaultV3FactoryAddress,
  resolveOnchainAddressBook
} from "../vaults/onchainAddressBook.js";
import {
  createOnchainPublicClient,
  formatSignedUsdFromAtomic,
  formatUsdFromAtomic,
  readBotVaultState,
  readBotVaultV3State,
  readMasterVaultState
} from "../vaults/onchainProvider.js";
import {
  botVaultAbi,
  botVaultFactoryV3Abi,
  botVaultV2Abi,
  botVaultV3Abi,
  masterVaultAbi,
  masterVaultFactoryAbi,
  masterVaultFactoryV2Abi,
  masterVaultV2Abi
} from "../vaults/onchainAbi.js";
import { createOnchainActionService, type OnchainActionService } from "../vaults/onchainAction.service.js";
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

type AutoActivateBotVaultV3Fn = (params: {
  mode: string;
  botVaultId: string;
  botVaultAddress: `0x${string}`;
}) => Promise<{ txHash: string } | null>;

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
      stateJson: true,
      botId: true
    }
  });
  if (!instance) return;
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
      stateJson: true,
      botId: true
    }
  });
  if (!instance) return;
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
  await params.tx.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "running",
      stateJson: {
        ...provisioningState,
        provisioning: {
          phase: "execution_active",
          reason: params.reason,
          completedAt: new Date().toISOString(),
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
  if (String(input.vaultModel ?? "").trim().toLowerCase() !== "bot_vault_v3") return false;
  const metadata = toRecord(input.executionMetadata);
  const status = String(metadata.autoActivateStatus ?? "").trim().toLowerCase();
  return status !== "submitted";
}

function createDefaultAutoActivateBotVaultV3(): AutoActivateBotVaultV3Fn {
  return async (params) => {
    const privateKeyRaw = String(process.env.CONTRACTS_PRIVATE_KEY ?? "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
      if (!/^[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
        logger.warn("vault_onchain_indexer_v3_auto_activate_missing_private_key", {
          botVaultId: params.botVaultId,
          botVaultAddress: params.botVaultAddress
        });
        return null;
      }
    }
    const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as `0x${string}`;
    const addressBook = resolveOnchainAddressBook({ mode: params.mode as any, contractVersion: "v3" });
    const account = privateKeyToAccount(privateKey);
    const chain = defineChain({
      id: addressBook.chainId,
      name: addressBook.chainId === 999 ? "HyperEVM" : `EVM-${addressBook.chainId}`,
      nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
      rpcUrls: {
        default: {
          http: [addressBook.rpcUrl]
        }
      }
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(addressBook.rpcUrl)
    });
    const txHash = await walletClient.sendTransaction({
      account,
      chain,
      to: params.botVaultAddress,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "activate",
        args: []
      })
    });
    return { txHash };
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

function trimLogsToBlock(logs: Log[], toBlock: bigint): Log[] {
  return logs.filter((entry) => (entry.blockNumber ?? 0n) <= toBlock);
}

function decodeKnownEvent(log: Log): DecodedEvent | null {
  const topics = (log.topics ?? []) as [] | [Hex, ...Hex[]];
  const data = (log.data ?? "0x") as Hex;

  for (const abi of [
    masterVaultFactoryAbi,
    masterVaultFactoryV2Abi,
    botVaultFactoryV3Abi,
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

export function createVaultOnchainIndexerJob(
  db: any,
  deps?: {
    onchainActionService?: OnchainActionService;
    executionLifecycleService?: Pick<ExecutionLifecycleService, "startExecution"> | null;
    autoActivateBotVaultV3?: AutoActivateBotVaultV3Fn | null;
  }
) {
  const onchainActionService = deps?.onchainActionService ?? createOnchainActionService(db);
  const executionLifecycleService = deps?.executionLifecycleService ?? null;
  const autoActivateBotVaultV3 = deps?.autoActivateBotVaultV3 ?? createDefaultAutoActivateBotVaultV3();

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
    stage: "block_number" | "get_logs";
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
          logs: await client.getLogs({
            address: params.address,
            fromBlock: params.fromBlock,
            toBlock: effectiveToBlock
          }),
          toBlock: effectiveToBlock
        };
      } catch (error) {
        if (!isRateLimitError(error)) throw error;

        const currentSpan = Number(effectiveToBlock - params.fromBlock + 1n);
        const nextSpan = Math.max(MIN_BLOCK_SPAN, Math.floor(currentSpan / 2));
        if (nextSpan >= currentSpan) {
          throw error;
        }

        const nextToBlock = params.fromBlock + BigInt(nextSpan - 1);
        currentMaxBlockSpan = Math.max(MIN_BLOCK_SPAN, Math.min(currentMaxBlockSpan, nextSpan));
        logger.warn("vault_onchain_indexer_shrinking_block_span", {
          fromBlock: params.fromBlock.toString(),
          requestedToBlock: effectiveToBlock.toString(),
          nextToBlock: nextToBlock.toString(),
          nextMaxBlockSpan: currentMaxBlockSpan,
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
      if (rateLimitedUntil && rateLimitedUntil.getTime() > Date.now() && reason === "scheduled") {
        return {
          enabled: true,
          mode,
          fromBlock: null,
          toBlock: null,
          fetchedLogs: 0,
          processedEvents: 0,
          skippedDuplicates: 0,
          failedEvents: 0
        };
      }

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

      const addressBooks = resolveAllOnchainAddressBooks(mode);
      if (addressBooks.length === 0) {
        throw new Error("vault_onchain_factory_address_missing");
      }
      const addressBook = addressBooks[0]!;
      const client = createOnchainPublicClient(addressBook);
      let head: bigint;
      try {
        head = await client.getBlockNumber();
      } catch (error) {
        if (isRateLimitError(error)) {
          applyRateLimitBackoff({ reason, stage: "block_number", error });
          lastError = String(error);
          lastErrorAt = new Date();
          return {
            enabled: true,
            mode,
            fromBlock: null,
            toBlock: null,
            fetchedLogs: 0,
            processedEvents: 0,
            skippedDuplicates: 0,
            failedEvents: 0
          };
        }
        throw error;
      }
      const confirmedHead = head > BigInt(addressBook.confirmations)
        ? head - BigInt(addressBook.confirmations)
        : 0n;

      const cursorId = `vault_onchain_indexer:${addressBook.chainId}`;
      const cursor = await db.onchainSyncCursor.findUnique({ where: { id: cursorId } });
      const storedLast = cursor ? BigInt(cursor.lastProcessedBlock ?? 0) : addressBook.startBlock;
      const fromBlock = storedLast + 1n;
      const blockLag = confirmedHead >= storedLast ? confirmedHead - storedLast : 0n;
      if (
        blockLag > BigInt(LAG_ALERT_BLOCKS)
        && lastFinishedAt
        && Date.now() - lastFinishedAt.getTime() > LAG_ALERT_SECONDS * 1000
      ) {
        totalLagAlerts += 1;
        logger.warn("vault_event_indexing_lag", {
          mode,
          chainId: addressBook.chainId,
          lastProcessedBlock: storedLast.toString(),
          confirmedHead: confirmedHead.toString(),
          lagBlocks: blockLag.toString(),
          lagSeconds: Math.round((Date.now() - lastFinishedAt.getTime()) / 1000),
          thresholdBlocks: LAG_ALERT_BLOCKS,
          thresholdSeconds: LAG_ALERT_SECONDS
        });
      }

      if (confirmedHead < fromBlock) {
        lastFromBlock = fromBlock;
        lastToBlock = confirmedHead;
        lastFetchedLogs = 0;
        lastProcessedEvents = 0;
        return {
          enabled: true,
          mode,
          fromBlock,
          toBlock: confirmedHead,
          fetchedLogs: 0,
          processedEvents: 0,
          skippedDuplicates: 0,
          failedEvents: 0
        };
      }

      const requestedToBlock = fromBlock + BigInt(currentMaxBlockSpan - 1) < confirmedHead
        ? fromBlock + BigInt(currentMaxBlockSpan - 1)
        : confirmedHead;

      const masterAddresses = (await db.masterVault.findMany({
        where: { onchainAddress: { not: null } },
        select: { onchainAddress: true }
      }))
        .map((row: any) => normalizeAddress(row.onchainAddress))
        .filter(Boolean) as `0x${string}`[];

      const botAddresses = (await db.botVault.findMany({
        where: { vaultAddress: { not: null } },
        select: { vaultAddress: true }
      }))
        .map((row: any) => normalizeAddress(row.vaultAddress))
        .filter(Boolean) as `0x${string}`[];

      const uniqueMasterAddresses = [...new Set(masterAddresses)];
      const uniqueBotAddresses = [...new Set(botAddresses)];
      const v3FactoryAddress = resolveBotVaultV3FactoryAddress(mode);
      const uniqueFactoryAddresses = [
        ...new Set([
          ...addressBooks.map((entry) => entry.factoryAddress),
          ...(v3FactoryAddress ? [v3FactoryAddress] : [])
        ])
      ];

      const fetchedLogs: Log[] = [];
      let effectiveToBlock = requestedToBlock;
      try {
        for (const factoryAddress of uniqueFactoryAddresses) {
          const factoryResult = await getLogsWithAdaptiveRange(client, {
            address: factoryAddress,
            fromBlock,
            toBlock: effectiveToBlock
          });
          if (factoryResult.toBlock < effectiveToBlock) {
            effectiveToBlock = factoryResult.toBlock;
          }
          fetchedLogs.splice(0, fetchedLogs.length, ...trimLogsToBlock(fetchedLogs, effectiveToBlock));
          fetchedLogs.push(...trimLogsToBlock(factoryResult.logs, effectiveToBlock));
        }

        if (uniqueMasterAddresses.length > 0) {
          const masterResult = await getLogsWithAdaptiveRange(client, {
            address: uniqueMasterAddresses,
            fromBlock,
            toBlock: effectiveToBlock
          });
          if (masterResult.toBlock < effectiveToBlock) {
            effectiveToBlock = masterResult.toBlock;
          }
          fetchedLogs.splice(0, fetchedLogs.length, ...trimLogsToBlock(fetchedLogs, effectiveToBlock));
          fetchedLogs.push(...trimLogsToBlock(masterResult.logs, effectiveToBlock));
        }

        if (uniqueBotAddresses.length > 0) {
          const botResult = await getLogsWithAdaptiveRange(client, {
            address: uniqueBotAddresses,
            fromBlock,
            toBlock: effectiveToBlock
          });
          if (botResult.toBlock < effectiveToBlock) {
            effectiveToBlock = botResult.toBlock;
          }
          fetchedLogs.splice(0, fetchedLogs.length, ...trimLogsToBlock(fetchedLogs, effectiveToBlock));
          fetchedLogs.push(...trimLogsToBlock(botResult.logs, effectiveToBlock));
        }
      } catch (error) {
        if (isRateLimitError(error)) {
          applyRateLimitBackoff({
            reason,
            stage: "get_logs",
            error,
            fromBlock,
            toBlock: effectiveToBlock
          });
          lastError = String(error);
          lastErrorAt = new Date();
          return {
            enabled: true,
            mode,
            fromBlock,
            toBlock: effectiveToBlock,
            fetchedLogs: 0,
            processedEvents: 0,
            skippedDuplicates: 0,
            failedEvents: 0
          };
        }
        throw error;
      }

      fetchedLogs.sort((a, b) => {
        const blockDiff = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
        if (blockDiff !== 0) return blockDiff;
        return Number((a.logIndex ?? 0) - (b.logIndex ?? 0));
      });

      let processedEvents = 0;
      let skippedDuplicates = 0;
      let failedEvents = 0;

      for (const logRow of fetchedLogs) {
        const transactionHash = logRow.transactionHash ? String(logRow.transactionHash) : "";
        const logIndex = Number(logRow.logIndex ?? -1);
        if (!transactionHash || logIndex < 0) continue;

        const eventKey = `${addressBook.chainId}:${transactionHash.toLowerCase()}:${logIndex}`;
        const decoded = decodeKnownEvent(logRow);
        if (!decoded) continue;
        const postCommitTasks: Array<() => Promise<void>> = [];

        try {
          const created = await db.$transaction(async (tx: any) => {
            try {
              await tx.onchainIndexedEvent.create({
                data: {
                  eventKey,
                  chainId: addressBook.chainId,
                  blockNumber: BigInt(logRow.blockNumber ?? 0n),
                  transactionHash: transactionHash.toLowerCase(),
                  logIndex,
                  contractAddress: normalizeAddress(logRow.address),
                  eventName: decoded.name,
                  payload: serialize(decoded.args)
                }
              });
            } catch (error) {
              if (isUniqueConstraintError(error)) {
                return false;
              }
              throw error;
            }

            const args = decoded.args;
            const eventAddress = normalizeAddress(logRow.address);

            if (decoded.name === "MasterVaultCreated") {
              const ownerAddress = normalizeAddress(args.owner);
              const masterVaultAddress = normalizeAddress(args.masterVault);
              const factoryContractVersion = addressBooks.find(
                (entry) => normalizeAddress(entry.factoryAddress) === eventAddress
              )?.contractVersion ?? "v1";
              const user = await tx.user.findFirst({
                where: {
                  walletAddress: {
                    equals: ownerAddress,
                    mode: "insensitive"
                  }
                },
                select: { id: true }
              });

              if (user) {
                const existingMaster = await tx.masterVault.findUnique({ where: { userId: user.id } });
                const masterVault = existingMaster
                  ? await tx.masterVault.update({
                      where: { id: existingMaster.id },
                      data: {
                        onchainAddress: masterVaultAddress,
                        contractVersion: factoryContractVersion
                      }
                    })
                  : await tx.masterVault.create({
                      data: {
                        userId: user.id,
                        onchainAddress: masterVaultAddress,
                        contractVersion: factoryContractVersion
                      }
                    });

                await tx.onchainAction.updateMany({
                  where: {
                    userId: user.id,
                    actionType: "create_master_vault",
                    txHash: transactionHash.toLowerCase()
                  },
                  data: {
                    status: "confirmed",
                    masterVaultId: masterVault.id
                  }
                });
              }
            }

            const masterVault = await findMasterVaultByAddress(tx, eventAddress);

            if (decoded.name === "Deposited" && masterVault) {
              const amount = formatUsdFromAtomic(BigInt(args.amount as bigint));
              const freeAfter = formatUsdFromAtomic(BigInt(args.freeBalanceAfter as bigint));
              await tx.masterVault.update({
                where: { id: masterVault.id },
                data: {
                  freeBalance: freeAfter,
                  availableUsd: freeAfter,
                  totalDeposited: { increment: amount }
                }
              });

              await tx.cashEvent.create({
                data: {
                  masterVaultId: masterVault.id,
                  eventType: "DEPOSIT",
                  amount,
                  idempotencyKey: eventKey,
                  metadata: {
                    source: "onchain_event",
                    txHash: transactionHash.toLowerCase()
                  }
                }
              }).catch((error: unknown) => {
                if (!isUniqueConstraintError(error)) throw error;
              });
            }

            if (decoded.name === "Withdrawn" && masterVault) {
              const amount = formatUsdFromAtomic(BigInt(args.amount as bigint));
              const freeAfter = formatUsdFromAtomic(BigInt(args.freeBalanceAfter as bigint));
              await tx.masterVault.update({
                where: { id: masterVault.id },
                data: {
                  freeBalance: freeAfter,
                  availableUsd: freeAfter,
                  totalWithdrawn: { increment: amount },
                  totalWithdrawnUsd: { increment: amount }
                }
              });

              await tx.cashEvent.create({
                data: {
                  masterVaultId: masterVault.id,
                  eventType: "WITHDRAWAL",
                  amount,
                  idempotencyKey: eventKey,
                  metadata: {
                    source: "onchain_event",
                    txHash: transactionHash.toLowerCase()
                  }
                }
              }).catch((error: unknown) => {
                if (!isUniqueConstraintError(error)) throw error;
              });
            }

            if (decoded.name === "ReservedForBotVault" && masterVault) {
              const amount = formatUsdFromAtomic(BigInt(args.amount as bigint));
              const freeAfter = formatUsdFromAtomic(BigInt(args.freeBalanceAfter as bigint));
              const reservedAfter = formatUsdFromAtomic(BigInt(args.reservedBalanceAfter as bigint));
              const botAddress = normalizeAddress(args.botVault);

              let botVault = await findBotVaultByAddress(tx, botAddress);
              if (!botVault) {
                const action = await tx.onchainAction.findFirst({
                  where: {
                    txHash: transactionHash.toLowerCase(),
                    actionType: "create_bot_vault"
                  },
                  orderBy: [{ createdAt: "desc" }]
                });
                if (action?.botVaultId) {
                  botVault = await tx.botVault.update({
                    where: { id: action.botVaultId },
                    data: {
                      vaultAddress: botAddress
                    }
                  });
                }
              }

              await tx.masterVault.update({
                where: { id: masterVault.id },
                data: {
                  freeBalance: freeAfter,
                  reservedBalance: reservedAfter,
                  totalAllocatedUsd: { increment: amount }
                }
              });

              if (botVault) {
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    principalAllocated: { increment: amount },
                    allocatedUsd: { increment: amount },
                    status: "ACTIVE"
                  }
                });

                await tx.cashEvent.create({
                  data: {
                    masterVaultId: masterVault.id,
                    botVaultId: botVault.id,
                    eventType: "ALLOCATE_TO_BOT",
                    amount,
                    idempotencyKey: eventKey,
                    metadata: {
                      source: "onchain_event",
                      txHash: transactionHash.toLowerCase()
                    }
                  }
                }).catch((error: unknown) => {
                  if (!isUniqueConstraintError(error)) throw error;
                });

                if (String(masterVault.contractVersion ?? "v1").trim().toLowerCase() === "v2") {
                  await markGridProvisioningPendingHypercoreFunding({
                    tx,
                    botVaultId: String(botVault.id),
                    gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
                    txHash: transactionHash.toLowerCase(),
                    allocationUsd: amount
                  });
                } else {
                  await promoteBotVaultExecutionActive({
                    tx,
                    executionLifecycleService,
                    botVault: {
                      id: String(botVault.id),
                      userId: String(botVault.userId),
                      gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
                      status: String(botVault.status ?? "ACTIVE"),
                      executionStatus: String(botVault.executionStatus ?? "")
                    },
                    txHash: transactionHash.toLowerCase(),
                    reason: "bot_vault_onchain_reserve_confirmed"
                  });
                }
              }
            }

            if (decoded.name === "HyperCoreVaultTransferForwarded" && masterVault) {
              const botAddress = normalizeAddress(args.botVault);
              const botVault = await findBotVaultByAddress(tx, botAddress);
              if (botVault) {
                await promoteBotVaultExecutionActive({
                  tx,
                  executionLifecycleService,
                  botVault: {
                    id: String(botVault.id),
                    userId: String(botVault.userId),
                    gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
                    status: String(botVault.status ?? "ACTIVE"),
                    executionStatus: String(botVault.executionStatus ?? "")
                  },
                  txHash: transactionHash.toLowerCase(),
                  reason: "bot_vault_hypercore_funding_confirmed"
                });
              }
            }

            if (
              (decoded.name === "ReleasedFromBotVault" || decoded.name === "BotVaultClaimed" || decoded.name === "BotVaultRecovered")
              && masterVault
            ) {
              const releasedReserved = formatUsdFromAtomic(BigInt(args.releasedReserved as bigint));
              const returnedToFree = formatUsdFromAtomic(BigInt(args.returnedToFree as bigint));
              const freeAfter = formatUsdFromAtomic(BigInt(args.freeBalanceAfter as bigint));
              const reservedAfter = formatUsdFromAtomic(BigInt(args.reservedBalanceAfter as bigint));
              const botAddress = normalizeAddress(args.botVault);
              const botVault = await findBotVaultByAddress(tx, botAddress);

              await tx.masterVault.update({
                where: { id: masterVault.id },
                data: {
                  freeBalance: freeAfter,
                  reservedBalance: reservedAfter,
                  availableUsd: freeAfter
                }
              });

              if (botVault) {
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    principalReturned: { increment: releasedReserved }
                  }
                });

                await tx.cashEvent.create({
                  data: {
                    masterVaultId: masterVault.id,
                    botVaultId: botVault.id,
                    eventType: "RETURN_FROM_BOT",
                    amount: returnedToFree,
                    idempotencyKey: eventKey,
                    metadata: {
                      source: decoded.name === "BotVaultRecovered" ? "onchain_recover_closed" : "onchain_event",
                      releasedReserved,
                      sourceType: decoded.name === "BotVaultRecovered" ? "onchain_recover_closed" : "onchain_return_from_bot",
                      txHash: transactionHash.toLowerCase()
                    }
                  }
                }).catch((error: unknown) => {
                  if (!isUniqueConstraintError(error)) throw error;
                });
              }
            }

            if (decoded.name === "BotVaultCreated") {
              const botAddress = normalizeAddress(args.botVault);
              const agentWallet = normalizeAddress(args.agentWallet);
              const action = await tx.onchainAction.findFirst({
                where: {
                  txHash: transactionHash.toLowerCase(),
                  actionType: "create_bot_vault"
                },
                orderBy: [{ createdAt: "desc" }]
              });
              if (action?.botVaultId) {
                const existingBotVault = await tx.botVault.findUnique({
                  where: { id: action.botVaultId },
                  select: {
                    id: true,
                    userId: true,
                    gridInstanceId: true,
                    status: true,
                    executionStatus: true,
                  executionMetadata: true
                  ,
                  principalAllocated: true,
                  allocatedUsd: true
                  }
                });
                const metadataPatch = mergeBotVaultExecutionMetadata(existingBotVault?.executionMetadata, {
                  vaultAddress: botAddress,
                  chain: String(addressBook.chainId),
                  lastAction: "onchain_bot_vault_created",
                  ...(agentWallet && agentWallet !== "0x0000000000000000000000000000000000000000"
                    ? { agentWallet }
                    : {})
                });
                await tx.botVault.update({
                  where: { id: action.botVaultId },
                  data: {
                    vaultAddress: botAddress,
                    ...(agentWallet && agentWallet !== "0x0000000000000000000000000000000000000000"
                      ? { agentWallet }
                      : {}),
                    executionMetadata: metadataPatch
                  }
                });

                const reserveRequired = requiresDeferredReserve(existingBotVault);
                if (reserveRequired) {
                  await markGridProvisioningPendingReserve({
                    tx,
                    botVaultId: String(existingBotVault.id),
                    gridInstanceId: existingBotVault.gridInstanceId ? String(existingBotVault.gridInstanceId) : null,
                    txHash: transactionHash.toLowerCase(),
                    allocationUsd: readDeferredProvisioningAllocationUsd(existingBotVault.executionMetadata)
                  });
                } else {
                  try {
                    await promoteBotVaultExecutionActive({
                      tx,
                      executionLifecycleService,
                      botVault: {
                        id: String(existingBotVault.id),
                        userId: String(existingBotVault.userId),
                        gridInstanceId: existingBotVault.gridInstanceId ? String(existingBotVault.gridInstanceId) : null,
                        status: String(existingBotVault.status ?? "ACTIVE"),
                        executionStatus: String(existingBotVault.executionStatus ?? "")
                      },
                      txHash: transactionHash.toLowerCase(),
                      reason: "bot_vault_onchain_create_confirmed"
                    });
                  } catch (error) {
                    logger.warn("vault_onchain_indexer_bot_autostart_failed", {
                      botVaultId: existingBotVault.id,
                      txHash: transactionHash.toLowerCase(),
                      error: String(error)
                    });
                  }
                }
              }
            }

            if (decoded.name === "BotVaultV3Created") {
              const botAddress = normalizeAddress(args.vaultAddress);
              const beneficiary = normalizeAddress(args.beneficiary);
              const action = await tx.onchainAction.findFirst({
                where: {
                  txHash: transactionHash.toLowerCase(),
                  actionType: "create_bot_vault_v3"
                },
                orderBy: [{ createdAt: "desc" }]
              });
              if (action?.botVaultId) {
                const existingBotVault = await tx.botVault.findUnique({
                  where: { id: action.botVaultId },
                  select: {
                    id: true,
                    userId: true,
                    gridInstanceId: true,
                    status: true,
                    executionStatus: true,
                    executionMetadata: true
                  }
                });
                if (existingBotVault) {
                  const metadataPatch = mergeBotVaultExecutionMetadata(existingBotVault.executionMetadata, {
                    vaultAddress: botAddress,
                    beneficiaryAddress: beneficiary,
                    chain: String(addressBook.chainId),
                    lastAction: "onchain_bot_vault_v3_created"
                  });
                  await tx.botVault.update({
                    where: { id: action.botVaultId },
                    data: {
                      vaultAddress: botAddress,
                      beneficiaryAddress: beneficiary || null,
                      fundingStatus: "deployed",
                      hypercoreFundingStatus: "not_funded",
                      executionMetadata: metadataPatch
                    }
                  });

                  await markGridProvisioningPendingReserve({
                    tx,
                    botVaultId: String(existingBotVault.id),
                    gridInstanceId: existingBotVault.gridInstanceId ? String(existingBotVault.gridInstanceId) : null,
                    txHash: transactionHash.toLowerCase(),
                    allocationUsd: readDeferredProvisioningAllocationUsd(existingBotVault.executionMetadata)
                  });
                }
              }
            }

            if (decoded.name === "BotVaultClosed") {
              const botAddress = normalizeAddress(args.botVault);
              const botVault = await findBotVaultByAddress(tx, botAddress);
              if (botVault) {
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: { status: "CLOSED" }
                });
              }
            }

            if (decoded.name === "Funded") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const amountUsd = formatUsdFromAtomic(BigInt(args.amount as bigint));
                const principalDepositedAfter = formatUsdFromAtomic(BigInt(args.principalDepositedAfter as bigint));
                const nextMetadata = mergeBotVaultExecutionMetadata(botVault.executionMetadata, {
                  chain: String(addressBook.chainId),
                  lastAction: "onchain_bot_vault_v3_funded",
                  autoActivateStatus: "pending",
                  autoActivateRequestedAt: new Date().toISOString()
                });
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    principalAllocated: principalDepositedAfter,
                    allocatedUsd: principalDepositedAfter,
                    availableUsd: {
                      increment: amountUsd
                    },
                    fundingStatus: "hyper_evm_funded",
                    hypercoreFundingStatus: "pending",
                    executionStatus: "funded",
                    executionMetadata: nextMetadata
                  }
                }).catch(async () => {
                  await tx.botVault.update({
                    where: { id: botVault.id },
                    data: {
                      principalAllocated: principalDepositedAfter,
                      allocatedUsd: principalDepositedAfter,
                      fundingStatus: "hyper_evm_funded",
                      hypercoreFundingStatus: "pending",
                      executionStatus: "funded",
                      executionMetadata: nextMetadata
                    }
                  });
                });

                await promoteBotVaultExecutionActive({
                  tx,
                  executionLifecycleService,
                  botVault: {
                    id: String(botVault.id),
                    userId: String(botVault.userId),
                    gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
                    status: String(botVault.status ?? "ACTIVE"),
                    executionStatus: String(botVault.executionStatus ?? "")
                  },
                  txHash: transactionHash.toLowerCase(),
                  reason: "bot_vault_v3_funding_confirmed"
                });

                if (shouldQueueBotVaultV3AutoActivate({
                  vaultModel: botVault.vaultModel,
                  executionMetadata: botVault.executionMetadata
                })) {
                  const botVaultId = String(botVault.id);
                  const botVaultAddress = eventAddress as `0x${string}`;
                  postCommitTasks.push(async () => {
                    try {
                      const activation = await autoActivateBotVaultV3({
                        mode,
                        botVaultId,
                        botVaultAddress
                      });
                      const existing = await db.botVault.findUnique({
                        where: { id: botVaultId },
                        select: { executionMetadata: true }
                      });
                      await db.botVault.update({
                        where: { id: botVaultId },
                        data: {
                          executionMetadata: mergeBotVaultExecutionMetadata(existing?.executionMetadata, {
                            autoActivateStatus: activation?.txHash ? "submitted" : "skipped",
                            autoActivateSubmittedAt: new Date().toISOString(),
                            autoActivateTxHash: activation?.txHash ?? null,
                            lastAction: activation?.txHash
                              ? "onchain_bot_vault_v3_activate_submitted"
                              : "onchain_bot_vault_v3_activate_skipped"
                          })
                        }
                      }).catch(() => undefined);
                    } catch (error) {
                      logger.warn("vault_onchain_indexer_v3_auto_activate_failed", {
                        botVaultId,
                        botVaultAddress,
                        txHash: transactionHash.toLowerCase(),
                        error: String(error)
                      });
                      const existing = await db.botVault.findUnique({
                        where: { id: botVaultId },
                        select: { executionMetadata: true }
                      }).catch(() => null);
                      await db.botVault.update({
                        where: { id: botVaultId },
                        data: {
                          executionMetadata: mergeBotVaultExecutionMetadata(existing?.executionMetadata, {
                            autoActivateStatus: "failed",
                            autoActivateFailedAt: new Date().toISOString(),
                            autoActivateLastError: String(error),
                            lastAction: "onchain_bot_vault_v3_activate_failed"
                          })
                        }
                      }).catch(() => undefined);
                    }
                  });
                }
              }
            }

            if (decoded.name === "ProfitClaimed") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const grossAmountUsd = formatUsdFromAtomic(BigInt(args.grossAmount as bigint));
                const feeAmountUsd = formatUsdFromAtomic(BigInt(args.feeAmount as bigint));
                const netAmountUsd = formatUsdFromAtomic(BigInt(args.netAmount as bigint));
                const sourceKey = buildProfitShareSourceKey(addressBook.chainId, transactionHash, String(botVault.id));
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    availableUsd: {
                      decrement: grossAmountUsd
                    },
                    withdrawnUsd: { increment: netAmountUsd },
                    claimedProfitUsd: { increment: grossAmountUsd },
                    feePaidTotal: { increment: feeAmountUsd },
                    realizedFeesUsd: { increment: feeAmountUsd }
                  }
                }).catch(async () => {
                  await tx.botVault.update({
                    where: { id: botVault.id },
                    data: {
                      withdrawnUsd: { increment: netAmountUsd },
                      claimedProfitUsd: { increment: grossAmountUsd },
                      feePaidTotal: { increment: feeAmountUsd },
                      realizedFeesUsd: { increment: feeAmountUsd }
                    }
                  });
                });
                await tx.feeEvent.create({
                  data: {
                    botVaultId: botVault.id,
                    eventType: "PROFIT_SHARE",
                    profitBase: grossAmountUsd,
                    feeAmount: feeAmountUsd,
                    sourceKey,
                    metadata: {
                      source: "onchain_event",
                      txHash: transactionHash.toLowerCase(),
                      feeRatePct: DEFAULT_SETTLEMENT_FEE_RATE_PCT,
                      contractVersion: "v3",
                      treasuryPayoutModel: "bot_vault_direct"
                    }
                  }
                }).catch((error: unknown) => {
                  if (!isUniqueConstraintError(error)) throw error;
                });
              }
            }

            if (decoded.name === "VaultClosed") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const principalReturnedTotal = formatUsdFromAtomic(BigInt(args.principalReturnedTotal as bigint));
                const feePaidTotalAfter = formatUsdFromAtomic(BigInt(args.feePaidTotalAfter as bigint));
                const now = new Date();
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    principalReturned: principalReturnedTotal,
                    feePaidTotal: feePaidTotalAfter,
                    fundingStatus: "settled",
                    hypercoreFundingStatus: "withdrawn",
                    executionStatus: "closed",
                    status: "CLOSED",
                    endedAt: now,
                    closedAt: now
                  }
                }).catch(() => undefined);
              }
            }

            if (decoded.name === "ClosedRecoveryApplied") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const releasedReserved = formatUsdFromAtomic(BigInt(args.releasedReserved as bigint));
                const realizedAfter = formatSignedUsdFromAtomic(BigInt(args.realizedPnlNetAfter as bigint));
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    principalReturned: { increment: releasedReserved },
                    realizedPnlNet: realizedAfter,
                    realizedNetUsd: realizedAfter,
                    status: "CLOSED"
                  }
                }).catch(() => undefined);
              }
            }

            if (decoded.name === "FeePaidRecorded") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const feeAmount = formatUsdFromAtomic(BigInt(args.feeAmount as bigint));
                const feePaidTotalAfter = formatUsdFromAtomic(BigInt(args.feePaidTotalAfter as bigint));
                const sourceKey = buildProfitShareSourceKey(addressBook.chainId, transactionHash, String(botVault.id));

                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    feePaidTotal: feePaidTotalAfter,
                    profitShareAccruedUsd: feePaidTotalAfter
                  }
                });

                const existingFeeEvent = await tx.feeEvent.findUnique({
                  where: { sourceKey },
                  select: { id: true, metadata: true }
                }).catch(() => null);
                if (existingFeeEvent?.id) {
                  await tx.feeEvent.update({
                    where: { id: existingFeeEvent.id },
                    data: {
                      feeAmount,
                      metadata: {
                        source: "onchain_event",
                        txHash: transactionHash.toLowerCase(),
                        feeRatePct: DEFAULT_SETTLEMENT_FEE_RATE_PCT,
                        contractVersion: LEGACY_TREASURY_CONTRACT_VERSION,
                        treasuryPayoutModel: LEGACY_TREASURY_PAYOUT_MODEL
                      }
                    }
                  });
                } else {
                  await tx.feeEvent.create({
                    data: {
                      botVaultId: botVault.id,
                      eventType: "PROFIT_SHARE",
                      profitBase: 0,
                      feeAmount,
                      sourceKey,
                      metadata: {
                        source: "onchain_event",
                        txHash: transactionHash.toLowerCase(),
                        feeRatePct: DEFAULT_SETTLEMENT_FEE_RATE_PCT,
                        contractVersion: LEGACY_TREASURY_CONTRACT_VERSION,
                        treasuryPayoutModel: LEGACY_TREASURY_PAYOUT_MODEL
                      }
                    }
                  }).catch((error: unknown) => {
                    if (!isUniqueConstraintError(error)) throw error;
                  });
                }
              }
            }

            if (decoded.name === "TreasuryFeePaid") {
              const botAddress = normalizeAddress(args.botVault);
              const botVault = await findBotVaultByAddress(tx, botAddress);
              if (botVault) {
                const feeAmount = formatUsdFromAtomic(BigInt(args.feeAmount as bigint));
                const grossReturnedUsd = formatUsdFromAtomic(BigInt(args.grossReturned as bigint));
                const netReturnedUsd = formatUsdFromAtomic(BigInt(args.netReturned as bigint));
                const highWaterMarkAfter = formatUsdFromAtomic(BigInt(args.highWaterMarkAfter as bigint));
                const treasuryRecipient = normalizeAddress(args.recipient);
                const sourceKey = buildProfitShareSourceKey(addressBook.chainId, transactionHash, String(botVault.id));
                const existingFeeEvent = await tx.feeEvent.findUnique({
                  where: { sourceKey },
                  select: { id: true, metadata: true }
                }).catch(() => null);
                const existingMetadata = toRecord(existingFeeEvent?.metadata);
                const derivedFeeRatePct =
                  grossReturnedUsd > 0 && feeAmount > 0
                    ? Math.round((feeAmount / grossReturnedUsd) * 10000) / 100
                    : DEFAULT_SETTLEMENT_FEE_RATE_PCT;
                const contractVersion =
                  String(botVault.vaultModel ?? "") === "bot_vault_v3"
                    ? ONCHAIN_TREASURY_CONTRACT_VERSION_V3
                    : ONCHAIN_TREASURY_CONTRACT_VERSION;

                const payload = {
                  source: "onchain_event",
                  txHash: transactionHash.toLowerCase(),
                  treasuryRecipient,
                  grossReturnedUsd,
                  netReturnedUsd,
                  feeRatePct: Number.isFinite(Number(existingMetadata.feeRatePct))
                    ? Number(existingMetadata.feeRatePct)
                    : derivedFeeRatePct,
                  contractVersion,
                  treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL
                };

                if (existingFeeEvent?.id) {
                  await tx.feeEvent.update({
                    where: { id: existingFeeEvent.id },
                    data: {
                      feeAmount,
                      metadata: payload
                    }
                  });
                } else {
                  await tx.feeEvent.create({
                    data: {
                      botVaultId: botVault.id,
                      eventType: "PROFIT_SHARE",
                      profitBase: 0,
                      feeAmount,
                      sourceKey,
                      metadata: payload
                    }
                  }).catch((error: unknown) => {
                    if (!isUniqueConstraintError(error)) throw error;
                  });
                }

                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    highWaterMark: highWaterMarkAfter,
                    executionMetadata: {
                      ...(toRecord(botVault.executionMetadata)),
                      treasuryRecipient,
                      treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL,
                      contractVersion
                    }
                  }
                }).catch(() => undefined);
              }
            }

            if (decoded.name === "BotReleased") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const releasedReserved = formatUsdFromAtomic(BigInt(args.releasedReserved as bigint));
                const grossReturned = formatUsdFromAtomic(BigInt(args.grossReturned as bigint));
                const realizedAfter = formatSignedUsdFromAtomic(BigInt(args.realizedPnlNetAfter as bigint));
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    principalReturned: { increment: releasedReserved },
                    realizedPnlNet: realizedAfter,
                    realizedNetUsd: realizedAfter,
                    availableUsd: {
                      decrement: grossReturned
                    }
                  }
                }).catch(async () => {
                  // Fallback for negative decrement edge cases.
                  await tx.botVault.update({
                    where: { id: botVault.id },
                    data: {
                      principalReturned: { increment: releasedReserved },
                      realizedPnlNet: realizedAfter,
                      realizedNetUsd: realizedAfter
                    }
                  });
                });
              }
            }

            if (decoded.name === "StatusChanged") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const toStatus = String(botVault.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3"
                  ? mapBotVaultV3Status(Number(args.toStatus ?? 0))
                  : mapBotVaultStatus(Number(args.toStatus ?? 0));
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    status: toStatus
                  }
                });
              }
            }

            if (decoded.name === "AgentWalletUpdated") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const nextAgentWallet = normalizeAddress(args.nextAgentWallet);
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    agentWallet: nextAgentWallet || null
                  }
                }).catch(() => undefined);
              }
            }

            if (decoded.name === "ControllerUpdated") {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const nextController = normalizeAddress(args.nextController);
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    controllerAddress: nextController || null
                  }
                }).catch(() => undefined);
              }
            }

            if (masterVault) {
              const currentState = await readMasterVaultState(client, eventAddress as `0x${string}`).catch(() => null);
              if (currentState) {
                await tx.masterVault.update({
                  where: { id: masterVault.id },
                  data: {
                    freeBalance: currentState.freeBalance,
                    reservedBalance: currentState.reservedBalance,
                    availableUsd: currentState.freeBalance
                  }
                });
              }
            }

            if (
              [
                "StatusChanged",
                "BotReleased",
                "ClosedRecoveryApplied",
                "FeePaidRecorded",
                "Funded",
                "ProfitClaimed",
                "VaultClosed"
              ].includes(decoded.name)
            ) {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const botState = String(botVault.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3"
                  ? await readBotVaultV3State(client, eventAddress as `0x${string}`).catch(() => null)
                  : await readBotVaultState(client, eventAddress as `0x${string}`).catch(() => null);
                if (botState) {
                  await tx.botVault.update({
                    where: { id: botVault.id },
                    data: {
                      principalAllocated: botState.principalAllocated,
                      principalReturned: botState.principalReturned,
                      realizedPnlNet: botState.realizedPnlNet,
                      realizedNetUsd: botState.realizedPnlNet,
                      feePaidTotal: botState.feePaidTotal,
                      highWaterMark: botState.highWaterMark,
                      status: String(botVault.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3"
                        ? mapBotVaultV3Status(botState.status)
                        : mapBotVaultStatus(botState.status)
                    }
                  });
                }
              }
            }

            await onchainActionService.markActionConfirmedByTxHash({
              txHash: transactionHash.toLowerCase(),
              status: "confirmed"
            }).catch(() => undefined);

            return true;
          });

          if (created) {
            processedEvents += 1;
            for (const task of postCommitTasks) {
              await task();
            }
          } else {
            skippedDuplicates += 1;
          }
        } catch (error) {
          failedEvents += 1;
          logger.warn("vault_onchain_indexer_event_failed", {
            reason,
            txHash: transactionHash.toLowerCase(),
            logIndex,
            eventName: decoded.name,
            error: String(error)
          });
        }
      }

      await db.onchainSyncCursor.upsert({
        where: { id: cursorId },
        create: {
          id: cursorId,
          chainId: addressBook.chainId,
          lastProcessedBlock: effectiveToBlock
        },
        update: {
          chainId: addressBook.chainId,
          lastProcessedBlock: effectiveToBlock
        }
      });

      lastFromBlock = fromBlock;
      lastToBlock = effectiveToBlock;
      lastFetchedLogs = fetchedLogs.length;
      lastProcessedEvents = processedEvents;
      totalFetchedLogs += fetchedLogs.length;
      totalProcessedEvents += processedEvents;
      totalSkippedDuplicates += skippedDuplicates;
      totalFailedEvents += failedEvents;
      consecutiveFailedCycles = 0;
      lastError = null;
      lastErrorAt = null;
      resetAdaptiveRateLimitState();

      if (processedEvents > 0 || failedEvents > 0) {
        logger.info("vault_onchain_indexer_cycle", {
          reason,
          mode,
          fromBlock: fromBlock.toString(),
          toBlock: effectiveToBlock.toString(),
          fetchedLogs: fetchedLogs.length,
          processedEvents,
          skippedDuplicates,
          failedEvents
        });
      }

      return {
        enabled: true,
        mode,
        fromBlock,
        toBlock: effectiveToBlock,
        fetchedLogs: fetchedLogs.length,
        processedEvents,
        skippedDuplicates,
        failedEvents
      };
    } catch (error) {
      if (isRateLimitError(error)) {
        applyRateLimitBackoff({ reason, stage: "get_logs", error });
        lastError = String(error);
        lastErrorAt = new Date();
        return {
          enabled: true,
          mode: lastMode,
          fromBlock: null,
          toBlock: null,
          fetchedLogs: 0,
          processedEvents: 0,
          skippedDuplicates: 0,
          failedEvents: 0
        };
      }
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
