import { logger } from "../logger.js";
import { normalizeBotVaultStatus } from "@mm/core";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VaultReconciliationStatus } from "../vaults/reconciliation.js";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "../vaults/executionMode.js";
import { resolveHyperEvmWriteRpcUrl, resolveOnchainAddressBook } from "../vaults/onchainAddressBook.js";
import { createOnchainPublicClient, readBotVaultState, readBotVaultV3State, readMasterVaultState } from "../vaults/onchainProvider.js";
import type { ExecutionLifecycleService } from "../vaults/executionLifecycle.service.js";
import { createOnchainActionService, type OnchainActionService } from "../vaults/onchainAction.service.js";
import { sendSerializedControllerTransaction } from "../vaults/controllerTransaction.js";
import { botVaultV3Abi } from "../vaults/onchainAbi.js";
import {
  buildBotVaultV3FundingLifecycleTransitionPatch,
  compareBotVaultV3FundingLifecycleStage,
  getBotVaultV3FundingLifecycleStage
} from "../vaults/botVaultV3.lifecycle.js";

const POLL_MS = Math.max(15, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_INTERVAL_SECONDS ?? "60")) * 1000;
const MASTER_LIMIT = Math.max(1, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_MASTER_LIMIT ?? "100"));
const BOT_LIMIT = Math.max(1, Number(process.env.VAULT_ONCHAIN_RECONCILIATION_BOT_LIMIT ?? "200"));
const EPSILON = 0.000001;
const LOW_HYPE_STATE_KEY_PREFIX = "vault.agent_low_hype.v1:";
const erc20BalanceOfAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const botVaultV3FundedEventAbi = parseAbi([
  "event Funded(address indexed from, uint256 amount, uint256 principalDepositedAfter)"
]);
const BOT_V3_FUNDING_TX_LOOKBACK_BLOCKS = BigInt(Math.max(
  128,
  Number(process.env.VAULT_ONCHAIN_V3_FUNDING_TX_LOOKBACK_BLOCKS ?? "50000")
));

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readClosedRecoveryCompensationUsd(event: { amount?: unknown; metadata?: unknown }): number {
  const metadata = toRecord(event.metadata);
  if (String(metadata.sourceType ?? "") !== "admin_closed_vault_compensation") return 0;
  if (metadata.creditToMasterVaultBalance !== true) return 0;
  const amount = Number(event.amount ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(raw) ? raw as `0x${string}` : null;
}

function normalizeTxHash(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(raw) ? raw as `0x${string}` : null;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  const raw = String(value ?? "").trim();
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  try {
    const parsed = BigInt(raw);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function usdToAtomic(value: unknown): bigint | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return BigInt(Math.round(parsed * 1_000_000));
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function deriveLowHypeState(balanceWei: string | null, thresholdHype: number, stale: boolean): "ok" | "low" | "unavailable" {
  if (!balanceWei) return "unavailable";
  if (stale) return "unavailable";
  const formatted = Number(formatUnits(BigInt(balanceWei), 18));
  if (!Number.isFinite(formatted)) return "unavailable";
  return formatted <= Math.max(0, thresholdHype) + EPSILON ? "low" : "ok";
}

function hasFundingReadyForExecution(row: {
  vaultModel?: unknown;
  fundingStatus?: unknown;
  hypercoreFundingStatus?: unknown;
  executionMetadata?: unknown;
}): boolean {
  const vaultModel = String(row.vaultModel ?? "").trim().toLowerCase();
  if (vaultModel !== "bot_vault_v3") return true;
  return getBotVaultV3FundingLifecycleStage(row) === "execution_ready";
}

function normalizeExecutionStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function deriveV3ReconciledLifecycleState(params: {
  chainStatus: string;
  principalReturned: number;
  usdcBalanceUsd: number | null;
  row: {
    fundingStatus?: unknown;
    hypercoreFundingStatus?: unknown;
    executionStatus?: unknown;
    executionMetadata?: unknown;
    status?: unknown;
  };
}) {
  const economicallyClosed = params.chainStatus === "CLOSED"
    || (
      params.chainStatus === "CLOSE_ONLY"
      && params.usdcBalanceUsd !== null
      && params.usdcBalanceUsd <= EPSILON
      && params.principalReturned > EPSILON
    );
  if (economicallyClosed) {
    return {
      economicallyClosed: true,
      fundingStatus: "settled",
      hypercoreFundingStatus: "withdrawn",
      executionStatus: "closed",
      targetStage: "settled" as const
    } as const;
  }
  return {
    economicallyClosed: false,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    targetStage: "hyper_evm_confirmed" as const
  } as const;
}

function shouldQueueBotVaultV3AutoActivate(metadata: unknown): boolean {
  const record = toRecord(metadata);
  const activateStatus = String(record.autoActivateStatus ?? "").trim().toLowerCase();
  const hypercoreStatus = String(record.autoHypercoreFundingStatus ?? "").trim().toLowerCase();
  if (hypercoreStatus === "confirmed") return false;
  if (activateStatus === "submitted" && hypercoreStatus === "submitted") return false;
  return true;
}

async function recoverBotVaultV3FundingTxHash(params: {
  client: any;
  botVaultAddress: `0x${string}`;
  actionMetadata?: unknown;
  principalAllocated?: unknown;
}): Promise<`0x${string}` | null> {
  const latestBlock = await params.client.getBlockNumber().catch(() => null);
  if (typeof latestBlock !== "bigint") return null;

  const fromBlock = latestBlock > BOT_V3_FUNDING_TX_LOOKBACK_BLOCKS
    ? latestBlock - BOT_V3_FUNDING_TX_LOOKBACK_BLOCKS
    : 0n;
  const logs = await params.client.getLogs({
    address: params.botVaultAddress,
    event: botVaultV3FundedEventAbi[0],
    fromBlock,
    toBlock: latestBlock
  }).catch(() => []);
  if (!Array.isArray(logs) || logs.length === 0) return null;

  const metadata = toRecord(params.actionMetadata);
  const expectedAmountAtomic = readBigInt(metadata.amountAtomic);
  const expectedPrincipalAfterAtomic = usdToAtomic(params.principalAllocated);
  let bestMatch: {
    txHash: `0x${string}`;
    score: number;
    blockNumber: bigint;
    logIndex: number;
  } | null = null;

  for (const log of logs) {
    const txHash = normalizeTxHash(log.transactionHash);
    if (!txHash) continue;

    const args = toRecord(log.args);
    const amountAtomic = readBigInt(args.amount);
    const principalAfterAtomic = readBigInt(args.principalDepositedAfter);
    let score = 0;

    if (expectedAmountAtomic !== null) {
      if (amountAtomic !== expectedAmountAtomic) continue;
      score += 4;
    }
    if (expectedPrincipalAfterAtomic !== null && principalAfterAtomic === expectedPrincipalAfterAtomic) {
      score += 2;
    }
    if (score === 0 && logs.length !== 1) continue;

    const candidate = {
      txHash,
      score,
      blockNumber: BigInt(log.blockNumber ?? 0n),
      logIndex: Number(log.logIndex ?? 0)
    };
    if (
      !bestMatch
      || candidate.score > bestMatch.score
      || (
        candidate.score === bestMatch.score
        && (
          candidate.blockNumber > bestMatch.blockNumber
          || (candidate.blockNumber === bestMatch.blockNumber && candidate.logIndex > bestMatch.logIndex)
        )
      )
    ) {
      bestMatch = candidate;
    }
  }

  return bestMatch?.txHash ?? null;
}

async function reconcileBotVaultV3FundingAction(params: {
  db: any;
  onchainActionService?: Pick<OnchainActionService, "markActionConfirmedByTxHash" | "submitActionTxHash"> | null;
  client: any;
  botVaultId: string;
  botVaultAddress: `0x${string}`;
  principalAllocated?: unknown;
  recoverBotVaultV3FundingTxHash?: typeof recoverBotVaultV3FundingTxHash;
}): Promise<`0x${string}` | null> {
  if (!params.onchainActionService || typeof params.db.onchainAction?.findFirst !== "function") return null;

  const action = await params.db.onchainAction.findFirst({
    where: {
      botVaultId: params.botVaultId,
      actionType: "fund_bot_vault_v3",
      status: {
        in: ["prepared", "submitted", "failed"]
      }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      userId: true,
      txHash: true,
      metadata: true
    }
  }).catch(() => null);
  if (!action) return null;

  const existingTxHash = normalizeTxHash(action.txHash);
  if (existingTxHash) {
    await params.onchainActionService.markActionConfirmedByTxHash({
      txHash: existingTxHash,
      status: "confirmed"
    }).catch(() => undefined);
    return existingTxHash;
  }

  if (typeof params.onchainActionService.submitActionTxHash !== "function") return null;
  const recoverFundingTxHash = params.recoverBotVaultV3FundingTxHash ?? recoverBotVaultV3FundingTxHash;
  const recoveredTxHash = await recoverFundingTxHash({
    client: params.client,
    botVaultAddress: params.botVaultAddress,
    actionMetadata: action.metadata,
    principalAllocated: params.principalAllocated
  }).catch(() => null);
  if (!recoveredTxHash) return null;

  await params.onchainActionService.submitActionTxHash({
    userId: String(action.userId),
    actionId: String(action.id),
    txHash: recoveredTxHash
  }).catch(() => undefined);
  await params.onchainActionService.markActionConfirmedByTxHash({
    txHash: recoveredTxHash,
    status: "confirmed"
  }).catch(() => undefined);
  return recoveredTxHash;
}

async function autoAdvanceBotVaultV3HypercoreFunding(params: {
  mode: string;
  botVaultId: string;
  botVaultAddress: `0x${string}`;
}): Promise<{
  activateTxHash: `0x${string}` | null;
  depositTxHash: `0x${string}` | null;
  depositedAmountAtomic: string;
  hypercoreFunded: boolean;
} | null> {
  const privateKeyRaw = String(process.env.CONTRACTS_PRIVATE_KEY ?? "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKeyRaw) && !/^[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
    logger.warn("vault_onchain_reconciliation_v3_hypercore_advance_missing_private_key", {
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

  let activateTxHash: `0x${string}` | null = null;
  let depositTxHash: `0x${string}` | null = null;
  const statusBefore = await readStatus();
  if (statusBefore === 1) {
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
      hash: activateTxHash,
      confirmations: 1
    });
    if (activateReceipt.status !== "success") throw new Error("bot_vault_v3_activate_tx_failed");
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
      hash: depositTxHash,
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
}

function mapBotVaultV3Status(statusIndex: number): "ACTIVE" | "PAUSED" | "CLOSE_ONLY" | "CLOSED" | "ERROR" {
  if (statusIndex === 0) return "ACTIVE";
  if (statusIndex === 1) return "ACTIVE";
  if (statusIndex === 2) return "ACTIVE";
  if (statusIndex === 3) return "PAUSED";
  if (statusIndex === 4) return "CLOSE_ONLY";
  if (statusIndex === 5) return "CLOSED";
  return "ERROR";
}

async function markGridProvisioningExecutionActive(params: {
  db: any;
  botVaultId: string;
  gridInstanceId?: string | null;
  reason: string;
}) {
  const now = new Date().toISOString();
  const botVault = await params.db.botVault.findUnique({
    where: { id: String(params.botVaultId) },
    select: {
      executionMetadata: true
    }
  }).catch(() => null);
  const botVaultMetadata = toRecord(botVault?.executionMetadata);
  const botVaultProvisioning = toRecord(botVaultMetadata.provisioning);
  await params.db.botVault.update({
    where: { id: String(params.botVaultId) },
    data: {
      executionMetadata: {
        ...botVaultMetadata,
        provisioning: {
          ...botVaultProvisioning,
          phase: "execution_active",
          reason: params.reason,
          completedAt: now
        }
      }
    }
  }).catch(() => undefined);
  if (!params.gridInstanceId) return;
  const instance = await params.db.gridBotInstance.findUnique({
    where: { id: String(params.gridInstanceId) },
    select: { id: true, botId: true, stateJson: true }
  }).catch(() => null);
  if (!instance) return;
  const stateJson = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
    ? instance.stateJson as Record<string, unknown>
    : {};
  const executionProvider = toRecord(stateJson.executionProvider);
  await params.db.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "running",
      stateJson: {
        ...stateJson,
        executionProvider: {
          ...executionProvider,
          lastError: null,
          lastErrorAt: null
        },
        provisioning: {
          phase: "execution_active",
          reason: params.reason,
          completedAt: now
        }
      }
    }
  }).catch(() => undefined);
  if (instance.botId) {
    await params.db.bot.update({
      where: { id: String(instance.botId) },
      data: {
        status: "running",
        lastError: null
      }
    }).catch(() => undefined);
  }
}

async function markGridProvisioningSubmittedHypercoreFunding(params: {
  db: any;
  botVaultId: string;
  gridInstanceId?: string | null;
  txHash?: string | null;
  allocationUsd?: number | null;
}) {
  if (!params.gridInstanceId) return;
  const now = new Date().toISOString();
  const instance = await params.db.gridBotInstance.findUnique({
    where: { id: String(params.gridInstanceId) },
    select: { id: true, botId: true, stateJson: true }
  }).catch(() => null);
  if (!instance) return;
  const stateJson = instance.stateJson && typeof instance.stateJson === "object" && !Array.isArray(instance.stateJson)
    ? instance.stateJson as Record<string, unknown>
    : {};
  await params.db.gridBotInstance.update({
    where: { id: instance.id },
    data: {
      state: "created",
      stateJson: {
        ...stateJson,
        provisioning: {
          phase: "submitted_waiting_hypercore_funding_indexer",
          reason: "bot_vault_v3_hypercore_transfer_pending",
          allocationUsd: params.allocationUsd ?? 0,
          completedAt: now,
          txHash: params.txHash ?? null
        }
      }
    }
  }).catch(() => undefined);
  if (instance.botId) {
    await params.db.bot.update({
      where: { id: String(instance.botId) },
      data: {
        status: "stopped",
        lastError: null
      }
    }).catch(() => undefined);
  }
}

export type VaultOnchainReconciliationStatus = {
  enabled: boolean;
  mode: string;
  running: boolean;
  pollMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastDriftCount: number;
  lastStatus: VaultReconciliationStatus;
  totalCycles: number;
  totalDrifts: number;
  totalFailedCycles: number;
};

export function createVaultOnchainReconciliationJob(
  db: any,
  deps?: {
    onchainActionService?: Pick<OnchainActionService, "markActionConfirmedByTxHash" | "submitActionTxHash"> | null;
    executionLifecycleService?: Pick<ExecutionLifecycleService, "startExecution"> | null;
    readMasterVaultState?: typeof readMasterVaultState;
    readBotVaultState?: typeof readBotVaultState;
    readBotVaultV3State?: typeof readBotVaultV3State;
    recoverBotVaultV3FundingTxHash?: typeof recoverBotVaultV3FundingTxHash;
    readNativeBalance?: ((client: any, address: `0x${string}`) => Promise<bigint>) | null;
    dispatchAgentLowHypeNotification?: ((payload: {
      userId: string;
      masterVaultId: string;
      masterVaultAddress?: string | null;
      agentWalletAddress: string;
      hypeBalance: string | null;
      lowHypeThreshold: number;
      lowHypeState: "ok" | "low" | "unavailable";
      updatedAt?: string | null;
    }) => Promise<void>) | null;
  }
) {
  const onchainActionService = deps?.onchainActionService ?? createOnchainActionService(db);
  const executionLifecycleService = deps?.executionLifecycleService ?? null;
  const readMasterVaultStateFn = deps?.readMasterVaultState ?? readMasterVaultState;
  const readBotVaultStateFn = deps?.readBotVaultState ?? readBotVaultState;
  const readBotVaultV3StateFn = deps?.readBotVaultV3State ?? deps?.readBotVaultState ?? readBotVaultV3State;
  const recoverBotVaultV3FundingTxHashFn = deps?.recoverBotVaultV3FundingTxHash ?? recoverBotVaultV3FundingTxHash;
  const readNativeBalance = deps?.readNativeBalance ?? ((client: any, address: `0x${string}`) => client.getBalance({ address }));
  const dispatchAgentLowHypeNotification = deps?.dispatchAgentLowHypeNotification ?? null;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastMode = "offchain_shadow";
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastDriftCount = 0;
  let totalCycles = 0;
  let totalDrifts = 0;
  let totalFailedCycles = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (running) return { enabled: false, mode: lastMode, drifts: 0 };
    running = true;
    totalCycles += 1;
    lastStartedAt = new Date();

    try {
      const mode = await getEffectiveVaultExecutionMode(db);
      lastMode = mode;
      if (!isOnchainMode(mode)) {
        lastDriftCount = 0;
        lastError = null;
        lastErrorAt = null;
        return { enabled: false, mode, drifts: 0 };
      }

      const addressBook = resolveOnchainAddressBook(mode);
      const client = createOnchainPublicClient(addressBook);

      const masters = await db.masterVault.findMany({
        where: { onchainAddress: { not: null } },
        select: {
          id: true,
          userId: true,
          onchainAddress: true,
          freeBalance: true,
          reservedBalance: true,
          agentWallet: true,
          agentHypeWarnThreshold: true,
          agentLastBalanceAt: true,
          agentLastBalanceWei: true,
          agentLastBalanceFormatted: true
        },
        take: MASTER_LIMIT,
        orderBy: [{ updatedAt: "desc" }]
      });

      const bots = await db.botVault.findMany({
        where: { vaultAddress: { not: null } },
        select: {
          id: true,
          userId: true,
          vaultModel: true,
          vaultAddress: true,
          gridInstanceId: true,
          executionMetadata: true,
          principalAllocated: true,
          principalReturned: true,
          realizedPnlNet: true,
          feePaidTotal: true,
          highWaterMark: true,
          status: true,
          executionStatus: true,
          fundingStatus: true,
          hypercoreFundingStatus: true
        },
        take: BOT_LIMIT,
        orderBy: [{ updatedAt: "desc" }]
      });

      let driftCount = 0;

      for (const row of masters) {
        const address = String(row.onchainAddress ?? "").trim().toLowerCase() as `0x${string}`;
        if (!address) continue;
        const onchain = await readMasterVaultStateFn(client, address).catch(() => null);
        if (!onchain) continue;
        const agentWallet = normalizeAddress(row.agentWallet);
        const lowHypeThreshold = readPositiveNumber(row.agentHypeWarnThreshold, 0.05);
        let agentBalanceWei = typeof row.agentLastBalanceWei === "string" && row.agentLastBalanceWei.trim()
          ? row.agentLastBalanceWei.trim()
          : null;
        let agentBalanceFormatted = typeof row.agentLastBalanceFormatted === "string" && row.agentLastBalanceFormatted.trim()
          ? row.agentLastBalanceFormatted.trim()
          : null;
        let agentLastBalanceAt = row.agentLastBalanceAt instanceof Date ? row.agentLastBalanceAt : null;
        let agentBalanceStale = true;
        if (agentWallet) {
          try {
            const balanceWei = await readNativeBalance(client, agentWallet);
            agentBalanceWei = balanceWei.toString();
            agentBalanceFormatted = formatUnits(balanceWei, 18);
            agentLastBalanceAt = new Date();
            agentBalanceStale = false;
            await db.masterVault.update({
              where: { id: row.id },
              data: {
                agentLastBalanceAt,
                agentLastBalanceWei: agentBalanceWei,
                agentLastBalanceFormatted: agentBalanceFormatted
              }
            }).catch(() => undefined);
          } catch (error) {
            logger.warn("vault_onchain_reconciliation_agent_balance_read_failed", {
              reason,
              masterVaultId: row.id,
              agentWallet,
              error: String(error)
            });
            agentBalanceStale = true;
          }
        }
        const lowHypeState = deriveLowHypeState(agentBalanceWei, lowHypeThreshold, agentBalanceStale);
        const notificationStateKey = `${LOW_HYPE_STATE_KEY_PREFIX}${row.id}`;
        if (dispatchAgentLowHypeNotification && agentWallet && lowHypeState === "low") {
          const existingState = typeof db.globalSetting?.findUnique === "function"
            ? await db.globalSetting.findUnique({
                where: { key: notificationStateKey },
                select: { value: true }
              }).catch(() => null)
            : null;
          const previousState = typeof existingState?.value?.state === "string" ? String(existingState.value.state) : null;
          if (previousState !== "low") {
            await dispatchAgentLowHypeNotification({
              userId: String(row.userId),
              masterVaultId: String(row.id),
              masterVaultAddress: String(row.onchainAddress ?? "").trim() || null,
              agentWalletAddress: agentWallet,
              hypeBalance: agentBalanceFormatted,
              lowHypeThreshold,
              lowHypeState,
              updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
            }).catch((error) => {
              logger.warn("vault_onchain_reconciliation_agent_low_hype_notify_failed", {
                reason,
                masterVaultId: row.id,
                agentWallet,
                error: String(error)
              });
            });
          }
        }
        if (typeof db.globalSetting?.upsert === "function" && agentWallet) {
          await db.globalSetting.upsert({
            where: { key: notificationStateKey },
            update: {
              value: {
                state: lowHypeState,
                balanceWei: agentBalanceWei,
                balanceFormatted: agentBalanceFormatted,
                threshold: lowHypeThreshold,
                updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
              }
            },
            create: {
              key: notificationStateKey,
              value: {
                state: lowHypeState,
                balanceWei: agentBalanceWei,
                balanceFormatted: agentBalanceFormatted,
                threshold: lowHypeThreshold,
                updatedAt: agentLastBalanceAt ? agentLastBalanceAt.toISOString() : null
              }
            }
          }).catch(() => undefined);
        }
        const compensationEvents = typeof db.cashEvent?.findMany === "function"
          ? await db.cashEvent.findMany({
              where: {
                masterVaultId: row.id,
                eventType: "ADJUSTMENT"
              },
              select: {
                amount: true,
                metadata: true
              }
            }).catch(() => [] as Array<{ amount: unknown; metadata: unknown }>)
          : [];
        const offchainCompensationUsd = compensationEvents.reduce(
          (sum, event) => sum + readClosedRecoveryCompensationUsd(event),
          0
        );
        const expectedFreeBalance = onchain.freeBalance + offchainCompensationUsd;

        const freeDiff = Math.abs(Number(row.freeBalance ?? 0) - expectedFreeBalance);
        const reservedDiff = Math.abs(Number(row.reservedBalance ?? 0) - onchain.reservedBalance);
        if (freeDiff <= EPSILON && reservedDiff <= EPSILON) continue;

        driftCount += 1;
        logger.warn("vault_onchain_reconciliation_drift", {
          reason,
          entityType: "master_vault",
          masterVaultId: row.id,
          onchainAddress: address,
          dbFreeBalance: Number(row.freeBalance ?? 0),
          dbReservedBalance: Number(row.reservedBalance ?? 0),
          chainFreeBalance: onchain.freeBalance,
          chainReservedBalance: onchain.reservedBalance,
          offchainCompensationUsd,
          expectedFreeBalance
        });

        await db.masterVault.update({
          where: { id: row.id },
          data: {
            freeBalance: expectedFreeBalance,
            reservedBalance: onchain.reservedBalance,
            availableUsd: expectedFreeBalance
          }
        }).catch((error: unknown) => {
          logger.warn("vault_onchain_reconciliation_master_repair_failed", {
            reason,
            masterVaultId: row.id,
            onchainAddress: address,
            error: String(error)
          });
        });
      }

      for (const row of bots) {
        const address = String(row.vaultAddress ?? "").trim().toLowerCase() as `0x${string}`;
        if (!address) continue;
        const isV3 = String(row.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3";
        const onchain = isV3
          ? await readBotVaultV3StateFn(client, address).catch(() => null)
          : await readBotVaultStateFn(client, address).catch(() => null);
        if (!onchain) continue;

        if (onchainActionService && typeof db.onchainAction?.findFirst === "function") {
          const submittedCreateAction = await db.onchainAction.findFirst({
            where: {
              botVaultId: row.id,
              status: "submitted",
              actionType: {
                in: ["create_bot_vault", "create_bot_vault_v3"]
              },
              txHash: {
                not: null
              }
            },
            orderBy: [{ updatedAt: "desc" }],
            select: {
              id: true,
              txHash: true,
              actionType: true
            }
          }).catch(() => null);

          if (submittedCreateAction?.txHash) {
            await onchainActionService.markActionConfirmedByTxHash({
              txHash: String(submittedCreateAction.txHash)
            }).catch((error) => {
              logger.warn("vault_onchain_reconciliation_confirm_action_failed", {
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                actionId: submittedCreateAction.id,
                actionType: submittedCreateAction.actionType,
                txHash: submittedCreateAction.txHash,
                error: String(error)
              });
            });
          }
        }

        const normalizedDbStatus = normalizeBotVaultStatus(row.status);
        const dbStatus = normalizedDbStatus === "STOPPED" ? "PAUSED" : normalizedDbStatus;
        const chainStatus = isV3
          ? mapBotVaultV3Status(onchain.status)
          : onchain.status === 0
            ? "ACTIVE"
            : onchain.status === 1
              ? "PAUSED"
              : onchain.status === 2
                ? "CLOSE_ONLY"
                : onchain.status === 3
                ? "CLOSED"
                  : "ERROR";
        const v3UsdcBalanceRaw = isV3
          ? await client.readContract({
              address: addressBook.usdcAddress,
              abi: erc20BalanceOfAbi,
              functionName: "balanceOf",
              args: [address]
            }).catch(() => null)
          : null;
        const v3UsdcBalanceUsd = typeof v3UsdcBalanceRaw === "bigint"
          ? Number(formatUnits(v3UsdcBalanceRaw, 6))
          : null;
        const v3Lifecycle = isV3
          ? deriveV3ReconciledLifecycleState({
              chainStatus,
              principalReturned: onchain.principalReturned,
              usdcBalanceUsd: v3UsdcBalanceUsd,
              row
            })
          : null;

        const v3FundingConfirmed = isV3 && (onchain.status >= 1 || onchain.principalAllocated > EPSILON);
        if (v3FundingConfirmed) {
          const currentV3Stage = getBotVaultV3FundingLifecycleStage(row);
          const nextObservedV3Stage = v3Lifecycle?.targetStage ?? "hyper_evm_confirmed";
          const reconciledV3Stage = currentV3Stage === "failed" || currentV3Stage === "recovery_required"
            ? nextObservedV3Stage
            : compareBotVaultV3FundingLifecycleStage(currentV3Stage, nextObservedV3Stage) >= 0
              ? currentV3Stage
              : nextObservedV3Stage;
          const needsHypercoreAdvance =
            reconciledV3Stage !== "hypercore_funded"
            && reconciledV3Stage !== "perp_margin_transferred"
            && reconciledV3Stage !== "execution_ready"
            && reconciledV3Stage !== "settled";
          await reconcileBotVaultV3FundingAction({
            db,
            onchainActionService,
            client,
            botVaultId: String(row.id),
            botVaultAddress: address,
            principalAllocated: onchain.principalAllocated,
            recoverBotVaultV3FundingTxHash: recoverBotVaultV3FundingTxHashFn
          }).catch(() => undefined);
          if (typeof db.botVault?.update === "function") {
            const lifecyclePatch = buildBotVaultV3FundingLifecycleTransitionPatch({
              row,
              targetStage: reconciledV3Stage,
              source: "vault_onchain_reconciliation",
              reason: "onchain_funding_confirmed",
              detail: chainStatus
            });
            await db.botVault.update({
              where: { id: row.id },
              data: {
                principalAllocated: onchain.principalAllocated,
                allocatedUsd: onchain.principalAllocated,
                principalReturned: onchain.principalReturned,
                realizedPnlNet: onchain.realizedPnlNet,
                realizedNetUsd: onchain.realizedPnlNet,
                feePaidTotal: onchain.feePaidTotal,
                highWaterMark: onchain.highWaterMark,
                ...lifecyclePatch,
                status: chainStatus,
                ...(v3Lifecycle?.economicallyClosed
                  ? {
                      endedAt: new Date(),
                      closedAt: new Date()
                    }
                  : {})
              }
            }).catch(() => undefined);
          }

          if (needsHypercoreAdvance) {
            await markGridProvisioningSubmittedHypercoreFunding({
              db,
              botVaultId: String(row.id),
              gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null,
              txHash: String(toRecord(row.executionMetadata).autoHypercoreFundingTxHash ?? toRecord(row.executionMetadata).autoActivateTxHash ?? ""),
              allocationUsd: onchain.principalAllocated
            });
          }

          if (typeof db.onchainAction?.updateMany === "function") {
            await db.onchainAction.updateMany({
              where: {
                botVaultId: row.id,
                actionType: "fund_bot_vault_v3",
                txHash: null,
                status: {
                  in: ["prepared", "submitted"]
                }
              },
              data: {
                status: "failed"
              }
            }).catch(() => undefined);
          }

          if (needsHypercoreAdvance && shouldQueueBotVaultV3AutoActivate(row.executionMetadata)) {
            const advancement = await autoAdvanceBotVaultV3HypercoreFunding({
              mode,
              botVaultId: String(row.id),
              botVaultAddress: address
            }).catch((error) => {
              logger.warn("vault_onchain_reconciliation_v3_hypercore_advance_failed", {
                reason,
                botVaultId: row.id,
                vaultAddress: address,
                error: String(error)
              });
              return null;
            });
            if (typeof db.botVault?.update === "function") {
              const postFundingRow = {
                ...row,
                  fundingStatus: "hyper_evm_confirmed_onchain",
                hypercoreFundingStatus: row.hypercoreFundingStatus,
                executionStatus: normalizeExecutionStatus(row.executionStatus) || "created",
                status: chainStatus,
                executionMetadata: buildBotVaultV3FundingLifecycleTransitionPatch({
                  row,
                  targetStage: reconciledV3Stage,
                  source: "vault_onchain_reconciliation",
                  reason: "onchain_funding_confirmed",
                  detail: chainStatus
                }).executionMetadata
              };
              const lifecyclePatch = buildBotVaultV3FundingLifecycleTransitionPatch({
                row: postFundingRow,
                targetStage: advancement?.hypercoreFunded ? "hypercore_funded" : "hyper_evm_confirmed",
                source: "vault_onchain_reconciliation",
                reason: advancement?.hypercoreFunded ? "hypercore_deposit_confirmed" : "hypercore_deposit_pending",
                detail: String(advancement?.depositTxHash ?? advancement?.activateTxHash ?? "")
              });
              await db.botVault.update({
                where: { id: row.id },
                data: {
                  ...lifecyclePatch,
                  executionMetadata: {
                    ...toRecord(row.executionMetadata),
                    fundingLifecycle: toRecord(lifecyclePatch.executionMetadata).fundingLifecycle,
                    autoActivateStatus: advancement?.activateTxHash ? "confirmed" : "skipped",
                    autoActivateSubmittedAt: advancement?.activateTxHash ? new Date().toISOString() : null,
                    autoActivateTxHash: advancement?.activateTxHash ?? null,
                    autoHypercoreFundingStatus: advancement?.hypercoreFunded ? "confirmed" : "pending",
                    autoHypercoreFundingSubmittedAt: advancement?.depositTxHash ? new Date().toISOString() : null,
                    autoHypercoreFundingTxHash: advancement?.depositTxHash ?? null,
                    autoHypercoreFundingAmountAtomic: advancement?.depositedAmountAtomic ?? "0",
                    lastAction: advancement?.depositTxHash
                      ? "onchain_bot_vault_v3_deposit_hypercore_confirmed"
                      : advancement?.activateTxHash
                        ? "onchain_bot_vault_v3_activate_confirmed"
                        : "onchain_bot_vault_v3_hypercore_advance_skipped"
                  }
                }
              }).catch(() => undefined);
            }
          }
        }

        const effectiveDbStatus = v3FundingConfirmed ? chainStatus : dbStatus;
        const effectiveV3Stage = v3FundingConfirmed
          ? (() => {
              const currentStage = getBotVaultV3FundingLifecycleStage(row);
              const nextObservedStage = v3Lifecycle?.targetStage ?? "hyper_evm_confirmed";
              if (currentStage === "failed" || currentStage === "recovery_required") return nextObservedStage;
              return compareBotVaultV3FundingLifecycleStage(currentStage, nextObservedStage) >= 0
                ? currentStage
                : nextObservedStage;
            })()
          : null;
        const effectiveFundingStatus = v3FundingConfirmed
          ? String(buildBotVaultV3FundingLifecycleTransitionPatch({
              row,
              targetStage: effectiveV3Stage ?? "hyper_evm_confirmed",
              source: "vault_onchain_reconciliation",
              reason: "onchain_funding_confirmed",
              detail: chainStatus
            }).fundingStatus ?? row.fundingStatus ?? "")
          : String(row.fundingStatus ?? "");
        const effectiveHypercoreFundingStatus = v3FundingConfirmed
          ? String(buildBotVaultV3FundingLifecycleTransitionPatch({
              row,
              targetStage: effectiveV3Stage ?? "hyper_evm_confirmed",
              source: "vault_onchain_reconciliation",
              reason: "onchain_funding_confirmed",
              detail: chainStatus
            }).hypercoreFundingStatus ?? row.hypercoreFundingStatus ?? "")
          : String(row.hypercoreFundingStatus ?? "");
        const effectiveExecutionStatus = v3FundingConfirmed
          ? normalizeExecutionStatus(buildBotVaultV3FundingLifecycleTransitionPatch({
              row,
              targetStage: effectiveV3Stage ?? "hyper_evm_confirmed",
              source: "vault_onchain_reconciliation",
              reason: "onchain_funding_confirmed",
              detail: chainStatus
            }).executionStatus ?? row.executionStatus)
          : normalizeExecutionStatus(row.executionStatus);
        const shouldAutoStart = executionLifecycleService
          && effectiveDbStatus === "ACTIVE"
          && chainStatus === "ACTIVE"
          && hasFundingReadyForExecution({
            vaultModel: row.vaultModel,
            fundingStatus: effectiveFundingStatus,
            hypercoreFundingStatus: effectiveHypercoreFundingStatus
          })
          && ["", "created", "funded"].includes(effectiveExecutionStatus);
        if (shouldAutoStart) {
          try {
            await executionLifecycleService.startExecution({
              userId: String(row.userId),
              botVaultId: String(row.id),
              sourceKey: `bot_vault:${row.id}:onchain_reconciliation_autostart`,
              reason: "bot_vault_onchain_reconciliation_autostart",
              metadata: {
                sourceType: "onchain_reconciliation_autostart"
              }
            });
            if (typeof db.gridBotInstance?.findUnique === "function" && typeof db.gridBotInstance?.update === "function") {
              await markGridProvisioningExecutionActive({
                db,
                botVaultId: String(row.id),
                gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null,
                reason: v3FundingConfirmed
                  ? "bot_vault_v3_funding_reconciled_onchain"
                  : "bot_vault_onchain_reconciliation_autostart"
              });
            }
          } catch (error) {
            logger.warn("vault_onchain_reconciliation_autostart_failed", {
              reason,
              botVaultId: row.id,
              vaultAddress: address,
              error: String(error)
            });
          }
        }

        const diffs = {
          principalAllocated: Math.abs(Number(row.principalAllocated ?? 0) - onchain.principalAllocated),
          principalReturned: Math.abs(Number(row.principalReturned ?? 0) - onchain.principalReturned),
          realizedPnlNet: Math.abs(Number(row.realizedPnlNet ?? 0) - onchain.realizedPnlNet),
          feePaidTotal: Math.abs(Number(row.feePaidTotal ?? 0) - onchain.feePaidTotal),
          highWaterMark: Math.abs(Number(row.highWaterMark ?? 0) - onchain.highWaterMark)
        };

        const hasNumericDrift = Object.values(diffs).some((value) => value > EPSILON);
        const hasStatusDrift = dbStatus !== chainStatus;
        if (!hasNumericDrift && !hasStatusDrift) continue;

        driftCount += 1;
        logger.warn("vault_onchain_reconciliation_drift", {
          reason,
          entityType: "bot_vault",
          botVaultId: row.id,
          vaultAddress: address,
          dbStatus,
          chainStatus,
          dbPrincipalAllocated: Number(row.principalAllocated ?? 0),
          chainPrincipalAllocated: onchain.principalAllocated,
          dbPrincipalReturned: Number(row.principalReturned ?? 0),
          chainPrincipalReturned: onchain.principalReturned,
          dbRealizedPnlNet: Number(row.realizedPnlNet ?? 0),
          chainRealizedPnlNet: onchain.realizedPnlNet,
          dbFeePaidTotal: Number(row.feePaidTotal ?? 0),
          chainFeePaidTotal: onchain.feePaidTotal,
          dbHighWaterMark: Number(row.highWaterMark ?? 0),
          chainHighWaterMark: onchain.highWaterMark
        });

        await db.botVault.update({
          where: { id: row.id },
          data: {
            principalAllocated: onchain.principalAllocated,
            principalReturned: onchain.principalReturned,
            realizedPnlNet: onchain.realizedPnlNet,
            realizedNetUsd: onchain.realizedPnlNet,
            feePaidTotal: onchain.feePaidTotal,
            highWaterMark: onchain.highWaterMark,
            status: chainStatus
          }
        }).catch((error: unknown) => {
          logger.warn("vault_onchain_reconciliation_bot_repair_failed", {
            reason,
            botVaultId: row.id,
            vaultAddress: address,
            error: String(error)
          });
        });
      }

      lastDriftCount = driftCount;
      totalDrifts += driftCount;
      lastError = null;
      lastErrorAt = null;

      if (driftCount > 0) {
        logger.info("vault_onchain_reconciliation_cycle", {
          reason,
          mode,
          drifts: driftCount
        });
      }

      return { enabled: true, mode, drifts: driftCount };
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      totalFailedCycles += 1;
      logger.warn("vault_onchain_reconciliation_cycle_failed", {
        reason,
        error: lastError
      });
      return { enabled: false, mode: lastMode, drifts: 0 };
    } finally {
      running = false;
      lastFinishedAt = new Date();
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, POLL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): VaultOnchainReconciliationStatus {
    return {
      enabled: isOnchainMode((lastMode as any) ?? "offchain_shadow"),
      mode: lastMode,
      running,
      pollMs: POLL_MS,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastDriftCount,
      lastStatus: lastError ? "blocked" : lastDriftCount > 0 ? "drift_detected" : "clean",
      totalCycles,
      totalDrifts,
      totalFailedCycles
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
