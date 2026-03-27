import { decodeEventLog, type Hex, type Log } from "viem";
import { logger } from "../logger.js";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "../vaults/executionMode.js";
import { resolveAllOnchainAddressBooks, resolveOnchainAddressBook } from "../vaults/onchainAddressBook.js";
import {
  createOnchainPublicClient,
  formatSignedUsdFromAtomic,
  formatUsdFromAtomic,
  readBotVaultState,
  readMasterVaultState
} from "../vaults/onchainProvider.js";
import {
  botVaultAbi,
  botVaultV2Abi,
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

function mapBotVaultStatus(statusIndex: number): string {
  if (statusIndex === 0) return "ACTIVE";
  if (statusIndex === 1) return "PAUSED";
  if (statusIndex === 2) return "CLOSE_ONLY";
  if (statusIndex === 3) return "CLOSED";
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

  for (const abi of [masterVaultFactoryAbi, masterVaultFactoryV2Abi, masterVaultAbi, masterVaultV2Abi, botVaultAbi, botVaultV2Abi]) {
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
  }
) {
  const onchainActionService = deps?.onchainActionService ?? createOnchainActionService(db);
  const executionLifecycleService = deps?.executionLifecycleService ?? null;

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

      const fetchedLogs: Log[] = [];
      let effectiveToBlock = requestedToBlock;
      try {
        for (const factoryBook of addressBooks) {
          const factoryResult = await getLogsWithAdaptiveRange(client, {
            address: factoryBook.factoryAddress,
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

                const shouldAutoStart = existingBotVault
                  && String(existingBotVault.status ?? "").trim().toUpperCase() === "ACTIVE"
                  && !["running", "close_only", "closed"].includes(String(existingBotVault.executionStatus ?? "").trim().toLowerCase());
                if (shouldAutoStart && executionLifecycleService) {
                  try {
                    await executionLifecycleService.startExecution({
                      tx,
                      userId: String(existingBotVault.userId),
                      botVaultId: String(existingBotVault.id),
                      sourceKey: `bot_vault:${existingBotVault.id}:onchain_create_autostart:${transactionHash.toLowerCase()}`,
                      reason: "bot_vault_onchain_create_confirmed",
                      metadata: {
                        sourceType: "onchain_indexer_bot_vault_created",
                        txHash: transactionHash.toLowerCase()
                      }
                    });
                    if (existingBotVault.gridInstanceId) {
                      const instance = await tx.gridBotInstance.findUnique({
                        where: { id: String(existingBotVault.gridInstanceId) },
                        select: {
                          id: true,
                          botId: true,
                          stateJson: true
                        }
                      });
                      if (instance) {
                        const provisioningState = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
                          ? instance.stateJson as Record<string, unknown>
                          : {};
                        await tx.gridBotInstance.update({
                          where: { id: instance.id },
                          data: {
                            state: "running",
                            stateJson: {
                              ...provisioningState,
                              provisioning: {
                                phase: "execution_active",
                                reason: "bot_vault_onchain_create_confirmed",
                                completedAt: new Date().toISOString(),
                                txHash: transactionHash.toLowerCase()
                              }
                            }
                          }
                        });
                        if (instance.botId) {
                          await tx.bot.update({
                            where: { id: String(instance.botId) },
                            data: {
                              status: "running",
                              lastError: null
                            }
                          }).catch(() => undefined);
                        }
                      }
                    }
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

                const payload = {
                  source: "onchain_event",
                  txHash: transactionHash.toLowerCase(),
                  treasuryRecipient,
                  grossReturnedUsd,
                  netReturnedUsd,
                  feeRatePct: Number.isFinite(Number(existingMetadata.feeRatePct))
                    ? Number(existingMetadata.feeRatePct)
                    : DEFAULT_SETTLEMENT_FEE_RATE_PCT,
                  contractVersion: ONCHAIN_TREASURY_CONTRACT_VERSION,
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
                      contractVersion: ONCHAIN_TREASURY_CONTRACT_VERSION
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
                const toStatus = mapBotVaultStatus(Number(args.toStatus ?? 0));
                await tx.botVault.update({
                  where: { id: botVault.id },
                  data: {
                    status: toStatus
                  }
                });
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

            if (["StatusChanged", "BotReleased", "ClosedRecoveryApplied", "FeePaidRecorded"].includes(decoded.name)) {
              const botVault = await findBotVaultByAddress(tx, eventAddress);
              if (botVault) {
                const botState = await readBotVaultState(client, eventAddress as `0x${string}`).catch(() => null);
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
                      status: mapBotVaultStatus(botState.status)
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
