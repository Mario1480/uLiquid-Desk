import crypto from "node:crypto";
import { HyperliquidCoreWriterClient } from "@mm/futures-exchange";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatUnits, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger as defaultLogger } from "../logger.js";
import { decryptSecret } from "../secret-crypto.js";
import { cancelAllOrders, closePositionsMarket, createPerpExecutionAdapter, type TradingAccount } from "../trading.js";
import { HyperliquidSpotClient, isHyperliquidSpotTestnet } from "../spot/hyperliquid-spot.client.js";
import { resolveWalletReadConfig } from "../wallet/config.js";
import { createApiAgentSecretProvider, type AgentSecretProvider as ApiAgentSecretProvider } from "./agentSecretProvider.js";
import { encryptSecret } from "../secret-crypto.js";
import { resolveHyperEvmWriteRpcUrl } from "./onchainAddressBook.js";
import { sendSerializedControllerTransaction } from "./controllerTransaction.js";
import { botVaultFactoryV3Abi, botVaultV3Abi } from "./onchainAbi.js";
import { createOnchainActionService, type OnchainActionService } from "./onchainAction.service.js";
import {
  buildBotVaultV3FundingLifecycleTransitionPatch,
  compareBotVaultV3FundingLifecycleStage,
  createBotVaultV3FundingLifecycleMetadata,
  readBotVaultV3FundingLifecycleState,
  type BotVaultV3FundingLifecycleStage,
  type BotVaultV3FundingLifecycleTransition
} from "./botVaultV3.lifecycle.js";
import {
  ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
  ONCHAIN_TREASURY_PAYOUT_MODEL
} from "./profitShareTreasury.settings.js";

export type AgentWalletSummary = {
  address: string | null;
  version: number;
  secretRef: string | null;
  hypeBalance: string | null;
  hypeBalanceWei: string | null;
  lowHypeThreshold: number;
  lowHypeState: "ok" | "low" | "unavailable";
  updatedAt: string | null;
  stale: boolean;
};

export type BotVaultV3Summary = {
  id: string;
  botId: string;
  userId: string;
  vaultModel: string;
  beneficiaryAddress: string | null;
  // Controller contract/operator address used to manage the BotVaultV3 lifecycle.
  controllerAddress: string | null;
  // Legacy alias for the BotVaultV3 contract address onchain.
  vaultAddress: string | null;
  // Canonical BotVaultV3 contract address onchain.
  onchainBotVaultAddress: string | null;
  // Address the strategy/execution agent signs with for Hyperliquid actions.
  agentWallet: string | null;
  // Explicit alias for the strategy/execution agent wallet address.
  agentWalletAddress: string | null;
  agentWalletVersion: number;
  agentSecretRef: string | null;
  allocatedUsd: number;
  availableUsd: number;
  withdrawnUsd: number;
  claimedProfitUsd: number;
  feePaidTotal: number;
  // EVM-side funding lifecycle.
  // `hyper_evm_funding_requested` means DB/onchain action intent only.
  // `hyper_evm_confirmed_onchain` means the BotVaultV3 `Funded` event or onchain snapshot confirmed vault funding.
  fundingStatus: string;
  // HyperCore-side lifecycle derived by backend orchestration, not by a dedicated CoreWriter confirmation event.
  // Today `pending` means EVM funding is confirmed and Core-side transfer/execution may still be outstanding.
  // `funded` means a HyperCore transfer completed with explicit post-action verification.
  hypercoreFundingStatus: string;
  fundingLifecycleStage: BotVaultV3FundingLifecycleStage;
  fundingLifecycleUpdatedAt: string | null;
  fundingLifecycleHistory: BotVaultV3FundingLifecycleTransition[];
  hasOnchainVault: boolean;
  fundingConfirmedOnchain: boolean;
  canClaim: boolean;
  canClose: boolean;
  canRecover: boolean;
  canSetAgentWallet: boolean;
  healthSummary: BotVaultV3HealthSummary;
  executionReadiness: BotVaultV3ExecutionReadiness;
  reconciliation: BotVaultV3Reconciliation | null;
  executionStatus: string | null;
  status: string;
  claimableProfitUsd: number;
  endedAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BotVaultV3ControllerCloseResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  closeOnlyTxHash: string | null;
  closeTxHash: string | null;
  onchainStatusBefore: string;
  onchainStatusAfterCloseOnly: string | null;
  principalToReturnAtomic: string;
  grossAmountAtomic: string;
  feeAmountAtomic: string;
};

export type BotVaultV3ControllerRecoverClosedResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  recoverTxHash: string;
  principalToReturnAtomic: string;
  grossAmountAtomic: string;
  feeAmountAtomic: string;
};

export type BotVaultV3ClaimProfitResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  claimTxHash: string;
  grossAmountAtomic: string;
  feeAmountAtomic: string;
  principalPortionAtomic: string;
  postProcessingStage: "applied" | "pending";
  postProcessingReason: string | null;
};

type BotVaultV3SettlementPostProcessingStep = "resync" | "apply" | "fee_event";

type BotVaultV3SettlementPostProcessingState = {
  state: "not_started" | "pending" | "complete";
  pendingSteps: BotVaultV3SettlementPostProcessingStep[];
  lastError: string | null;
  updatedAt: string | null;
};

type BotVaultV3OnchainSnapshot = {
  status: string;
  principalAllocated: number;
  principalReturned: number;
  availableUsd: number;
  feePaidTotal: number;
};

type BotVaultV3ControllerSettlementState = {
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
  excludedPrincipalUsd: number;
  stage: "prepared" | "confirmed" | "applied" | "resync_only_missing_prepare";
  preparedAt: string | null;
  confirmedAt: string | null;
  appliedAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
  postProcessing: BotVaultV3SettlementPostProcessingState;
};

type BotVaultV3ClaimSettlementState = {
  sourceAction: "claim_profit";
  sourceKey: string;
  feeEventSourceKey: string;
  claimTxHash: string | null;
  feeRatePct: number;
  treasuryRecipient: string | null;
  grossAmountUsd: number;
  feeAmountUsd: number;
  netReturnedUsd: number;
  excludedPrincipalUsd: number;
  stage: "prepared" | "confirmed" | "applied";
  preparedAt: string | null;
  confirmedAt: string | null;
  appliedAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
  postProcessing: BotVaultV3SettlementPostProcessingState;
};

export type BotVaultV3ReconciliationIssue = {
  code: string;
  severity: "warning" | "blocking";
  field: string | null;
  sourceOfTruth: "onchain" | "execution" | "local_settlement" | "derived";
  detail: string;
  autoRecoverable: boolean;
  autoRecovered: boolean;
  dbValue: number | string | null;
  observedValue: number | string | null;
  expectedValue: number | string | null;
};

export type BotVaultV3ExecutionStateSnapshot = {
  state: "ok" | "unavailable" | "skipped";
  coreSpotUsd: number | null;
  perpAvailableMarginUsd: number | null;
  perpEquityUsd: number | null;
  totalVisibleUsd: number | null;
  detail: string | null;
};

export type BotVaultV3Reconciliation = {
  status: "ok" | "warning" | "blocking";
  checkedAt: string | null;
  detail: string | null;
  autoApplied: boolean;
  issues: BotVaultV3ReconciliationIssue[];
  sourceOfTruth: {
    principalAllocated: "onchain";
    principalReturned: "onchain";
    availableUsd: "onchain";
    claimedProfitUsd: "local_settlement";
    feePaidTotal: "onchain";
    fundingLifecycle: "derived";
    hypercoreFundingLifecycle: "derived";
    executionBalances: "execution";
  };
  onchainSnapshot: BotVaultV3OnchainSnapshot | null;
  executionSnapshot: BotVaultV3ExecutionStateSnapshot;
};

export type BotVaultV3ActionFlags = {
  hasOnchainVault: boolean;
  fundingConfirmedOnchain: boolean;
  canClaim: boolean;
  canClose: boolean;
  canRecover: boolean;
  canSetAgentWallet: boolean;
};

export type BotVaultV3HealthSummary = {
  lifecycleStatus: string;
  fundingHealth: string;
  onchainStateKnown: boolean;
  actionState: string;
};

export type BotVaultV3ExecutionReadinessReason =
  | "bot_vault_v3_ready"
  | "bot_vault_v3_onchain_vault_missing"
  | "bot_vault_v3_execution_blocked"
  | "bot_vault_v3_reconciliation_blocking_mismatch"
  | "bot_vault_v3_execution_lifecycle_not_ready"
  | "bot_vault_v3_funding_requested_not_confirmed"
  | "bot_vault_v3_hypercore_funding_not_started"
  | "bot_vault_v3_hypercore_transfer_pending"
  | "bot_vault_v3_hypercore_transfer_not_observed"
  | "bot_vault_v3_hypercore_final_state_unverified"
  | "bot_vault_v3_hypercore_pause_restore_unverified";

export type BotVaultV3ExecutionReadiness = {
  ready: boolean;
  stage: "ready" | "configuration" | "funding" | "transfer" | "verification" | "blocked";
  reason: BotVaultV3ExecutionReadinessReason;
  detail: string | null;
  fundingStatus: string;
  hypercoreFundingStatus: string;
  verificationState: string | null;
  verificationBlockingReason: string | null;
};

function readBotVaultV3AddressSemantics(row: any): {
  controllerAddress: string | null;
  vaultAddress: string | null;
  onchainBotVaultAddress: string | null;
  agentWallet: string | null;
  agentWalletAddress: string | null;
} {
  const controllerAddress = toNullableString(row?.controllerAddress);
  const onchainBotVaultAddress = toNullableString(row?.onchainBotVaultAddress ?? row?.vaultAddress);
  const agentWalletAddress = toNullableString(row?.agentWalletAddress ?? row?.agentWallet);
  return {
    controllerAddress,
    vaultAddress: onchainBotVaultAddress,
    onchainBotVaultAddress,
    agentWallet: agentWalletAddress,
    agentWalletAddress
  };
}

type CreateBotVaultV3ServiceDeps = {
  agentSecretProvider?: ApiAgentSecretProvider | null;
  onchainActionService?: Pick<OnchainActionService, "buildReserveForBotVault"> | null;
  buildControllerWalletClient?: ((expectedControllerAddress?: string | null) => {
    account: any;
    chain: any;
    publicClient: any;
    walletClient: any;
  }) | null;
  readHyperliquidClearinghouseState?: ((address: `0x${string}`) => Promise<HyperliquidClearinghouseState>) | null;
  readHyperliquidSpotAssetBalance?: ((address: `0x${string}`, asset: string) => Promise<string>) | null;
  readHyperliquidSpotUsdcBalance?: ((address: `0x${string}`) => Promise<string>) | null;
  createPerpExecutionAdapter?: ((account: TradingAccount) => any) | null;
  createVaultCoreWriter?: ((account: TradingAccount) => BotVaultV3ExitCoreWriter | null) | null;
  createVaultSpotClient?: ((account: TradingAccount) => BotVaultV3ExitSpotClient | null) | null;
  cancelAllOrders?: ((adapter: any, symbol?: string) => Promise<{ requested: number; cancelled: number; failed: number }>) | null;
  closePositionsMarket?: ((adapter: any, symbol: string, side?: "long" | "short") => Promise<string[]>) | null;
  decryptSecret?: ((value: string) => string) | null;
  sleep?: ((ms: number) => Promise<void>) | null;
  logger?: {
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  } | null;
};

type FundBotVaultParams = {
  userId: string;
  botId: string;
  amountUsd: number;
  moveToHyperCore?: boolean;
};

type ClaimProfitParams = {
  userId: string;
  botId: string;
  amountUsd?: number | null;
};

type PreviewClaimProfitParams = {
  userId: string;
  botId: string;
  amountUsd?: number | null;
};

type LoadClaimProfitQuoteParams = PreviewClaimProfitParams & {
  allowEmptyClaim?: boolean;
};

type ClaimProfitQuote = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  status: string;
  claimableProfitRaw: bigint;
  requestedAmountRaw: bigint;
  feeRatePctRaw: bigint;
  feeAmountRaw: bigint;
  treasuryRecipientRaw: `0x${string}` | null;
  excludedPrincipalUsd: number;
  usdcAddress: `0x${string}`;
  controllerClient: {
    account: any;
    chain: any;
    publicClient: any;
    walletClient: any;
  };
  evmUsdcBalanceRaw: bigint;
};

export type BotVaultV3ClaimProfitPreview = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  status: string;
  maxClaimableUsd: number;
  requestedAmountUsd: number;
  feeRatePct: number;
  feeAmountUsd: number;
  netAmountUsd: number;
  excludedPrincipalUsd: number;
  treasuryRecipient: string | null;
};

function formatFundingIntentAmountKey(amountUsd: number): string {
  return roundUsd(toNonNegativeNumber(amountUsd, 0), 6).toFixed(6).replace(/\.?0+$/, "");
}

type FinalizeMarginAddParams = {
  userId: string;
  botVaultId: string;
  amountUsd: number;
};

export type BotVaultV3FinalizeMarginAddResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  requestedAmountUsd: number;
  depositedAmountUsd: number;
  transferToPerpAmountUsd: number;
  coreSpotBalanceBeforeUsd: number;
  coreSpotBalanceAfterUsd: number | null;
  activateTxHash: string | null;
  depositTxHash: string | null;
  pauseTxHash: string | null;
  restoredPaused: boolean;
};

type ReduceMarginParams = {
  userId: string;
  botVaultId: string;
  amountUsd: number;
};

export type BotVaultV3ReduceMarginResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  releasedAmountUsd: number;
  coreSpotBalanceBeforeUsd: number;
  coreSpotBalanceAfterUsd: number | null;
  verificationState: "reduction_verified" | "transfer_observed" | "transfer_submitted";
  verificationBlockingReason: string | null;
  transferResultStatus: string;
  finalPerpStateReadable: boolean;
};

type EndBotVaultParams = {
  userId: string;
  botId: string;
};

type ControllerCloseBotVaultParams = {
  userId: string;
  botVaultId: string;
};

type ControllerRecoverClosedBotVaultParams = {
  userId: string;
  botVaultId: string;
};

type HyperliquidClearinghouseState = {
  withdrawable: string;
  accountValue: string;
  totalMarginUsed: string;
  assetPositions: unknown[];
};

type BotVaultV3ExitSpotSymbol = {
  symbol: string;
  exchangeSymbol?: string;
  assetIndex?: number | null;
  status?: string;
  tradable?: boolean;
  tickSize?: number | null;
  stepSize?: number | null;
  minQty?: number | null;
  maxQty?: number | null;
  quoteAsset?: string | null;
  baseAsset?: string | null;
};

type BotVaultV3ExitSpotClient = {
  listSymbols(): Promise<BotVaultV3ExitSpotSymbol[]>;
  getLastPrice(symbol: string): Promise<number | null>;
};

type BotVaultV3ExitCoreWriter = {
  placeLimitOrder(input: {
    asset: number;
    isBuy: boolean;
    limitPx: number;
    sz: number;
    reduceOnly: boolean;
    encodedTif: 1 | 2 | 3;
    clientOrderId: string;
  }): Promise<{
    status: "confirmed" | "failed" | "pending_timeout";
    submitted: boolean;
    confirmationSource: "receipt" | "none" | "venue_ack";
    receiptStatus: "success" | "reverted" | "unknown";
    orderId?: string;
    candidateOrderId?: string;
    clientOrderId?: string;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
};

type SetUserAgentWalletParams = {
  userId: string;
  agentWallet: string;
  agentWalletVersion?: number | null;
  agentSecretRef?: string | null;
};

type SetUserAgentThresholdParams = {
  userId: string;
  thresholdHype: number;
};

type WithdrawUserAgentHypeParams = {
  userId: string;
  amountHype?: number | null;
  reserveHype?: number | null;
};

type CreateUserAgentWalletParams = {
  userId: string;
};

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundUsd(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const USD_VERIFICATION_EPSILON = 0.000001;
const BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MINUTES = Math.max(
  1,
  Math.trunc(Number(process.env.VAULT_BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MINUTES ?? "15") || 15)
);
const BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MS = BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MINUTES * 60_000;

type BotVaultV3FundingIntentTimeoutState = {
  sourceKey: string | null;
  actionKey: string | null;
  actionStatus: string;
  pendingSinceAt: string;
  timeoutAt: string;
  timedOutAt: string;
  pendingMinutes: number;
  reason: string;
  detail: string;
  error: string;
};

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function formatUsdAtomicToNumber(value: bigint): number {
  return roundUsd(Number(formatUnits(value, 6)), 6);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAtomicUsd(value: number): bigint {
  const rounded = roundUsd(toNonNegativeNumber(value), 6);
  return parseUnits(rounded.toFixed(6), 6);
}

function parseIsoDate(value: unknown): Date | null {
  const raw = toNullableString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addMillisecondsIso(date: Date, ms: number): string {
  return new Date(date.getTime() + ms).toISOString();
}

function readBotVaultV3FundingIntentTimeoutState(params: {
  row: any;
  fundingAction?: {
    actionKey?: unknown;
    status?: unknown;
  } | null;
  now?: Date;
}): BotVaultV3FundingIntentTimeoutState | null {
  const lifecycle = readBotVaultV3FundingLifecycleState(params.row);
  if (lifecycle.stage !== "funding_requested") return null;

  const rowRecord = toRecord(params.row);
  const executionMetadata = toRecord(rowRecord.executionMetadata);
  const fundingIntent = toRecord(executionMetadata.fundingIntent);
  const actionStatus = String(params.fundingAction?.status ?? fundingIntent.actionStatus ?? "").trim().toLowerCase();
  if (!["prepared", "submitted", "confirmed", "requested"].includes(actionStatus)) return null;

  const fundingStatus = String(rowRecord.fundingStatus ?? "").trim().toLowerCase();
  const hypercoreFundingStatus = String(rowRecord.hypercoreFundingStatus ?? "").trim().toLowerCase();
  const chainStatus = String(rowRecord.status ?? "").trim().toUpperCase();
  const hasOnchainFundingEvidence =
    toNonNegativeNumber(rowRecord.principalAllocated) > USD_VERIFICATION_EPSILON
    || toNonNegativeNumber(rowRecord.availableUsd) > USD_VERIFICATION_EPSILON
    || fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded"
    || hypercoreFundingStatus === "pending"
    || hypercoreFundingStatus === "funded"
    || hypercoreFundingStatus === "withdrawn"
    || chainStatus === "FUNDED"
    || chainStatus === "ACTIVE"
    || chainStatus === "PAUSED"
    || chainStatus === "CLOSE_ONLY"
    || chainStatus === "CLOSED";
  if (hasOnchainFundingEvidence) return null;

  const pendingSince = parseIsoDate(fundingIntent.lastBoundAt)
    ?? parseIsoDate(fundingIntent.requestedAt)
    ?? parseIsoDate(lifecycle.updatedAt);
  if (!pendingSince) return null;

  const timeoutAt = parseIsoDate(fundingIntent.timeoutAt)
    ?? new Date(pendingSince.getTime() + BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MS);
  const now = params.now ?? new Date();
  if (timeoutAt.getTime() > now.getTime()) return null;

  const pendingMinutes = Math.max(
    BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MINUTES,
    Math.trunc((now.getTime() - pendingSince.getTime()) / 60_000)
  );
  const sourceKey = toNullableString(fundingIntent.sourceKey);
  const actionKey = toNullableString(params.fundingAction?.actionKey ?? fundingIntent.actionKey);
  const reason = `bot_vault_v3_funding_intent_timeout:${actionStatus}`;
  const detail = sourceKey
    ? `${sourceKey} pending for ${pendingMinutes}m without funding confirmation`
    : `funding intent pending for ${pendingMinutes}m without funding confirmation`;

  return {
    sourceKey,
    actionKey,
    actionStatus,
    pendingSinceAt: pendingSince.toISOString(),
    timeoutAt: timeoutAt.toISOString(),
    timedOutAt: now.toISOString(),
    pendingMinutes,
    reason,
    detail,
    error: `${reason}:${pendingMinutes}m`
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

function derivePrincipalOutstandingRaw(principalDepositedRaw: bigint, principalReturnedRaw: bigint): bigint {
  return principalDepositedRaw > principalReturnedRaw
    ? principalDepositedRaw - principalReturnedRaw
    : 0n;
}

function deriveEffectivePrincipalOutstandingRaw(params: {
  principalDepositedRaw: bigint;
  principalReturnedRaw: bigint;
  excludedPrincipalRaw?: bigint;
}): bigint {
  const principalOutstandingRaw = derivePrincipalOutstandingRaw(
    params.principalDepositedRaw,
    params.principalReturnedRaw
  );
  const excludedPrincipalRaw = params.excludedPrincipalRaw ?? 0n;
  return principalOutstandingRaw > excludedPrincipalRaw
    ? principalOutstandingRaw - excludedPrincipalRaw
    : 0n;
}

function buildBotVaultV3ControllerSettlementSourceKey(
  botVaultId: string,
  sourceAction: "close_vault" | "recover_closed_funds"
): string {
  return `bot_vault_v3:${String(botVaultId)}:${sourceAction}:settlement`;
}

function buildBotVaultV3ClaimSettlementSourceKey(botVaultId: string, claimTxHash: string): string {
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

function buildBotVaultV3SettlementPostProcessingState(params: {
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

function hasPendingBotVaultV3SettlementPostProcessing(
  value: BotVaultV3SettlementPostProcessingState | null | undefined
): boolean {
  return value?.state === "pending" && value.pendingSteps.length > 0;
}

function clearBotVaultV3SettlementPendingStep(
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

function readBotVaultV3ControllerSettlementState(params: {
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
    profitComponentUsd: roundUsd(Math.max(0, grossAmountUsd - principalReturnedUsd), 6),
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

function readBotVaultV3ClaimSettlementState(executionMetadata: unknown): BotVaultV3ClaimSettlementState | null {
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

function normalizeStoredBotVaultV3ExecutionSnapshot(value: unknown): BotVaultV3ExecutionStateSnapshot {
  const raw = toRecord(value);
  const stateRaw = String(raw.state ?? "").trim().toLowerCase();
  const state = stateRaw === "ok" || stateRaw === "unavailable" || stateRaw === "skipped"
    ? stateRaw as BotVaultV3ExecutionStateSnapshot["state"]
    : "skipped";
  const coreSpotUsd = raw.coreSpotUsd == null ? null : roundUsd(toNonNegativeNumber(raw.coreSpotUsd), 6);
  const perpAvailableMarginUsd = raw.perpAvailableMarginUsd == null ? null : roundUsd(toNonNegativeNumber(raw.perpAvailableMarginUsd), 6);
  const perpEquityUsd = raw.perpEquityUsd == null ? null : roundUsd(toNonNegativeNumber(raw.perpEquityUsd), 6);
  const totalVisibleUsd = raw.totalVisibleUsd == null
    ? roundUsd((coreSpotUsd ?? 0) + (perpEquityUsd ?? 0), 6)
    : roundUsd(toNonNegativeNumber(raw.totalVisibleUsd), 6);
  return {
    state,
    coreSpotUsd,
    perpAvailableMarginUsd,
    perpEquityUsd,
    totalVisibleUsd,
    detail: toNullableString(raw.detail)
  };
}

function normalizeStoredBotVaultV3ReconciliationIssue(value: unknown): BotVaultV3ReconciliationIssue | null {
  const raw = toRecord(value);
  const code = String(raw.code ?? "").trim();
  if (!code) return null;
  const severityRaw = String(raw.severity ?? "").trim().toLowerCase();
  const severity = severityRaw === "blocking" ? "blocking" : "warning";
  const sourceRaw = String(raw.sourceOfTruth ?? "").trim().toLowerCase();
  const sourceOfTruth = sourceRaw === "onchain"
    || sourceRaw === "execution"
    || sourceRaw === "local_settlement"
    || sourceRaw === "derived"
    ? sourceRaw as BotVaultV3ReconciliationIssue["sourceOfTruth"]
    : "derived";
  return {
    code,
    severity,
    field: toNullableString(raw.field),
    sourceOfTruth,
    detail: String(raw.detail ?? code),
    autoRecoverable: raw.autoRecoverable === true,
    autoRecovered: raw.autoRecovered === true,
    dbValue: typeof raw.dbValue === "number" || typeof raw.dbValue === "string" ? raw.dbValue : null,
    observedValue: typeof raw.observedValue === "number" || typeof raw.observedValue === "string" ? raw.observedValue : null,
    expectedValue: typeof raw.expectedValue === "number" || typeof raw.expectedValue === "string" ? raw.expectedValue : null
  };
}

export function readBotVaultV3Reconciliation(executionMetadata: unknown): BotVaultV3Reconciliation | null {
  const metadata = toRecord(executionMetadata);
  const raw = toRecord(metadata.botVaultV3Reconciliation);
  if (Object.keys(raw).length === 0) return null;
  const statusRaw = String(raw.status ?? "").trim().toLowerCase();
  const status = statusRaw === "blocking" || statusRaw === "warning" || statusRaw === "ok"
    ? statusRaw as BotVaultV3Reconciliation["status"]
    : "warning";
  const issues = Array.isArray(raw.issues)
    ? raw.issues.map(normalizeStoredBotVaultV3ReconciliationIssue).filter((item): item is BotVaultV3ReconciliationIssue => Boolean(item))
    : [];
  const onchain = toRecord(raw.onchainSnapshot);
  const onchainSnapshot = Object.keys(onchain).length === 0
    ? null
    : {
        status: String(onchain.status ?? "UNKNOWN"),
        principalAllocated: roundUsd(toNonNegativeNumber(onchain.principalAllocated), 6),
        principalReturned: roundUsd(toNonNegativeNumber(onchain.principalReturned), 6),
        availableUsd: roundUsd(toNonNegativeNumber(onchain.availableUsd), 6),
        feePaidTotal: roundUsd(toNonNegativeNumber(onchain.feePaidTotal), 6)
      };
  return {
    status,
    checkedAt: toNullableString(raw.checkedAt),
    detail: toNullableString(raw.detail),
    autoApplied: raw.autoApplied === true,
    issues,
    sourceOfTruth: {
      principalAllocated: "onchain",
      principalReturned: "onchain",
      availableUsd: "onchain",
      claimedProfitUsd: "local_settlement",
      feePaidTotal: "onchain",
      fundingLifecycle: "derived",
      hypercoreFundingLifecycle: "derived",
      executionBalances: "execution"
    },
    onchainSnapshot,
    executionSnapshot: normalizeStoredBotVaultV3ExecutionSnapshot(raw.executionSnapshot)
  };
}

function roundStep(value: number, step: number | null | undefined, mode: "up" | "down"): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!step || !Number.isFinite(step) || step <= 0) {
    return Number(value.toFixed(12));
  }
  const ratio = value / step;
  const epsilon = Math.max(1e-9, Math.abs(ratio) * Number.EPSILON * 16);
  const steps = mode === "up"
    ? Math.ceil(ratio - epsilon)
    : Math.floor(ratio + epsilon);
  if (!Number.isFinite(steps) || steps <= 0) return 0;
  return Number((steps * step).toFixed(12));
}

function statusIndexToLabel(statusIndex: bigint | number): string {
  const normalized = typeof statusIndex === "bigint" ? Number(statusIndex) : statusIndex;
  if (normalized === 0) return "DEPLOYED";
  if (normalized === 1) return "FUNDED";
  if (normalized === 2) return "ACTIVE";
  if (normalized === 3) return "PAUSED";
  if (normalized === 4) return "CLOSE_ONLY";
  if (normalized === 5) return "CLOSED";
  return `UNKNOWN_${String(statusIndex)}`;
}

function findSpotSymbol(
  rows: BotVaultV3ExitSpotSymbol[],
  baseAsset: string,
  quoteAsset: string
): BotVaultV3ExitSpotSymbol | null {
  const normalizedBase = String(baseAsset ?? "").trim().toUpperCase();
  const normalizedQuote = String(quoteAsset ?? "").trim().toUpperCase();
  for (const row of Array.isArray(rows) ? rows : []) {
    const base = String(row?.baseAsset ?? "").trim().toUpperCase();
    const quote = String(row?.quoteAsset ?? "").trim().toUpperCase();
    if (base !== normalizedBase || quote !== normalizedQuote) continue;
    if (row?.tradable === false) continue;
    return row;
  }
  return null;
}

function createDefaultVaultSpotClient(account: TradingAccount): BotVaultV3ExitSpotClient | null {
  if (String(account.exchange ?? "").trim().toLowerCase() !== "hyperliquid") return null;
  if (!account.passphrase || !isAddress(account.passphrase)) return null;
  return new HyperliquidSpotClient({
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    vaultAddress: account.passphrase,
    testnet: isHyperliquidSpotTestnet()
  });
}

function normalizePrivateKey(value: unknown): `0x${string}` | null {
  const normalized = String(value ?? "").trim();
  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(normalized)) return null;
  return (normalized.startsWith("0x") ? normalized : `0x${normalized}`) as `0x${string}`;
}

function sameAddress(left: unknown, right: unknown): boolean {
  if (!isAddress(String(left ?? "")) || !isAddress(String(right ?? ""))) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function deriveAddressFromPrivateKey(value: unknown): `0x${string}` | null {
  const privateKey = normalizePrivateKey(value);
  if (!privateKey) return null;
  return privateKeyToAccount(privateKey).address;
}

function createDefaultVaultCoreWriter(account: TradingAccount): BotVaultV3ExitCoreWriter | null {
  if (String(account.exchange ?? "").trim().toLowerCase() !== "hyperliquid") return null;
  const botVaultAddress = toNullableString(account.botVaultAddress);
  const privateKey = normalizePrivateKey(account.apiSecret);
  if (!botVaultAddress || !isAddress(botVaultAddress) || !privateKey) return null;
  const { walletConfig } = buildHyperEvmClient();
  return new HyperliquidCoreWriterClient({
    privateKey,
    botVaultAddress: botVaultAddress as `0x${string}`,
    rpcUrl: resolveHyperEvmWriteRpcUrl(walletConfig.hyperEvmRpcUrl),
    chainId: walletConfig.hyperEvmChainId
  });
}

function computeClaimableProfitUsd(row: {
  availableUsd?: unknown;
  principalAllocated?: unknown;
  principalReturned?: unknown;
  executionMetadata?: unknown;
}): number {
  const executionMetadata = toRecord(row.executionMetadata);
  const excludedPrincipalUsd = roundUsd(
    toNonNegativeNumber(executionMetadata.hypercoreAccountingFeeUsd),
    6
  );
  const availableUsd = toNonNegativeNumber(row.availableUsd);
  const principalOutstanding = Math.max(
    0,
    toNonNegativeNumber(row.principalAllocated) - toNonNegativeNumber(row.principalReturned)
  );
  const effectivePrincipalOutstandingUsd = Math.max(0, principalOutstanding - excludedPrincipalUsd);
  return roundUsd(Math.max(0, availableUsd - effectivePrincipalOutstandingUsd));
}

function toNormalizedDecimalString(value: unknown, fallback = "0"): string {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : fallback;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeFinite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sumHyperliquidUnrealizedPnlUsd(state: HyperliquidClearinghouseState | null | undefined): number {
  const rows = Array.isArray(state?.assetPositions) ? state.assetPositions : [];
  let total = 0;
  for (const row of rows) {
    const position = row && typeof row === "object" && "position" in row
      ? (row as { position?: Record<string, unknown> | null }).position
      : row as Record<string, unknown> | null;
    const unrealized = toFiniteNumber(position?.unrealizedPnl ?? position?.unrealizedPL, 0);
    total += unrealized;
  }
  return roundUsd(total, 6);
}

function pickString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const raw = String((value as Record<string, unknown>)[key] ?? "").trim();
    if (raw) return raw;
  }
  return null;
}

function pickNumber(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const parsed = Number((value as Record<string, unknown>)[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function postHyperliquidInfoWithRetry(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const baseUrl = String(process.env.HYPERLIQUID_API_URL || "https://api.hyperliquid.xyz").trim();
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/info`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return await response.json().catch(() => null) as Record<string, unknown> | null;
      }
      const body = await response.text().catch(() => "");
      const error = new Error(`hyperliquid_info_request_failed:${response.status}:${body}`);
      if ((response.status !== 429 && response.status < 500) || attempt >= 2) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (attempt >= 2) {
        throw error instanceof Error ? error : new Error(String(error ?? "hyperliquid_info_request_failed"));
      }
      lastError = error instanceof Error ? error : new Error(String(error ?? "hyperliquid_info_request_failed"));
    }
    await sleep(400 * (attempt + 1));
  }
  if (lastError) throw lastError;
  throw new Error("hyperliquid_info_request_failed");
}

async function readHyperliquidClearinghouseState(
  address: `0x${string}`
): Promise<HyperliquidClearinghouseState> {
  const payload = await postHyperliquidInfoWithRetry({
    type: "clearinghouseState",
    user: address
  });
  return {
    withdrawable: toNormalizedDecimalString(payload?.withdrawable, "0"),
    accountValue: toNormalizedDecimalString((payload?.marginSummary as Record<string, unknown> | null)?.accountValue, "0"),
    totalMarginUsed: toNormalizedDecimalString((payload?.marginSummary as Record<string, unknown> | null)?.totalMarginUsed, "0"),
    assetPositions: Array.isArray(payload?.assetPositions) ? payload!.assetPositions as unknown[] : []
  };
}

async function readHyperliquidSpotAssetBalance(address: `0x${string}`, asset: string): Promise<string> {
  const [stateRaw, spotMetaRaw] = await Promise.all([
    postHyperliquidInfoWithRetry({
      type: "spotClearinghouseState",
      user: address
    }),
    postHyperliquidInfoWithRetry({
      type: "spotMeta"
    })
  ]);
  const spotStateRaw = stateRaw?.spotState as Record<string, unknown> | null | undefined;

  const tokens = Array.isArray(spotMetaRaw?.tokens)
    ? spotMetaRaw.tokens
    : Array.isArray(spotMetaRaw?.universe)
      ? spotMetaRaw.universe
      : [];
  const tokenNameByIndex = new Map<number, string>();
  tokens.forEach((entry: unknown, fallbackIndex: number) => {
    const resolvedIndexRaw = pickNumber(entry, ["index", "token", "tokenId", "coinIndex"]);
    const resolvedIndex = resolvedIndexRaw === null || resolvedIndexRaw < 0
      ? fallbackIndex
      : Math.trunc(resolvedIndexRaw);
    const name = pickString(entry, ["name", "coin", "symbol", "tokenName"]);
    if (name) {
      tokenNameByIndex.set(resolvedIndex, name.toUpperCase());
    }
  });

  const balancesRaw = Array.isArray(stateRaw?.balances)
    ? stateRaw.balances
    : Array.isArray(spotStateRaw?.balances)
      ? spotStateRaw.balances as unknown[]
      : Array.isArray(stateRaw?.tokenBalances)
        ? stateRaw.tokenBalances
        : [];
  const normalizedAsset = String(asset ?? "").trim().toUpperCase();

  for (const entry of balancesRaw) {
    const tokenIndex = pickNumber(entry, ["token", "tokenId", "coinIndex"]);
    const tokenName = tokenIndex === null ? null : tokenNameByIndex.get(tokenIndex);
    const symbol = (
      pickString(entry, ["coin", "symbol", "tokenName", "name"])
      ?? tokenName
      ?? ""
    ).toUpperCase();
    if (symbol !== normalizedAsset) continue;
    return toNormalizedDecimalString(pickString(entry, ["total", "balance", "sz", "amount", "available"]), "0");
  }
  return "0";
}

export async function readHyperliquidSpotUsdcBalance(address: `0x${string}`): Promise<string> {
  return readHyperliquidSpotAssetBalance(address, "USDC");
}

function buildHyperEvmClient() {
  const walletConfig = resolveWalletReadConfig();
  const chain = defineChain({
    id: walletConfig.hyperEvmChainId,
    name: walletConfig.hyperEvmChainId === 999 ? "HyperEVM" : `HyperEVM-${walletConfig.hyperEvmChainId}`,
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: {
      default: {
        http: [walletConfig.hyperEvmRpcUrl]
      }
    }
  });
  return {
    walletConfig,
    chain,
    publicClient: createPublicClient({
      chain,
      transport: http(walletConfig.hyperEvmRpcUrl)
    })
  };
}

function deriveLowHypeState(balanceWei: string | null, thresholdHype: number): AgentWalletSummary["lowHypeState"] {
  if (!balanceWei) return "unavailable";
  try {
    const currentWei = BigInt(balanceWei);
    const thresholdWei = parseEther(String(Math.max(0, thresholdHype)));
    return currentWei < thresholdWei ? "low" : "ok";
  } catch {
    return "unavailable";
  }
}

function mapAgentWalletSummary(user: any): AgentWalletSummary {
  const address = toNullableString(user?.agentWallet);
  const version = Math.max(1, Math.trunc(Number(user?.agentWalletVersion ?? 1) || 1));
  const secretRef = toNullableString(user?.agentSecretRef);
  const hypeBalance = toNullableString(user?.agentLastBalanceFormatted);
  const hypeBalanceWei = toNullableString(user?.agentLastBalanceWei);
  const lowHypeThreshold = toNonNegativeNumber(user?.agentHypeWarnThreshold, 0.05);
  const updatedAt = user?.agentLastBalanceAt instanceof Date
    ? user.agentLastBalanceAt.toISOString()
    : toNullableString(user?.agentLastBalanceAt);
  const stale = !updatedAt;
  return {
    address,
    version,
    secretRef,
    hypeBalance,
    hypeBalanceWei,
    lowHypeThreshold,
    lowHypeState: deriveLowHypeState(hypeBalanceWei, lowHypeThreshold),
    updatedAt,
    stale
  };
}

export function buildBotVaultV3ActionFlags(row: any): BotVaultV3ActionFlags {
  const { onchainBotVaultAddress } = readBotVaultV3AddressSemantics(row);
  const status = String(row?.status ?? "DEPLOYED").trim().toUpperCase();
  const executionStatus = String(row?.executionStatus ?? "").trim().toLowerCase();
  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const principalAllocated = toNonNegativeNumber(row?.principalAllocated ?? row?.allocatedUsd);
  const principalReturned = toNonNegativeNumber(row?.principalReturned);
  const claimableProfitUsd = computeClaimableProfitUsd(row);
  const hasOnchainVault = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));
  const fundingConfirmedOnchain =
    principalAllocated > 0
    || principalReturned > 0
    || lifecycle.stage === "hyper_evm_confirmed"
    || lifecycle.stage === "hypercore_funded"
    || lifecycle.stage === "perp_margin_transferred"
    || lifecycle.stage === "execution_ready"
    || lifecycle.stage === "settled";

  return {
    hasOnchainVault,
    fundingConfirmedOnchain,
    canClaim: hasOnchainVault && executionStatus !== "closed" && status !== "CLOSED" && claimableProfitUsd > 0.000001,
    canClose: hasOnchainVault
      && executionStatus !== "closed"
      && (status === "FUNDED" || status === "ACTIVE" || status === "PAUSED" || status === "CLOSE_ONLY"),
    canRecover: hasOnchainVault
      && fundingConfirmedOnchain
      && executionStatus === "closed"
      && (status === "CLOSE_ONLY" || status === "CLOSED"),
    canSetAgentWallet: true
  };
}

export function buildBotVaultV3HealthSummary(row: any): BotVaultV3HealthSummary {
  const { onchainBotVaultAddress, agentWalletAddress } = readBotVaultV3AddressSemantics(row);
  const actionFlags = buildBotVaultV3ActionFlags(row);
  const status = String(row?.status ?? "DEPLOYED").trim().toUpperCase();
  const executionStatus = String(row?.executionStatus ?? "").trim().toLowerCase();
  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const fundingConfirmedOnchain = actionFlags.fundingConfirmedOnchain;
  const onchainStateKnown = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));

  let lifecycleStatus: string = lifecycle.stage;
  if (executionStatus === "closed") lifecycleStatus = "closed";
  else if (status === "ACTIVE" && lifecycle.stage === "execution_ready") lifecycleStatus = "active";
  else if (status === "PAUSED" && lifecycle.stage === "execution_ready") lifecycleStatus = "paused";
  else if (status === "CLOSE_ONLY") lifecycleStatus = "close_only";
  else if (status === "CLOSED" || lifecycle.stage === "settled") lifecycleStatus = "closed";

  let fundingHealth = "empty";
  if (lifecycle.stage === "funding_requested") fundingHealth = "requested";
  else if (lifecycle.stage === "hyper_evm_confirmed") fundingHealth = "confirmed_onchain";
  else if (lifecycle.stage === "hypercore_funded") fundingHealth = "hypercore_funded";
  else if (lifecycle.stage === "perp_margin_transferred") fundingHealth = "transfer_pending";
  else if (lifecycle.stage === "execution_ready") fundingHealth = "funded";
  else if (lifecycle.stage === "failed") fundingHealth = "failed";
  else if (lifecycle.stage === "recovery_required") fundingHealth = "recovery_required";
  else if (lifecycle.stage === "settled") fundingHealth = "settled";
  else if (fundingConfirmedOnchain) fundingHealth = "confirmed_onchain";

  let actionState = "idle";
  if (!agentWalletAddress && actionFlags.canSetAgentWallet) actionState = "agent_setup_required";
  else if (actionFlags.canRecover) actionState = "recover_available";
  else if (actionFlags.canClaim) actionState = "claim_available";
  else if (actionFlags.canClose) actionState = "close_available";
  else if (fundingHealth === "requested" || fundingHealth === "transfer_pending") actionState = "waiting_on_chain";
  else if (executionStatus === "closed" || lifecycleStatus === "closed") actionState = "closed";

  return {
    lifecycleStatus,
    fundingHealth,
    onchainStateKnown,
    actionState
  };
}

export function evaluateBotVaultV3ExecutionReadiness(row: any): BotVaultV3ExecutionReadiness {
  const { onchainBotVaultAddress } = readBotVaultV3AddressSemantics(row);
  const hasOnchainVault = Boolean(onchainBotVaultAddress && isAddress(onchainBotVaultAddress));
  const status = String(row?.status ?? "DEPLOYED").trim().toUpperCase();
  const executionStatus = String(row?.executionStatus ?? "").trim().toLowerCase();
  const fundingStatus = String(row?.fundingStatus ?? "vault_empty").trim().toLowerCase();
  const hypercoreFundingStatus = String(row?.hypercoreFundingStatus ?? "not_funded").trim().toLowerCase();
  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const executionMetadata = toRecord(row?.executionMetadata);
  const marginAddFinalization = toRecord(executionMetadata.marginAddFinalization);
  const reconciliation = row?.reconciliation && typeof row.reconciliation === "object"
    ? row.reconciliation as BotVaultV3Reconciliation
    : readBotVaultV3Reconciliation(executionMetadata);
  const lifecycleOverrideState = String(executionMetadata.lifecycleOverrideState ?? "").trim().toLowerCase();
  const verificationState = toNullableString(marginAddFinalization.verificationState);
  const verificationBlockingReason = toNullableString(marginAddFinalization.verificationBlockingReason);

  const buildResult = (
    ready: boolean,
    stage: BotVaultV3ExecutionReadiness["stage"],
    reason: BotVaultV3ExecutionReadinessReason,
    detail?: string | null
  ): BotVaultV3ExecutionReadiness => ({
    ready,
    stage,
    reason,
    detail: toNullableString(detail),
    fundingStatus,
    hypercoreFundingStatus,
    verificationState,
    verificationBlockingReason
  });

  if (
    lifecycle.stage === "failed"
    || lifecycle.stage === "recovery_required"
    || status === "ERROR"
    || status === "CLOSE_ONLY"
    || status === "CLOSED"
    || executionStatus === "error"
    || executionStatus === "close_only"
    || executionStatus === "closed"
    || lifecycleOverrideState === "withdraw_pending"
    || lifecycleOverrideState === "settling"
    || lifecycleOverrideState === "close_only"
    || lifecycleOverrideState === "closed"
  ) {
    return buildResult(
      false,
      "blocked",
      "bot_vault_v3_execution_blocked",
      lifecycle.recoveryReason || lifecycle.failureReason || lifecycleOverrideState || executionStatus || status
    );
  }

  if (reconciliation?.status === "blocking") {
    return buildResult(
      false,
      "blocked",
      "bot_vault_v3_reconciliation_blocking_mismatch",
      reconciliation.issues.find((issue) => issue.severity === "blocking")?.code ?? reconciliation.detail
    );
  }

  if (!hasOnchainVault) {
    return buildResult(false, "configuration", "bot_vault_v3_onchain_vault_missing");
  }

  if (lifecycle.stage === "deployed") {
    return buildResult(false, "funding", "bot_vault_v3_funding_requested_not_confirmed", "deployed");
  }

  if (lifecycle.stage === "funding_requested" || fundingStatus === "hyper_evm_funding_requested") {
    return buildResult(false, "funding", "bot_vault_v3_funding_requested_not_confirmed");
  }

  if (lifecycle.stage === "execution_ready") {
    if (verificationState && verificationState !== "funding_verified") {
      return buildResult(
        false,
        verificationBlockingReason === "paused_restore_unconfirmed" ? "verification" : "transfer",
        verificationBlockingReason === "paused_restore_unconfirmed"
          ? "bot_vault_v3_hypercore_pause_restore_unverified"
          : "bot_vault_v3_hypercore_final_state_unverified",
        verificationBlockingReason
      );
    }
    return buildResult(true, "ready", "bot_vault_v3_ready");
  }

  if (
    verificationState === "funding_verified"
    || hypercoreFundingStatus === "funded"
    || executionStatus === "running"
    || executionStatus === "paused"
  ) {
    return buildResult(
      false,
      "verification",
      "bot_vault_v3_execution_lifecycle_not_ready",
      lifecycle.stage
    );
  }

  if (lifecycle.stage === "hypercore_funded") {
    return buildResult(false, "transfer", "bot_vault_v3_hypercore_transfer_pending");
  }

  if (lifecycle.stage === "perp_margin_transferred") {
    if (verificationBlockingReason === "paused_restore_unconfirmed") {
      return buildResult(false, "verification", "bot_vault_v3_hypercore_pause_restore_unverified", verificationBlockingReason);
    }
    return buildResult(false, "verification", "bot_vault_v3_hypercore_final_state_unverified", verificationBlockingReason);
  }

  if (hypercoreFundingStatus === "pending") {
    if (verificationBlockingReason === "paused_restore_unconfirmed") {
      return buildResult(false, "verification", "bot_vault_v3_hypercore_pause_restore_unverified", verificationBlockingReason);
    }
    if (
      verificationBlockingReason === "perp_state_read_unavailable"
      || verificationBlockingReason === "final_state_resync_unavailable"
      || verificationState === "transfer_observed"
    ) {
      return buildResult(false, "verification", "bot_vault_v3_hypercore_final_state_unverified", verificationBlockingReason);
    }
    if (
      verificationBlockingReason === "transfer_not_yet_observed"
      || verificationState === "transfer_submitted"
    ) {
      return buildResult(false, "transfer", "bot_vault_v3_hypercore_transfer_not_observed", verificationBlockingReason);
    }
    return buildResult(false, "transfer", "bot_vault_v3_hypercore_transfer_pending", verificationBlockingReason);
  }

  if (lifecycle.stage === "hyper_evm_confirmed" || fundingStatus === "hyper_evm_confirmed_onchain" || fundingStatus === "hyper_evm_funded") {
    return buildResult(false, "transfer", "bot_vault_v3_hypercore_funding_not_started");
  }

  return buildResult(false, "funding", "bot_vault_v3_funding_requested_not_confirmed");
}

function mapBotVaultSummary(row: any): BotVaultV3Summary {
  const actionFlags = buildBotVaultV3ActionFlags(row);
  const healthSummary = buildBotVaultV3HealthSummary(row);
  const executionReadiness = evaluateBotVaultV3ExecutionReadiness(row);
  const reconciliation = readBotVaultV3Reconciliation(row.executionMetadata);
  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const addresses = readBotVaultV3AddressSemantics(row);
  return {
    id: String(row.id),
    botId: String(row.botId),
    userId: String(row.userId),
    vaultModel: String(row.vaultModel ?? "bot_vault_v3"),
    beneficiaryAddress: toNullableString(row.beneficiaryAddress),
    ...addresses,
    agentWalletVersion: Math.max(1, Math.trunc(Number(row.agentWalletVersion ?? 1) || 1)),
    agentSecretRef: toNullableString(row.agentSecretRef),
    allocatedUsd: toNonNegativeNumber(row.allocatedUsd),
    availableUsd: toNonNegativeNumber(row.availableUsd),
    withdrawnUsd: toNonNegativeNumber(row.withdrawnUsd),
    claimedProfitUsd: toNonNegativeNumber(row.claimedProfitUsd),
    feePaidTotal: toNonNegativeNumber(row.feePaidTotal),
    fundingStatus: String(row.fundingStatus ?? "vault_empty"),
    hypercoreFundingStatus: String(row.hypercoreFundingStatus ?? "not_funded"),
    fundingLifecycleStage: lifecycle.stage,
    fundingLifecycleUpdatedAt: lifecycle.updatedAt,
    fundingLifecycleHistory: lifecycle.history,
    ...actionFlags,
    healthSummary,
    executionReadiness,
    reconciliation,
    executionStatus: toNullableString(row.executionStatus),
    status: String(row.status ?? "DEPLOYED"),
    claimableProfitUsd: computeClaimableProfitUsd(row),
    endedAt: row.endedAt instanceof Date ? row.endedAt.toISOString() : toNullableString(row.endedAt),
    closedAt: row.closedAt instanceof Date ? row.closedAt.toISOString() : toNullableString(row.closedAt),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : toNullableString(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : toNullableString(row.updatedAt)
  };
}

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

async function readBotVaultV3OnchainSnapshot(params: {
  publicClient: any;
  vaultAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}): Promise<BotVaultV3OnchainSnapshot> {
  const [statusRaw, principalDepositedRaw, principalReturnedRaw, feePaidTotalRaw, usdcBalanceRaw] = await Promise.all([
    params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV3Abi,
      functionName: "status"
    }),
    params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV3Abi,
      functionName: "principalDeposited"
    }) as Promise<bigint>,
    params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV3Abi,
      functionName: "principalReturned"
    }) as Promise<bigint>,
    params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV3Abi,
      functionName: "feePaidTotal"
    }) as Promise<bigint>,
    params.publicClient.readContract({
      address: params.usdcAddress,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [params.vaultAddress]
    }) as Promise<bigint>
  ]);

  return {
    status: statusIndexToLabel(statusRaw),
    principalAllocated: formatUsdAtomicToNumber(principalDepositedRaw),
    principalReturned: formatUsdAtomicToNumber(principalReturnedRaw),
    availableUsd: formatUsdAtomicToNumber(usdcBalanceRaw),
    feePaidTotal: formatUsdAtomicToNumber(feePaidTotalRaw)
  };
}

export function buildBotVaultV3ResyncUpdate(snapshot: BotVaultV3OnchainSnapshot, now = new Date()) {
  const data: Record<string, unknown> = {
    status: snapshot.status,
    principalAllocated: snapshot.principalAllocated,
    allocatedUsd: snapshot.principalAllocated,
    principalReturned: snapshot.principalReturned,
    availableUsd: snapshot.availableUsd,
    feePaidTotal: snapshot.feePaidTotal
  };

  const economicallyClosed = snapshot.status === "CLOSED"
    || (
      snapshot.status === "CLOSE_ONLY"
      && snapshot.availableUsd <= 0
      && snapshot.principalReturned > 0
    );

  if (economicallyClosed) {
    data.fundingStatus = "settled";
    data.hypercoreFundingStatus = "withdrawn";
    data.executionStatus = "closed";
    data.endedAt = now;
    data.closedAt = now;
    return data;
  }

  if (snapshot.principalAllocated > 0 || snapshot.availableUsd > 0) {
    data.fundingStatus = "hyper_evm_confirmed_onchain";
  }

  return data;
}

async function resolveTemplateIdForBot(db: any): Promise<string> {
  const exact = await db.botTemplate.findUnique({
    where: { id: "legacy_grid_default" },
    select: { id: true }
  }).catch(() => null);
  if (exact?.id) return String(exact.id);
  const fallback = await db.botTemplate.findFirst({
    where: {},
    orderBy: { createdAt: "asc" },
    select: { id: true }
  }).catch(() => null);
  if (fallback?.id) return String(fallback.id);
  throw new Error("bot_template_missing");
}

async function findBotVaultRowForUpdate(
  client: any,
  botVaultId: string,
  select: Record<string, unknown>
): Promise<any | null> {
  if (client?.botVault?.findUnique) {
    return client.botVault.findUnique({
      where: { id: botVaultId },
      select
    });
  }
  if (client?.botVault?.findFirst) {
    return client.botVault.findFirst({
      where: { id: botVaultId },
      select
    });
  }
  return null;
}

async function withDbTransaction<T>(db: any, operation: (tx: any) => Promise<T>): Promise<T> {
  if (typeof db?.$transaction === "function") {
    return db.$transaction(operation);
  }
  return operation(db);
}

function hasUsdDrift(dbValue: unknown, expectedValue: unknown, epsilon = USD_VERIFICATION_EPSILON): boolean {
  return Math.abs(toNonNegativeNumber(dbValue) - toNonNegativeNumber(expectedValue)) > epsilon;
}

function buildBotVaultV3ReconciliationIssue(params: {
  code: string;
  severity: "warning" | "blocking";
  field?: string | null;
  sourceOfTruth: "onchain" | "execution" | "local_settlement" | "derived";
  detail: string;
  autoRecoverable?: boolean;
  autoRecovered?: boolean;
  dbValue?: number | string | null;
  observedValue?: number | string | null;
  expectedValue?: number | string | null;
}): BotVaultV3ReconciliationIssue {
  return {
    code: params.code,
    severity: params.severity,
    field: params.field ?? null,
    sourceOfTruth: params.sourceOfTruth,
    detail: params.detail,
    autoRecoverable: params.autoRecoverable === true,
    autoRecovered: params.autoRecovered === true,
    dbValue: params.dbValue ?? null,
    observedValue: params.observedValue ?? null,
    expectedValue: params.expectedValue ?? null
  };
}

export function createBotVaultV3Service(db: any, deps?: CreateBotVaultV3ServiceDeps) {
  const agentSecretProvider = deps?.agentSecretProvider ?? createApiAgentSecretProvider();
  const controllerAddress = toNullableString(process.env.BOT_VAULT_V3_CONTROLLER_ADDRESS);
  const logger = deps?.logger ?? defaultLogger;
  const onchainActionService = deps?.onchainActionService ?? createOnchainActionService(db);
  const decryptSecretValue = deps?.decryptSecret ?? decryptSecret;
  const buildControllerWalletClientOverride = deps?.buildControllerWalletClient ?? null;
  const readHyperliquidClearinghouseStateLive = deps?.readHyperliquidClearinghouseState ?? readHyperliquidClearinghouseState;
  const readHyperliquidSpotAssetBalanceLive = deps?.readHyperliquidSpotAssetBalance ?? readHyperliquidSpotAssetBalance;
  const readHyperliquidSpotUsdcBalanceLive = deps?.readHyperliquidSpotUsdcBalance ?? readHyperliquidSpotUsdcBalance;
  const createPerpExecutionAdapterImpl = deps?.createPerpExecutionAdapter ?? createPerpExecutionAdapter;
  const createVaultCoreWriterImpl = deps?.createVaultCoreWriter ?? createDefaultVaultCoreWriter;
  const createVaultSpotClientImpl = deps?.createVaultSpotClient ?? createDefaultVaultSpotClient;
  const cancelAllOrdersImpl = deps?.cancelAllOrders ?? cancelAllOrders;
  const closePositionsMarketImpl = deps?.closePositionsMarket ?? closePositionsMarket;
  const sleepImpl = deps?.sleep ?? sleep;

  async function persistBotVaultV3StateOrThrow(params: {
    botVaultId: string;
    data: Record<string, unknown>;
    operation: string;
    phase: string;
    meta?: Record<string, unknown>;
  }) {
    try {
      await db.botVault.update({
        where: { id: params.botVaultId },
        data: params.data
      });
    } catch (error) {
      logger.warn("bot_vault_v3_state_persist_failed", {
        botVaultId: params.botVaultId,
        operation: params.operation,
        phase: params.phase,
        error: String(error),
        ...(params.meta ?? {})
      });
      throw new Error(
        `bot_vault_v3_${params.operation}_state_persist_failed:${params.phase}:${params.botVaultId}:${String(error)}`
      );
    }
  }

  async function markBotVaultV3ControllerSettlementPendingOrThrow(params: {
    botVaultId: string;
    metadataKey: "closeSettlement" | "recoverySettlement";
    settlement: BotVaultV3ControllerSettlementState;
    lastError: string;
    flow: "close" | "recovery";
  }) {
    try {
      await markBotVaultV3ControllerSettlementPostProcessingPending({
        botVaultId: params.botVaultId,
        metadataKey: params.metadataKey,
        settlement: params.settlement,
        lastError: params.lastError
      });
    } catch (persistError) {
      logger.warn("bot_vault_v3_settlement_pending_mark_failed", {
        botVaultId: params.botVaultId,
        metadataKey: params.metadataKey,
        flow: params.flow,
        originalError: params.lastError,
        persistError: String(persistError)
      });
      throw new Error(
        `bot_vault_v3_${params.flow}_post_processing_pending_mark_failed:${params.botVaultId}:${params.lastError}:${String(persistError)}`
      );
    }
  }

  function buildControllerWalletClient(expectedControllerAddress?: string | null) {
    if (buildControllerWalletClientOverride) {
      return buildControllerWalletClientOverride(expectedControllerAddress);
    }
    const privateKeyRaw = String(process.env.CONTRACTS_PRIVATE_KEY ?? "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKeyRaw) && !/^[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
      throw new Error("controller_private_key_missing");
    }
    const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as `0x${string}`;
    const { chain, walletConfig } = buildHyperEvmClient();
    const rpcUrl = resolveHyperEvmWriteRpcUrl(walletConfig.hyperEvmRpcUrl);
    const account = privateKeyToAccount(privateKey);
    if (expectedControllerAddress && isAddress(expectedControllerAddress)) {
      if (String(account.address).toLowerCase() !== String(expectedControllerAddress).toLowerCase()) {
        throw new Error("controller_private_key_address_mismatch");
      }
    }
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl || walletConfig.hyperEvmRpcUrl)
    });
    return { account, chain, publicClient, walletClient };
  }

  async function readHypercoreAccountingFeeUsdForBotVault(params: {
    botVaultId: string;
    executionMetadata?: unknown;
  }): Promise<number> {
    const executionMetadata = toRecord(params.executionMetadata);
    const metadataFeeUsd = roundUsd(
      toNonNegativeNumber(executionMetadata.hypercoreAccountingFeeUsd),
      6
    );
    if (metadataFeeUsd > 0) return metadataFeeUsd;
    if (!db?.feeEvent?.findMany) return 0;
    const rows = await db.feeEvent.findMany({
      where: {
        botVaultId: params.botVaultId,
        eventType: "ADJUSTMENT"
      },
      select: {
        feeAmount: true,
        metadata: true
      }
    }).catch(() => []);
    let totalFeeUsd = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const metadata = toRecord(row?.metadata);
      if (String(metadata.source ?? "") !== "hypercore_account_creation") continue;
      totalFeeUsd += toNonNegativeNumber(row?.feeAmount);
    }
    return roundUsd(totalFeeUsd, 6);
  }

  async function findProfitShareFeeEventBySourceKey(params: {
    dbClient?: any;
    sourceKey: string;
  }): Promise<any | null> {
    const feeDb = params.dbClient ?? db;
    if (!params.sourceKey) return null;
    if (typeof feeDb?.feeEvent?.findUnique === "function") {
      return feeDb.feeEvent.findUnique({
        where: { sourceKey: params.sourceKey }
      }).catch(() => null);
    }
    if (typeof feeDb?.feeEvent?.findFirst === "function") {
      return feeDb.feeEvent.findFirst({
        where: { sourceKey: params.sourceKey }
      }).catch(() => null);
    }
    return null;
  }

  async function createProfitShareFeeEventIfNew(params: {
    dbClient?: any;
    botVaultId: string;
    sourceKey: string;
    profitBaseUsd: number;
    feeAmountUsd: number;
    treasuryRecipient: string | null;
    feeRatePct: number;
    txHash: string | null;
    sourceAction: "claim_profit" | "close_vault" | "recover_closed_funds";
    grossAmountUsd: number;
    netReturnedUsd: number;
    excludedPrincipalUsd: number;
  }): Promise<"skipped" | "created" | "existing"> {
    const feeDb = params.dbClient ?? db;
    if (params.feeAmountUsd <= 0) return "skipped";
    const sourceKey = toNullableString(params.sourceKey);
    if (!sourceKey) {
      throw new Error(`bot_vault_v3_fee_event_source_key_missing:${params.sourceAction}:${params.botVaultId}`);
    }

    const existingBeforeCreate = await findProfitShareFeeEventBySourceKey({
      dbClient: feeDb,
      sourceKey
    });
    if (existingBeforeCreate) return "existing";

    if (!feeDb?.feeEvent?.create) {
      throw new Error(`bot_vault_v3_fee_event_persistence_unavailable:${params.sourceAction}:${params.botVaultId}`);
    }

    try {
      await feeDb.feeEvent.create({
        data: {
          botVaultId: params.botVaultId,
          eventType: "PROFIT_SHARE",
          profitBase: roundUsd(params.profitBaseUsd, 6),
          feeAmount: roundUsd(params.feeAmountUsd, 6),
          sourceKey,
          metadata: {
            treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL,
            contractVersion: ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
            treasuryRecipient: params.treasuryRecipient,
            feeRatePct: params.feeRatePct,
            txHash: params.txHash ?? null,
            sourceAction: params.sourceAction,
            grossAmountUsd: roundUsd(params.grossAmountUsd, 6),
            netReturnedUsd: roundUsd(params.netReturnedUsd, 6),
            excludedPrincipalUsd: roundUsd(params.excludedPrincipalUsd, 6)
          }
        }
      });
      return "created";
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existingAfterUnique = await findProfitShareFeeEventBySourceKey({
        dbClient: feeDb,
        sourceKey
      });
      if (existingAfterUnique) return "existing";
      throw new Error(`bot_vault_v3_fee_event_duplicate_without_record:${params.sourceAction}:${params.botVaultId}:${sourceKey}`);
    }
  }

  async function persistBotVaultV3ControllerSettlementState(params: {
    botVaultId: string;
    metadataKey: "closeSettlement" | "recoverySettlement";
    settlement: Omit<BotVaultV3ControllerSettlementState, "stage" | "preparedAt" | "confirmedAt" | "appliedAt" | "updatedAt">;
    stage: BotVaultV3ControllerSettlementState["stage"];
  }): Promise<BotVaultV3ControllerSettlementState> {
    const botVault = await findBotVaultRowForUpdate(db, params.botVaultId, {
      id: true,
      executionMetadata: true
    });
    if (!botVault?.id) {
      throw new Error(`bot_vault_v3_settlement_persist_target_missing:${params.settlement.sourceAction}:${params.stage}:${params.botVaultId}`);
    }
    const currentMetadata = toRecord(botVault.executionMetadata);
    const currentSettlement = readBotVaultV3ControllerSettlementState({
      executionMetadata: currentMetadata,
      metadataKey: params.metadataKey,
      sourceAction: params.settlement.sourceAction
    }) ?? {
      sourceAction: params.settlement.sourceAction,
      sourceKey: params.settlement.sourceKey,
      feeEventSourceKey: params.settlement.feeEventSourceKey,
      closeTxHash: null,
      feeRatePct: 0,
      treasuryRecipient: null,
      principalReturnedUsd: 0,
      grossAmountUsd: 0,
      feeAmountUsd: 0,
      netReturnedUsd: 0,
      profitComponentUsd: 0,
      excludedPrincipalUsd: 0,
      stage: "prepared" as const,
      preparedAt: null,
      confirmedAt: null,
      appliedAt: null,
      updatedAt: null,
      lastError: null,
      postProcessing: buildBotVaultV3SettlementPostProcessingState({
        state: "not_started",
        pendingSteps: [],
        lastError: null,
        updatedAt: null
      })
    };
    const nowIso = new Date().toISOString();
    const nextSettlement: BotVaultV3ControllerSettlementState = {
      sourceAction: params.settlement.sourceAction,
      sourceKey: params.settlement.sourceKey,
      feeEventSourceKey: params.settlement.feeEventSourceKey,
      closeTxHash: params.settlement.closeTxHash ?? currentSettlement.closeTxHash,
      feeRatePct: roundUsd(params.settlement.feeRatePct, 6),
      treasuryRecipient: params.settlement.treasuryRecipient,
      principalReturnedUsd: roundUsd(params.settlement.principalReturnedUsd, 6),
      grossAmountUsd: roundUsd(params.settlement.grossAmountUsd, 6),
      feeAmountUsd: roundUsd(params.settlement.feeAmountUsd, 6),
      netReturnedUsd: roundUsd(
        Math.max(0, roundUsd(params.settlement.grossAmountUsd, 6) - roundUsd(params.settlement.feeAmountUsd, 6)),
        6
      ),
      profitComponentUsd: roundUsd(
        Math.max(0, roundUsd(params.settlement.grossAmountUsd, 6) - roundUsd(params.settlement.principalReturnedUsd, 6)),
        6
      ),
      excludedPrincipalUsd: roundUsd(params.settlement.excludedPrincipalUsd, 6),
      stage: params.stage,
      preparedAt: currentSettlement.preparedAt ?? nowIso,
      confirmedAt: params.stage === "confirmed"
        ? (currentSettlement.confirmedAt ?? nowIso)
        : currentSettlement.confirmedAt,
      appliedAt: params.stage === "applied"
        ? (currentSettlement.appliedAt ?? nowIso)
        : currentSettlement.appliedAt,
      updatedAt: nowIso,
      lastError: toNullableString(params.settlement.lastError) ?? currentSettlement.lastError ?? null,
      postProcessing: buildBotVaultV3SettlementPostProcessingState({
        state: params.settlement.postProcessing?.state ?? currentSettlement.postProcessing.state,
        pendingSteps: params.settlement.postProcessing?.pendingSteps ?? currentSettlement.postProcessing.pendingSteps,
        lastError: params.settlement.postProcessing?.lastError ?? params.settlement.lastError ?? currentSettlement.postProcessing.lastError,
        updatedAt: nowIso
      })
    };

    try {
      await db.botVault.update({
        where: { id: params.botVaultId },
        data: {
          executionMetadata: {
            ...currentMetadata,
            [params.metadataKey]: nextSettlement
          }
        }
      });
    } catch (error) {
      throw new Error(
        `bot_vault_v3_settlement_persist_failed:${params.settlement.sourceAction}:${params.stage}:${params.botVaultId}:${String(error)}`
      );
    }

    return nextSettlement;
  }

  async function persistBotVaultV3ClaimSettlementState(params: {
    botVaultId: string;
    settlement: Omit<BotVaultV3ClaimSettlementState, "stage" | "preparedAt" | "confirmedAt" | "appliedAt" | "updatedAt" | "lastError" | "netReturnedUsd">;
    stage: BotVaultV3ClaimSettlementState["stage"];
    lastError?: string | null;
  }): Promise<BotVaultV3ClaimSettlementState> {
    const botVault = await findBotVaultRowForUpdate(db, params.botVaultId, {
      id: true,
      executionMetadata: true
    });
    if (!botVault?.id) {
      throw new Error(`bot_vault_v3_settlement_persist_target_missing:claim_profit:${params.stage}:${params.botVaultId}`);
    }
    const currentMetadata = toRecord(botVault.executionMetadata);
    const currentSettlement = readBotVaultV3ClaimSettlementState(currentMetadata) ?? {
      sourceAction: "claim_profit" as const,
      sourceKey: params.settlement.sourceKey,
      feeEventSourceKey: params.settlement.feeEventSourceKey,
      claimTxHash: null,
      feeRatePct: 0,
      treasuryRecipient: null,
      grossAmountUsd: 0,
      feeAmountUsd: 0,
      netReturnedUsd: 0,
      excludedPrincipalUsd: 0,
      stage: "prepared" as const,
      preparedAt: null,
      confirmedAt: null,
      appliedAt: null,
      updatedAt: null,
      lastError: null,
      postProcessing: buildBotVaultV3SettlementPostProcessingState({
        state: "not_started",
        pendingSteps: [],
        lastError: null,
        updatedAt: null
      })
    };
    const nowIso = new Date().toISOString();
    const nextSettlement: BotVaultV3ClaimSettlementState = {
      sourceAction: "claim_profit",
      sourceKey: params.settlement.sourceKey,
      feeEventSourceKey: params.settlement.feeEventSourceKey,
      claimTxHash: params.settlement.claimTxHash ?? currentSettlement.claimTxHash,
      feeRatePct: roundUsd(params.settlement.feeRatePct, 6),
      treasuryRecipient: params.settlement.treasuryRecipient,
      grossAmountUsd: roundUsd(params.settlement.grossAmountUsd, 6),
      feeAmountUsd: roundUsd(params.settlement.feeAmountUsd, 6),
      netReturnedUsd: roundUsd(
        Math.max(0, roundUsd(params.settlement.grossAmountUsd, 6) - roundUsd(params.settlement.feeAmountUsd, 6)),
        6
      ),
      excludedPrincipalUsd: roundUsd(params.settlement.excludedPrincipalUsd, 6),
      stage: params.stage,
      preparedAt: currentSettlement.preparedAt ?? nowIso,
      confirmedAt: params.stage === "confirmed"
        ? (currentSettlement.confirmedAt ?? nowIso)
        : currentSettlement.confirmedAt,
      appliedAt: params.stage === "applied"
        ? (currentSettlement.appliedAt ?? nowIso)
        : currentSettlement.appliedAt,
      updatedAt: nowIso,
      lastError: toNullableString(params.lastError) ?? toNullableString(params.settlement.lastError) ?? null,
      postProcessing: buildBotVaultV3SettlementPostProcessingState({
        state: params.settlement.postProcessing?.state ?? currentSettlement.postProcessing.state,
        pendingSteps: params.settlement.postProcessing?.pendingSteps ?? currentSettlement.postProcessing.pendingSteps,
        lastError: params.settlement.postProcessing?.lastError ?? params.lastError ?? params.settlement.lastError ?? currentSettlement.postProcessing.lastError,
        updatedAt: nowIso
      })
    };

    try {
      await db.botVault.update({
        where: { id: params.botVaultId },
        data: {
          executionMetadata: {
            ...currentMetadata,
            claimSettlement: nextSettlement
          }
        }
      });
    } catch (error) {
      throw new Error(
        `bot_vault_v3_settlement_persist_failed:claim_profit:${params.stage}:${params.botVaultId}:${String(error)}`
      );
    }

    return nextSettlement;
  }

  async function applyBotVaultV3ClaimSettlementIfNeeded(params: {
    botVaultId: string;
    settlement: BotVaultV3ClaimSettlementState;
    snapshot?: BotVaultV3OnchainSnapshot | null;
  }): Promise<BotVaultV3ClaimSettlementState | null> {
    return withDbTransaction(db, async (tx) => {
      const botVault = await findBotVaultRowForUpdate(tx, params.botVaultId, {
        id: true,
        fundingStatus: true,
        hypercoreFundingStatus: true,
        executionStatus: true,
        status: true,
        executionMetadata: true
      });
      if (!botVault?.id) return false;

      const currentMetadata = toRecord(botVault.executionMetadata);
      const currentSettlement = readBotVaultV3ClaimSettlementState(currentMetadata);
      const currentPostProcessing = currentSettlement?.postProcessing ?? null;
      const needsApply =
        currentSettlement?.sourceKey !== params.settlement.sourceKey
        || currentSettlement.stage !== "applied"
        || currentPostProcessing?.pendingSteps.includes("apply") === true;
      if (!needsApply) {
        return currentSettlement ?? params.settlement;
      }
      if (!params.snapshot) {
        throw new Error("claim_profit_post_processing_snapshot_missing");
      }

      const settledAt = new Date();
      const settledAtIso = settledAt.toISOString();
      const nextSettlement: BotVaultV3ClaimSettlementState = {
        ...params.settlement,
        netReturnedUsd: roundUsd(Math.max(0, params.settlement.grossAmountUsd - params.settlement.feeAmountUsd), 6),
        stage: "applied",
        preparedAt: currentSettlement?.preparedAt ?? params.settlement.preparedAt ?? settledAtIso,
        confirmedAt: currentSettlement?.confirmedAt ?? params.settlement.confirmedAt ?? settledAtIso,
        appliedAt: currentSettlement?.appliedAt ?? settledAtIso,
        updatedAt: settledAtIso,
        lastError: null,
        postProcessing: buildBotVaultV3SettlementPostProcessingState({
          state: params.settlement.feeAmountUsd > 0 ? "pending" : "complete",
          pendingSteps: params.settlement.feeAmountUsd > 0 ? ["fee_event"] : [],
          lastError: null,
          updatedAt: settledAtIso
        })
      };
      const lifecyclePatch = buildBotVaultV3FundingLifecycleTransitionPatch({
        row: botVault,
        targetStage: "settled",
        source: "claim_profit_post_processing",
        reason: "claim_profit_applied",
        detail: nextSettlement.claimTxHash,
        occurredAt: settledAt
      });
      const lifecycleMetadata = toRecord(lifecyclePatch.executionMetadata);

      await tx.botVault.update({
        where: { id: params.botVaultId },
        data: {
          ...buildBotVaultV3ResyncUpdate(params.snapshot, settledAt),
          ...lifecyclePatch,
          withdrawnUsd: { increment: roundUsd(nextSettlement.netReturnedUsd, 6) },
          claimedProfitUsd: { increment: roundUsd(nextSettlement.grossAmountUsd, 6) },
          executionLastError: null,
          executionLastErrorAt: null,
          executionMetadata: {
            ...currentMetadata,
            claimSettlement: nextSettlement,
            fundingLifecycle: lifecycleMetadata.fundingLifecycle
          }
        }
      });
      return nextSettlement;
    });
  }

  async function applyBotVaultV3ControllerSettlementIfNeeded(params: {
    botVaultId: string;
    metadataKey: "closeSettlement" | "recoverySettlement";
    settlement: BotVaultV3ControllerSettlementState;
    snapshot?: BotVaultV3OnchainSnapshot | null;
  }): Promise<BotVaultV3ControllerSettlementState | null> {
    return withDbTransaction(db, async (tx) => {
      const botVault = await findBotVaultRowForUpdate(tx, params.botVaultId, {
        id: true,
        fundingStatus: true,
        hypercoreFundingStatus: true,
        executionStatus: true,
        status: true,
        executionMetadata: true
      });
      if (!botVault?.id) return false;

      const currentMetadata = toRecord(botVault.executionMetadata);
      const currentSettlement = readBotVaultV3ControllerSettlementState({
        executionMetadata: currentMetadata,
        metadataKey: params.metadataKey,
        sourceAction: params.settlement.sourceAction
      });
      const currentPostProcessing = currentSettlement?.postProcessing ?? null;
      const needsApply =
        currentSettlement?.sourceKey !== params.settlement.sourceKey
        || currentSettlement.stage !== "applied"
        || currentPostProcessing?.pendingSteps.includes("apply") === true;
      if (!needsApply) {
        return currentSettlement ?? params.settlement;
      }
      if (!params.snapshot) {
        throw new Error(`bot_vault_v3_${params.settlement.sourceAction}_post_processing_snapshot_missing`);
      }

      const settledAt = new Date();
      const settledAtIso = settledAt.toISOString();
      const nextSettlement: BotVaultV3ControllerSettlementState = {
        ...params.settlement,
        netReturnedUsd: roundUsd(Math.max(0, params.settlement.grossAmountUsd - params.settlement.feeAmountUsd), 6),
        profitComponentUsd: roundUsd(Math.max(0, params.settlement.grossAmountUsd - params.settlement.principalReturnedUsd), 6),
        stage: "applied",
        preparedAt: currentSettlement?.preparedAt ?? params.settlement.preparedAt ?? settledAtIso,
        confirmedAt: currentSettlement?.confirmedAt ?? params.settlement.confirmedAt,
        appliedAt: currentSettlement?.appliedAt ?? settledAtIso,
        updatedAt: settledAtIso,
        lastError: null,
        postProcessing: buildBotVaultV3SettlementPostProcessingState({
          state: params.settlement.feeAmountUsd > 0 ? "pending" : "complete",
          pendingSteps: params.settlement.feeAmountUsd > 0 ? ["fee_event"] : [],
          lastError: null,
          updatedAt: settledAtIso
        })
      };

      const nextMetadata = {
        ...currentMetadata,
        [params.metadataKey]: nextSettlement
      };
      const lifecyclePatch = buildBotVaultV3FundingLifecycleTransitionPatch({
        row: botVault,
        targetStage: "settled",
        source: params.settlement.sourceAction,
        reason: "controller_settlement_applied",
        detail: params.settlement.closeTxHash,
        occurredAt: settledAt
      });
      const lifecycleMetadata = toRecord(lifecyclePatch.executionMetadata);

      await tx.botVault.update({
        where: { id: params.botVaultId },
        data: {
          ...buildBotVaultV3ResyncUpdate(params.snapshot, settledAt),
          withdrawnUsd: { increment: roundUsd(params.settlement.netReturnedUsd, 6) },
          claimedProfitUsd: { increment: roundUsd(params.settlement.profitComponentUsd, 6) },
          ...lifecyclePatch,
          executionLastError: null,
          executionLastErrorAt: null,
          endedAt: settledAt,
          closedAt: settledAt,
          executionMetadata: {
            ...nextMetadata,
            fundingLifecycle: lifecycleMetadata.fundingLifecycle
          }
        }
      });
      return nextSettlement;
    });
  }

  async function markBotVaultV3ClaimSettlementPostProcessingPending(params: {
    botVaultId: string;
    settlement: BotVaultV3ClaimSettlementState;
    pendingSteps?: BotVaultV3SettlementPostProcessingStep[];
    lastError: string;
  }): Promise<BotVaultV3ClaimSettlementState> {
    return persistBotVaultV3ClaimSettlementState({
      botVaultId: params.botVaultId,
      settlement: {
        ...params.settlement,
        lastError: params.lastError,
        postProcessing: buildBotVaultV3SettlementPostProcessingState({
          state: "pending",
          pendingSteps: params.pendingSteps ?? params.settlement.postProcessing.pendingSteps,
          lastError: params.lastError
        })
      },
      stage: params.settlement.stage,
      lastError: params.lastError
    });
  }

  async function markBotVaultV3ControllerSettlementPostProcessingPending(params: {
    botVaultId: string;
    metadataKey: "closeSettlement" | "recoverySettlement";
    settlement: BotVaultV3ControllerSettlementState;
    pendingSteps?: BotVaultV3SettlementPostProcessingStep[];
    lastError: string;
  }): Promise<BotVaultV3ControllerSettlementState> {
    return persistBotVaultV3ControllerSettlementState({
      botVaultId: params.botVaultId,
      metadataKey: params.metadataKey,
      settlement: {
        ...params.settlement,
        lastError: params.lastError,
        postProcessing: buildBotVaultV3SettlementPostProcessingState({
          state: "pending",
          pendingSteps: params.pendingSteps ?? params.settlement.postProcessing.pendingSteps,
          lastError: params.lastError
        })
      },
      stage: params.settlement.stage
    });
  }

  async function completeBotVaultV3ClaimSettlementFeeEventIfNeeded(params: {
    botVaultId: string;
    settlement: BotVaultV3ClaimSettlementState;
  }): Promise<BotVaultV3ClaimSettlementState | null> {
    return withDbTransaction(db, async (tx) => {
      const botVault = await findBotVaultRowForUpdate(tx, params.botVaultId, {
        id: true,
        executionMetadata: true
      });
      if (!botVault?.id) return false;

      const currentMetadata = toRecord(botVault.executionMetadata);
      const storedSettlement = readBotVaultV3ClaimSettlementState(currentMetadata);
      const currentSettlement = storedSettlement?.sourceKey === params.settlement.sourceKey
        ? storedSettlement
        : params.settlement;
      if (!currentSettlement.postProcessing.pendingSteps.includes("fee_event")) return currentSettlement;

      await createProfitShareFeeEventIfNew({
        dbClient: tx,
        botVaultId: params.botVaultId,
        sourceKey: currentSettlement.feeEventSourceKey,
        profitBaseUsd: roundUsd(currentSettlement.grossAmountUsd, 6),
        feeAmountUsd: roundUsd(currentSettlement.feeAmountUsd, 6),
        treasuryRecipient: currentSettlement.treasuryRecipient,
        feeRatePct: currentSettlement.feeRatePct,
        txHash: currentSettlement.claimTxHash,
        sourceAction: "claim_profit",
        grossAmountUsd: roundUsd(currentSettlement.grossAmountUsd, 6),
        netReturnedUsd: roundUsd(currentSettlement.netReturnedUsd, 6),
        excludedPrincipalUsd: roundUsd(currentSettlement.excludedPrincipalUsd, 6)
      });

      const nowIso = new Date().toISOString();
      const nextPostProcessing = clearBotVaultV3SettlementPendingStep(currentSettlement.postProcessing, "fee_event");
      const nextSettlement: BotVaultV3ClaimSettlementState = {
        ...currentSettlement,
        updatedAt: nowIso,
        lastError: nextPostProcessing.state === "complete" ? null : currentSettlement.lastError,
        postProcessing: {
          ...nextPostProcessing,
          updatedAt: nowIso
        }
      };

      await tx.botVault.update({
        where: { id: params.botVaultId },
        data: {
          executionMetadata: {
            ...currentMetadata,
            claimSettlement: nextSettlement
          }
        }
      });
      return nextSettlement;
    });
  }

  async function completeBotVaultV3ControllerSettlementFeeEventIfNeeded(params: {
    botVaultId: string;
    metadataKey: "closeSettlement" | "recoverySettlement";
    settlement: BotVaultV3ControllerSettlementState;
  }): Promise<BotVaultV3ControllerSettlementState | null> {
    return withDbTransaction(db, async (tx) => {
      const botVault = await findBotVaultRowForUpdate(tx, params.botVaultId, {
        id: true,
        executionMetadata: true
      });
      if (!botVault?.id) return false;

      const currentMetadata = toRecord(botVault.executionMetadata);
      const storedSettlement = readBotVaultV3ControllerSettlementState({
        executionMetadata: currentMetadata,
        metadataKey: params.metadataKey,
        sourceAction: params.settlement.sourceAction
      });
      const currentSettlement = storedSettlement?.sourceKey === params.settlement.sourceKey
        ? storedSettlement
        : params.settlement;
      if (!currentSettlement.postProcessing.pendingSteps.includes("fee_event")) return currentSettlement;

      await createProfitShareFeeEventIfNew({
        dbClient: tx,
        botVaultId: params.botVaultId,
        sourceKey: currentSettlement.feeEventSourceKey,
        profitBaseUsd: currentSettlement.profitComponentUsd,
        feeAmountUsd: currentSettlement.feeAmountUsd,
        treasuryRecipient: currentSettlement.treasuryRecipient,
        feeRatePct: currentSettlement.feeRatePct,
        txHash: currentSettlement.closeTxHash,
        sourceAction: currentSettlement.sourceAction,
        grossAmountUsd: currentSettlement.grossAmountUsd,
        netReturnedUsd: currentSettlement.netReturnedUsd,
        excludedPrincipalUsd: currentSettlement.excludedPrincipalUsd
      });

      const nowIso = new Date().toISOString();
      const nextPostProcessing = clearBotVaultV3SettlementPendingStep(currentSettlement.postProcessing, "fee_event");
      const nextSettlement: BotVaultV3ControllerSettlementState = {
        ...currentSettlement,
        updatedAt: nowIso,
        lastError: nextPostProcessing.state === "complete" ? null : currentSettlement.lastError,
        postProcessing: {
          ...nextPostProcessing,
          updatedAt: nowIso
        }
      };

      await tx.botVault.update({
        where: { id: params.botVaultId },
        data: {
          executionMetadata: {
            ...currentMetadata,
            [params.metadataKey]: nextSettlement
          }
        }
      });
      return nextSettlement;
    });
  }

  async function readBotVaultV3ClaimSettlementById(botVaultId: string): Promise<BotVaultV3ClaimSettlementState | null> {
    const botVault = await db.botVault.findFirst({
      where: { id: botVaultId },
      select: { executionMetadata: true }
    });
    return readBotVaultV3ClaimSettlementState(botVault?.executionMetadata);
  }

  async function readBotVaultV3ControllerSettlementById(params: {
    botVaultId: string;
    metadataKey: "closeSettlement" | "recoverySettlement";
    sourceAction: "close_vault" | "recover_closed_funds";
  }): Promise<BotVaultV3ControllerSettlementState | null> {
    const botVault = await db.botVault.findFirst({
      where: { id: params.botVaultId },
      select: { executionMetadata: true }
    });
    return readBotVaultV3ControllerSettlementState({
      executionMetadata: botVault?.executionMetadata,
      metadataKey: params.metadataKey,
      sourceAction: params.sourceAction
    });
  }

  async function resumeBotVaultV3ClaimSettlementPostProcessing(params: {
    botVaultId: string;
    settlement: BotVaultV3ClaimSettlementState;
    snapshot?: BotVaultV3OnchainSnapshot | null;
  }): Promise<BotVaultV3ClaimSettlementState | null> {
    let currentSettlement = params.settlement;
    if (currentSettlement.stage !== "applied" || currentSettlement.postProcessing.pendingSteps.includes("apply")) {
      if (!params.snapshot) {
        throw new Error("claim_profit_post_processing_snapshot_missing");
      }
      currentSettlement = await applyBotVaultV3ClaimSettlementIfNeeded({
        botVaultId: params.botVaultId,
        settlement: currentSettlement,
        snapshot: params.snapshot
      }) ?? currentSettlement;
    }
    if (currentSettlement.postProcessing.pendingSteps.includes("fee_event")) {
      currentSettlement = await completeBotVaultV3ClaimSettlementFeeEventIfNeeded({
        botVaultId: params.botVaultId,
        settlement: currentSettlement
      }) ?? currentSettlement;
    }
    return currentSettlement;
  }

  async function resumeBotVaultV3ControllerSettlementPostProcessing(params: {
    botVaultId: string;
    metadataKey: "closeSettlement" | "recoverySettlement";
    settlement: BotVaultV3ControllerSettlementState;
    snapshot?: BotVaultV3OnchainSnapshot | null;
  }): Promise<BotVaultV3ControllerSettlementState | null> {
    let currentSettlement = params.settlement;
    if (currentSettlement.stage !== "applied" || currentSettlement.postProcessing.pendingSteps.includes("apply")) {
      if (!params.snapshot) {
        throw new Error(`bot_vault_v3_${currentSettlement.sourceAction}_post_processing_snapshot_missing`);
      }
      currentSettlement = await applyBotVaultV3ControllerSettlementIfNeeded({
        botVaultId: params.botVaultId,
        metadataKey: params.metadataKey,
        settlement: currentSettlement,
        snapshot: params.snapshot
      }) ?? currentSettlement;
    }
    if (currentSettlement.postProcessing.pendingSteps.includes("fee_event")) {
      currentSettlement = await completeBotVaultV3ControllerSettlementFeeEventIfNeeded({
        botVaultId: params.botVaultId,
        metadataKey: params.metadataKey,
        settlement: currentSettlement
      }) ?? currentSettlement;
    }
    return currentSettlement;
  }

  async function loadExecutionCloseoutContext(params: {
    userId: string;
    botVaultId: string;
  }): Promise<{
    id: string;
    userId: string;
    symbol: string | null;
    agentWallet: string | null;
    agentWalletVersion: number;
    agentSecretRef: string | null;
    exchangeAccount: {
      id: string;
      exchange: string;
      apiKeyEnc: string;
      apiSecretEnc: string;
      passphraseEnc: string | null;
    } | null;
    executionVaultAddress: string | null;
  } | null> {
    const row = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: {
        id: true,
        userId: true,
        vaultAddress: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        gridInstance: {
          select: {
            template: {
              select: {
                symbol: true
              }
            },
            exchangeAccount: {
              select: {
                id: true,
                exchange: true,
                apiKeyEnc: true,
                apiSecretEnc: true,
                passphraseEnc: true
              }
            }
          }
        },
        bot: {
          select: {
            symbol: true,
            exchangeAccount: {
              select: {
                id: true,
                exchange: true,
                apiKeyEnc: true,
                apiSecretEnc: true,
                passphraseEnc: true
              }
            }
          }
        }
      }
    });
    if (!row) return null;
    const exchangeAccount = row.gridInstance?.exchangeAccount ?? row.bot?.exchangeAccount ?? null;
    return {
      id: String(row.id),
      userId: String(row.userId),
      symbol: toNullableString(row.gridInstance?.template?.symbol) ?? toNullableString(row.bot?.symbol),
      agentWallet: toNullableString(row.agentWallet),
      agentWalletVersion: Number.isFinite(Number(row.agentWalletVersion))
        ? Math.max(1, Math.trunc(Number(row.agentWalletVersion)))
        : 1,
      agentSecretRef: toNullableString(row.agentSecretRef),
      exchangeAccount: exchangeAccount
        ? {
            id: String(exchangeAccount.id),
            exchange: String(exchangeAccount.exchange ?? ""),
            apiKeyEnc: String(exchangeAccount.apiKeyEnc),
            apiSecretEnc: String(exchangeAccount.apiSecretEnc),
            passphraseEnc: exchangeAccount.passphraseEnc ? String(exchangeAccount.passphraseEnc) : null
          }
        : null,
      executionVaultAddress: toNullableString(row.vaultAddress)
    };
  }

  async function resolveExecutionCloseoutAccount(
    context: NonNullable<Awaited<ReturnType<typeof loadExecutionCloseoutContext>>>
  ): Promise<TradingAccount> {
    if (!context.exchangeAccount) {
      throw new Error("bot_vault_v3_exchange_account_missing");
    }
    if (!context.executionVaultAddress || !isAddress(context.executionVaultAddress)) {
      throw new Error("bot_vault_v3_execution_vault_address_missing");
    }

    const decryptedApiKey = decryptSecretValue(context.exchangeAccount.apiKeyEnc).trim();
    const decryptedApiSecret = decryptSecretValue(context.exchangeAccount.apiSecretEnc).trim();
    const decryptedPrivateKey = normalizePrivateKey(decryptedApiSecret);
    const decryptedSignerAddress = deriveAddressFromPrivateKey(decryptedApiSecret);
    const decryptedApiKeyAddress = isAddress(decryptedApiKey) ? decryptedApiKey as `0x${string}` : null;
    const expectedAgentWallet = toNullableString(context.agentWallet);

    let resolvedApiKey = decryptedApiKeyAddress ?? decryptedSignerAddress;
    let resolvedApiSecret = decryptedPrivateKey;

    if (expectedAgentWallet && isAddress(expectedAgentWallet)) {
      const agentCredentials = await agentSecretProvider.getAgentCredentials({
        userId: context.userId,
        botVaultId: context.id,
        agentWalletAddress: expectedAgentWallet,
        agentWalletVersion: context.agentWalletVersion,
        agentSecretRef: context.agentSecretRef
      }).catch(() => null);
      const agentPrivateKey = normalizePrivateKey(agentCredentials?.privateKey);
      const agentSignerAddress = agentCredentials?.address && isAddress(agentCredentials.address)
        ? agentCredentials.address as `0x${string}`
        : deriveAddressFromPrivateKey(agentCredentials?.privateKey);

      if (agentPrivateKey && agentSignerAddress && sameAddress(agentSignerAddress, expectedAgentWallet)) {
        resolvedApiKey = expectedAgentWallet as `0x${string}`;
        resolvedApiSecret = agentPrivateKey;
      } else if (decryptedPrivateKey && decryptedSignerAddress && sameAddress(decryptedSignerAddress, expectedAgentWallet)) {
        resolvedApiKey = expectedAgentWallet as `0x${string}`;
        resolvedApiSecret = decryptedPrivateKey;
      } else {
        throw new Error(`bot_vault_v3_agent_credentials_missing:${String(expectedAgentWallet).toLowerCase()}`);
      }
    }

    if (!resolvedApiKey || !isAddress(resolvedApiKey)) {
      throw new Error("bot_vault_v3_execution_api_key_invalid");
    }
    if (!resolvedApiSecret) {
      throw new Error("bot_vault_v3_execution_api_secret_invalid");
    }

    return {
      id: context.exchangeAccount.id,
      userId: context.userId,
      exchange: context.exchangeAccount.exchange,
      label: `${context.exchangeAccount.exchange}:${context.id}`,
      apiKey: resolvedApiKey,
      apiSecret: resolvedApiSecret,
      passphrase: context.executionVaultAddress,
      botVaultAddress: context.executionVaultAddress,
      marketDataExchangeAccountId: null
    };
  }

  function deriveStoredReduceMarginState(executionMetadata: unknown): Record<string, unknown> {
    return toRecord(toRecord(executionMetadata).reduceMarginFinalization);
  }

  async function readBotVaultV3ExecutionSnapshotLive(params: {
    userId: string;
    botVaultId: string;
  }): Promise<BotVaultV3ExecutionStateSnapshot> {
    const context = await loadExecutionCloseoutContext({
      userId: params.userId,
      botVaultId: params.botVaultId
    }).catch(() => null);
    if (!context) {
      return {
        state: "skipped",
        coreSpotUsd: null,
        perpAvailableMarginUsd: null,
        perpEquityUsd: null,
        totalVisibleUsd: null,
        detail: "execution_context_missing"
      };
    }

    let account: TradingAccount;
    try {
      account = await resolveExecutionCloseoutAccount(context);
    } catch (error) {
      return {
        state: "unavailable",
        coreSpotUsd: null,
        perpAvailableMarginUsd: null,
        perpEquityUsd: null,
        totalVisibleUsd: null,
        detail: String(error)
      };
    }

    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;
    try {
      const [coreSpotResult, perpStateResult] = await Promise.allSettled([
        readCoreUsdcSpotBalanceFromAdapter(adapterAny),
        readPerpAccountStateFromAdapter(adapter)
      ]);
      const coreSpotUsd = coreSpotResult.status === "fulfilled"
        ? roundUsd(Math.max(0, coreSpotResult.value), 6)
        : null;
      const perpAvailableMarginUsd = perpStateResult.status === "fulfilled"
        ? roundUsd(Math.max(0, perpStateResult.value.availableMarginUsd), 6)
        : null;
      const perpEquityUsd = perpStateResult.status === "fulfilled"
        ? roundUsd(Math.max(0, perpStateResult.value.equityUsd), 6)
        : null;
      const totalVisibleUsd = coreSpotUsd == null && perpEquityUsd == null
        ? null
        : roundUsd((coreSpotUsd ?? 0) + (perpEquityUsd ?? 0), 6);
      if (coreSpotUsd == null && perpEquityUsd == null) {
        return {
          state: "unavailable",
          coreSpotUsd: null,
          perpAvailableMarginUsd: null,
          perpEquityUsd: null,
          totalVisibleUsd: null,
          detail: coreSpotResult.status === "rejected"
            ? String(coreSpotResult.reason)
            : perpStateResult.status === "rejected"
              ? String(perpStateResult.reason)
              : "execution_state_unavailable"
        };
      }
      return {
        state: "ok",
        coreSpotUsd,
        perpAvailableMarginUsd,
        perpEquityUsd,
        totalVisibleUsd,
        detail: null
      };
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function escalateBotVaultV3FundingIntentTimeout(params: {
    row: any;
    fundingAction?: {
      actionKey?: unknown;
      status?: unknown;
    } | null;
    persist?: boolean;
    source: string;
    loggerContext?: Record<string, unknown>;
    now?: Date;
  }): Promise<{
    row: any;
    escalated: boolean;
    timeoutState: BotVaultV3FundingIntentTimeoutState | null;
  }> {
    const timeoutState = readBotVaultV3FundingIntentTimeoutState({
      row: params.row,
      fundingAction: params.fundingAction,
      now: params.now
    });
    if (!timeoutState) {
      return {
        row: params.row,
        escalated: false,
        timeoutState: null
      };
    }

    logger.warn("bot_vault_v3_funding_intent_timeout", {
      botVaultId: String(params.row?.id ?? ""),
      source: params.source,
      actionKey: timeoutState.actionKey,
      actionStatus: timeoutState.actionStatus,
      pendingMinutes: timeoutState.pendingMinutes,
      timeoutAt: timeoutState.timeoutAt,
      ...params.loggerContext
    });

    if (params.persist === false) {
      return {
        row: params.row,
        escalated: false,
        timeoutState
      };
    }

    const executionMetadata = toRecord(params.row?.executionMetadata);
    const fundingIntent = toRecord(executionMetadata.fundingIntent);
    const patch = buildBotVaultV3FundingLifecycleTransitionPatch({
      row: params.row,
      targetStage: "recovery_required",
      source: params.source,
      reason: timeoutState.reason,
      detail: timeoutState.detail,
      occurredAt: timeoutState.timedOutAt,
      metadataPatch: {
        fundingIntent: {
          ...fundingIntent,
          actionStatus: "timed_out",
          verificationState: "timed_out",
          timeoutAt: timeoutState.timeoutAt,
          timedOutAt: timeoutState.timedOutAt,
          timeoutReason: timeoutState.reason,
          lastError: timeoutState.error
        }
      }
    });

    const updatedRow = await db.botVault.update({
      where: { id: String(params.row.id) },
      data: patch
    });

    if (typeof db.onchainAction?.updateMany === "function") {
      await db.onchainAction.updateMany({
        where: {
          botVaultId: String(params.row.id),
          actionType: "fund_bot_vault_v3",
          status: {
            in: ["prepared", "submitted"]
          },
          ...(timeoutState.actionKey ? { actionKey: timeoutState.actionKey } : {})
        },
        data: {
          status: "failed"
        }
      }).catch((error) => {
        logger.warn("bot_vault_v3_funding_intent_timeout_action_mark_failed", {
          botVaultId: String(params.row.id),
          actionKey: timeoutState.actionKey,
          error: String(error)
        });
      });
    }

    return {
      row: updatedRow,
      escalated: true,
      timeoutState
    };
  }

  async function reconcileBotVaultV3ById(params: {
    userId: string;
    botVaultId: string;
    persist?: boolean;
  }): Promise<BotVaultV3Summary | null> {
    const currentRow = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId,
        vaultModel: "bot_vault_v3"
      }
    });
    if (!currentRow) return null;

    let row = currentRow;
    const executionMetadata = toRecord(row.executionMetadata);
    const closeSettlement = readBotVaultV3ControllerSettlementState({
      executionMetadata,
      metadataKey: "closeSettlement",
      sourceAction: "close_vault"
    });
    const recoverySettlement = readBotVaultV3ControllerSettlementState({
      executionMetadata,
      metadataKey: "recoverySettlement",
      sourceAction: "recover_closed_funds"
    });
    const claimSettlement = readBotVaultV3ClaimSettlementState(executionMetadata);
    const marginAddFinalization = toRecord(executionMetadata.marginAddFinalization);
    const reduceMarginFinalization = deriveStoredReduceMarginState(executionMetadata);
    const fundingAction = typeof db.onchainAction?.findFirst === "function"
      ? await db.onchainAction.findFirst({
        where: {
          botVaultId: String(row.id),
          actionType: "fund_bot_vault_v3",
          status: {
            in: ["prepared", "submitted", "confirmed", "failed"]
          }
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          actionKey: true,
          status: true
        }
      }).catch(() => null)
      : null;
    const issues: BotVaultV3ReconciliationIssue[] = [];
    let autoApplied = false;
    const checkedAt = new Date().toISOString();

    const vaultAddress = toNullableString(row.vaultAddress);
    const expectedControllerAddress = toNullableString(row.controllerAddress) ?? controllerAddress;
    const canReadOnchain = Boolean(vaultAddress && isAddress(vaultAddress));
    const walletConfig = resolveWalletReadConfig();
    let onchainPublicClient: any = null;
    if (canReadOnchain && expectedControllerAddress && isAddress(expectedControllerAddress)) {
      try {
        onchainPublicClient = buildControllerWalletClient(expectedControllerAddress).publicClient;
      } catch {
        onchainPublicClient = null;
      }
    }
    if (canReadOnchain && !onchainPublicClient) {
      onchainPublicClient = buildHyperEvmClient().publicClient;
    }
    let onchainSnapshot: BotVaultV3OnchainSnapshot | null = null;
    if (canReadOnchain && onchainPublicClient && walletConfig.usdcAddress) {
      onchainSnapshot = await readBotVaultV3OnchainSnapshot({
        publicClient: onchainPublicClient,
        vaultAddress: vaultAddress as `0x${string}`,
        usdcAddress: walletConfig.usdcAddress
      }).catch(() => null);
    }

    if (closeSettlement?.closeTxHash && hasPendingBotVaultV3SettlementPostProcessing(closeSettlement.postProcessing)) {
      const recoveredSettlement = await resumeBotVaultV3ControllerSettlementPostProcessing({
        botVaultId: String(row.id),
        metadataKey: "closeSettlement",
        settlement: closeSettlement,
        snapshot: onchainSnapshot
      }).catch((error) => {
        logger.warn("bot_vault_v3_close_settlement_resume_failed", {
          userId: params.userId,
          botVaultId: String(row.id),
          error: String(error)
        });
        return null;
      });
      const recovered = recoveredSettlement?.postProcessing.state === "complete";
      if (recovered) {
        autoApplied = true;
        row = await db.botVault.findFirst({
          where: { id: params.botVaultId, userId: params.userId, vaultModel: "bot_vault_v3" }
        }) ?? row;
      }
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "close_settlement_pending_apply",
        severity: recovered ? "warning" : "blocking",
        field: "claimedProfitUsd",
        sourceOfTruth: "local_settlement",
        detail: recovered
          ? "close settlement post-processing was resumed from stored state"
          : `close settlement post-processing is pending locally (${closeSettlement.postProcessing.pendingSteps.join(",") || "unknown"})`,
        autoRecoverable: true,
        autoRecovered: recovered
      }));
    }

    if (recoverySettlement?.closeTxHash && hasPendingBotVaultV3SettlementPostProcessing(recoverySettlement.postProcessing)) {
      const recoveredSettlement = await resumeBotVaultV3ControllerSettlementPostProcessing({
        botVaultId: String(row.id),
        metadataKey: "recoverySettlement",
        settlement: recoverySettlement,
        snapshot: onchainSnapshot
      }).catch((error) => {
        logger.warn("bot_vault_v3_recovery_settlement_resume_failed", {
          userId: params.userId,
          botVaultId: String(row.id),
          error: String(error)
        });
        return null;
      });
      const recovered = recoveredSettlement?.postProcessing.state === "complete";
      if (recovered) {
        autoApplied = true;
        row = await db.botVault.findFirst({
          where: { id: params.botVaultId, userId: params.userId, vaultModel: "bot_vault_v3" }
        }) ?? row;
      }
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "recovery_settlement_pending_apply",
        severity: recovered ? "warning" : "blocking",
        field: "claimedProfitUsd",
        sourceOfTruth: "local_settlement",
        detail: recovered
          ? "closed-funds recovery settlement post-processing was resumed from stored state"
          : `closed-funds recovery settlement post-processing is pending locally (${recoverySettlement.postProcessing.pendingSteps.join(",") || "unknown"})`,
        autoRecoverable: true,
        autoRecovered: recovered
      }));
    }

    if (claimSettlement?.claimTxHash && hasPendingBotVaultV3SettlementPostProcessing(claimSettlement.postProcessing)) {
      const recoveredSettlement = await resumeBotVaultV3ClaimSettlementPostProcessing({
        botVaultId: String(row.id),
        settlement: claimSettlement,
        snapshot: onchainSnapshot
      }).catch((error) => {
        logger.warn("bot_vault_v3_claim_settlement_resume_failed", {
          userId: params.userId,
          botVaultId: String(row.id),
          error: String(error)
        });
        return null;
      });
      const recovered = recoveredSettlement?.postProcessing.state === "complete";
      if (recovered) {
        autoApplied = true;
        row = await db.botVault.findFirst({
          where: { id: params.botVaultId, userId: params.userId, vaultModel: "bot_vault_v3" }
        }) ?? row;
      }
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "claim_profit_post_processing_pending_apply",
        severity: recovered ? "warning" : "blocking",
        field: "claimedProfitUsd",
        sourceOfTruth: "local_settlement",
        detail: recovered
          ? "claim-profit post-processing was resumed from stored state"
          : `claim-profit post-processing is pending locally (${claimSettlement.postProcessing.pendingSteps.join(",") || "unknown"})`,
        autoRecoverable: true,
        autoRecovered: recovered
      }));
    }

    const executionSnapshot = await readBotVaultV3ExecutionSnapshotLive({
      userId: params.userId,
      botVaultId: String(row.id)
    });

    const fundingIntentTimeout = await escalateBotVaultV3FundingIntentTimeout({
      row,
      fundingAction,
      persist: params.persist !== false,
      source: "reconcile_bot_vault_v3",
      loggerContext: {
        userId: params.userId
      }
    });
    if (fundingIntentTimeout.timeoutState) {
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "funding_intent_timeout",
        severity: "blocking",
        field: "fundingStatus",
        sourceOfTruth: "derived",
        detail: fundingIntentTimeout.timeoutState.detail,
        autoRecoverable: true,
        autoRecovered: fundingIntentTimeout.escalated,
        dbValue: fundingIntentTimeout.timeoutState.actionStatus,
        observedValue: fundingIntentTimeout.timeoutState.pendingMinutes,
        expectedValue: `resume_or_retry_before_${fundingIntentTimeout.timeoutState.timeoutAt}`
      }));
      row = fundingIntentTimeout.row;
    }

    const patchData: Record<string, unknown> = {};
    if (onchainSnapshot) {
      const safeOnchainPatch = buildBotVaultV3ResyncUpdate(onchainSnapshot);
      if (hasUsdDrift(row.principalAllocated, onchainSnapshot.principalAllocated)) {
        issues.push(buildBotVaultV3ReconciliationIssue({
          code: "db_onchain_principal_allocated_mismatch",
          severity: "warning",
          field: "principalAllocated",
          sourceOfTruth: "onchain",
          detail: "principalAllocated differed from onchain principalDeposited and was resynced",
          autoRecoverable: true,
          autoRecovered: params.persist !== false,
          dbValue: roundUsd(toNonNegativeNumber(row.principalAllocated), 6),
          observedValue: onchainSnapshot.principalAllocated,
          expectedValue: onchainSnapshot.principalAllocated
        }));
      }
      if (hasUsdDrift(row.principalReturned, onchainSnapshot.principalReturned)) {
        issues.push(buildBotVaultV3ReconciliationIssue({
          code: "db_onchain_principal_returned_mismatch",
          severity: "warning",
          field: "principalReturned",
          sourceOfTruth: "onchain",
          detail: "principalReturned differed from onchain principalReturned and was resynced",
          autoRecoverable: true,
          autoRecovered: params.persist !== false,
          dbValue: roundUsd(toNonNegativeNumber(row.principalReturned), 6),
          observedValue: onchainSnapshot.principalReturned,
          expectedValue: onchainSnapshot.principalReturned
        }));
      }
      if (hasUsdDrift(row.availableUsd, onchainSnapshot.availableUsd)) {
        issues.push(buildBotVaultV3ReconciliationIssue({
          code: "db_onchain_available_usd_mismatch",
          severity: "warning",
          field: "availableUsd",
          sourceOfTruth: "onchain",
          detail: "availableUsd differed from onchain EVM USDC balance and was resynced",
          autoRecoverable: true,
          autoRecovered: params.persist !== false,
          dbValue: roundUsd(toNonNegativeNumber(row.availableUsd), 6),
          observedValue: onchainSnapshot.availableUsd,
          expectedValue: onchainSnapshot.availableUsd
        }));
      }
      if (hasUsdDrift(row.feePaidTotal, onchainSnapshot.feePaidTotal)) {
        issues.push(buildBotVaultV3ReconciliationIssue({
          code: "db_onchain_fee_paid_total_mismatch",
          severity: "warning",
          field: "feePaidTotal",
          sourceOfTruth: "onchain",
          detail: "feePaidTotal differed from the onchain vault fee counter and was resynced",
          autoRecoverable: true,
          autoRecovered: params.persist !== false,
          dbValue: roundUsd(toNonNegativeNumber(row.feePaidTotal), 6),
          observedValue: onchainSnapshot.feePaidTotal,
          expectedValue: onchainSnapshot.feePaidTotal
        }));
      }
      Object.assign(patchData, safeOnchainPatch);
    }

    const currentLifecycle = readBotVaultV3FundingLifecycleState(row);
    const onchainStatus = String(onchainSnapshot?.status ?? row.status ?? "DEPLOYED");
    const economicallyClosed = onchainStatus === "CLOSED"
      || (onchainStatus === "CLOSE_ONLY" && toNonNegativeNumber(onchainSnapshot?.availableUsd) <= USD_VERIFICATION_EPSILON && toNonNegativeNumber(onchainSnapshot?.principalReturned) > USD_VERIFICATION_EPSILON);

    let desiredLifecycleStage: BotVaultV3FundingLifecycleStage = currentLifecycle.stage;
    if (economicallyClosed) {
      desiredLifecycleStage = "settled";
    } else {
      const fundingIntent = toRecord(toRecord(row.executionMetadata).fundingIntent);
      const executionTotalUsd = toNonNegativeNumber(executionSnapshot.totalVisibleUsd);
      const executionPerpUsd = toNonNegativeNumber(executionSnapshot.perpEquityUsd);
      const executionSpotUsd = toNonNegativeNumber(executionSnapshot.coreSpotUsd);
      const verificationState = String(marginAddFinalization.verificationState ?? "").trim().toLowerCase();
      const fundingIntentStatus = String(fundingIntent.actionStatus ?? "").trim().toLowerCase();
      const hasOnchainFundingEvidence =
        (onchainSnapshot?.principalAllocated ?? 0) > USD_VERIFICATION_EPSILON
        || (onchainSnapshot?.availableUsd ?? 0) > USD_VERIFICATION_EPSILON
        || executionTotalUsd > USD_VERIFICATION_EPSILON
        || onchainStatus === "FUNDED"
        || onchainStatus === "ACTIVE"
        || onchainStatus === "PAUSED"
        || onchainStatus === "CLOSE_ONLY";

      if (fundingIntentStatus === "timed_out" && !hasOnchainFundingEvidence) {
        desiredLifecycleStage = "recovery_required";
      } else if (fundingIntentStatus === "failed" && !hasOnchainFundingEvidence) {
        desiredLifecycleStage = "failed";
      } else if (
        verificationState === "funding_verified"
        || ["running", "paused", "close_only"].includes(String(row.executionStatus ?? "").trim().toLowerCase())
      ) {
        desiredLifecycleStage = "execution_ready";
      } else if (executionPerpUsd > USD_VERIFICATION_EPSILON) {
        desiredLifecycleStage = "perp_margin_transferred";
      } else if (verificationState === "transfer_observed" || verificationState === "transfer_submitted") {
        desiredLifecycleStage = "perp_margin_transferred";
      } else if (
        executionSpotUsd > USD_VERIFICATION_EPSILON
        || String(toRecord(row.executionMetadata).autoHypercoreFundingStatus ?? "").trim().toLowerCase() === "confirmed"
        || toNullableString(toRecord(row.executionMetadata).autoHypercoreFundingTxHash)
        || toNullableString(marginAddFinalization.depositTxHash)
      ) {
        desiredLifecycleStage = "hypercore_funded";
      } else if (hasOnchainFundingEvidence) {
        desiredLifecycleStage = "hyper_evm_confirmed";
      } else if (
        String(row.fundingStatus ?? "").trim().toLowerCase() === "hyper_evm_funding_requested"
        || fundingIntentStatus === "prepared"
        || fundingIntentStatus === "submitted"
        || fundingIntentStatus === "confirmed"
      ) {
        desiredLifecycleStage = "funding_requested";
      } else {
        desiredLifecycleStage = "deployed";
      }
    }

    const lifecyclePromoted =
      desiredLifecycleStage !== currentLifecycle.stage
      && (
        currentLifecycle.stage === "failed"
        || currentLifecycle.stage === "recovery_required"
        || compareBotVaultV3FundingLifecycleStage(currentLifecycle.stage, desiredLifecycleStage) < 0
      );
    if (lifecyclePromoted) {
      Object.assign(
        patchData,
        buildBotVaultV3FundingLifecycleTransitionPatch({
          row,
          targetStage: desiredLifecycleStage,
          source: "reconcile_bot_vault_v3",
          reason: "observed_state_advance",
          detail: onchainStatus
        })
      );
    }

    const desiredFundingStatus = String(patchData.fundingStatus ?? row.fundingStatus ?? "vault_empty");
    const desiredHypercoreFundingStatus = String(patchData.hypercoreFundingStatus ?? row.hypercoreFundingStatus ?? "not_funded");
    const desiredExecutionStatus = String(patchData.executionStatus ?? row.executionStatus ?? "created");

    if (currentLifecycle.stage !== desiredLifecycleStage) {
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "funding_lifecycle_stage_out_of_sync",
        severity: executionSnapshot.state === "ok" || desiredLifecycleStage === "settled" ? "warning" : "blocking",
        field: "fundingLifecycleStage",
        sourceOfTruth: "derived",
        detail: `funding lifecycle was promoted to ${desiredLifecycleStage}`,
        autoRecoverable: lifecyclePromoted,
        autoRecovered: lifecyclePromoted && params.persist !== false,
        dbValue: currentLifecycle.stage,
        observedValue: onchainStatus,
        expectedValue: desiredLifecycleStage
      }));
    }

    if (String(row.fundingStatus ?? "") !== desiredFundingStatus) {
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "funding_status_out_of_sync",
        severity: "warning",
        field: "fundingStatus",
        sourceOfTruth: "derived",
        detail: "fundingStatus was promoted from real state evidence",
        autoRecoverable: true,
        autoRecovered: params.persist !== false,
        dbValue: String(row.fundingStatus ?? ""),
        observedValue: onchainStatus,
        expectedValue: desiredFundingStatus
      }));
      patchData.fundingStatus = desiredFundingStatus;
    }

    if (String(row.hypercoreFundingStatus ?? "") !== desiredHypercoreFundingStatus) {
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "hypercore_funding_status_out_of_sync",
        severity: executionSnapshot.state === "ok" ? "warning" : "blocking",
        field: "hypercoreFundingStatus",
        sourceOfTruth: "derived",
        detail: executionSnapshot.state === "ok"
          ? "hypercoreFundingStatus was updated from observed Hyperliquid balances"
          : "hypercoreFundingStatus could not be verified from execution state",
        autoRecoverable: executionSnapshot.state === "ok",
        autoRecovered: executionSnapshot.state === "ok" && params.persist !== false,
        dbValue: String(row.hypercoreFundingStatus ?? ""),
        observedValue: executionSnapshot.totalVisibleUsd,
        expectedValue: desiredHypercoreFundingStatus
      }));
      if (executionSnapshot.state === "ok") {
        patchData.hypercoreFundingStatus = desiredHypercoreFundingStatus;
      }
    }

    if (String(row.executionStatus ?? "") !== desiredExecutionStatus && desiredExecutionStatus !== String(row.executionStatus ?? "")) {
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "execution_status_out_of_sync",
        severity: "warning",
        field: "executionStatus",
        sourceOfTruth: "derived",
        detail: "executionStatus was normalized from the strict funding lifecycle stage",
        autoRecoverable: true,
        autoRecovered: params.persist !== false,
        dbValue: String(row.executionStatus ?? ""),
        observedValue: String(row.executionStatus ?? ""),
        expectedValue: desiredExecutionStatus
      }));
      patchData.executionStatus = desiredExecutionStatus;
    }

    if (economicallyClosed && executionSnapshot.state === "ok" && toNonNegativeNumber(executionSnapshot.totalVisibleUsd) > USD_VERIFICATION_EPSILON) {
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "execution_balance_remaining_after_close",
        severity: "blocking",
        field: "executionBalances",
        sourceOfTruth: "execution",
        detail: "execution balances remain visible even though the vault is economically closed onchain",
        autoRecoverable: false,
        autoRecovered: false,
        observedValue: executionSnapshot.totalVisibleUsd,
        expectedValue: 0
      }));
    }

    if (
      !economicallyClosed
      && (String(row.hypercoreFundingStatus ?? "").trim().toLowerCase() === "pending"
        || String(row.hypercoreFundingStatus ?? "").trim().toLowerCase() === "funded"
        || Object.keys(marginAddFinalization).length > 0
        || (
          Object.keys(reduceMarginFinalization).length > 0
          && String(reduceMarginFinalization.stage ?? "").trim().toLowerCase() !== "observed"
        ))
      && executionSnapshot.state !== "ok"
    ) {
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: "execution_state_unavailable",
        severity: "blocking",
        field: "executionBalances",
        sourceOfTruth: "execution",
        detail: executionSnapshot.detail ?? "execution state could not be read for reconciliation",
        autoRecoverable: false,
        autoRecovered: false
      }));
    }

    if (Object.keys(reduceMarginFinalization).length > 0 && executionSnapshot.state === "ok") {
      const releasedAmountUsd = roundUsd(toNonNegativeNumber(reduceMarginFinalization.releasedAmountUsd), 6);
      const coreSpotBalanceBeforeUsd = roundUsd(toNonNegativeNumber(reduceMarginFinalization.coreSpotBalanceBeforeUsd), 6);
      const verification = buildReduceMarginVerification({
        releasedAmountUsd,
        coreSpotBalanceBeforeUsd,
        coreSpotBalanceAfterUsd: executionSnapshot.coreSpotUsd,
        perpAccountStateAfter:
          executionSnapshot.perpAvailableMarginUsd != null && executionSnapshot.perpEquityUsd != null
            ? {
              availableMarginUsd: executionSnapshot.perpAvailableMarginUsd,
              equityUsd: executionSnapshot.perpEquityUsd
            }
            : null,
        transferStatus: reduceMarginFinalization.transferResultStatus ?? reduceMarginFinalization.stage
      });
      if (!verification.transferObserved) {
        issues.push(buildBotVaultV3ReconciliationIssue({
          code: "reduce_margin_visibility_pending",
          severity: "warning",
          field: "executionBalances",
          sourceOfTruth: "execution",
          detail: "reduce-margin transfer was submitted but the expected HyperCore spot increase is not visible yet",
          autoRecoverable: false,
          autoRecovered: false,
          observedValue: executionSnapshot.coreSpotUsd,
          expectedValue: verification.expectedCoreSpotAfterUsd
        }));
      } else {
        if (!verification.finalPerpStateReadable) {
          issues.push(buildBotVaultV3ReconciliationIssue({
            code: "reduce_margin_final_state_unverified",
            severity: "warning",
            field: "executionBalances",
            sourceOfTruth: "execution",
            detail: "reduce-margin transfer is visible in HyperCore spot, but the final perp state could not be read",
            autoRecoverable: false,
            autoRecovered: false,
            observedValue: executionSnapshot.coreSpotUsd,
            expectedValue: verification.expectedCoreSpotAfterUsd
          }));
        }
      }
      const reduceMarginStage = String(reduceMarginFinalization.stage ?? "").trim().toLowerCase();
      if (
        verification.transferObserved
        && (
          (reduceMarginStage !== "observed" && reduceMarginStage !== "verified")
          || (reduceMarginStage === "observed" && verification.finalPerpStateReadable)
        )
      ) {
        issues.push(buildBotVaultV3ReconciliationIssue({
          code: verification.reductionVerified ? "reduce_margin_verified_after_restart" : "reduce_margin_observed_after_restart",
          severity: "warning",
          field: "executionBalances",
          sourceOfTruth: "execution",
          detail: verification.reductionVerified
            ? "reduce-margin final state was fully verified during reconciliation"
            : "reduce-margin visibility was confirmed during reconciliation",
          autoRecoverable: true,
          autoRecovered: params.persist !== false,
          observedValue: executionSnapshot.coreSpotUsd,
          expectedValue: verification.expectedCoreSpotAfterUsd
        }));
        patchData.executionMetadata = {
          ...toRecord(row.executionMetadata),
          reduceMarginFinalization: {
            ...reduceMarginFinalization,
            stage: verification.finalPerpStateReadable ? "verified" : "observed",
            coreSpotBalanceAfterUsd: executionSnapshot.coreSpotUsd,
            coreSpotExpectedAfterUsd: verification.expectedCoreSpotAfterUsd,
            perpAvailableMarginAfterUsd: executionSnapshot.perpAvailableMarginUsd,
            perpEquityAfterUsd: executionSnapshot.perpEquityUsd,
            transferObserved: verification.transferObserved,
            finalPerpStateReadable: verification.finalPerpStateReadable,
            verificationState: verification.verificationState,
            verificationBlockingReason: verification.verificationBlockingReason,
            observedAt: checkedAt,
            verifiedAt: verification.reductionVerified ? checkedAt : null,
            updatedAt: checkedAt
          }
        };
      }
    }

    const reconciliationStatus: BotVaultV3Reconciliation["status"] = issues.some((issue) => issue.severity === "blocking")
      ? "blocking"
      : issues.length > 0
        ? "warning"
        : "ok";
    const reconciliation: BotVaultV3Reconciliation = {
      status: reconciliationStatus,
      checkedAt,
      detail: reconciliationStatus === "ok"
        ? "bot_vault_v3_reconciliation_ok"
        : issues[0]?.detail ?? "bot_vault_v3_reconciliation_warning",
      autoApplied: autoApplied || Object.keys(patchData).some((key) => key !== "executionMetadata"),
      issues,
      sourceOfTruth: {
        principalAllocated: "onchain",
        principalReturned: "onchain",
        availableUsd: "onchain",
        claimedProfitUsd: "local_settlement",
        feePaidTotal: "onchain",
        fundingLifecycle: "derived",
        hypercoreFundingLifecycle: "derived",
        executionBalances: "execution"
      },
      onchainSnapshot,
      executionSnapshot
    };

    const nextExecutionMetadata = {
      ...toRecord(row.executionMetadata),
      botVaultV3Reconciliation: reconciliation
    };

    if (params.persist !== false) {
      const persisted = await db.botVault.update({
        where: { id: String(row.id) },
        data: {
          ...patchData,
          executionMetadata: {
            ...nextExecutionMetadata,
            ...toRecord(patchData.executionMetadata)
          }
        }
      }).catch((error) => {
        logger.warn("bot_vault_v3_reconciliation_persist_failed", {
          userId: params.userId,
          botVaultId: String(row.id),
          error: String(error)
        });
        return null;
      });
      row = persisted ?? {
        ...row,
        ...patchData,
        executionMetadata: {
          ...nextExecutionMetadata,
          ...toRecord(patchData.executionMetadata)
        }
      };
    } else {
      row = {
        ...row,
        ...patchData,
        executionMetadata: {
          ...nextExecutionMetadata,
          ...toRecord(patchData.executionMetadata)
        }
      };
    }

    return mapBotVaultSummary(row);
  }

  async function readRequiresHypercoreExitGasTopUp(vaultAddress: `0x${string}`): Promise<boolean> {
    const targetHype = envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_TARGET", 0.05);
    if (targetHype <= 0) return false;
    const hypeBalance = toNonNegativeFinite(await readHyperliquidSpotAssetBalanceLive(vaultAddress, "HYPE"));
    return hypeBalance + 0.0000001 < targetHype;
  }

  async function waitForPositionsToFlat(adapter: any, symbol?: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const positions = typeof adapter?.listPositions === "function"
        ? await adapter.listPositions(symbol ? { symbol } : undefined)
        : [];
      const hasOpenPositions = Array.isArray(positions)
        ? positions.some((position) => Math.abs(Number(position?.size ?? 0)) > 0.0000001)
        : false;
      if (!hasOpenPositions) return;
      await sleepImpl(750);
    }
  }

  async function ensureHypercoreExitGas(params: {
    account: TradingAccount;
    vaultAddress: `0x${string}`;
    onchainStatus: string;
  }): Promise<void> {
    const coreWriter = createVaultCoreWriterImpl(params.account);
    const spotClient = createVaultSpotClientImpl(params.account);
    if (!spotClient) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_market_client_missing");
    }
    if (!coreWriter) {
      throw new Error("bot_vault_v3_hypercore_exit_corewriter_missing");
    }

    const targetHype = envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_TARGET", 0.05);
    const maxUsdcSpend = envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_MAX_USDC_SPEND", 1);
    if (targetHype <= 0 || maxUsdcSpend <= 0) return;
    const hypeBefore = toNonNegativeFinite(await readHyperliquidSpotAssetBalanceLive(params.vaultAddress, "HYPE"));
    if (hypeBefore >= targetHype - 0.0000001) return;
    if (params.onchainStatus !== "ACTIVE") {
      throw new Error(`bot_vault_v3_hypercore_exit_gas_order_not_allowed:${params.onchainStatus}`);
    }

    const spotUsdcBefore = toNonNegativeFinite(await readHyperliquidSpotAssetBalanceLive(params.vaultAddress, "USDC"));
    const spendBudgetUsd = Math.min(spotUsdcBefore, maxUsdcSpend);
    if (spendBudgetUsd <= 0.000001) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_usdc_missing");
    }

    const hypeUsdcMarket = findSpotSymbol(await spotClient.listSymbols(), "HYPE", "USDC");
    const marketAssetIndex = Number(hypeUsdcMarket?.assetIndex ?? NaN);
    if (!hypeUsdcMarket?.symbol || !Number.isFinite(marketAssetIndex) || marketAssetIndex < 0) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_market_missing");
    }

    const referencePrice = toNonNegativeFinite(await spotClient.getLastPrice(hypeUsdcMarket.symbol));
    if (referencePrice <= 0) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_price_unavailable");
    }

    const stepSize = toNonNegativeFinite(hypeUsdcMarket.stepSize);
    const minQty = Math.max(
      toNonNegativeFinite(hypeUsdcMarket.minQty),
      stepSize
    );
    const desiredQty = roundStep(
      Math.max(targetHype - hypeBefore, minQty || targetHype),
      stepSize || null,
      "up"
    );
    const maxAffordableQty = roundStep(spendBudgetUsd / referencePrice, stepSize || null, "down");
    const buyQty = maxAffordableQty >= desiredQty && desiredQty > 0
      ? desiredQty
      : maxAffordableQty;
    if (buyQty <= 0.000000001 || (minQty > 0 && buyQty + 0.000000001 < minQty)) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_budget_too_low");
    }

    const marketSlippage = envNumber("HYPERLIQUID_SPOT_MARKET_SLIPPAGE_PCT", 0.05) / 100;
    const limitPx = Number((referencePrice * (1 + marketSlippage)).toFixed(8));
    const normalizedQty = Number(buyQty.toFixed(8));
    const gasOrderResult = await coreWriter.placeLimitOrder({
      asset: 10_000 + Math.trunc(marketAssetIndex),
      isBuy: true,
      limitPx,
      sz: normalizedQty,
      reduceOnly: false,
      encodedTif: 3,
      clientOrderId: `bot-vault-exit-gas-${crypto.randomUUID()}`
    });
    if (gasOrderResult.status !== "confirmed") {
      throw new Error(
        gasOrderResult.errorMessage
        ?? gasOrderResult.errorCode
        ?? "bot_vault_v3_hypercore_exit_gas_confirmation_pending"
      );
    }
    await sleepImpl(750);
  }

  function isHyperliquidRateLimitError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return (
      /hyperliquid_info_request_failed:429\b/i.test(message)
      || /rate[_ -]?limit/i.test(message)
      || /too many requests/i.test(message)
    );
  }

  function isHyperliquidTransientError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return (
      isHyperliquidRateLimitError(message)
      || /hyperliquidapierror/i.test(message)
      || /unknown error occurred/i.test(message)
      || /failed to deserialize/i.test(message)
      || /request timeout/i.test(message)
      || /fetch failed/i.test(message)
      || /network/i.test(message)
    );
  }

  async function retryHyperliquidTransient<T>(
    operation: string,
    run: () => Promise<T>,
    attempts = 4
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error ?? operation));
        if (!isHyperliquidTransientError(normalized) || attempt >= attempts - 1) {
          throw normalized;
        }
        lastError = normalized;
      }
      await sleepImpl(Math.min(5_000, 500 * (2 ** attempt)));
    }
    throw lastError ?? new Error(`bot_vault_v3_hyperliquid_retry_exhausted:${operation}`);
  }

  type HypercoreExitCheck = {
    state: HyperliquidClearinghouseState;
    withdrawableUsd: number;
    accountValueUsd: number;
    marginUsedUsd: number;
    openPositionCount: number;
    spotUsdcUsd: number;
    requiresExit: boolean;
  };

  async function readHypercoreExitCheck(vaultAddress: `0x${string}`, usdcBalanceRaw: bigint): Promise<HypercoreExitCheck> {
    const state = await readHyperliquidClearinghouseStateLive(vaultAddress);
    const withdrawableUsd = toNonNegativeFinite(state.withdrawable);
    const accountValueUsd = toNonNegativeFinite(state.accountValue);
    const marginUsedUsd = toNonNegativeFinite(state.totalMarginUsed);
    const openPositionCount = Array.isArray(state.assetPositions) ? state.assetPositions.length : 0;
    const spotUsdcUsd = toNonNegativeFinite(await readHyperliquidSpotUsdcBalanceLive(vaultAddress));
    return {
      state,
      withdrawableUsd,
      accountValueUsd,
      marginUsedUsd,
      openPositionCount,
      spotUsdcUsd,
      requiresExit:
        withdrawableUsd > 0.000001
        || spotUsdcUsd > 0.000001
        || marginUsedUsd > 0.000001
        || openPositionCount > 0
        || (accountValueUsd > 0.000001 && usdcBalanceRaw === 0n)
    };
  }

  async function readHypercoreExitCheckWithRetry(
    vaultAddress: `0x${string}`,
    usdcBalanceRaw: bigint
  ): Promise<HypercoreExitCheck> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await readHypercoreExitCheck(vaultAddress, usdcBalanceRaw);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error ?? "hypercore_exit_check_failed"));
        if (!isHyperliquidRateLimitError(normalized) || attempt >= 5) {
          throw normalized;
        }
        lastError = normalized;
      }
      await sleepImpl(Math.min(8000, 750 * (2 ** attempt)));
    }
    throw lastError ?? new Error("bot_vault_v3_hypercore_exit_check_rate_limited");
  }

  function formatHypercoreExitRequiredError(check: HypercoreExitCheck): Error {
    return new Error(
      [
        "bot_vault_v3_hypercore_exit_required",
        `withdrawable=${check.state.withdrawable}`,
        `spotUsdc=${String(check.spotUsdcUsd)}`,
        `accountValue=${check.state.accountValue}`,
        `marginUsed=${check.state.totalMarginUsed}`,
        `openPositions=${String(check.openPositionCount)}`
      ].join(":")
    );
  }

  async function bestEffortSettleHypercoreExit(params: {
    userId: string;
    botVaultId: string;
    onchainStatus: string;
  }): Promise<void> {
    const context = await loadExecutionCloseoutContext(params);
    if (!context?.exchangeAccount || !context.executionVaultAddress || !isAddress(context.executionVaultAddress)) {
      return;
    }
    const logSettlementStepFailure = (step: string, error: unknown) => {
      logger.warn("bot_vault_v3_hypercore_exit_settlement_step_failed", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        step,
        error: String(error)
      });
    };
    let account: TradingAccount;
    try {
      account = await resolveExecutionCloseoutAccount(context);
    } catch (error) {
      logSettlementStepFailure("resolve_execution_account", error);
      return;
    }
    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;
    const symbol = context.symbol ?? undefined;
    try {
      await cancelAllOrdersImpl(adapter, symbol).catch(() => ({ requested: 0, cancelled: 0, failed: 0 }));
      const positions = typeof adapter?.listPositions === "function"
        ? await retryHyperliquidTransient(
            "list_positions",
            () => adapter.listPositions(symbol ? { symbol } : undefined)
          ).catch((error) => {
            logSettlementStepFailure("list_positions", error);
            return [];
          })
        : [];
      const actionablePositions = Array.isArray(positions)
        ? positions.filter((position) => Math.abs(Number(position?.size ?? 0)) > 0.0000001)
        : [];
      for (const position of actionablePositions) {
        const positionSymbol = String(position?.symbol ?? symbol ?? "").trim();
        if (!positionSymbol) continue;
        await retryHyperliquidTransient(
          `close_position:${positionSymbol}`,
          () => closePositionsMarketImpl(adapter, positionSymbol, position.side)
        ).catch((error) => {
          logSettlementStepFailure(`close_position:${positionSymbol}`, error);
          return [];
        });
      }
      await retryHyperliquidTransient(
        "wait_positions_flat",
        () => waitForPositionsToFlat(adapter, symbol)
      ).catch((error) => {
        logSettlementStepFailure("wait_positions_flat", error);
      });

      const accountState: { availableMargin?: unknown } | null = typeof adapter?.getAccountState === "function"
        ? await retryHyperliquidTransient(
            "get_account_state",
            async () => {
              const result = await adapter.getAccountState();
              return result as { availableMargin?: unknown } | null;
            }
          ).catch((error) => {
            logSettlementStepFailure("get_account_state", error);
            return null;
          })
        : null;
      const withdrawableUsd = Math.max(0, Number(accountState?.availableMargin ?? 0));
      if (withdrawableUsd > 0.000001 && typeof adapterAny.transferUsdClass === "function") {
        await retryHyperliquidTransient(
          "transfer_usd_class_to_spot",
          async () => {
            const result = await adapterAny.transferUsdClass({
              amountUsd: withdrawableUsd,
              toPerp: false
            });
            if (result?.status !== "confirmed") {
              throw new Error(result?.errorMessage ?? result?.errorCode ?? "bot_vault_v3_transfer_usd_class_not_confirmed");
            }
            return result;
          }
        ).catch((error) => {
          logSettlementStepFailure("transfer_usd_class_to_spot", error);
          return null;
        });
        await sleepImpl(750);
      }

      await retryHyperliquidTransient(
        "ensure_hypercore_exit_gas",
        () => ensureHypercoreExitGas({
          account,
          vaultAddress: context.executionVaultAddress as `0x${string}`,
          onchainStatus: params.onchainStatus
        })
      ).catch((error) => {
        logSettlementStepFailure("ensure_hypercore_exit_gas", error);
      });

      const spotBalance: { amountUsd?: unknown } | null = typeof adapterAny.getCoreUsdcSpotBalance === "function"
        ? await retryHyperliquidTransient(
            "get_core_usdc_spot_balance",
            async () => {
              const result = await adapterAny.getCoreUsdcSpotBalance();
              return result as { amountUsd?: unknown } | null;
            }
          ).catch((error) => {
            logSettlementStepFailure("get_core_usdc_spot_balance", error);
            return null;
          })
        : null;
      const spotUsdcUsd = Math.max(0, Number(spotBalance?.amountUsd ?? 0));
      if (spotUsdcUsd > 0.000001 && typeof adapterAny.transferUsdcSpotToEvm === "function") {
        await retryHyperliquidTransient(
          "transfer_usdc_spot_to_evm",
          async () => {
            const result = await adapterAny.transferUsdcSpotToEvm({
              amountUsd: spotUsdcUsd
            });
            if (result?.status !== "confirmed") {
              throw new Error(result?.errorMessage ?? result?.errorCode ?? "bot_vault_v3_transfer_spot_to_evm_not_confirmed");
            }
            return result;
          }
        ).catch((error) => {
          logSettlementStepFailure("transfer_usdc_spot_to_evm", error);
          return null;
        });
        await sleepImpl(750);
      }
    } catch (error) {
      logger.warn("bot_vault_v3_hypercore_exit_settlement_failed", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        error: String(error)
      });
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function resyncBotVaultV3StateFromChain(params: {
    botVaultId: string;
    vaultAddress: `0x${string}`;
    publicClient: any;
    usdcAddress: `0x${string}`;
  }) {
    const current = typeof db?.botVault?.findUnique === "function"
      ? await db.botVault.findUnique({
          where: { id: params.botVaultId },
          select: {
            id: true,
            fundingStatus: true,
            hypercoreFundingStatus: true,
            executionStatus: true,
            status: true,
            principalAllocated: true,
            principalReturned: true,
            availableUsd: true,
            executionMetadata: true
          }
        }).catch(() => null)
      : null;
    const snapshot = await readBotVaultV3OnchainSnapshot({
      publicClient: params.publicClient,
      vaultAddress: params.vaultAddress,
      usdcAddress: params.usdcAddress
    });
    const lifecycleTargetStage: BotVaultV3FundingLifecycleStage = (
      snapshot.status === "CLOSED"
      || (snapshot.status === "CLOSE_ONLY" && snapshot.availableUsd <= 0 && snapshot.principalReturned > 0)
    )
      ? "settled"
      : (snapshot.principalAllocated > 0 || snapshot.availableUsd > 0)
        ? "hyper_evm_confirmed"
        : readBotVaultV3FundingLifecycleState(current).stage;
    await db.botVault.update({
      where: { id: params.botVaultId },
      data: {
        ...buildBotVaultV3ResyncUpdate(snapshot),
        ...(current
          ? buildBotVaultV3FundingLifecycleTransitionPatch({
              row: current,
              targetStage: lifecycleTargetStage,
              source: "resync_bot_vault_v3_state_from_chain",
              reason: "onchain_state_observed",
              detail: snapshot.status
            })
          : {})
      }
    });
    return snapshot;
  }

  async function refreshUserAgentWalletSummary(params: { user: any; persist?: boolean }): Promise<AgentWalletSummary> {
    const address = toNullableString(params.user?.agentWallet);
    if (!address || !isAddress(address)) return mapAgentWalletSummary(params.user);
    try {
      const { publicClient } = buildHyperEvmClient();
      const balance = await publicClient.getBalance({
        address: address as `0x${string}`
      });
      const updatedAt = new Date();
      const formatted = formatUnits(balance, 18);
      if (params.persist !== false) {
        await db.user.update({
          where: { id: String(params.user.id) },
          data: {
            agentLastBalanceAt: updatedAt,
            agentLastBalanceWei: balance.toString(),
            agentLastBalanceFormatted: formatted
          }
        }).catch(() => undefined);
      }
      return mapAgentWalletSummary({
        ...params.user,
        agentLastBalanceAt: updatedAt,
        agentLastBalanceWei: balance.toString(),
        agentLastBalanceFormatted: formatted
      });
    } catch {
      return mapAgentWalletSummary(params.user);
    }
  }

  async function getUserAgentWalletSummary(params: { userId: string }) {
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentHypeWarnThreshold: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    if (!user) throw new Error("user_not_found");
    return refreshUserAgentWalletSummary({ user });
  }

  async function setUserAgentWallet(params: SetUserAgentWalletParams) {
    const agentWallet = String(params.agentWallet ?? "").trim();
    if (!isAddress(agentWallet)) throw new Error("agent_wallet_invalid");
    const updated = await db.user.update({
      where: { id: params.userId },
      data: {
        agentWallet,
        agentWalletVersion: Math.max(1, Math.trunc(Number(params.agentWalletVersion ?? 1) || 1)),
        agentSecretRef: toNullableString(params.agentSecretRef)
      },
      select: {
        id: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentHypeWarnThreshold: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    await db.botVault.updateMany({
      where: {
        userId: params.userId,
        vaultModel: "bot_vault_v3",
        status: { in: ["ACTIVE", "PAUSED", "CLOSE_ONLY"] }
      },
      data: {
        agentWallet,
        agentWalletVersion: Math.max(1, Math.trunc(Number(params.agentWalletVersion ?? 1) || 1)),
        agentSecretRef: toNullableString(params.agentSecretRef)
      }
    }).catch(() => undefined);
    return refreshUserAgentWalletSummary({ user: updated });
  }

  async function createUserAgentWallet(params: CreateUserAgentWalletParams) {
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentHypeWarnThreshold: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    if (!user) throw new Error("user_not_found");
    if (toNullableString(user.agentWallet)) {
      throw new Error("agent_wallet_already_configured");
    }

    const activeSecret = await db.agentWalletSecret.findFirst({
      where: {
        userId: params.userId,
        status: "active"
      },
      select: {
        address: true,
        version: true,
        secretRef: true
      },
      orderBy: { version: "desc" }
    }).catch(() => null);

    if (activeSecret?.address && isAddress(activeSecret.address)) {
      const restored = await db.user.update({
        where: { id: params.userId },
        data: {
          agentWallet: activeSecret.address,
          agentWalletVersion: Math.max(1, Math.trunc(Number(activeSecret.version ?? 1) || 1)),
          agentSecretRef: toNullableString(activeSecret.secretRef)
        },
        select: {
          id: true,
          agentWallet: true,
          agentWalletVersion: true,
          agentSecretRef: true,
          agentHypeWarnThreshold: true,
          agentLastBalanceAt: true,
          agentLastBalanceWei: true,
          agentLastBalanceFormatted: true
        }
      });
      await db.botVault.updateMany({
        where: {
          userId: params.userId,
          vaultModel: "bot_vault_v3",
          status: { in: ["ACTIVE", "PAUSED", "CLOSE_ONLY"] }
        },
        data: {
          agentWallet: activeSecret.address,
          agentWalletVersion: Math.max(1, Math.trunc(Number(activeSecret.version ?? 1) || 1)),
          agentSecretRef: toNullableString(activeSecret.secretRef)
        }
      }).catch(() => undefined);
      return refreshUserAgentWalletSummary({ user: restored });
    }

    const lastSecret = await db.agentWalletSecret.findFirst({
      where: { userId: params.userId },
      select: { version: true },
      orderBy: { version: "desc" }
    }).catch(() => null);
    const nextVersion = Math.max(1, Math.trunc(Number(lastSecret?.version ?? 0) || 0) + 1);
    const privateKey = `0x${crypto.randomBytes(32).toString("hex")}` as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    const secretRef = `agent_wallet:${params.userId}:${nextVersion}:${crypto.randomUUID()}`;

    const updated = await db.$transaction(async (tx: any) => {
      await tx.agentWalletSecret.create({
        data: {
          userId: params.userId,
          address: account.address,
          version: nextVersion,
          secretRef,
          encryptedPrivateKey: encryptSecret(privateKey),
          status: "active"
        }
      });
      const nextUser = await tx.user.update({
        where: { id: params.userId },
        data: {
          agentWallet: account.address,
          agentWalletVersion: nextVersion,
          agentSecretRef: secretRef
        },
        select: {
          id: true,
          agentWallet: true,
          agentWalletVersion: true,
          agentSecretRef: true,
          agentHypeWarnThreshold: true,
          agentLastBalanceAt: true,
          agentLastBalanceWei: true,
          agentLastBalanceFormatted: true
        }
      });
      await tx.botVault.updateMany({
        where: {
          userId: params.userId,
          vaultModel: "bot_vault_v3",
          status: { in: ["ACTIVE", "PAUSED", "CLOSE_ONLY"] }
        },
        data: {
          agentWallet: account.address,
          agentWalletVersion: nextVersion,
          agentSecretRef: secretRef
        }
      });
      return nextUser;
    });

    return refreshUserAgentWalletSummary({ user: updated });
  }

  async function setUserAgentThreshold(params: SetUserAgentThresholdParams) {
    const thresholdHype = toNonNegativeNumber(params.thresholdHype, -1);
    if (!Number.isFinite(thresholdHype) || thresholdHype < 0) {
      throw new Error("invalid_threshold_hype");
    }
    const updated = await db.user.update({
      where: { id: params.userId },
      data: { agentHypeWarnThreshold: thresholdHype },
      select: {
        id: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentHypeWarnThreshold: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    return refreshUserAgentWalletSummary({ user: updated, persist: false });
  }

  async function withdrawHypeFromUserAgentWallet(params: WithdrawUserAgentHypeParams) {
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        walletAddress: true,
        agentWallet: true,
        agentWalletVersion: true,
        agentSecretRef: true,
        agentLastBalanceAt: true,
        agentLastBalanceWei: true,
        agentLastBalanceFormatted: true
      }
    });
    if (!user) throw new Error("user_not_found");
    const agentWallet = toNullableString(user.agentWallet);
    const targetAddress = toNullableString(user.walletAddress);
    if (!agentWallet || !isAddress(agentWallet)) throw new Error("agent_wallet_missing");
    if (!targetAddress || !isAddress(targetAddress)) throw new Error("linked_wallet_missing");
    const credentials = await agentSecretProvider.getAgentCredentials({
      userId: params.userId,
      masterVaultId: null,
      botVaultId: `user:${params.userId}`,
      agentWalletAddress: agentWallet,
      agentWalletVersion: user.agentWalletVersion,
      agentSecretRef: user.agentSecretRef
    });
    if (!credentials?.privateKey) throw new Error("agent_secret_missing");

    const reserveHype = toNonNegativeNumber(params.reserveHype, 0.003);
    const { chain, publicClient, walletConfig } = buildHyperEvmClient();
    const account = privateKeyToAccount(credentials.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(walletConfig.hyperEvmRpcUrl)
    });
    const rawBalance = await publicClient.getBalance({ address: agentWallet as `0x${string}` });
    const reserveWei = parseEther(String(reserveHype));
    const requestedWei = params.amountHype != null ? parseEther(String(Math.max(0, Number(params.amountHype)))) : null;
    let amountWei = requestedWei ?? (rawBalance > reserveWei ? rawBalance - reserveWei : 0n);
    if (rawBalance - amountWei < reserveWei) {
      amountWei = rawBalance > reserveWei ? rawBalance - reserveWei : 0n;
    }
    if (amountWei <= 0n) throw new Error("insufficient_hype_balance");

    const txHash = await walletClient.sendTransaction({
      account,
      chain,
      to: targetAddress as `0x${string}`,
      value: amountWei
    });
    const nextBalanceWei = rawBalance - amountWei;
    await db.user.update({
      where: { id: params.userId },
      data: {
        agentLastBalanceAt: new Date(),
        agentLastBalanceWei: nextBalanceWei.toString(),
        agentLastBalanceFormatted: formatUnits(nextBalanceWei, 18)
      }
    }).catch(() => undefined);

    return {
      txHash,
      amountHype: formatUnits(amountWei, 18),
      remainingReserveHype: formatUnits(nextBalanceWei, 18),
      targetAddress
    };
  }

  async function getBotVaultForBot(params: { userId: string; botId: string; reconcile?: boolean }): Promise<BotVaultV3Summary | null> {
    const row = await db.botVault.findFirst({
      where: {
        userId: params.userId,
        botId: params.botId,
        vaultModel: "bot_vault_v3"
      }
    });
    if (!row) return null;
    if (params.reconcile === true) {
      return reconcileBotVaultV3ById({
        userId: params.userId,
        botVaultId: String(row.id)
      }).catch((error) => {
        logger.warn("bot_vault_v3_reconcile_read_fallback", {
          userId: params.userId,
          botId: params.botId,
          botVaultId: String(row.id),
          error: String(error)
        });
        return mapBotVaultSummary(row);
      });
    }
    return mapBotVaultSummary(row);
  }

  async function findBotVaultRecordForBot(params: {
    userId: string;
    botId: string;
    select?: Record<string, boolean>;
  }) {
    return db.botVault.findFirst({
      where: {
        userId: params.userId,
        botId: params.botId,
        vaultModel: "bot_vault_v3"
      },
      select: params.select
    });
  }

  async function findBotVaultRecordById(params: {
    userId: string;
    botVaultId: string;
    select?: Record<string, boolean>;
  }) {
    return db.botVault.findFirst({
      where: {
        userId: params.userId,
        id: params.botVaultId,
        vaultModel: "bot_vault_v3"
      },
      select: params.select
    });
  }

  async function ensureBotVaultForBot(params: { userId: string; botId: string }): Promise<BotVaultV3Summary> {
    const existing = await getBotVaultForBot(params);
    if (existing) return existing;

    const [bot, user, templateId] = await Promise.all([
      db.bot.findFirst({
        where: { id: params.botId, userId: params.userId },
        select: { id: true, userId: true }
      }),
      db.user.findUnique({
        where: { id: params.userId },
        select: {
          id: true,
          walletAddress: true,
          agentWallet: true,
          agentWalletVersion: true,
          agentSecretRef: true
        }
      }),
      resolveTemplateIdForBot(db)
    ]);
    if (!bot) throw new Error("bot_not_found");
    if (!user) throw new Error("user_not_found");

    const created = await db.botVault.create({
      data: {
        userId: params.userId,
        masterVaultId: null,
        templateId,
        botId: params.botId,
        vaultModel: "bot_vault_v3",
        beneficiaryAddress: toNullableString(user.walletAddress),
        controllerAddress,
        agentWallet: toNullableString(user.agentWallet),
        agentWalletVersion: Math.max(1, Math.trunc(Number(user.agentWalletVersion ?? 1) || 1)),
        agentSecretRef: toNullableString(user.agentSecretRef),
        fundingStatus: "deployed",
        hypercoreFundingStatus: "not_funded",
        executionStatus: "created",
        availableUsd: 0,
        allocatedUsd: 0,
        principalAllocated: 0,
        principalReturned: 0,
        claimedProfitUsd: 0,
        executionMetadata: createBotVaultV3FundingLifecycleMetadata("deployed")
      }
    });
    return mapBotVaultSummary(created);
  }

  async function fundBotVault(params: FundBotVaultParams): Promise<BotVaultV3Summary> {
    const amountUsd = roundUsd(toNonNegativeNumber(params.amountUsd, 0));
    if (amountUsd <= 0) throw new Error("amount_required");
    const moveToHyperCore = params.moveToHyperCore !== false;
    const current = await ensureBotVaultForBot({ userId: params.userId, botId: params.botId });
    const botVault = await findBotVaultRecordForBot({
      userId: params.userId,
      botId: params.botId,
      select: {
        id: true,
        fundingStatus: true,
        hypercoreFundingStatus: true,
        executionStatus: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    const amountKey = formatFundingIntentAmountKey(amountUsd);
    const currentMetadata = toRecord(botVault.executionMetadata);
    const currentFundingIntent = toRecord(currentMetadata.fundingIntent);
    const currentIntentAmountKey = currentFundingIntent.amountUsd !== undefined
      ? formatFundingIntentAmountKey(toNonNegativeNumber(currentFundingIntent.amountUsd, 0))
      : null;

    const existingFundingAction = typeof db?.onchainAction?.findFirst === "function"
      ? await db.onchainAction.findFirst({
        where: {
          botVaultId: String(botVault.id),
          actionType: "fund_bot_vault_v3",
          status: {
            in: ["prepared", "submitted", "confirmed", "failed"]
          }
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          actionKey: true,
          actionType: true,
          status: true,
          txHash: true,
          metadata: true
        }
      }).catch(() => null)
      : null;
    const timeoutEscalation = await escalateBotVaultV3FundingIntentTimeout({
      row: botVault,
      fundingAction: existingFundingAction,
      source: "fund_bot_vault",
      loggerContext: {
        userId: params.userId,
        botId: params.botId,
        amountUsd
      }
    });
    const effectiveBotVault = timeoutEscalation.row;
    const effectiveMetadata = toRecord(effectiveBotVault.executionMetadata);
    const effectiveFundingIntent = toRecord(effectiveMetadata.fundingIntent);
    const effectiveLifecycle = readBotVaultV3FundingLifecycleState(effectiveBotVault);
    const existingFundingActionStatus = String(existingFundingAction?.status ?? "").trim().toLowerCase();
    const existingActionMetadata = toRecord(existingFundingAction?.metadata);
    const existingActionAmountKey = existingActionMetadata.amountUsd !== undefined
      ? formatFundingIntentAmountKey(toNonNegativeNumber(existingActionMetadata.amountUsd, 0))
      : null;
    const timedOutFundingIntent =
      String(effectiveFundingIntent.actionStatus ?? "").trim().toLowerCase() === "timed_out"
      || (
        effectiveLifecycle.stage === "recovery_required"
        && String(effectiveLifecycle.recoveryReason ?? "").startsWith("bot_vault_v3_funding_intent_timeout:")
      );

    const conflictingExistingAmountKey = existingActionAmountKey || currentIntentAmountKey;
    if (
      conflictingExistingAmountKey
      && conflictingExistingAmountKey !== amountKey
      && (
        (
          (existingFundingActionStatus === "prepared" || existingFundingActionStatus === "submitted")
          || String(effectiveBotVault.fundingStatus ?? "").trim().toLowerCase() === "hyper_evm_funding_requested"
        )
        && !timedOutFundingIntent
      )
    ) {
      throw new Error("bot_vault_funding_request_amount_conflict");
    }

    if (
      existingFundingAction
      && effectiveFundingIntent.moveToHyperCore !== undefined
      && (effectiveFundingIntent.moveToHyperCore === false ? false : true) !== moveToHyperCore
      && existingFundingActionStatus !== "confirmed"
      && existingFundingActionStatus !== "failed"
      && !timedOutFundingIntent
    ) {
      throw new Error("bot_vault_funding_request_move_to_hypercore_conflict");
    }

    if (existingFundingActionStatus === "confirmed" && !timedOutFundingIntent) {
      const reconciled = await reconcileBotVaultV3ById({
        userId: params.userId,
        botVaultId: String(botVault.id)
      }).catch(() => null);
      return reconciled ?? current;
    }

    const fundingSourceKey = `bot_vault_v3_funding:${botVault.id}:${amountKey}`;
    const requestedAt = new Date().toISOString();
    const nextRetryAttempt = existingFundingActionStatus === "failed" || timedOutFundingIntent
      ? Math.max(1, Math.trunc(toNonNegativeNumber(effectiveFundingIntent.retryAttempt, 0)) + 1)
      : Math.max(0, Math.trunc(toNonNegativeNumber(effectiveFundingIntent.retryAttempt, 0)));
    const nextFundingActionKey = existingFundingActionStatus === "failed" || timedOutFundingIntent
      ? `${fundingSourceKey}:retry:${nextRetryAttempt}`
      : fundingSourceKey;
    const nextTimeoutAt = existingFundingActionStatus === "failed" || timedOutFundingIntent
      ? addMillisecondsIso(new Date(requestedAt), BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MS)
      : toNullableString(effectiveFundingIntent.timeoutAt) ?? addMillisecondsIso(new Date(requestedAt), BOT_VAULT_V3_FUNDING_INTENT_TIMEOUT_MS);
    const built = ((existingFundingActionStatus === "prepared" || existingFundingActionStatus === "submitted") && !timedOutFundingIntent)
      ? {
        action: existingFundingAction
      }
      : await onchainActionService.buildReserveForBotVault({
        userId: params.userId,
        botVaultId: String(botVault.id),
        amountUsd,
        actionKey: nextFundingActionKey
      });

    const nextAction = built.action;
    const nextActionStatus = String(nextAction?.status ?? "prepared").trim().toLowerCase() || "prepared";
    const fundingLifecyclePatch = buildBotVaultV3FundingLifecycleTransitionPatch({
      row: effectiveBotVault,
      targetStage: "funding_requested",
      source: "fund_bot_vault",
      reason: "funding_requested",
      detail: fundingSourceKey,
      metadataPatch: {
        fundingIntent: {
          sourceKey: fundingSourceKey,
          requestedAt: toNullableString(effectiveFundingIntent.requestedAt) ?? requestedAt,
          lastBoundAt: requestedAt,
          amountUsd,
          moveToHyperCore,
          actionId: toNullableString(nextAction?.id),
          actionKey: toNullableString(nextAction?.actionKey) ?? nextFundingActionKey,
          actionType: toNullableString(nextAction?.actionType) ?? "fund_bot_vault_v3",
          actionStatus: nextActionStatus,
          txHash: toNullableString(nextAction?.txHash),
          retryAttempt: nextRetryAttempt,
          timeoutAt: nextTimeoutAt,
          timedOutAt: null,
          timeoutReason: null,
          lastError: null,
          finalizationPath: moveToHyperCore
            ? "fund_bot_vault_v3 -> fund_bot_vault_hypercore -> finalize_margin_add"
            : "fund_bot_vault_v3_confirmed_onchain",
          verificationState: "requested"
        },
        autoActivateStatus: moveToHyperCore ? effectiveMetadata.autoActivateStatus : "skipped",
        autoHypercoreFundingStatus: moveToHyperCore ? effectiveMetadata.autoHypercoreFundingStatus : "skipped"
      }
    });
    const updated = await db.botVault.update({
      where: { id: String(botVault.id) },
      data: fundingLifecyclePatch
    });
    return mapBotVaultSummary(updated);
  }

  async function loadClaimProfitQuote(params: LoadClaimProfitQuoteParams): Promise<ClaimProfitQuote> {
    const botVault = await findBotVaultRecordForBot({
      userId: params.userId,
      botId: params.botId,
      select: {
        id: true,
        vaultAddress: true,
        controllerAddress: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");

    const controllerClient = buildControllerWalletClient(expectedControllerAddress);
    const { publicClient } = controllerClient;

    const [statusRaw, principalDepositedRaw, principalReturnedRaw, factoryAddress, evmUsdcBalanceRaw, excludedPrincipalUsd, hypercoreState, hypercoreSpotUsdcRaw] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      }),
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalDeposited"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalReturned"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "factory"
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as Promise<bigint>,
      readHypercoreAccountingFeeUsdForBotVault({
        botVaultId: String(botVault.id),
        executionMetadata: botVault.executionMetadata
      }),
      retryHyperliquidTransient(
        "claim_profit_clearinghouse_state",
        () => readHyperliquidClearinghouseStateLive(vaultAddress as `0x${string}`)
      ).catch(() => ({
        withdrawable: "0",
        accountValue: "0",
        totalMarginUsed: "0",
        assetPositions: []
      } satisfies HyperliquidClearinghouseState)),
      retryHyperliquidTransient(
        "claim_profit_spot_usdc_balance",
        () => readHyperliquidSpotUsdcBalanceLive(vaultAddress as `0x${string}`)
      ).catch(() => "0")
    ]);

    const status = statusIndexToLabel(statusRaw);
    if (status === "CLOSED") {
      throw new Error("claim_profit_unavailable:vault_closed");
    }

    const excludedPrincipalRaw = toAtomicUsd(excludedPrincipalUsd);
    const effectivePrincipalOutstandingRaw = deriveEffectivePrincipalOutstandingRaw({
      principalDepositedRaw,
      principalReturnedRaw,
      excludedPrincipalRaw
    });
    const evmUsdcBalanceUsd = formatUsdAtomicToNumber(evmUsdcBalanceRaw);
    const hypercoreAccountValueUsd = roundUsd(toNonNegativeFinite(hypercoreState.accountValue), 6);
    const hypercoreSpotUsdcUsd = roundUsd(toNonNegativeFinite(hypercoreSpotUsdcRaw), 6);
    const unrealizedPnlUsd = sumHyperliquidUnrealizedPnlUsd(hypercoreState);
    const totalVaultValueUsd = roundUsd(evmUsdcBalanceUsd + hypercoreAccountValueUsd + hypercoreSpotUsdcUsd, 6);
    const effectivePrincipalOutstandingUsd = formatUsdAtomicToNumber(effectivePrincipalOutstandingRaw);
    const claimableProfitUsd = roundUsd(
      Math.max(0, totalVaultValueUsd - effectivePrincipalOutstandingUsd - unrealizedPnlUsd),
      6
    );
    const claimableProfitRaw = toAtomicUsd(claimableProfitUsd);
    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    if (claimableProfitRaw <= 0n) {
      if (params.allowEmptyClaim === true) {
        return {
          botVaultId: String(botVault.id),
          vaultAddress,
          onchainBotVaultAddress: vaultAddress,
          status,
          claimableProfitRaw,
          requestedAmountRaw: 0n,
          feeRatePctRaw,
          feeAmountRaw: 0n,
          treasuryRecipientRaw: null,
          excludedPrincipalUsd,
          usdcAddress,
          controllerClient,
          evmUsdcBalanceRaw
        };
      }
      throw new Error("claim_profit_unavailable:no_claimable_profit");
    }

    const requestedAmountRaw = params.amountUsd != null
      ? toAtomicUsd(params.amountUsd)
      : claimableProfitRaw;
    if (requestedAmountRaw <= 0n) {
      throw new Error("invalid_amount_usd");
    }
    if (requestedAmountRaw > claimableProfitRaw) {
      throw new Error("claim_profit_unavailable:amount_exceeds_claimable_profit");
    }

    const feeAmountRaw = (requestedAmountRaw * feeRatePctRaw) / 100n;
    const treasuryRecipientRaw = feeAmountRaw > 0n
      ? await publicClient.readContract({
          address: factoryAddress,
          abi: botVaultFactoryV3Abi,
          functionName: "treasuryRecipient"
        }) as `0x${string}`
      : null;

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      status,
      claimableProfitRaw,
      requestedAmountRaw,
      feeRatePctRaw,
      feeAmountRaw,
      treasuryRecipientRaw,
      excludedPrincipalUsd,
      usdcAddress,
      controllerClient,
      evmUsdcBalanceRaw
    };
  }

  async function settleClaimProfitToEvm(params: {
    userId: string;
    botVaultId: string;
    vaultAddress: `0x${string}`;
    onchainStatus: string;
    requiredAmountUsd: number;
    currentEvmBalanceUsd: number;
  }): Promise<void> {
    const shortfallUsd = roundUsd(Math.max(0, params.requiredAmountUsd - params.currentEvmBalanceUsd), 6);
    if (shortfallUsd <= 0.000001) return;

    const context = await loadExecutionCloseoutContext({
      userId: params.userId,
      botVaultId: params.botVaultId
    });
    if (!context) throw new Error("bot_vault_not_found");

    const executionAccount = await resolveExecutionCloseoutAccount(context);
    const adapter = createPerpExecutionAdapterImpl(executionAccount);
    const adapterAny = adapter as any;

    try {
      let spotUsdcUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => 0);
      if (spotUsdcUsd + 0.000001 < shortfallUsd) {
        if (typeof adapterAny.transferUsdClass !== "function") {
          throw new Error("claim_profit_unavailable:hypercore_transfer_unavailable");
        }
        const neededFromPerpUsd = roundUsd(Math.max(0, shortfallUsd - spotUsdcUsd), 6);
        const accountState = typeof adapter?.getAccountState === "function"
          ? await retryHyperliquidTransient(
              "claim_profit_get_account_state",
              async () => {
                const result = await adapter.getAccountState();
                return result as { availableMargin?: unknown } | null;
              }
            ).catch(() => null)
          : null;
        const withdrawableUsd = roundUsd(toNonNegativeFinite(accountState?.availableMargin), 6);
        if (withdrawableUsd + 0.000001 < neededFromPerpUsd) {
          throw new Error("claim_profit_unavailable:insufficient_hypercore_withdrawable");
        }
        await retryHyperliquidTransient(
          "claim_profit_transfer_usd_class_to_spot",
          async () => {
            const result = await adapterAny.transferUsdClass({
              amountUsd: neededFromPerpUsd,
              toPerp: false
            });
            if (result?.status !== "confirmed") {
              throw new Error(result?.errorMessage ?? result?.errorCode ?? "claim_profit_unavailable:transfer_usd_class_not_confirmed");
            }
            return result;
          }
        );
        await sleepImpl(750);
        spotUsdcUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => 0);
      }

      const transferToEvmUsd = roundUsd(Math.min(shortfallUsd, spotUsdcUsd), 6);
      if (transferToEvmUsd <= 0.000001) {
        throw new Error("claim_profit_unavailable:no_hypercore_spot_usdc");
      }
      if (typeof adapterAny.transferUsdcSpotToEvm !== "function") {
        throw new Error("claim_profit_unavailable:spot_to_evm_transfer_unavailable");
      }

      await retryHyperliquidTransient(
        "claim_profit_ensure_exit_gas",
        () => ensureHypercoreExitGas({
          account: executionAccount,
          vaultAddress: params.vaultAddress,
          onchainStatus: params.onchainStatus
        })
      );

      await retryHyperliquidTransient(
        "claim_profit_transfer_usdc_spot_to_evm",
        async () => {
          const result = await adapterAny.transferUsdcSpotToEvm({
            amountUsd: transferToEvmUsd
          });
          if (result?.status !== "confirmed") {
            throw new Error(result?.errorMessage ?? result?.errorCode ?? "claim_profit_unavailable:transfer_spot_to_evm_not_confirmed");
          }
          return result;
        }
      );
      await sleepImpl(750);
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function previewClaimProfit(params: PreviewClaimProfitParams): Promise<BotVaultV3ClaimProfitPreview> {
    const quote = await loadClaimProfitQuote({
      ...params,
      allowEmptyClaim: true
    });
    return {
      botVaultId: quote.botVaultId,
      vaultAddress: quote.vaultAddress,
      onchainBotVaultAddress: quote.onchainBotVaultAddress,
      status: quote.status,
      maxClaimableUsd: formatUsdAtomicToNumber(quote.claimableProfitRaw),
      requestedAmountUsd: formatUsdAtomicToNumber(quote.requestedAmountRaw),
      feeRatePct: Number(quote.feeRatePctRaw),
      feeAmountUsd: formatUsdAtomicToNumber(quote.feeAmountRaw),
      netAmountUsd: roundUsd(
        Math.max(
          0,
          formatUsdAtomicToNumber(quote.requestedAmountRaw) - formatUsdAtomicToNumber(quote.feeAmountRaw)
        ),
        6
      ),
      excludedPrincipalUsd: roundUsd(quote.excludedPrincipalUsd, 6),
      treasuryRecipient: toNullableString(quote.treasuryRecipientRaw)
    };
  }

  async function claimProfit(params: ClaimProfitParams): Promise<BotVaultV3ClaimProfitResult> {
    let quote = await loadClaimProfitQuote(params);
    const {
      botVaultId,
      vaultAddress,
      requestedAmountRaw,
      usdcAddress
    } = quote;
    const requestedAmountUsd = formatUsdAtomicToNumber(requestedAmountRaw);

    if (formatUsdAtomicToNumber(quote.evmUsdcBalanceRaw) + 0.000001 < requestedAmountUsd) {
      await settleClaimProfitToEvm({
        userId: params.userId,
        botVaultId,
        vaultAddress: vaultAddress as `0x${string}`,
        onchainStatus: quote.status,
        requiredAmountUsd: requestedAmountUsd,
        currentEvmBalanceUsd: formatUsdAtomicToNumber(quote.evmUsdcBalanceRaw)
      });
      quote = await loadClaimProfitQuote(params);
    }

    const {
      feeAmountRaw,
      feeRatePctRaw,
      treasuryRecipientRaw,
      excludedPrincipalUsd,
      controllerClient
    } = quote;
    const { account, chain, publicClient, walletClient } = controllerClient;

    const claimTxHash = await sendSerializedControllerTransaction({
      account,
      chain,
      publicClient,
      walletClient
    }, {
      to: vaultAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "claimProfit",
        args: [requestedAmountRaw, feeAmountRaw, 0n]
      })
    });
    const claimReceipt = await publicClient.waitForTransactionReceipt({
      hash: claimTxHash as `0x${string}`,
      confirmations: 1
    });
    if (claimReceipt.status !== "success") {
      throw new Error("bot_vault_v3_claim_profit_tx_failed");
    }

    const claimSettlementSourceKey = buildBotVaultV3ClaimSettlementSourceKey(botVaultId, String(claimTxHash));
    const claimSettlement = await persistBotVaultV3ClaimSettlementState({
      botVaultId,
      settlement: {
        sourceAction: "claim_profit",
        sourceKey: claimSettlementSourceKey,
        feeEventSourceKey: `${claimSettlementSourceKey}:fee_event`,
        claimTxHash: String(claimTxHash),
        feeRatePct: Number(feeRatePctRaw),
        treasuryRecipient: toNullableString(treasuryRecipientRaw),
        grossAmountUsd: formatUsdAtomicToNumber(requestedAmountRaw),
        feeAmountUsd: formatUsdAtomicToNumber(feeAmountRaw),
        excludedPrincipalUsd,
        lastError: null,
        postProcessing: buildBotVaultV3SettlementPostProcessingState({
          state: "pending",
          pendingSteps: formatUsdAtomicToNumber(feeAmountRaw) > 0
            ? ["resync", "apply", "fee_event"]
            : ["resync", "apply"],
          lastError: null
        })
      },
      stage: "confirmed",
      lastError: null
    });

    let postProcessingStage: BotVaultV3ClaimProfitResult["postProcessingStage"] = "pending";
    let postProcessingReason: string | null = "claim_profit_post_processing_pending";
    try {
      const postClaimSnapshot = await readBotVaultV3OnchainSnapshot({
        publicClient,
        vaultAddress: vaultAddress as `0x${string}`,
        usdcAddress
      });
      const resumedSettlement = await resumeBotVaultV3ClaimSettlementPostProcessing({
        botVaultId,
        settlement: claimSettlement,
        snapshot: postClaimSnapshot
      });
      postProcessingStage = resumedSettlement?.postProcessing.state === "complete" ? "applied" : "pending";
      postProcessingReason = resumedSettlement?.postProcessing.lastError ?? null;
    } catch (error) {
      const reason = String(error);
      const latestSettlement = await readBotVaultV3ClaimSettlementById(botVaultId);
      await markBotVaultV3ClaimSettlementPostProcessingPending({
        botVaultId,
        settlement: latestSettlement?.sourceKey === claimSettlement.sourceKey ? latestSettlement : claimSettlement,
        pendingSteps: latestSettlement?.sourceKey === claimSettlement.sourceKey
          ? latestSettlement.postProcessing.pendingSteps
          : claimSettlement.postProcessing.pendingSteps,
        lastError: reason
      });
      logger.warn("bot_vault_v3_claim_profit_post_processing_pending", {
        userId: params.userId,
        botVaultId,
        claimTxHash: String(claimTxHash),
        reason
      });
      postProcessingReason = reason;
    }

    return {
      botVaultId,
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      claimTxHash,
      grossAmountAtomic: requestedAmountRaw.toString(),
      feeAmountAtomic: feeAmountRaw.toString(),
      principalPortionAtomic: "0",
      postProcessingStage,
      postProcessingReason
    };
  }

  async function readCoreUsdcSpotBalanceFromAdapter(adapter: any): Promise<number> {
    if (typeof adapter?.getCoreUsdcSpotBalance !== "function") return 0;
    const balance = await retryHyperliquidTransient(
      "get_core_usdc_spot_balance",
      async () => {
        const result = await adapter.getCoreUsdcSpotBalance();
        return result as { amountUsd?: unknown } | null;
      }
    );
    return Math.max(0, Number(balance?.amountUsd ?? 0));
  }

  async function readPerpAccountStateFromAdapter(adapter: any): Promise<{
    availableMarginUsd: number;
    equityUsd: number;
  }> {
    if (typeof adapter?.getAccountState !== "function") {
      throw new Error("bot_vault_v3_perp_account_state_unavailable");
    }
    const accountState = await retryHyperliquidTransient(
      "get_perp_account_state",
      async () => {
        const result = await adapter.getAccountState();
        return result as { availableMargin?: unknown; equity?: unknown } | null;
      }
    );
    return {
      availableMarginUsd: roundUsd(Math.max(0, Number(accountState?.availableMargin ?? 0)), 6),
      equityUsd: roundUsd(Math.max(0, Number(accountState?.equity ?? 0)), 6)
    };
  }

  function buildReduceMarginVerification(params: {
    releasedAmountUsd: number;
    coreSpotBalanceBeforeUsd: number;
    coreSpotBalanceAfterUsd: number | null;
    perpAccountStateAfter: { availableMarginUsd: number; equityUsd: number } | null;
    transferStatus?: unknown;
  }): {
    expectedCoreSpotAfterUsd: number;
    transferObserved: boolean;
    finalPerpStateReadable: boolean;
    reductionVerified: boolean;
    verificationState: "reduction_verified" | "transfer_observed" | "transfer_submitted";
    verificationBlockingReason: string | null;
  } {
    const expectedCoreSpotAfterUsd = roundUsd(
      params.coreSpotBalanceBeforeUsd + params.releasedAmountUsd,
      6
    );
    const transferObserved =
      params.coreSpotBalanceAfterUsd != null
      && roundUsd(params.coreSpotBalanceAfterUsd, 6) + USD_VERIFICATION_EPSILON >= expectedCoreSpotAfterUsd;
    const finalPerpStateReadable = params.perpAccountStateAfter != null;
    const transferStatus = String(params.transferStatus ?? "unknown").trim().toLowerCase() || "unknown";
    const transferConfirmed = transferStatus === "confirmed";
    const reductionVerified = transferConfirmed && transferObserved && finalPerpStateReadable;
    const verificationState =
      reductionVerified
        ? "reduction_verified"
        : transferObserved
          ? "transfer_observed"
          : "transfer_submitted";
    const verificationBlockingReason = reductionVerified
      ? null
      : !transferConfirmed
        ? `transfer_${transferStatus}`
        : !transferObserved
          ? "transfer_not_yet_observed"
          : !finalPerpStateReadable
            ? "perp_state_read_unavailable"
            : "reduce_margin_verification_incomplete";
    return {
      expectedCoreSpotAfterUsd,
      transferObserved,
      finalPerpStateReadable,
      reductionVerified,
      verificationState,
      verificationBlockingReason
    };
  }

  async function finalizeMarginAdd(params: FinalizeMarginAddParams): Promise<BotVaultV3FinalizeMarginAddResult> {
    const requestedAmountUsd = roundUsd(toNonNegativeNumber(params.amountUsd, 0), 6);
    if (requestedAmountUsd <= 0) throw new Error("amount_required");

    const botVault = await findBotVaultRecordById({
      userId: params.userId,
      botVaultId: params.botVaultId,
      select: {
        id: true,
        vaultAddress: true,
        controllerAddress: true,
        fundingStatus: true,
        executionMetadata: true,
        hypercoreFundingStatus: true,
        executionStatus: true,
        status: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");

    const context = await loadExecutionCloseoutContext({
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
    if (!context) throw new Error("bot_vault_not_found");

    const account = await resolveExecutionCloseoutAccount(context);
    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;
    const { account: controllerAccount, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);

    let activateTxHash: string | null = null;
    let depositTxHash: string | null = null;
    let pauseTxHash: string | null = null;
    let restoredPaused = false;

    try {
      const statusRaw = await publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      });
      const initialStatus = statusIndexToLabel(statusRaw);
      let currentStatus = initialStatus;

      if (initialStatus === "PAUSED" || initialStatus === "FUNDED") {
        activateTxHash = await sendSerializedControllerTransaction({
          account: controllerAccount,
          chain,
          publicClient,
          walletClient
        }, {
          to: vaultAddress as `0x${string}`,
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
        if (activateReceipt.status !== "success") {
          throw new Error("bot_vault_v3_margin_add_activate_tx_failed");
        }
        currentStatus = "ACTIVE";
      }

      if (currentStatus !== "ACTIVE") {
        throw new Error(`bot_vault_v3_margin_add_invalid_status:${currentStatus}`);
      }

      const coreSpotBalanceBeforeUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => 0);
      const perpAccountStateBefore = await readPerpAccountStateFromAdapter(adapter).catch(() => null);
      const missingHypercoreFundingUsd = roundUsd(
        Math.max(0, requestedAmountUsd - coreSpotBalanceBeforeUsd),
        6
      );

      if (missingHypercoreFundingUsd > 0.000001) {
        const evmBalanceRaw = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [vaultAddress as `0x${string}`]
        }) as bigint;
        const evmBalanceUsd = formatUsdAtomicToNumber(evmBalanceRaw);
        if (evmBalanceUsd + 0.000001 < missingHypercoreFundingUsd) {
          throw new Error(`bot_vault_v3_margin_add_insufficient_evm_balance:${String(evmBalanceUsd)}`);
        }
        depositTxHash = await sendSerializedControllerTransaction({
          account: controllerAccount,
          chain,
          publicClient,
          walletClient
        }, {
          to: vaultAddress as `0x${string}`,
          data: encodeFunctionData({
            abi: botVaultV3Abi,
            functionName: "depositUsdcToHyperCore",
            args: [toAtomicUsd(missingHypercoreFundingUsd)]
          })
        });
        const depositReceipt = await publicClient.waitForTransactionReceipt({
          hash: depositTxHash as `0x${string}`,
          confirmations: 1
        });
        if (depositReceipt.status !== "success") {
          throw new Error("bot_vault_v3_margin_add_deposit_tx_failed");
        }
        await sleepImpl(750);
      }

      if (typeof adapterAny.transferUsdClass !== "function") {
        throw new Error("bot_vault_v3_margin_transfer_unavailable");
      }

      const transferToPerpResult = await retryHyperliquidTransient(
        "transfer_usd_class_to_perp",
        async () => (
          await adapterAny.transferUsdClass({
            amountUsd: requestedAmountUsd,
            toPerp: true
          })
        ) as {
          status?: "confirmed" | "failed" | "pending_timeout" | string;
          submitted?: boolean;
          confirmationSource?: string;
          receiptStatus?: string;
          txHash?: string;
          errorCode?: string;
          errorMessage?: string;
        } | null
      );
      const transferConfirmed = transferToPerpResult?.status === "confirmed";
      if (transferToPerpResult?.status === "failed") {
        throw new Error(
          transferToPerpResult.errorMessage
          ?? transferToPerpResult.errorCode
          ?? "bot_vault_v3_margin_add_transfer_to_perp_failed"
        );
      }

      const coreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => null);
      const perpAccountStateAfter = await readPerpAccountStateFromAdapter(adapter).catch(() => null);

      if (initialStatus === "PAUSED") {
        try {
          pauseTxHash = await sendSerializedControllerTransaction({
            account: controllerAccount,
            chain,
            publicClient,
            walletClient
          }, {
            to: vaultAddress as `0x${string}`,
            data: encodeFunctionData({
              abi: parseAbi(["function pause()"]),
              functionName: "pause",
              args: []
            })
          });
          const pauseReceipt = await publicClient.waitForTransactionReceipt({
            hash: pauseTxHash as `0x${string}`,
            confirmations: 1
          });
          restoredPaused = pauseReceipt.status === "success";
        } catch (error) {
          logger.warn("bot_vault_v3_margin_add_restore_pause_failed", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            error: String(error)
          });
        }
      }

      const expectedCoreSpotAvailableBeforeTransferUsd = roundUsd(
        coreSpotBalanceBeforeUsd + missingHypercoreFundingUsd,
        6
      );
      const expectedCoreSpotAfterUsd = roundUsd(
        Math.max(0, expectedCoreSpotAvailableBeforeTransferUsd - requestedAmountUsd),
        6
      );
      const transferObserved =
        coreSpotBalanceAfterUsd != null
        && coreSpotBalanceAfterUsd <= expectedCoreSpotAfterUsd + USD_VERIFICATION_EPSILON;
      const finalPerpStateReadable = perpAccountStateAfter != null;
      const pauseStateSafe = initialStatus !== "PAUSED" || restoredPaused;

      const postResyncSnapshot = await resyncBotVaultV3StateFromChain({
        botVaultId: String(botVault.id),
        vaultAddress: vaultAddress as `0x${string}`,
        publicClient,
        usdcAddress
      }).catch(() => null);
      const finalStateResynced = postResyncSnapshot !== null;
      const fundingVerified =
        transferConfirmed
        && transferObserved
        && finalPerpStateReadable
        && finalStateResynced
        && pauseStateSafe;
      const verificationState =
        fundingVerified
          ? "funding_verified"
          : transferObserved
            ? "transfer_observed"
            : "transfer_submitted";
      const verificationBlockingReason = fundingVerified
        ? null
        : !transferConfirmed
          ? `transfer_${String(transferToPerpResult?.status ?? "unknown")}`
          : !transferObserved
            ? "transfer_not_yet_observed"
            : !finalPerpStateReadable
              ? "perp_state_read_unavailable"
              : !finalStateResynced
                ? "final_state_resync_unavailable"
                : !pauseStateSafe
                  ? "paused_restore_unconfirmed"
                  : "funding_verification_incomplete";
      const lifecycleTargetStage: BotVaultV3FundingLifecycleStage = fundingVerified
        ? "execution_ready"
        : "perp_margin_transferred";
      const lifecyclePatch = buildBotVaultV3FundingLifecycleTransitionPatch({
        row: botVault,
        targetStage: lifecycleTargetStage,
        source: "finalize_margin_add",
        reason: fundingVerified ? "perp_margin_verified" : "perp_margin_transfer_submitted",
        detail: verificationBlockingReason,
        metadataPatch: {
          lastAction: fundingVerified
            ? "bot_vault_v3_margin_add_verified"
            : verificationState === "transfer_observed"
              ? "bot_vault_v3_margin_add_observed"
              : "bot_vault_v3_margin_add_submitted",
          marginAddFinalization: {
            requestedAmountUsd,
            depositedAmountUsd: missingHypercoreFundingUsd,
            transferToPerpAmountUsd: requestedAmountUsd,
            activateTxHash,
            depositTxHash,
            pauseTxHash,
            restoredPaused,
            initialStatus,
            finalStatusObserved: postResyncSnapshot?.status ?? null,
            transferResultStatus: String(transferToPerpResult?.status ?? "unknown"),
            transferSubmitted: transferToPerpResult?.submitted === true,
            transferConfirmationSource: String(transferToPerpResult?.confirmationSource ?? "none"),
            transferReceiptStatus: String(transferToPerpResult?.receiptStatus ?? "unknown"),
            transferTxHash: toNullableString(transferToPerpResult?.txHash),
            transferObserved,
            fundingVerified,
            verificationState,
            verificationBlockingReason,
            finalPerpStateReadable,
            finalStateResynced,
            pauseStateSafe,
            coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
            coreSpotExpectedAfterUsd: expectedCoreSpotAfterUsd,
            coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6),
            perpAvailableMarginBeforeUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
            perpAvailableMarginAfterUsd: perpAccountStateAfter?.availableMarginUsd ?? null,
            perpEquityBeforeUsd: perpAccountStateBefore?.equityUsd ?? null,
            perpEquityAfterUsd: perpAccountStateAfter?.equityUsd ?? null,
            verifiedAt: fundingVerified ? new Date().toISOString() : null,
            updatedAt: new Date().toISOString()
          }
        }
      });
      await persistBotVaultV3StateOrThrow({
        botVaultId: String(botVault.id),
        data: lifecyclePatch,
        operation: "margin_add",
        phase: "post_transfer_verification",
        meta: {
          userId: params.userId
        }
      });
      if (!fundingVerified) {
        logger.warn("bot_vault_v3_margin_add_verification_incomplete", {
          userId: params.userId,
          botVaultId: String(botVault.id),
          verificationState,
          verificationBlockingReason,
          transferStatus: transferToPerpResult?.status ?? null,
          transferObserved,
          finalPerpStateReadable,
          finalStateResynced,
          pauseStateSafe
        });
      }

      return {
        botVaultId: String(botVault.id),
        vaultAddress,
        onchainBotVaultAddress: vaultAddress,
        requestedAmountUsd,
        depositedAmountUsd: missingHypercoreFundingUsd,
        transferToPerpAmountUsd: requestedAmountUsd,
        coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
        coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6),
        activateTxHash,
        depositTxHash,
        pauseTxHash,
        restoredPaused
      };
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function reduceMargin(params: ReduceMarginParams): Promise<BotVaultV3ReduceMarginResult> {
    const releasedAmountUsd = roundUsd(toNonNegativeNumber(params.amountUsd, 0), 6);
    if (releasedAmountUsd <= 0) throw new Error("amount_required");

    const botVault = await findBotVaultRecordById({
      userId: params.userId,
      botVaultId: params.botVaultId,
      select: {
        id: true,
        vaultAddress: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    const vaultAddress = toNullableString(botVault.vaultAddress);
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    const currentMetadata = toRecord(botVault.executionMetadata);
    const existingReduceMarginFinalization = deriveStoredReduceMarginState(botVault.executionMetadata);

    const context = await loadExecutionCloseoutContext({
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
    if (!context) throw new Error("bot_vault_not_found");
    const account = await resolveExecutionCloseoutAccount(context);
    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;

    try {
      if (typeof adapterAny.transferUsdClass !== "function") {
        throw new Error("bot_vault_v3_margin_transfer_unavailable");
      }
      const coreSpotBalanceBeforeUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => 0);
      const perpAccountStateBefore = await readPerpAccountStateFromAdapter(adapter).catch(() => null);
      const existingStage = String(existingReduceMarginFinalization.stage ?? "").trim().toLowerCase();
      const existingReleasedAmountUsd = roundUsd(toNonNegativeNumber(existingReduceMarginFinalization.releasedAmountUsd), 6);
      const hasPendingReduceMargin =
        Object.keys(existingReduceMarginFinalization).length > 0
        && existingStage !== "observed"
        && existingStage !== "verified"
        && existingStage !== "failed";
      if (hasPendingReduceMargin) {
        if (hasUsdDrift(existingReleasedAmountUsd, releasedAmountUsd)) {
          throw new Error("bot_vault_v3_reduce_margin_pending_conflict");
        }
        const resumedCoreSpotBalanceBeforeUsd = roundUsd(
          toNonNegativeNumber(existingReduceMarginFinalization.coreSpotBalanceBeforeUsd, coreSpotBalanceBeforeUsd),
          6
        );
        const resumedCoreSpotBalanceAfterUsd = roundUsd(coreSpotBalanceBeforeUsd, 6);
        const resumedVerification = buildReduceMarginVerification({
          releasedAmountUsd,
          coreSpotBalanceBeforeUsd: resumedCoreSpotBalanceBeforeUsd,
          coreSpotBalanceAfterUsd: resumedCoreSpotBalanceAfterUsd,
          perpAccountStateAfter: perpAccountStateBefore,
          transferStatus: existingReduceMarginFinalization.transferResultStatus ?? existingStage
        });
        await persistBotVaultV3StateOrThrow({
          botVaultId: String(botVault.id),
          operation: "reduce_margin",
          phase: "resume_pending",
          meta: {
            userId: params.userId
          },
          data: {
            executionMetadata: {
              ...currentMetadata,
              lastAction: resumedVerification.reductionVerified
                ? "bot_vault_v3_reduce_margin_verified"
                : resumedVerification.verificationState === "transfer_observed"
                  ? "bot_vault_v3_reduce_margin_observed"
                  : "bot_vault_v3_reduce_margin_submitted",
              reduceMarginFinalization: {
                ...existingReduceMarginFinalization,
                releasedAmountUsd,
                coreSpotBalanceBeforeUsd: resumedCoreSpotBalanceBeforeUsd,
                coreSpotExpectedAfterUsd: resumedVerification.expectedCoreSpotAfterUsd,
                coreSpotBalanceAfterUsd: resumedCoreSpotBalanceAfterUsd,
                perpAvailableMarginBeforeUsd: existingReduceMarginFinalization.perpAvailableMarginBeforeUsd ?? perpAccountStateBefore?.availableMarginUsd ?? null,
                perpAvailableMarginAfterUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
                perpEquityBeforeUsd: existingReduceMarginFinalization.perpEquityBeforeUsd ?? perpAccountStateBefore?.equityUsd ?? null,
                perpEquityAfterUsd: perpAccountStateBefore?.equityUsd ?? null,
                transferObserved: resumedVerification.transferObserved,
                finalPerpStateReadable: resumedVerification.finalPerpStateReadable,
                verificationState: resumedVerification.verificationState,
                verificationBlockingReason: resumedVerification.verificationBlockingReason,
                stage: resumedVerification.reductionVerified
                  ? "verified"
                  : resumedVerification.transferObserved
                    ? "observed"
                    : "submitted",
                observedAt: resumedVerification.transferObserved
                  ? toNullableString(existingReduceMarginFinalization.observedAt) ?? new Date().toISOString()
                  : null,
                verifiedAt: resumedVerification.reductionVerified ? new Date().toISOString() : null,
                resumedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            }
          }
        });
        if (!resumedVerification.reductionVerified) {
          logger.warn("bot_vault_v3_reduce_margin_verification_incomplete", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            verificationState: resumedVerification.verificationState,
            verificationBlockingReason: resumedVerification.verificationBlockingReason,
            resumed: true,
            transferStatus: existingReduceMarginFinalization.transferResultStatus ?? existingStage,
            transferObserved: resumedVerification.transferObserved,
            finalPerpStateReadable: resumedVerification.finalPerpStateReadable
          });
        }
        await reconcileBotVaultV3ById({
          userId: params.userId,
          botVaultId: String(botVault.id),
          persist: true
        }).catch((error) => {
          logger.warn("bot_vault_v3_reduce_margin_reconcile_failed", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            phase: "resume_pending",
            error: String(error)
          });
          return null;
        });
        return {
          botVaultId: String(botVault.id),
          vaultAddress,
          onchainBotVaultAddress: vaultAddress,
          releasedAmountUsd,
          coreSpotBalanceBeforeUsd: resumedCoreSpotBalanceBeforeUsd,
          coreSpotBalanceAfterUsd: resumedCoreSpotBalanceAfterUsd,
          verificationState: resumedVerification.verificationState,
          verificationBlockingReason: resumedVerification.verificationBlockingReason,
          transferResultStatus: String(existingReduceMarginFinalization.transferResultStatus ?? (existingStage || "unknown")),
          finalPerpStateReadable: resumedVerification.finalPerpStateReadable
        };
      }
      await persistBotVaultV3StateOrThrow({
        botVaultId: String(botVault.id),
        operation: "reduce_margin",
        phase: "submitted",
        meta: {
          userId: params.userId
        },
        data: {
          executionMetadata: {
            ...currentMetadata,
            lastAction: "bot_vault_v3_reduce_margin_submitted",
            reduceMarginFinalization: {
              releasedAmountUsd,
              coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
              coreSpotExpectedAfterUsd: roundUsd(coreSpotBalanceBeforeUsd + releasedAmountUsd, 6),
              coreSpotBalanceAfterUsd: null,
              perpAvailableMarginBeforeUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
              perpAvailableMarginAfterUsd: null,
              perpEquityBeforeUsd: perpAccountStateBefore?.equityUsd ?? null,
              perpEquityAfterUsd: null,
              stage: "submitted",
              requestedAt: new Date().toISOString(),
              transferObserved: false,
              finalPerpStateReadable: false,
              verificationState: "transfer_submitted",
              verificationBlockingReason: "transfer_submitted",
              updatedAt: new Date().toISOString()
            }
          }
        }
      });
      const transferResult: any = await retryHyperliquidTransient(
        "transfer_usd_class_to_spot",
        () => adapterAny.transferUsdClass({
          amountUsd: releasedAmountUsd,
          toPerp: false
        })
      ).catch(async (error) => {
        await persistBotVaultV3StateOrThrow({
          botVaultId: String(botVault.id),
          operation: "reduce_margin",
          phase: "failed",
          meta: {
            userId: params.userId
          },
          data: {
            executionMetadata: {
              ...currentMetadata,
              lastAction: "bot_vault_v3_reduce_margin_failed",
              reduceMarginFinalization: {
                releasedAmountUsd,
                coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
                coreSpotExpectedAfterUsd: roundUsd(coreSpotBalanceBeforeUsd + releasedAmountUsd, 6),
                coreSpotBalanceAfterUsd: null,
                perpAvailableMarginBeforeUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
                perpAvailableMarginAfterUsd: null,
                perpEquityBeforeUsd: perpAccountStateBefore?.equityUsd ?? null,
                perpEquityAfterUsd: null,
                stage: "failed",
                requestedAt: new Date().toISOString(),
                transferObserved: false,
                finalPerpStateReadable: false,
                verificationState: "transfer_submitted",
                verificationBlockingReason: "transfer_failed",
                transferResultStatus: "failed",
                error: String(error),
                updatedAt: new Date().toISOString()
              }
            }
          }
        });
        throw error;
      });
      const coreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny).catch(() => null);
      const perpAccountStateAfter = await readPerpAccountStateFromAdapter(adapter).catch(() => null);
      const verification = buildReduceMarginVerification({
        releasedAmountUsd,
        coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
        coreSpotBalanceAfterUsd,
        perpAccountStateAfter,
        transferStatus: transferResult?.status
      });
      await persistBotVaultV3StateOrThrow({
        botVaultId: String(botVault.id),
        operation: "reduce_margin",
        phase: "post_transfer_verification",
        meta: {
          userId: params.userId
        },
        data: {
          executionMetadata: {
            ...currentMetadata,
            lastAction: verification.reductionVerified
              ? "bot_vault_v3_reduce_margin_verified"
              : verification.verificationState === "transfer_observed"
                ? "bot_vault_v3_reduce_margin_observed"
                : "bot_vault_v3_reduce_margin_submitted",
            reduceMarginFinalization: {
              releasedAmountUsd,
              coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
              coreSpotExpectedAfterUsd: verification.expectedCoreSpotAfterUsd,
              coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6),
              perpAvailableMarginBeforeUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
              perpAvailableMarginAfterUsd: perpAccountStateAfter?.availableMarginUsd ?? null,
              perpEquityBeforeUsd: perpAccountStateBefore?.equityUsd ?? null,
              perpEquityAfterUsd: perpAccountStateAfter?.equityUsd ?? null,
              transferResultStatus: String(transferResult?.status ?? "unknown"),
              transferSubmitted: transferResult?.submitted === true,
              transferConfirmationSource: String(transferResult?.confirmationSource ?? "none"),
              transferReceiptStatus: String(transferResult?.receiptStatus ?? "unknown"),
              transferTxHash: toNullableString(transferResult?.txHash),
              transferObserved: verification.transferObserved,
              finalPerpStateReadable: verification.finalPerpStateReadable,
              verificationState: verification.verificationState,
              verificationBlockingReason: verification.verificationBlockingReason,
              stage: verification.reductionVerified
                ? "verified"
                : verification.transferObserved
                  ? "observed"
                  : "submitted",
              requestedAt: new Date().toISOString(),
              observedAt: verification.transferObserved ? new Date().toISOString() : null,
              verifiedAt: verification.reductionVerified ? new Date().toISOString() : null,
              updatedAt: new Date().toISOString()
            }
          }
        }
      });
      if (!verification.reductionVerified) {
        logger.warn("bot_vault_v3_reduce_margin_verification_incomplete", {
          userId: params.userId,
          botVaultId: String(botVault.id),
          verificationState: verification.verificationState,
          verificationBlockingReason: verification.verificationBlockingReason,
          transferStatus: transferResult?.status ?? null,
          transferObserved: verification.transferObserved,
          finalPerpStateReadable: verification.finalPerpStateReadable
        });
      }
      await reconcileBotVaultV3ById({
        userId: params.userId,
        botVaultId: String(botVault.id),
        persist: true
      }).catch((error) => {
        logger.warn("bot_vault_v3_reduce_margin_reconcile_failed", {
          userId: params.userId,
          botVaultId: String(botVault.id),
          phase: "post_transfer_verification",
          error: String(error)
        });
        return null;
      });
      return {
        botVaultId: String(botVault.id),
        vaultAddress,
        onchainBotVaultAddress: vaultAddress,
        releasedAmountUsd,
        coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
        coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6),
        verificationState: verification.verificationState,
        verificationBlockingReason: verification.verificationBlockingReason,
        transferResultStatus: String(transferResult?.status ?? "unknown"),
        finalPerpStateReadable: verification.finalPerpStateReadable
      };
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
  }

  async function endBotVault(params: EndBotVaultParams) {
    const bot = await db.bot.findFirst({
      where: {
        id: params.botId,
        userId: params.userId
      },
      select: { id: true }
    });
    if (!bot) throw new Error("bot_not_found");

    const botVault = await findBotVaultRecordForBot({
      userId: params.userId,
      botId: params.botId,
      select: { id: true }
    });
    if (!botVault?.id) return null;
    return controllerCloseBotVault({
      userId: params.userId,
      botVaultId: String(botVault.id)
    });
  }

  async function controllerCloseBotVault(
    params: ControllerCloseBotVaultParams
  ): Promise<BotVaultV3ControllerCloseResult> {
    const botVault = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId,
        vaultModel: "bot_vault_v3"
      },
      select: {
        id: true,
        vaultAddress: true,
        controllerAddress: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");
    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");
    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);
    const [statusBeforeRaw, principalDepositedRaw, principalReturnedRaw, feePaidTotalBeforeRaw, factoryAddress, usdcBalanceBeforeRaw, excludedPrincipalUsd] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      }),
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalDeposited"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalReturned"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "feePaidTotal"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "factory"
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as Promise<bigint>,
      readHypercoreAccountingFeeUsdForBotVault({
        botVaultId: String(botVault.id),
        executionMetadata: botVault.executionMetadata
      })
    ]);
    const statusBefore = statusIndexToLabel(statusBeforeRaw);
    const preCloseSnapshot: BotVaultV3OnchainSnapshot = {
      status: statusBefore,
      principalAllocated: formatUsdAtomicToNumber(principalDepositedRaw),
      principalReturned: formatUsdAtomicToNumber(principalReturnedRaw),
      availableUsd: formatUsdAtomicToNumber(usdcBalanceBeforeRaw),
      feePaidTotal: formatUsdAtomicToNumber(feePaidTotalBeforeRaw)
    };
    const existingCloseSettlement = readBotVaultV3ControllerSettlementState({
      executionMetadata: botVault.executionMetadata,
      metadataKey: "closeSettlement",
      sourceAction: "close_vault"
    });
    if (
      statusBefore !== "ACTIVE"
      && statusBefore !== "PAUSED"
      && statusBefore !== "FUNDED"
      && statusBefore !== "CLOSE_ONLY"
      && statusBefore !== "CLOSED"
    ) {
      throw new Error(`bot_vault_v3_close_invalid_status:${statusBefore}`);
    }
    let closeOnlyTxHash: string | null = null;
    let statusAfterCloseOnly = statusBefore;
    let currentStatus = statusBefore;

    if (statusBefore === "CLOSED") {
      if (existingCloseSettlement) {
        const resumedSettlement = await resumeBotVaultV3ControllerSettlementPostProcessing({
          botVaultId: String(botVault.id),
          metadataKey: "closeSettlement",
          settlement: existingCloseSettlement,
          snapshot: preCloseSnapshot
        }).catch(async (error) => {
          const reason = String(error);
          const latestSettlement = await readBotVaultV3ControllerSettlementById({
            botVaultId: String(botVault.id),
            metadataKey: "closeSettlement",
            sourceAction: "close_vault"
          });
          await markBotVaultV3ControllerSettlementPendingOrThrow({
            botVaultId: String(botVault.id),
            metadataKey: "closeSettlement",
            settlement: latestSettlement?.sourceKey === existingCloseSettlement.sourceKey ? latestSettlement : existingCloseSettlement,
            lastError: reason,
            flow: "close"
          });
          throw new Error(`bot_vault_v3_close_post_processing_pending:${String(botVault.id)}:${reason}`);
        });
        if (hasPendingBotVaultV3SettlementPostProcessing(resumedSettlement?.postProcessing)) {
          throw new Error(
            `bot_vault_v3_close_post_processing_pending:${String(botVault.id)}:${String(resumedSettlement?.postProcessing.lastError ?? "close_post_processing_pending")}`
          );
        }
      } else {
        await db.botVault.update({
          where: { id: String(botVault.id) },
          data: {
            ...buildBotVaultV3ResyncUpdate(preCloseSnapshot, new Date()),
            executionLastError: null,
            executionLastErrorAt: null
          }
        }).catch((error) => {
          logger.warn("bot_vault_v3_closed_resync_persist_failed", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            error: String(error)
          });
        });
      }
      return {
        botVaultId: String(botVault.id),
        vaultAddress,
        onchainBotVaultAddress: vaultAddress,
        closeOnlyTxHash,
        closeTxHash: existingCloseSettlement?.closeTxHash ?? null,
        onchainStatusBefore: statusBefore,
        onchainStatusAfterCloseOnly: statusAfterCloseOnly,
        principalToReturnAtomic: existingCloseSettlement
          ? toAtomicUsd(existingCloseSettlement.principalReturnedUsd).toString()
          : principalReturnedRaw.toString(),
        grossAmountAtomic: existingCloseSettlement
          ? toAtomicUsd(existingCloseSettlement.grossAmountUsd).toString()
          : "0",
        feeAmountAtomic: existingCloseSettlement
          ? toAtomicUsd(existingCloseSettlement.feeAmountUsd).toString()
          : "0"
      };
    }

    let usdcBalanceRaw = usdcBalanceBeforeRaw;
    let hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);
    if (hypercoreExitCheck.requiresExit && (currentStatus === "PAUSED" || currentStatus === "FUNDED")) {
      const needsExitGasTopUp = await readRequiresHypercoreExitGasTopUp(vaultAddress as `0x${string}`);
      if (needsExitGasTopUp) {
        const activateTxHash = await sendSerializedControllerTransaction({
          account,
          chain,
          publicClient,
          walletClient
        }, {
          to: vaultAddress as `0x${string}`,
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
        if (activateReceipt.status !== "success") {
          throw new Error("bot_vault_v3_activate_for_exit_tx_failed");
        }
        const activatedStatusRaw = await publicClient.readContract({
          address: vaultAddress as `0x${string}`,
          abi: botVaultV3Abi,
          functionName: "status"
        });
        currentStatus = statusIndexToLabel(activatedStatusRaw);
        if (currentStatus !== "ACTIVE") {
          throw new Error(`bot_vault_v3_activate_for_exit_failed:${currentStatus}`);
        }
      }
    }

    if (hypercoreExitCheck.requiresExit && currentStatus === "ACTIVE") {
      await bestEffortSettleHypercoreExit({
        userId: params.userId,
        botVaultId: String(botVault.id),
        onchainStatus: currentStatus
      });
      usdcBalanceRaw = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as bigint;
      hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);
    }

    if (currentStatus === "ACTIVE" || currentStatus === "PAUSED" || currentStatus === "FUNDED") {
      closeOnlyTxHash = await sendSerializedControllerTransaction({
        account,
        chain,
        publicClient,
        walletClient
      }, {
        to: vaultAddress as `0x${string}`,
        data: encodeFunctionData({
          abi: botVaultV3Abi,
          functionName: "setCloseOnly",
          args: []
        })
      });
      const closeOnlyReceipt = await publicClient.waitForTransactionReceipt({
        hash: closeOnlyTxHash as `0x${string}`,
        confirmations: 1
      });
      if (closeOnlyReceipt.status !== "success") {
        throw new Error("bot_vault_v3_close_only_tx_failed");
      }
      const statusAfterCloseOnlyRaw = await publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      });
      statusAfterCloseOnly = statusIndexToLabel(statusAfterCloseOnlyRaw);
      currentStatus = statusAfterCloseOnly;
      if (statusAfterCloseOnly !== "CLOSE_ONLY") {
        throw new Error(`bot_vault_v3_close_only_failed:${statusAfterCloseOnly}`);
      }
    }

    usdcBalanceRaw = await publicClient.readContract({
      address: usdcAddress,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [vaultAddress as `0x${string}`]
    }) as bigint;
    hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);

    if (hypercoreExitCheck.requiresExit) {
      await bestEffortSettleHypercoreExit({
        userId: params.userId,
        botVaultId: String(botVault.id),
        onchainStatus: statusAfterCloseOnly
      });
      usdcBalanceRaw = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as bigint;
      hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);
      if (hypercoreExitCheck.requiresExit) {
        throw formatHypercoreExitRequiredError(hypercoreExitCheck);
      }
    }

    const excludedPrincipalRaw = toAtomicUsd(excludedPrincipalUsd);
    const effectivePrincipalOutstandingRaw = deriveEffectivePrincipalOutstandingRaw({
      principalDepositedRaw,
      principalReturnedRaw,
      excludedPrincipalRaw
    });
    const principalToReturnRaw = effectivePrincipalOutstandingRaw > usdcBalanceRaw
      ? usdcBalanceRaw
      : effectivePrincipalOutstandingRaw;
    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    const profitComponentRaw = usdcBalanceRaw > principalToReturnRaw
      ? usdcBalanceRaw - principalToReturnRaw
      : 0n;
    const feeAmountRaw = (profitComponentRaw * feeRatePctRaw) / 100n;
    const treasuryRecipientRaw = feeAmountRaw > 0n
      ? await publicClient.readContract({
          address: factoryAddress,
          abi: botVaultFactoryV3Abi,
          functionName: "treasuryRecipient"
        }) as `0x${string}`
      : null;
    const grossAmountUsd = formatUsdAtomicToNumber(usdcBalanceRaw);
    const principalReturnedUsd = formatUsdAtomicToNumber(principalToReturnRaw);
    const feeAmountUsd = formatUsdAtomicToNumber(feeAmountRaw);
    const profitComponentUsd = roundUsd(Math.max(0, grossAmountUsd - principalReturnedUsd));
    const netReturnedUsd = roundUsd(Math.max(0, grossAmountUsd - feeAmountUsd));
    const closeSettlementSourceKey = buildBotVaultV3ControllerSettlementSourceKey(
      String(botVault.id),
      "close_vault"
    );
    const closeSettlementPreparedBase = {
      sourceAction: "close_vault" as const,
      sourceKey: closeSettlementSourceKey,
      feeEventSourceKey: `${closeSettlementSourceKey}:fee_event`,
      closeTxHash: null,
      feeRatePct: Number(feeRatePctRaw),
      treasuryRecipient: toNullableString(treasuryRecipientRaw),
      principalReturnedUsd,
      grossAmountUsd,
      feeAmountUsd,
      netReturnedUsd,
      profitComponentUsd,
      excludedPrincipalUsd,
      lastError: null,
      postProcessing: buildBotVaultV3SettlementPostProcessingState({
        state: "not_started",
        pendingSteps: [],
        lastError: null
      })
    };

    await persistBotVaultV3ControllerSettlementState({
      botVaultId: String(botVault.id),
      metadataKey: "closeSettlement",
      settlement: closeSettlementPreparedBase,
      stage: "prepared"
    });

    const closeTxHash = await sendSerializedControllerTransaction({
      account,
      chain,
      publicClient,
      walletClient
    }, {
      to: vaultAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "closeVault",
        args: [principalToReturnRaw, usdcBalanceRaw, feeAmountRaw]
      })
    });
    const closeReceipt = await publicClient.waitForTransactionReceipt({
      hash: closeTxHash as `0x${string}`,
      confirmations: 1
    });
    if (closeReceipt.status !== "success") {
      throw new Error("bot_vault_v3_close_tx_failed");
    }
    const closeSettlementBase = {
      ...closeSettlementPreparedBase,
      closeTxHash: String(closeTxHash),
    };
    await persistBotVaultV3ControllerSettlementState({
      botVaultId: String(botVault.id),
      metadataKey: "closeSettlement",
      settlement: {
        ...closeSettlementBase,
        postProcessing: buildBotVaultV3SettlementPostProcessingState({
          state: "pending",
          pendingSteps: feeAmountUsd > 0 ? ["resync", "apply", "fee_event"] : ["resync", "apply"],
          lastError: null
        })
      },
      stage: "confirmed"
    });

    try {
      const postCloseSnapshot = await resyncBotVaultV3StateFromChain({
        botVaultId: String(botVault.id),
        vaultAddress: vaultAddress as `0x${string}`,
        publicClient,
        usdcAddress
      });
      const resumedSettlement = await resumeBotVaultV3ControllerSettlementPostProcessing({
        botVaultId: String(botVault.id),
        metadataKey: "closeSettlement",
        settlement: {
          ...closeSettlementBase,
          stage: "confirmed",
          preparedAt: null,
          confirmedAt: null,
          appliedAt: null,
          updatedAt: null,
          lastError: null,
          postProcessing: buildBotVaultV3SettlementPostProcessingState({
            state: "pending",
            pendingSteps: feeAmountUsd > 0 ? ["resync", "apply", "fee_event"] : ["resync", "apply"],
            lastError: null
          })
        },
        snapshot: postCloseSnapshot
      });
      if (hasPendingBotVaultV3SettlementPostProcessing(resumedSettlement?.postProcessing)) {
        throw new Error(
          `bot_vault_v3_close_post_processing_pending:${String(botVault.id)}:${String(resumedSettlement?.postProcessing.lastError ?? "close_post_processing_pending")}`
        );
      }
    } catch (error) {
      const reason = String(error);
      const latestSettlement = await readBotVaultV3ControllerSettlementById({
        botVaultId: String(botVault.id),
        metadataKey: "closeSettlement",
        sourceAction: "close_vault"
      });
      logger.warn("bot_vault_v3_close_post_processing_pending", {
        userId: params.userId,
        botVaultId: String(botVault.id),
        closeTxHash: String(closeTxHash),
        reason
      });
      await markBotVaultV3ControllerSettlementPendingOrThrow({
        botVaultId: String(botVault.id),
        metadataKey: "closeSettlement",
        settlement: latestSettlement?.sourceKey === closeSettlementSourceKey ? latestSettlement : {
          ...closeSettlementBase,
          stage: "confirmed",
          preparedAt: null,
          confirmedAt: null,
          appliedAt: null,
          updatedAt: null,
          lastError: null,
          postProcessing: buildBotVaultV3SettlementPostProcessingState({
            state: "pending",
            pendingSteps: feeAmountUsd > 0 ? ["resync", "apply", "fee_event"] : ["resync", "apply"],
            lastError: null
          })
        },
        lastError: reason,
        flow: "close"
      });
      throw new Error(`bot_vault_v3_close_post_processing_pending:${String(botVault.id)}:${reason}`);
    }

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      closeOnlyTxHash,
      closeTxHash,
      onchainStatusBefore: statusBefore,
      onchainStatusAfterCloseOnly: statusAfterCloseOnly,
      principalToReturnAtomic: principalToReturnRaw.toString(),
      grossAmountAtomic: usdcBalanceRaw.toString(),
      feeAmountAtomic: feeAmountRaw.toString()
    };
  }

  async function controllerRecoverClosedBotVault(
    params: ControllerRecoverClosedBotVaultParams
  ): Promise<BotVaultV3ControllerRecoverClosedResult> {
    const botVault = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId,
        vaultModel: "bot_vault_v3"
      },
      select: {
        id: true,
        vaultAddress: true,
        controllerAddress: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");
    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");
    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);
    const [
      statusRaw,
      principalDepositedRaw,
      principalReturnedRaw,
      feePaidTotalBeforeRaw,
      factoryAddress,
      usdcBalanceRaw,
      excludedPrincipalUsd
    ] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "status"
      }),
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalDeposited"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "principalReturned"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "feePaidTotal"
      }) as Promise<bigint>,
      publicClient.readContract({
        address: vaultAddress as `0x${string}`,
        abi: botVaultV3Abi,
        functionName: "factory"
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as Promise<bigint>,
      readHypercoreAccountingFeeUsdForBotVault({
        botVaultId: String(botVault.id),
        executionMetadata: botVault.executionMetadata
      })
    ]);
    const status = statusIndexToLabel(statusRaw);
    const preRecoverySnapshot: BotVaultV3OnchainSnapshot = {
      status,
      principalAllocated: formatUsdAtomicToNumber(principalDepositedRaw),
      principalReturned: formatUsdAtomicToNumber(principalReturnedRaw),
      availableUsd: formatUsdAtomicToNumber(usdcBalanceRaw),
      feePaidTotal: formatUsdAtomicToNumber(feePaidTotalBeforeRaw)
    };
    const existingRecoverySettlement = readBotVaultV3ControllerSettlementState({
      executionMetadata: botVault.executionMetadata,
      metadataKey: "recoverySettlement",
      sourceAction: "recover_closed_funds"
    });
    if (status !== "CLOSE_ONLY" && status !== "CLOSED") {
      throw new Error(`bot_vault_v3_recovery_requires_close_only_or_closed_status:${status}`);
    }
    if (usdcBalanceRaw <= 0n) {
      if (existingRecoverySettlement?.closeTxHash) {
        const resumedSettlement = await resumeBotVaultV3ControllerSettlementPostProcessing({
          botVaultId: String(botVault.id),
          metadataKey: "recoverySettlement",
          settlement: existingRecoverySettlement,
          snapshot: preRecoverySnapshot
        }).catch(async (error) => {
          const reason = String(error);
          const latestSettlement = await readBotVaultV3ControllerSettlementById({
            botVaultId: String(botVault.id),
            metadataKey: "recoverySettlement",
            sourceAction: "recover_closed_funds"
          });
          await markBotVaultV3ControllerSettlementPendingOrThrow({
            botVaultId: String(botVault.id),
            metadataKey: "recoverySettlement",
            settlement: latestSettlement?.sourceKey === existingRecoverySettlement.sourceKey ? latestSettlement : existingRecoverySettlement,
            lastError: reason,
            flow: "recovery"
          });
          throw new Error(`bot_vault_v3_recovery_post_processing_pending:${String(botVault.id)}:${reason}`);
        });
        if (hasPendingBotVaultV3SettlementPostProcessing(resumedSettlement?.postProcessing)) {
          throw new Error(
            `bot_vault_v3_recovery_post_processing_pending:${String(botVault.id)}:${String(resumedSettlement?.postProcessing.lastError ?? "recovery_post_processing_pending")}`
          );
        }
        return {
          botVaultId: String(botVault.id),
          vaultAddress,
          onchainBotVaultAddress: vaultAddress,
          recoverTxHash: existingRecoverySettlement.closeTxHash,
          principalToReturnAtomic: toAtomicUsd(existingRecoverySettlement.principalReturnedUsd).toString(),
          grossAmountAtomic: toAtomicUsd(existingRecoverySettlement.grossAmountUsd).toString(),
          feeAmountAtomic: toAtomicUsd(existingRecoverySettlement.feeAmountUsd).toString()
        };
      }
      throw new Error("bot_vault_v3_recovery_no_vault_balance");
    }
    const excludedPrincipalRaw = toAtomicUsd(excludedPrincipalUsd);
    const effectivePrincipalOutstandingRaw = deriveEffectivePrincipalOutstandingRaw({
      principalDepositedRaw,
      principalReturnedRaw,
      excludedPrincipalRaw
    });
    const principalToReturnRaw = effectivePrincipalOutstandingRaw > usdcBalanceRaw
      ? usdcBalanceRaw
      : effectivePrincipalOutstandingRaw;
    const profitComponentRaw = usdcBalanceRaw > principalToReturnRaw
      ? usdcBalanceRaw - principalToReturnRaw
      : 0n;
    const feeRatePctRaw = await publicClient.readContract({
      address: factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
    const feeAmountRaw = (profitComponentRaw * feeRatePctRaw) / 100n;
    const treasuryRecipientRaw = feeAmountRaw > 0n
      ? await publicClient.readContract({
          address: factoryAddress,
          abi: botVaultFactoryV3Abi,
          functionName: "treasuryRecipient"
        }) as `0x${string}`
      : null;
    const grossAmountUsd = formatUsdAtomicToNumber(usdcBalanceRaw);
    const principalReturnedUsd = formatUsdAtomicToNumber(principalToReturnRaw);
    const feeAmountUsd = formatUsdAtomicToNumber(feeAmountRaw);
    const profitComponentUsd = roundUsd(Math.max(0, grossAmountUsd - principalReturnedUsd));
    const netReturnedUsd = roundUsd(Math.max(0, grossAmountUsd - feeAmountUsd));
    const recoverySettlementSourceKey = buildBotVaultV3ControllerSettlementSourceKey(
      String(botVault.id),
      "recover_closed_funds"
    );
    const recoverySettlementPreparedBase = {
      sourceAction: "recover_closed_funds" as const,
      sourceKey: recoverySettlementSourceKey,
      feeEventSourceKey: `${recoverySettlementSourceKey}:fee_event`,
      closeTxHash: null,
      feeRatePct: Number(feeRatePctRaw),
      treasuryRecipient: toNullableString(treasuryRecipientRaw),
      principalReturnedUsd,
      grossAmountUsd,
      feeAmountUsd,
      netReturnedUsd,
      profitComponentUsd,
      excludedPrincipalUsd,
      lastError: null,
      postProcessing: buildBotVaultV3SettlementPostProcessingState({
        state: "not_started",
        pendingSteps: [],
        lastError: null
      })
    };

    await persistBotVaultV3ControllerSettlementState({
      botVaultId: String(botVault.id),
      metadataKey: "recoverySettlement",
      settlement: recoverySettlementPreparedBase,
      stage: "prepared"
    });

    const recoverTxHash = await sendSerializedControllerTransaction({
      account,
      chain,
      publicClient,
      walletClient
    }, {
      to: vaultAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "recoverClosedFunds",
        args: [principalToReturnRaw, usdcBalanceRaw, feeAmountRaw]
      })
    });
    const recoverReceipt = await publicClient.waitForTransactionReceipt({
      hash: recoverTxHash as `0x${string}`,
      confirmations: 1
    });
    if (recoverReceipt.status !== "success") {
      throw new Error("bot_vault_v3_recovery_tx_failed");
    }
    const recoverySettlementBase = {
      ...recoverySettlementPreparedBase,
      closeTxHash: String(recoverTxHash)
    };
    await persistBotVaultV3ControllerSettlementState({
      botVaultId: String(botVault.id),
      metadataKey: "recoverySettlement",
      settlement: {
        ...recoverySettlementBase,
        postProcessing: buildBotVaultV3SettlementPostProcessingState({
          state: "pending",
          pendingSteps: feeAmountUsd > 0 ? ["resync", "apply", "fee_event"] : ["resync", "apply"],
          lastError: null
        })
      },
      stage: "confirmed"
    });
    try {
      const postRecoverySnapshot = await resyncBotVaultV3StateFromChain({
        botVaultId: String(botVault.id),
        vaultAddress: vaultAddress as `0x${string}`,
        publicClient,
        usdcAddress
      });
      const resumedSettlement = await resumeBotVaultV3ControllerSettlementPostProcessing({
        botVaultId: String(botVault.id),
        metadataKey: "recoverySettlement",
        settlement: {
          ...recoverySettlementBase,
          stage: "confirmed",
          preparedAt: null,
          confirmedAt: null,
          appliedAt: null,
          updatedAt: null,
          lastError: null,
          postProcessing: buildBotVaultV3SettlementPostProcessingState({
            state: "pending",
            pendingSteps: feeAmountUsd > 0 ? ["resync", "apply", "fee_event"] : ["resync", "apply"],
            lastError: null
          })
        },
        snapshot: postRecoverySnapshot
      });
      if (hasPendingBotVaultV3SettlementPostProcessing(resumedSettlement?.postProcessing)) {
        throw new Error(
          `bot_vault_v3_recovery_post_processing_pending:${String(botVault.id)}:${String(resumedSettlement?.postProcessing.lastError ?? "recovery_post_processing_pending")}`
        );
      }
    } catch (error) {
      const reason = String(error);
      const latestSettlement = await readBotVaultV3ControllerSettlementById({
        botVaultId: String(botVault.id),
        metadataKey: "recoverySettlement",
        sourceAction: "recover_closed_funds"
      });
      logger.warn("bot_vault_v3_recovery_post_processing_pending", {
        userId: params.userId,
        botVaultId: String(botVault.id),
        recoverTxHash: String(recoverTxHash),
        reason
      });
      await markBotVaultV3ControllerSettlementPendingOrThrow({
        botVaultId: String(botVault.id),
        metadataKey: "recoverySettlement",
        settlement: latestSettlement?.sourceKey === recoverySettlementSourceKey ? latestSettlement : {
          ...recoverySettlementBase,
          stage: "confirmed",
          preparedAt: null,
          confirmedAt: null,
          appliedAt: null,
          updatedAt: null,
          lastError: null,
          postProcessing: buildBotVaultV3SettlementPostProcessingState({
            state: "pending",
            pendingSteps: feeAmountUsd > 0 ? ["resync", "apply", "fee_event"] : ["resync", "apply"],
            lastError: null
          })
        },
        lastError: reason,
        flow: "recovery"
      });
      throw new Error(`bot_vault_v3_recovery_post_processing_pending:${String(botVault.id)}:${reason}`);
    }

    return {
      botVaultId: String(botVault.id),
      vaultAddress,
      onchainBotVaultAddress: vaultAddress,
      recoverTxHash,
      principalToReturnAtomic: principalToReturnRaw.toString(),
      grossAmountAtomic: usdcBalanceRaw.toString(),
      feeAmountAtomic: feeAmountRaw.toString()
    };
  }

  return {
    getUserAgentWalletSummary,
    createUserAgentWallet,
    setUserAgentWallet,
    setUserAgentThreshold,
    withdrawHypeFromUserAgentWallet,
    getBotVaultForBot,
    reconcileBotVaultV3ById,
    ensureBotVaultForBot,
    fundBotVault,
    previewClaimProfit,
    claimProfit,
    finalizeMarginAdd,
    reduceMargin,
    endBotVault,
    controllerCloseBotVault,
    controllerRecoverClosedBotVault
  };
}

export type BotVaultV3Service = ReturnType<typeof createBotVaultV3Service>;
