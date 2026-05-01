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
import { normalizeOnchainContractVersion, resolveHyperEvmWriteRpcUrl } from "./onchainAddressBook.js";
import { sendSerializedControllerTransaction } from "./controllerTransaction.js";
import { botVaultFactoryV3Abi, botVaultV3Abi, botVaultV4Abi } from "./onchainAbi.js";
import { computeProfitShareAccounting } from "./feeSettlement.math.js";
import { createOnchainActionService, type OnchainActionService } from "./onchainAction.service.js";
import {
  buildBotVaultV3FundingLifecycleTransitionPatch,
  classifyBotVaultV4Mismatch,
  classifyBotVaultV4Status,
  compareBotVaultV3FundingLifecycleStage,
  createBotVaultV3FundingLifecycleMetadata,
  deriveBotVaultV4RecoveryHint,
  findBotVaultV3FundingLifecyclePath,
  getBotVaultV3FundingLifecycleProgressIndex,
  normalizeBotVaultV4MismatchCategory,
  normalizeBotVaultV4MismatchRecoveryAction,
  normalizeBotVaultV4RecoveryHint,
  normalizeBotVaultV4StatusCategory,
  readBotVaultV3FundingLifecycleState,
  type BotVaultV3FundingLifecycleStage,
  type BotVaultV3FundingLifecycleTransition,
  type BotVaultV4MismatchCategory,
  type BotVaultV4MismatchClassification,
  type BotVaultV4MismatchRecoveryAction,
  type BotVaultV4RecoveryHint,
  type BotVaultV4StatusCategory
} from "./botVaultV3.lifecycle.js";
import {
  ONCHAIN_AFFILIATE_DIRECT_SPLIT_PAYOUT_MODEL,
  ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
  ONCHAIN_TREASURY_CONTRACT_VERSION_V4,
  ONCHAIN_TREASURY_PAYOUT_MODEL
} from "./profitShareTreasury.settings.js";
import {
  createAffiliateAccrualFromFeeEventIfEligible,
  decorateFeeEventMetadataWithAffiliateContext,
  ensureAffiliateProfileForUser,
  readAffiliatePayoutWalletConfig,
  readLockedAffiliateFeeConfig,
  resolveLockedAffiliateFeeConfig,
  type LockedAffiliateFeeConfig
} from "../affiliate/program.js";

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

export type AffiliatePayoutWalletSummary = {
  address: string | null;
  version: number;
  secretRef: string | null;
  hypeBalance: string | null;
  hypeBalanceWei: string | null;
  usdcBalance: string | null;
  usdcBalanceAtomic: string | null;
  updatedAt: string | null;
  stale: boolean;
};

export type BotVaultV3OperationStep =
  | "hyper_evm_deposit"
  | "hypercore_funding"
  | "hypercore_withdraw"
  | "claim"
  | "close"
  | "recover";

export type BotVaultV3OperationStateValue =
  | "pending"
  | "submitted"
  | "confirmed"
  | "pending_reconciliation"
  | "failed_retryable"
  | "failed_final";

export type BotVaultV3OperationState = {
  step: BotVaultV3OperationStep;
  state: BotVaultV3OperationStateValue;
  reasonCode: string;
  detail: string | null;
  nextRecommendedAction: "submit" | "wait" | "retry" | "retry_reconcile" | "recover" | "request_user_action" | "none";
  canRetry: boolean;
  amountUsd: number | null;
  txHash: string | null;
  updatedAt: string | null;
};

export type BotVaultV3Summary = {
  id: string;
  botId: string;
  userId: string;
  vaultModel: string;
  contractVersion: "v3" | "v4";
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
  profitShareAccruedUsd: number;
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
  operationState: BotVaultV3OperationState | null;
  statusCategory: BotVaultV4StatusCategory;
  statusReason: string;
  statusDetail: string | null;
  statusMismatchCategory: BotVaultV4MismatchCategory | null;
  statusRecoveryAction: BotVaultV4MismatchRecoveryAction | null;
  statusRecoveryHint: BotVaultV4RecoveryHint | null;
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
  feeConfigSummary: LockedAffiliateFeeConfig | null;
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

export type BotVaultV3ReconciliationIssue = {
  code: string;
  severity: "warning" | "blocking";
  statusCategory: BotVaultV4StatusCategory;
  mismatchCategory: BotVaultV4MismatchCategory | null;
  recoveryAction: BotVaultV4MismatchRecoveryAction | null;
  recoveryHint: BotVaultV4RecoveryHint | null;
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
  statusCategory: BotVaultV4StatusCategory;
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
  statusCategory: BotVaultV4StatusCategory;
  statusReason: string;
  statusDetail: string | null;
  statusMismatchCategory: BotVaultV4MismatchCategory | null;
  statusRecoveryAction: BotVaultV4MismatchRecoveryAction | null;
  statusRecoveryHint: BotVaultV4RecoveryHint | null;
};

export type BotVaultV3ExecutionReadinessReason =
  | "bot_vault_v3_ready"
  | "bot_vault_v3_onchain_vault_missing"
  | "bot_vault_v3_execution_blocked"
  | "bot_vault_v3_reconciliation_blocking_mismatch"
  | "bot_vault_v3_execution_lifecycle_not_ready"
  | "bot_vault_v3_funding_requested_not_confirmed"
  | "bot_vault_v4_funding_requested_not_confirmed"
  | "bot_vault_v3_hypercore_funding_not_started"
  | "bot_vault_v3_hypercore_transfer_pending"
  | "bot_vault_v3_hypercore_transfer_not_observed"
  | "bot_vault_v3_hype_reserve_not_ready"
  | "bot_vault_v4_funding_verification_missing"
  | "bot_vault_v4_hype_reserve_not_ready"
  | "bot_vault_v4_hype_reserve_not_verified"
  | "bot_vault_v4_perp_margin_not_verified"
  | "bot_vault_v4_perp_margin_not_visible"
  | "bot_vault_v4_reconciliation_snapshot_missing"
  | "bot_vault_v3_hypercore_final_state_unverified"
  | "bot_vault_v3_hypercore_pause_restore_unverified";

export type BotVaultV3ExecutionReadiness = {
  ready: boolean;
  stage: "ready" | "configuration" | "funding" | "transfer" | "verification" | "blocked";
  statusCategory: BotVaultV4StatusCategory;
  reason: BotVaultV3ExecutionReadinessReason;
  detail: string | null;
  fundingStatus: string;
  hypercoreFundingStatus: string;
  verificationState: string | null;
  verificationBlockingReason: string | null;
  mismatchCategory?: BotVaultV4MismatchCategory | null;
  recoveryAction?: BotVaultV4MismatchRecoveryAction | null;
  recoveryHint?: BotVaultV4RecoveryHint | null;
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
  contractVersion: "v3" | "v4";
  status: string;
  claimableProfitRaw: bigint;
  requestedAmountRaw: bigint;
  feeRatePctRaw: bigint;
  feeAmountRaw: bigint;
  feeBaseRaw: bigint;
  realizedClosedPnlRaw: bigint;
  highWaterMarkBeforeRaw: bigint;
  highWaterMarkAfterRaw: bigint;
  realizedClosedPnlUsd: number;
  highWaterMarkBeforeUsd: number;
  highWaterMarkAfterUsd: number;
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

type BotVaultV3ContractBalanceAction = "claim_profit" | "close_vault" | "recover_closed_funds";

export type BotVaultV3ClaimProfitPreview = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  status: string;
  maxClaimableUsd: number;
  requestedAmountUsd: number;
  feeRatePct: number;
  feeAmountUsd: number;
  feeBaseUsd: number;
  realizedClosedPnlUsd: number;
  highWaterMarkBeforeUsd: number;
  highWaterMarkAfterUsd: number;
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
  hypeReserveState: string | null;
  hypeReserveTarget: number | null;
  hypeReserveBudgetUsd: number | null;
  hypeReserveFailureClass: string | null;
  hypeReserveReasonCode: string | null;
  hypeReserveStatusCategory: BotVaultV4StatusCategory | null;
  hypeReserveMismatchCategory: BotVaultV4MismatchCategory | null;
  hypeReserveRecoveryAction: BotVaultV4MismatchRecoveryAction | null;
  hypeReserveCanRetry: boolean;
  hypeReserveNeedsUserAction: boolean;
  hypeBalanceAfter: number | null;
};

type ReduceMarginParams = {
  userId: string;
  botVaultId: string;
  amountUsd: number;
};

type BotVaultV3ReduceMarginVerificationState =
  | "reduction_verified"
  | "transfer_observed"
  | "transfer_submitted"
  | "evm_transfer_observed"
  | "evm_transfer_submitted";

type BotVaultV3ReduceMarginResultState =
  | BotVaultV3ReduceMarginVerificationState
  | "post_reconcile_pending"
  | "post_reconcile_recovery_required";

type BotVaultV3ReduceMarginFlowState =
  | "transfer_submitted"
  | "transfer_verified"
  | "post_reconcile_pending"
  | "post_reconcile_recovery_required"
  | "evm_return_pending"
  | "evm_return_verified";

type BotVaultV3ReduceMarginFlowEvent =
  | BotVaultV3ReduceMarginFlowState
  | "request_received"
  | "fully_settled";

type BotVaultV3ReduceMarginSettlementState =
  | BotVaultV3ReduceMarginFlowState
  | "fully_settled";

type BotVaultV3ReduceMarginPostReconcileState =
  | "not_required"
  | "applied"
  | "pending"
  | "recovery_required";

export type BotVaultV3ReduceMarginResult = {
  botVaultId: string;
  vaultAddress: string;
  onchainBotVaultAddress: string;
  releasedAmountUsd: number;
  coreSpotBalanceBeforeUsd: number;
  coreSpotBalanceAfterUsd: number | null;
  evmBalanceBeforeUsd: number | null;
  evmBalanceAfterUsd: number | null;
  spotToEvmAmountUsd: number | null;
  spotToEvmTransferStatus: string | null;
  statusCategory: BotVaultV4StatusCategory;
  flowState: BotVaultV3ReduceMarginFlowState;
  statusReason: string;
  settlementState: BotVaultV3ReduceMarginSettlementState;
  settlementReason: string;
  verificationState: BotVaultV3ReduceMarginResultState;
  verificationBlockingReason: string | null;
  transferVerificationState: BotVaultV3ReduceMarginVerificationState;
  postReconcileState: BotVaultV3ReduceMarginPostReconcileState;
  postReconcileStatusCategory: BotVaultV4StatusCategory | null;
  postReconcileReason: string | null;
  postReconcileMismatchCategory: BotVaultV4MismatchCategory | null;
  postReconcileRecoveryAction: BotVaultV4MismatchRecoveryAction | null;
  postReconcileCanRetry: boolean;
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

type CreateAffiliatePayoutWalletParams = {
  userId: string;
};

type WithdrawAffiliatePayoutHypeParams = {
  userId: string;
  amountHype?: number | null;
  reserveHype?: number | null;
};

type WithdrawAffiliatePayoutUsdcParams = {
  userId: string;
  amountUsdc?: number | null;
};

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function resolveBotVaultControllerContractVersion(value: unknown): "v3" | "v4" {
  const normalized = normalizeOnchainContractVersion(value, "v3");
  return normalized === "v4" ? "v4" : "v3";
}

function readBotVaultExecutionMetadata(value: unknown): Record<string, unknown> {
  const record = toRecord(value);
  if ("executionMetadata" in record) {
    return toRecord(record.executionMetadata);
  }
  return record;
}

function readBotVaultOnchainContractVersion(value: unknown): "v3" | "v4" {
  const metadata = readBotVaultExecutionMetadata(value);
  return resolveBotVaultControllerContractVersion(metadata.onchainContractVersion);
}

function readBotVaultHypeReserveState(value: unknown): string {
  const metadata = readBotVaultExecutionMetadata(value);
  const marginAddFinalization = toRecord(metadata.marginAddFinalization);
  return String(
    marginAddFinalization.hypeReserveState
    ?? metadata.hypeReserveState
    ?? ""
  ).trim().toLowerCase();
}

function readBotVaultHypeReserveTarget(contractVersion: "v3" | "v4"): number {
  if (contractVersion === "v4") {
    return envNumber(
      "BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET",
      envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_TARGET", 0.05)
    );
  }
  return envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_TARGET", 0.05);
}

function readBotVaultHypeReserveBudgetUsd(contractVersion: "v3" | "v4"): number {
  if (contractVersion === "v4") {
    return envNumber(
      "BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND",
      envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_MAX_USDC_SPEND", 1)
    );
  }
  return envNumber("BOT_VAULT_V3_HYPERCORE_EXIT_HYPE_MAX_USDC_SPEND", 1);
}

function isBotVaultHypeReserveReady(state: unknown): boolean {
  const normalized = String(state ?? "").trim().toLowerCase();
  return normalized === "ready" || normalized === "not_required";
}

function isBotVaultHypeReserveTransientDetail(detail: string): boolean {
  return (
    /hyperliquid_info_request_failed:429\b/i.test(detail)
    || /rate[_ -]?limit/i.test(detail)
    || /too many requests/i.test(detail)
    || /hyperliquidapierror/i.test(detail)
    || /unknown error occurred/i.test(detail)
    || /failed to deserialize/i.test(detail)
    || /request timeout/i.test(detail)
    || /fetch failed/i.test(detail)
    || /network/i.test(detail)
  );
}

function buildBotVaultHypeReserveStatus(params: {
  requiresHypeReserve: boolean;
  result?: BotVaultHypeReserveResult | null;
  error?: unknown;
  fallbackState?: unknown;
}): BotVaultHypeReserveStatus {
  if (!params.requiresHypeReserve) {
    return {
      state: "not_required",
      failureClass: null,
      reasonCode: null,
      statusCategory: "execution_ready",
      mismatch: null,
      detail: null,
      canRetry: false,
      needsUserAction: false,
      requiresRecovery: false
    };
  }

  if (params.result) {
    if (isBotVaultHypeReserveReady(params.result.state)) {
      return {
        state: params.result.state,
        failureClass: null,
        reasonCode: null,
        statusCategory: "execution_ready",
        mismatch: null,
        detail: null,
        canRetry: false,
        needsUserAction: false,
        requiresRecovery: false
      };
    }
    return {
      state: "pending",
      failureClass: "retryable",
      reasonCode: "bot_vault_v4_hype_reserve_balance_pending",
      statusCategory: "retryable",
      mismatch: classifyBotVaultV4Mismatch({
        reason: "bot_vault_v4_hype_reserve_balance_pending",
        detail: "HYPE reserve order completed but the target balance is not visible yet",
        failureClass: "retryable",
        defaultCategory: "reserve_bootstrap_incomplete"
      }),
      detail: "HYPE reserve order completed but the target balance is not visible yet",
      canRetry: true,
      needsUserAction: false,
      requiresRecovery: false
    };
  }

  const fallbackState = String(params.fallbackState ?? "").trim().toLowerCase();
  if (isBotVaultHypeReserveReady(fallbackState)) {
    return {
      state: fallbackState as BotVaultHypeReserveStatus["state"],
      failureClass: null,
      reasonCode: null,
      statusCategory: "execution_ready",
      mismatch: null,
      detail: null,
      canRetry: false,
      needsUserAction: false,
      requiresRecovery: false
    };
  }

  const detail = toNullableString(params.error) ?? (fallbackState || "bot_vault_v4_hype_reserve_pending");
  const normalizedDetail = detail.toLowerCase();
  const classify = (
    failureClass: BotVaultHypeReserveFailureClass,
    reasonCode: string
  ): BotVaultHypeReserveStatus => {
    const mismatch = classifyBotVaultV4Mismatch({
      reason: reasonCode,
      detail,
      failureClass,
      defaultCategory: failureClass === "retryable" ? "reserve_bootstrap_incomplete" : null
    });
    const statusCategory = classifyBotVaultV4Status({
      reason: reasonCode,
      detail,
      mismatch,
      fallbackCategory: failureClass === "retryable" ? "retryable" : failureClass
    }).category;
    return {
      state: failureClass === "retryable" ? "retryable_error" : failureClass,
      failureClass,
      reasonCode,
      statusCategory,
      mismatch,
      detail,
      canRetry: failureClass === "retryable",
      needsUserAction: failureClass === "user_action_required",
      requiresRecovery: failureClass !== "retryable"
    };
  };

  if (normalizedDetail.includes("bot_vault_v3_hypercore_exit_gas_usdc_missing")) {
    return classify("user_action_required", "bot_vault_v4_hype_reserve_core_spot_usdc_missing");
  }
  if (normalizedDetail.includes("bot_vault_v3_hypercore_exit_gas_budget_too_low")) {
    return classify("user_action_required", "bot_vault_v4_hype_reserve_budget_too_low");
  }
  if (normalizedDetail.includes("bot_vault_v3_hypercore_exit_gas_order_not_allowed")) {
    return classify("recovery_required", "bot_vault_v4_hype_reserve_order_not_allowed");
  }
  if (normalizedDetail.includes("bot_vault_v3_hypercore_exit_corewriter_missing")) {
    return classify("recovery_required", "bot_vault_v4_hype_reserve_corewriter_missing");
  }
  if (normalizedDetail.includes("bot_vault_v3_hypercore_exit_gas_market_client_missing")) {
    return classify("recovery_required", "bot_vault_v4_hype_reserve_market_client_missing");
  }
  if (normalizedDetail.includes("bot_vault_v3_hypercore_exit_gas_market_missing")) {
    return classify("recovery_required", "bot_vault_v4_hype_reserve_market_missing");
  }
  if (normalizedDetail.includes("bot_vault_v3_hypercore_exit_gas_price_unavailable")) {
    return classify("retryable", "bot_vault_v4_hype_reserve_price_unavailable");
  }
  if (
    normalizedDetail.includes("bot_vault_v3_hypercore_exit_gas_confirmation_pending")
    || normalizedDetail.includes("pending_timeout")
    || isBotVaultHypeReserveTransientDetail(detail)
  ) {
    return classify("retryable", "bot_vault_v4_hype_reserve_confirmation_pending");
  }
  if (fallbackState === "pending") {
    return classify("retryable", "bot_vault_v4_hype_reserve_pending");
  }

  return classify("recovery_required", "bot_vault_v4_hype_reserve_unknown_failure");
}

type BotVaultHypeReserveResult = {
  contractVersion: "v3" | "v4";
  targetHype: number;
  maxUsdcSpend: number;
  hypeBalanceBefore: number;
  hypeBalanceAfter: number;
  spotUsdcBefore: number;
  spotUsdcBudget: number;
  state: "not_required" | "ready" | "pending";
  txHash: string | null;
};

type BotVaultHypeReserveFailureClass = "retryable" | "user_action_required" | "recovery_required";

type BotVaultHypeReserveStatus = {
  state: "not_required" | "ready" | "pending" | "retryable_error" | "user_action_required" | "recovery_required";
  failureClass: BotVaultHypeReserveFailureClass | null;
  reasonCode: string | null;
  statusCategory: BotVaultV4StatusCategory;
  mismatch: BotVaultV4MismatchClassification | null;
  detail: string | null;
  canRetry: boolean;
  needsUserAction: boolean;
  requiresRecovery: boolean;
};

type BotVaultV4FundingReserveFlowEvent =
  | "funding_requested"
  | "funding_timed_out"
  | "reserve_bootstrap_pending"
  | "reserve_bootstrap_retryable"
  | "reserve_bootstrap_user_action_required"
  | "reserve_bootstrap_recovery_required"
  | "margin_add_verified"
  | "execution_ready_confirmed";

function resolveBotVaultV4ReserveBootstrapFlowEvent(
  status: BotVaultHypeReserveStatus
): BotVaultV4FundingReserveFlowEvent | null {
  if (isBotVaultHypeReserveReady(status.state)) return null;
  if (status.failureClass === "user_action_required") return "reserve_bootstrap_user_action_required";
  if (status.failureClass === "recovery_required" || status.requiresRecovery) {
    return "reserve_bootstrap_recovery_required";
  }

  const reasonCode = String(status.reasonCode ?? "").trim().toLowerCase();
  if (
    status.state === "pending"
    || reasonCode === "bot_vault_v4_hype_reserve_pending"
    || reasonCode === "bot_vault_v4_hype_reserve_balance_pending"
  ) {
    return "reserve_bootstrap_pending";
  }
  if (status.failureClass === "retryable" || status.canRetry) return "reserve_bootstrap_retryable";
  return "reserve_bootstrap_pending";
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

async function readBotVaultProfitShareFeeRatePct(params: {
  publicClient: ReturnType<typeof createPublicClient>;
  factoryAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
}): Promise<bigint> {
  try {
    return await params.publicClient.readContract({
      address: params.vaultAddress,
      abi: botVaultV4Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
  } catch {
    return await params.publicClient.readContract({
      address: params.factoryAddress,
      abi: botVaultFactoryV3Abi,
      functionName: "profitShareFeeRatePct"
    }) as bigint;
  }
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

function formatSignedUsdAtomicToNumber(value: bigint): number {
  const sign = value < 0n ? -1 : 1;
  const magnitude = value < 0n ? -value : value;
  return roundUsd(sign * Number(formatUnits(magnitude, 6)), 6);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAtomicUsd(value: number): bigint {
  const rounded = roundUsd(toNonNegativeNumber(value), 6);
  return parseUnits(rounded.toFixed(6), 6);
}

function toSignedAtomicUsd(value: number): bigint {
  const parsed = Number.isFinite(Number(value)) ? Number(value) : 0;
  const sign = parsed < 0 ? -1n : 1n;
  return sign * toAtomicUsd(Math.abs(parsed));
}

function computeV4ProfitShareRaw(params: {
  payoutProfitRaw: bigint;
  feeRatePctRaw: bigint;
  realizedClosedPnlUsd: number;
  highWaterMarkBeforeUsd: number;
}) {
  const realizedClosedPnlRaw = toSignedAtomicUsd(params.realizedClosedPnlUsd);
  const highWaterMarkBeforeRaw = toAtomicUsd(params.highWaterMarkBeforeUsd);
  const positiveRealizedClosedPnlRaw = realizedClosedPnlRaw > 0n ? realizedClosedPnlRaw : 0n;
  const feeableCapacityRaw = positiveRealizedClosedPnlRaw > highWaterMarkBeforeRaw
    ? positiveRealizedClosedPnlRaw - highWaterMarkBeforeRaw
    : 0n;
  const feeBaseRaw = params.payoutProfitRaw < feeableCapacityRaw
    ? params.payoutProfitRaw
    : feeableCapacityRaw;
  const feeAmountRaw = (feeBaseRaw * params.feeRatePctRaw) / 100n;
  const highWaterMarkAfterRaw = highWaterMarkBeforeRaw + feeBaseRaw;
  const accounting = computeProfitShareAccounting({
    realizedClosedPnlUsd: formatSignedUsdAtomicToNumber(realizedClosedPnlRaw),
    settledProfitUsd: formatUsdAtomicToNumber(highWaterMarkBeforeRaw),
    payoutProfitUsd: formatUsdAtomicToNumber(params.payoutProfitRaw),
    feeRatePct: Number(params.feeRatePctRaw)
  });

  return {
    feeBaseRaw,
    feeAmountRaw,
    realizedClosedPnlRaw,
    highWaterMarkBeforeRaw,
    highWaterMarkAfterRaw,
    realizedClosedPnlUsd: accounting.realizedClosedPnlUsd,
    highWaterMarkBeforeUsd: accounting.settledProfitBeforeUsd,
    highWaterMarkAfterUsd: formatUsdAtomicToNumber(highWaterMarkAfterRaw)
  };
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

function buildBotVaultV3OperationState(input: {
  step: BotVaultV3OperationStep;
  state: BotVaultV3OperationStateValue;
  reasonCode: string;
  detail?: string | null;
  amountUsd?: number | null;
  txHash?: string | null;
  updatedAt?: string | null;
}): BotVaultV3OperationState {
  const nextRecommendedAction = (() => {
    if (input.state === "pending") return "submit";
    if (input.state === "submitted") return "wait";
    if (input.state === "pending_reconciliation") return "retry_reconcile";
    if (input.state === "failed_retryable") return "retry";
    if (input.state === "failed_final") {
      const reason = `${input.reasonCode}:${input.detail ?? ""}`.toLowerCase();
      return reason.includes("user_action") || reason.includes("insufficient") || reason.includes("missing")
        ? "request_user_action"
        : "recover";
    }
    return "none";
  })();
  return {
    step: input.step,
    state: input.state,
    reasonCode: input.reasonCode,
    detail: toNullableString(input.detail) ?? null,
    nextRecommendedAction,
    canRetry: input.state === "pending_reconciliation" || input.state === "failed_retryable",
    amountUsd: input.amountUsd == null ? null : roundUsd(toNonNegativeNumber(input.amountUsd), 6),
    txHash: toNullableString(input.txHash),
    updatedAt: toNullableString(input.updatedAt)
  };
}

function mapControllerSettlementOperationState(
  settlement: BotVaultV3ControllerSettlementState | null,
  step: "close" | "recover"
): BotVaultV3OperationState | null {
  if (!settlement) return null;
  const txHash = settlement.closeTxHash;
  if (settlement.stage === "applied" && settlement.postProcessing.state === "complete") {
    return buildBotVaultV3OperationState({
      step,
      state: "confirmed",
      reasonCode: `${settlement.sourceAction}_confirmed`,
      amountUsd: settlement.grossAmountUsd,
      txHash,
      updatedAt: settlement.updatedAt ?? settlement.appliedAt
    });
  }
  if (settlement.lastError) {
    return buildBotVaultV3OperationState({
      step,
      state: "pending_reconciliation",
      reasonCode: `${settlement.sourceAction}_pending_reconciliation`,
      detail: settlement.lastError,
      amountUsd: settlement.grossAmountUsd,
      txHash,
      updatedAt: settlement.updatedAt
    });
  }
  if (settlement.stage === "confirmed" || txHash) {
    return buildBotVaultV3OperationState({
      step,
      state: settlement.postProcessing.state === "pending" ? "pending_reconciliation" : "confirmed",
      reasonCode: settlement.postProcessing.state === "pending"
        ? `${settlement.sourceAction}_pending_reconciliation`
        : `${settlement.sourceAction}_confirmed`,
      detail: settlement.postProcessing.pendingSteps.join(",") || null,
      amountUsd: settlement.grossAmountUsd,
      txHash,
      updatedAt: settlement.updatedAt ?? settlement.confirmedAt
    });
  }
  return buildBotVaultV3OperationState({
    step,
    state: "pending",
    reasonCode: `${settlement.sourceAction}_prepared`,
    amountUsd: settlement.grossAmountUsd,
    txHash,
    updatedAt: settlement.updatedAt ?? settlement.preparedAt
  });
}

function mapClaimSettlementOperationState(
  settlement: BotVaultV3ClaimSettlementState | null
): BotVaultV3OperationState | null {
  if (!settlement) return null;
  if (settlement.stage === "applied" && settlement.postProcessing.state === "complete") {
    return buildBotVaultV3OperationState({
      step: "claim",
      state: "confirmed",
      reasonCode: "claim_profit_confirmed",
      amountUsd: settlement.grossAmountUsd,
      txHash: settlement.claimTxHash,
      updatedAt: settlement.updatedAt ?? settlement.appliedAt
    });
  }
  if (settlement.lastError) {
    return buildBotVaultV3OperationState({
      step: "claim",
      state: "pending_reconciliation",
      reasonCode: "claim_profit_pending_reconciliation",
      detail: settlement.lastError,
      amountUsd: settlement.grossAmountUsd,
      txHash: settlement.claimTxHash,
      updatedAt: settlement.updatedAt
    });
  }
  if (settlement.stage === "confirmed" || settlement.claimTxHash) {
    return buildBotVaultV3OperationState({
      step: "claim",
      state: settlement.postProcessing.state === "pending" ? "pending_reconciliation" : "confirmed",
      reasonCode: settlement.postProcessing.state === "pending"
        ? "claim_profit_pending_reconciliation"
        : "claim_profit_confirmed",
      detail: settlement.postProcessing.pendingSteps.join(",") || null,
      amountUsd: settlement.grossAmountUsd,
      txHash: settlement.claimTxHash,
      updatedAt: settlement.updatedAt ?? settlement.confirmedAt
    });
  }
  return buildBotVaultV3OperationState({
    step: "claim",
    state: "pending",
    reasonCode: "claim_profit_prepared",
    amountUsd: settlement.grossAmountUsd,
    txHash: settlement.claimTxHash,
    updatedAt: settlement.updatedAt ?? settlement.preparedAt
  });
}

function deriveBotVaultV3OperationState(row: any): BotVaultV3OperationState | null {
  const metadata = toRecord(row?.executionMetadata);
  const contractBalanceReconciliation = toRecord(metadata.contractBalanceReconciliation);
  if (
    contractBalanceReconciliation.state === "pending_reconciliation"
    && contractBalanceReconciliation.reasonCode === "insufficient_contract_balance"
  ) {
    const action = String(contractBalanceReconciliation.action ?? "");
    const step: BotVaultV3OperationStep =
      action === "claim_profit" ? "claim"
        : action === "close_vault" ? "close"
        : action === "recover_closed_funds" ? "recover"
        : "hypercore_withdraw";
    return buildBotVaultV3OperationState({
      step,
      state: "pending_reconciliation",
      reasonCode: "insufficient_contract_balance",
      detail: `expected=${String(contractBalanceReconciliation.expectedAmountAtomic ?? "")};actual=${String(contractBalanceReconciliation.actualBalanceAtomic ?? "")}`,
      amountUsd: toNonNegativeNumber(contractBalanceReconciliation.expectedAmountUsd),
      updatedAt: toNullableString(contractBalanceReconciliation.updatedAt)
    });
  }

  const recoveryState = mapControllerSettlementOperationState(
    readBotVaultV3ControllerSettlementState({
      executionMetadata: metadata,
      metadataKey: "recoverySettlement",
      sourceAction: "recover_closed_funds"
    }),
    "recover"
  );
  if (recoveryState && recoveryState.state !== "confirmed") return recoveryState;

  const closeState = mapControllerSettlementOperationState(
    readBotVaultV3ControllerSettlementState({
      executionMetadata: metadata,
      metadataKey: "closeSettlement",
      sourceAction: "close_vault"
    }),
    "close"
  );
  if (closeState && closeState.state !== "confirmed") return closeState;

  const claimState = mapClaimSettlementOperationState(readBotVaultV3ClaimSettlementState(metadata));
  if (claimState && claimState.state !== "confirmed") return claimState;

  const reduceMarginFinalization = toRecord(metadata.reduceMarginFinalization);
  if (Object.keys(reduceMarginFinalization).length > 0) {
    const stage = String(reduceMarginFinalization.stage ?? "").trim().toLowerCase();
    const postReconcileState = String(reduceMarginFinalization.postReconcileState ?? "").trim().toLowerCase();
    const statusCategory = normalizeBotVaultV4StatusCategory(reduceMarginFinalization.statusCategory);
    const state: BotVaultV3OperationStateValue =
      postReconcileState === "recovery_required" || statusCategory === "recovery_required"
        ? "failed_final"
        : postReconcileState === "pending"
          ? "pending_reconciliation"
          : stage === "failed"
            ? "failed_retryable"
            : stage === "verified"
              ? "confirmed"
              : stage === "observed"
                ? "pending_reconciliation"
                : stage === "submitted"
                  ? "submitted"
                  : "pending";
    const mapped = buildBotVaultV3OperationState({
      step: "hypercore_withdraw",
      state,
      reasonCode: toNullableString(reduceMarginFinalization.postReconcileReason)
        ?? toNullableString(reduceMarginFinalization.verificationBlockingReason)
        ?? toNullableString(reduceMarginFinalization.statusReason)
        ?? `reduce_margin_${stage || "pending"}`,
      detail: toNullableString(reduceMarginFinalization.error),
      amountUsd: toNonNegativeNumber(reduceMarginFinalization.releasedAmountUsd),
      txHash: toNullableString(reduceMarginFinalization.spotToEvmTransferTxHash)
        ?? toNullableString(reduceMarginFinalization.transferTxHash),
      updatedAt: toNullableString(reduceMarginFinalization.updatedAt)
    });
    if (mapped.state !== "confirmed") return mapped;
  }

  const marginAddFinalization = toRecord(metadata.marginAddFinalization);
  if (Object.keys(marginAddFinalization).length > 0) {
    const verificationState = String(marginAddFinalization.verificationState ?? "").trim().toLowerCase();
    const failureClass = String(marginAddFinalization.hypeReserveFailureClass ?? "").trim().toLowerCase();
    const state: BotVaultV3OperationStateValue =
      marginAddFinalization.fundingVerified === true || verificationState === "funding_verified"
        ? "confirmed"
        : failureClass === "recovery_required" || marginAddFinalization.hypeReserveRequiresRecovery === true
          ? "failed_final"
          : failureClass === "user_action_required" || marginAddFinalization.hypeReserveNeedsUserAction === true
            ? "failed_final"
            : failureClass === "retryable"
              ? "failed_retryable"
              : verificationState === "transfer_observed"
                || verificationState === "hype_reserve_pending"
                || verificationState === "hype_reserve_retryable"
                ? "pending_reconciliation"
                : verificationState === "transfer_submitted"
                  ? "submitted"
                  : "pending";
    const mapped = buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state,
      reasonCode: toNullableString(marginAddFinalization.verificationBlockingReason)
        ?? toNullableString(marginAddFinalization.hypeReserveReasonCode)
        ?? `margin_add_${verificationState || "pending"}`,
      detail: toNullableString(marginAddFinalization.hypeReserveError),
      amountUsd: toNonNegativeNumber(marginAddFinalization.requestedAmountUsd),
      txHash: toNullableString(marginAddFinalization.transferTxHash)
        ?? toNullableString(marginAddFinalization.depositTxHash)
        ?? toNullableString(marginAddFinalization.activateTxHash),
      updatedAt: toNullableString(marginAddFinalization.updatedAt)
    });
    if (mapped.state !== "confirmed") return mapped;
  }

  const fundingIntent = toRecord(metadata.fundingIntent);
  if (Object.keys(fundingIntent).length > 0) {
    const actionStatus = String(fundingIntent.actionStatus ?? "").trim().toLowerCase();
    const state: BotVaultV3OperationStateValue =
      actionStatus === "confirmed"
        ? "confirmed"
        : actionStatus === "submitted"
          ? "submitted"
          : actionStatus === "failed" || actionStatus === "timed_out"
            ? "failed_retryable"
            : "pending";
    const mapped = buildBotVaultV3OperationState({
      step: "hyper_evm_deposit",
      state,
      reasonCode: toNullableString(fundingIntent.timeoutReason)
        ?? toNullableString(fundingIntent.lastError)
        ?? `funding_${actionStatus || "pending"}`,
      detail: toNullableString(fundingIntent.sourceKey),
      amountUsd: toNonNegativeNumber(fundingIntent.amountUsd),
      txHash: toNullableString(fundingIntent.txHash),
      updatedAt: toNullableString(fundingIntent.updatedAt)
        ?? toNullableString(fundingIntent.timedOutAt)
        ?? toNullableString(fundingIntent.lastBoundAt)
        ?? toNullableString(fundingIntent.requestedAt)
    });
    if (mapped.state !== "confirmed") return mapped;
  }

  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const fundingStatus = String(row?.fundingStatus ?? "").trim().toLowerCase();
  const hypercoreFundingStatus = String(row?.hypercoreFundingStatus ?? "").trim().toLowerCase();
  const { onchainBotVaultAddress } = readBotVaultV3AddressSemantics(row);
  const amountUsd = toNonNegativeNumber(row?.principalAllocated ?? row?.allocatedUsd ?? row?.availableUsd);
  const updatedAt = row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : toNullableString(row?.updatedAt);
  if (lifecycle.stage === "failed" || lifecycle.stage === "recovery_required") {
    const hasEvmFundingEvidence =
      fundingStatus === "hyper_evm_confirmed_onchain"
      || fundingStatus === "hyper_evm_funded"
      || hypercoreFundingStatus === "pending"
      || hypercoreFundingStatus === "funded";
    return buildBotVaultV3OperationState({
      step: hasEvmFundingEvidence ? "hypercore_funding" : "hyper_evm_deposit",
      state: lifecycle.stage === "failed" ? "failed_retryable" : "failed_final",
      reasonCode: lifecycle.recoveryReason ?? lifecycle.failureReason ?? `funding_${lifecycle.stage}`,
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (lifecycle.stage === "funding_requested" || fundingStatus === "hyper_evm_funding_requested") {
    return buildBotVaultV3OperationState({
      step: "hyper_evm_deposit",
      state: "pending",
      reasonCode: "funding_requested",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (onchainBotVaultAddress && lifecycle.stage === "deployed") {
    return buildBotVaultV3OperationState({
      step: "hyper_evm_deposit",
      state: "pending",
      reasonCode: "funding_not_started",
      amountUsd,
      updatedAt
    });
  }
  if (lifecycle.stage === "perp_margin_transferred" || lifecycle.stage === "hype_reserve_ready") {
    return buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state: "pending_reconciliation",
      reasonCode: "hypercore_final_state_unverified",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (hypercoreFundingStatus === "pending") {
    return buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state: "submitted",
      reasonCode: "hypercore_transfer_pending",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (lifecycle.stage === "hypercore_funded" || hypercoreFundingStatus === "funded") {
    return buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state: "pending",
      reasonCode: "perp_margin_not_started",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }
  if (
    lifecycle.stage === "hyper_evm_confirmed"
    || fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded"
  ) {
    return buildBotVaultV3OperationState({
      step: "hypercore_funding",
      state: "pending",
      reasonCode: "hypercore_funding_not_started",
      amountUsd,
      updatedAt: lifecycle.updatedAt ?? updatedAt
    });
  }

  return recoveryState ?? closeState ?? claimState ?? null;
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
  const mismatchCategory = normalizeBotVaultV4MismatchCategory(raw.mismatchCategory);
  const recoveryAction = normalizeBotVaultV4MismatchRecoveryAction(raw.recoveryAction);
  const recoveryHint = normalizeBotVaultV4RecoveryHint(raw.recoveryHint)
    ?? deriveBotVaultV4RecoveryHint({ mismatchCategory, recoveryAction });
  const detail = String(raw.detail ?? code);
  const statusCategory = normalizeBotVaultV4StatusCategory(raw.statusCategory)
    ?? classifyBotVaultV4Status({
      reason: code,
      detail,
      mismatchCategory,
      recoveryAction,
      issueSeverity: severity
    }).category;
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
    statusCategory,
    mismatchCategory,
    recoveryAction,
    recoveryHint,
    field: toNullableString(raw.field),
    sourceOfTruth,
    detail,
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
  const primaryIssue = issues.find((issue) => issue.severity === "blocking") ?? issues[0] ?? null;
  const statusCategory = normalizeBotVaultV4StatusCategory(raw.statusCategory)
    ?? classifyBotVaultV4Status({
      reconciliationStatus: status,
      issueSeverity: primaryIssue?.severity ?? null,
      reason: primaryIssue?.code ?? raw.detail ?? `bot_vault_v3_reconciliation_${status}`,
      detail: primaryIssue?.detail ?? raw.detail,
      mismatchCategory: primaryIssue?.mismatchCategory ?? null,
      recoveryAction: primaryIssue?.recoveryAction ?? null,
      fallbackCategory: status === "ok" ? "execution_ready" : status === "warning" ? "pending" : "blocked"
    }).category;
  return {
    status,
    statusCategory,
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

function writeAffiliatePayoutWalletMetadata(
  currentMetadata: unknown,
  next: {
    address?: string | null;
    version?: number | null;
    secretRef?: string | null;
    lastBalanceAt?: string | null;
    lastHypeBalanceWei?: string | null;
    lastHypeBalanceFormatted?: string | null;
    lastUsdcBalanceAtomic?: string | null;
    lastUsdcBalanceFormatted?: string | null;
  }
): Record<string, unknown> {
  const metadata = toRecord(currentMetadata);
  const current = readAffiliatePayoutWalletConfig(metadata);
  return {
    ...metadata,
    payoutWallet: {
      address: toNullableString(next.address) ?? current?.address ?? null,
      version: Math.max(1, Math.trunc(Number(next.version ?? current?.version ?? 1) || 1)),
      secretRef: toNullableString(next.secretRef) ?? current?.secretRef ?? null,
      lastBalanceAt: toNullableString(next.lastBalanceAt) ?? current?.lastBalanceAt ?? null,
      lastHypeBalanceWei: toNullableString(next.lastHypeBalanceWei) ?? current?.lastHypeBalanceWei ?? null,
      lastHypeBalanceFormatted: toNullableString(next.lastHypeBalanceFormatted) ?? current?.lastHypeBalanceFormatted ?? null,
      lastUsdcBalanceAtomic: toNullableString(next.lastUsdcBalanceAtomic) ?? current?.lastUsdcBalanceAtomic ?? null,
      lastUsdcBalanceFormatted: toNullableString(next.lastUsdcBalanceFormatted) ?? current?.lastUsdcBalanceFormatted ?? null
    }
  };
}

function mapAffiliatePayoutWalletSummary(profile: any): AffiliatePayoutWalletSummary {
  const config = readAffiliatePayoutWalletConfig(profile?.metadata);
  return {
    address: config?.address ?? null,
    version: Math.max(1, Math.trunc(Number(config?.version ?? 1) || 1)),
    secretRef: config?.secretRef ?? null,
    hypeBalance: config?.lastHypeBalanceFormatted ?? null,
    hypeBalanceWei: config?.lastHypeBalanceWei ?? null,
    usdcBalance: config?.lastUsdcBalanceFormatted ?? null,
    usdcBalanceAtomic: config?.lastUsdcBalanceAtomic ?? null,
    updatedAt: config?.lastBalanceAt ?? null,
    stale: !config?.lastBalanceAt
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
    || lifecycle.stage === "hype_reserve_ready"
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
  const executionMetadata = toRecord(row?.executionMetadata);
  const marginAddFinalization = toRecord(executionMetadata.marginAddFinalization);
  const hypeReserveFailureClass = String(marginAddFinalization.hypeReserveFailureClass ?? "").trim().toLowerCase();
  const hypeReserveReasonCode = toNullableString(marginAddFinalization.hypeReserveReasonCode);
  const hypeReserveDetail = toNullableString(marginAddFinalization.hypeReserveError);
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
  else if (lifecycle.stage === "hype_reserve_ready") fundingHealth = "reserve_ready";
  else if (lifecycle.stage === "execution_ready") fundingHealth = "funded";
  else if (lifecycle.stage === "failed") fundingHealth = "failed";
  else if (lifecycle.stage === "recovery_required") fundingHealth = "recovery_required";
  else if (lifecycle.stage === "settled") fundingHealth = "settled";
  else if (fundingConfirmedOnchain) fundingHealth = "confirmed_onchain";

  let actionState = "idle";
  if (!agentWalletAddress && actionFlags.canSetAgentWallet) actionState = "agent_setup_required";
  else if (hypeReserveFailureClass === "user_action_required") actionState = "user_action_required";
  else if (hypeReserveFailureClass === "recovery_required" || fundingHealth === "recovery_required") actionState = "recovery_required";
  else if (actionFlags.canRecover) actionState = "recover_available";
  else if (actionFlags.canClaim) actionState = "claim_available";
  else if (actionFlags.canClose) actionState = "close_available";
  else if (fundingHealth === "requested" || fundingHealth === "transfer_pending") actionState = "waiting_on_chain";
  else if (executionStatus === "closed" || lifecycleStatus === "closed") actionState = "closed";

  const statusDescriptor = classifyBotVaultV4Status({
    lifecycleStage: lifecycle.stage,
    reason: hypeReserveReasonCode ?? actionState ?? fundingHealth,
    detail: hypeReserveDetail ?? lifecycle.recoveryReason ?? lifecycle.failureReason ?? lifecycleStatus,
    mismatch: hypeReserveFailureClass
      ? classifyBotVaultV4Mismatch({
        reason: hypeReserveReasonCode ?? "bot_vault_v4_hype_reserve_incomplete",
        detail: hypeReserveDetail,
        failureClass: hypeReserveFailureClass,
        defaultCategory: "reserve_bootstrap_incomplete"
      })
      : null,
    fallbackCategory: lifecycle.stage === "settled"
      ? "settled"
      : actionState === "user_action_required" || actionState === "agent_setup_required"
        ? "user_action_required"
        : actionState === "recovery_required"
          ? "recovery_required"
          : lifecycle.stage === "execution_ready"
            ? "execution_ready"
            : "pending"
  });

  return {
    lifecycleStatus,
    fundingHealth,
    onchainStateKnown,
    actionState,
    statusCategory: statusDescriptor.category,
    statusReason: statusDescriptor.reason,
    statusDetail: statusDescriptor.detail,
    statusMismatchCategory: statusDescriptor.mismatchCategory,
    statusRecoveryAction: statusDescriptor.recoveryAction,
    statusRecoveryHint: statusDescriptor.recoveryHint
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
  const contractVersion = String(row?.contractVersion ?? "").trim().toLowerCase() === "v4"
    ? "v4"
    : readBotVaultOnchainContractVersion(executionMetadata);
  const marginAddFinalization = toRecord(executionMetadata.marginAddFinalization);
  const reconciliation = row?.reconciliation && typeof row.reconciliation === "object"
    ? row.reconciliation as BotVaultV3Reconciliation
    : readBotVaultV3Reconciliation(executionMetadata);
  const lifecycleOverrideState = String(executionMetadata.lifecycleOverrideState ?? "").trim().toLowerCase();
  const verificationState = toNullableString(marginAddFinalization.verificationState);
  const verificationBlockingReason = toNullableString(marginAddFinalization.verificationBlockingReason);
  const hypeReserveReasonCode = toNullableString(marginAddFinalization.hypeReserveReasonCode);
  const hypeReserveMismatchCategory = normalizeBotVaultV4MismatchCategory(marginAddFinalization.hypeReserveMismatchCategory);
  const hypeReserveRecoveryAction = normalizeBotVaultV4MismatchRecoveryAction(marginAddFinalization.hypeReserveRecoveryAction);
  const hypeReserveRecoveryHint = normalizeBotVaultV4RecoveryHint(marginAddFinalization.hypeReserveRecoveryHint)
    ?? deriveBotVaultV4RecoveryHint({
      mismatchCategory: hypeReserveMismatchCategory,
      recoveryAction: hypeReserveRecoveryAction
    });
  const hypeReserveState = readBotVaultHypeReserveState(executionMetadata);
  const transferObserved = marginAddFinalization.transferObserved === true;
  const fundingVerified = marginAddFinalization.fundingVerified === true;
  const marginFundingVerified = marginAddFinalization.marginFundingVerified === true;
  const hypeReserveReady = marginAddFinalization.hypeReserveReady === true;
  const finalPerpStateReadable = marginAddFinalization.finalPerpStateReadable === true;
  const finalStateResynced = marginAddFinalization.finalStateResynced === true;
  const pauseStateSafe = marginAddFinalization.pauseStateSafe !== false;
  const perpAvailableMarginAfterUsd = toNonNegativeNumber(marginAddFinalization.perpAvailableMarginAfterUsd);
  const perpEquityAfterUsd = toNonNegativeNumber(marginAddFinalization.perpEquityAfterUsd);
  const reconciliationExecutionSnapshot = reconciliation?.executionSnapshot ?? null;
  const reconciliationPerpEquityUsd = toNonNegativeNumber(reconciliationExecutionSnapshot?.perpEquityUsd);
  const reconciliationPerpAvailableMarginUsd = toNonNegativeNumber(reconciliationExecutionSnapshot?.perpAvailableMarginUsd);
  const primaryReconciliationIssue = reconciliation?.issues.find((issue) => issue.severity === "blocking")
    ?? reconciliation?.issues[0]
    ?? null;

  const buildResult = (
    ready: boolean,
    stage: BotVaultV3ExecutionReadiness["stage"],
    reason: BotVaultV3ExecutionReadinessReason,
    detail?: string | null,
    mismatchOverride?: {
      mismatchCategory?: BotVaultV4MismatchCategory | null;
      recoveryAction?: BotVaultV4MismatchRecoveryAction | null;
      recoveryHint?: BotVaultV4RecoveryHint | null;
    }
  ): BotVaultV3ExecutionReadiness => {
    const normalizedDetail = toNullableString(detail);
    const mismatch = !ready && contractVersion === "v4"
      ? classifyBotVaultV4Mismatch({ reason, detail: normalizedDetail })
      : null;
    const mismatchCategory = mismatchOverride?.mismatchCategory ?? mismatch?.category ?? null;
    const recoveryAction = mismatchOverride?.recoveryAction ?? mismatch?.recoveryAction ?? null;
    const recoveryHint = mismatchOverride?.recoveryHint
      ?? deriveBotVaultV4RecoveryHint({ mismatchCategory, recoveryAction });
    const statusDescriptor = classifyBotVaultV4Status({
      ready,
      lifecycleStage: lifecycle.stage,
      readinessStage: stage,
      reconciliationStatus: reconciliation?.status ?? null,
      issueSeverity: primaryReconciliationIssue?.severity ?? null,
      reason,
      detail: normalizedDetail,
      mismatchCategory,
      recoveryAction,
      fallbackCategory: ready ? "execution_ready" : stage === "blocked" ? "blocked" : "pending"
    });
    return {
      ready,
      stage,
      statusCategory: statusDescriptor.category,
      reason,
      detail: normalizedDetail,
      fundingStatus,
      hypercoreFundingStatus,
      verificationState,
      verificationBlockingReason,
      mismatchCategory,
      recoveryAction,
      recoveryHint
    };
  };

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
      primaryReconciliationIssue?.code ?? reconciliation.detail,
      {
        mismatchCategory: primaryReconciliationIssue?.mismatchCategory ?? null,
        recoveryAction: primaryReconciliationIssue?.recoveryAction ?? null,
        recoveryHint: primaryReconciliationIssue?.recoveryHint ?? null
      }
    );
  }

  if (!hasOnchainVault) {
    return buildResult(false, "configuration", "bot_vault_v3_onchain_vault_missing");
  }

  if (lifecycle.stage === "deployed") {
    return buildResult(
      false,
      "funding",
      contractVersion === "v4"
        ? "bot_vault_v4_funding_requested_not_confirmed"
        : "bot_vault_v3_funding_requested_not_confirmed",
      "deployed"
    );
  }

  if (lifecycle.stage === "funding_requested" || fundingStatus === "hyper_evm_funding_requested") {
    return buildResult(
      false,
      "funding",
      contractVersion === "v4"
        ? "bot_vault_v4_funding_requested_not_confirmed"
        : "bot_vault_v3_funding_requested_not_confirmed"
    );
  }

  if (lifecycle.stage === "execution_ready") {
    if (contractVersion === "v4") {
      if (hypeReserveState !== "ready") {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_hype_reserve_not_ready",
          verificationBlockingReason || hypeReserveReasonCode || hypeReserveState || "hype_reserve_not_ready",
          {
            mismatchCategory: hypeReserveMismatchCategory,
            recoveryAction: hypeReserveRecoveryAction,
            recoveryHint: hypeReserveRecoveryHint
          }
        );
      }
      if (!hypeReserveReady) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_hype_reserve_not_verified",
          verificationBlockingReason || "hype_reserve_ready_flag_missing"
        );
      }
      if (verificationState !== "funding_verified" || !fundingVerified) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_funding_verification_missing",
          verificationBlockingReason || verificationState || "funding_verified_metadata_missing"
        );
      }
      if (!marginFundingVerified || !transferObserved || !finalPerpStateReadable || !finalStateResynced || !pauseStateSafe) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_perp_margin_not_verified",
          verificationBlockingReason
            || (!transferObserved ? "transfer_not_observed" : null)
            || (!marginFundingVerified ? "margin_funding_not_verified" : null)
            || (!finalPerpStateReadable ? "perp_state_read_unavailable" : null)
            || (!finalStateResynced ? "final_state_resync_unavailable" : null)
            || (!pauseStateSafe ? "paused_restore_unconfirmed" : null)
            || "perp_margin_verification_incomplete"
        );
      }
      if (perpEquityAfterUsd <= USD_VERIFICATION_EPSILON || perpAvailableMarginAfterUsd <= USD_VERIFICATION_EPSILON) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_perp_margin_not_verified",
          "perp_margin_after_missing"
        );
      }
      if (!reconciliation || reconciliationExecutionSnapshot?.state !== "ok") {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_reconciliation_snapshot_missing",
          reconciliationExecutionSnapshot?.detail || reconciliation?.detail || "reconciliation_execution_snapshot_missing"
        );
      }
      if (reconciliationPerpEquityUsd <= USD_VERIFICATION_EPSILON || reconciliationPerpAvailableMarginUsd <= USD_VERIFICATION_EPSILON) {
        return buildResult(
          false,
          "verification",
          "bot_vault_v4_perp_margin_not_visible",
          `perp_equity:${reconciliationPerpEquityUsd};perp_available:${reconciliationPerpAvailableMarginUsd}`
        );
      }
      return buildResult(true, "ready", "bot_vault_v3_ready");
    }
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
    contractVersion === "v4"
    && lifecycle.stage === "perp_margin_transferred"
    && hypeReserveState !== "ready"
  ) {
    return buildResult(
      false,
      "verification",
      "bot_vault_v4_hype_reserve_not_ready",
      verificationBlockingReason || hypeReserveReasonCode || hypeReserveState || "hype_reserve_not_ready",
      {
        mismatchCategory: hypeReserveMismatchCategory,
        recoveryAction: hypeReserveRecoveryAction,
        recoveryHint: hypeReserveRecoveryHint
      }
    );
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

  if (lifecycle.stage === "hype_reserve_ready") {
    if (verificationBlockingReason === "paused_restore_unconfirmed") {
      return buildResult(false, "verification", "bot_vault_v3_hypercore_pause_restore_unverified", verificationBlockingReason);
    }
    return buildResult(false, "verification", "bot_vault_v3_hypercore_final_state_unverified", verificationBlockingReason);
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

  return buildResult(
    false,
    "funding",
    contractVersion === "v4"
      ? "bot_vault_v4_funding_requested_not_confirmed"
      : "bot_vault_v3_funding_requested_not_confirmed"
  );
}

function mapBotVaultSummary(row: any): BotVaultV3Summary {
  const actionFlags = buildBotVaultV3ActionFlags(row);
  const healthSummary = buildBotVaultV3HealthSummary(row);
  const executionReadiness = evaluateBotVaultV3ExecutionReadiness(row);
  const reconciliation = readBotVaultV3Reconciliation(row.executionMetadata);
  const lifecycle = readBotVaultV3FundingLifecycleState(row);
  const addresses = readBotVaultV3AddressSemantics(row);
  const contractVersion = resolveBotVaultControllerContractVersion(toRecord(row.executionMetadata).onchainContractVersion);
  const feeConfigSummary = readLockedAffiliateFeeConfig(row.executionMetadata);
  const primaryIssue = reconciliation?.issues.find((issue) => issue.severity === "blocking")
    ?? reconciliation?.issues[0]
    ?? null;
  const statusDescriptor = classifyBotVaultV4Status({
    ready: executionReadiness.ready,
    lifecycleStage: lifecycle.stage,
    readinessStage: executionReadiness.stage,
    reconciliationStatus: reconciliation?.status ?? null,
    issueSeverity: primaryIssue?.severity ?? null,
    reason: executionReadiness.ready
      ? executionReadiness.reason
      : primaryIssue?.code ?? executionReadiness.reason ?? healthSummary.statusReason,
    detail: executionReadiness.ready
      ? executionReadiness.detail
      : primaryIssue?.detail ?? executionReadiness.detail ?? healthSummary.statusDetail,
    mismatchCategory: primaryIssue?.mismatchCategory ?? executionReadiness.mismatchCategory ?? null,
    recoveryAction: primaryIssue?.recoveryAction ?? executionReadiness.recoveryAction ?? null,
    fallbackCategory: healthSummary.statusCategory
  });
  return {
    id: String(row.id),
    botId: String(row.botId),
    userId: String(row.userId),
    vaultModel: String(row.vaultModel ?? "bot_vault_v3"),
    contractVersion,
    beneficiaryAddress: toNullableString(row.beneficiaryAddress),
    ...addresses,
    agentWalletVersion: Math.max(1, Math.trunc(Number(row.agentWalletVersion ?? 1) || 1)),
    agentSecretRef: toNullableString(row.agentSecretRef),
    allocatedUsd: toNonNegativeNumber(row.allocatedUsd),
    availableUsd: toNonNegativeNumber(row.availableUsd),
    withdrawnUsd: toNonNegativeNumber(row.withdrawnUsd),
    claimedProfitUsd: toNonNegativeNumber(row.claimedProfitUsd),
    feePaidTotal: toNonNegativeNumber(row.feePaidTotal),
    profitShareAccruedUsd: toNonNegativeNumber(row.profitShareAccruedUsd),
    fundingStatus: String(row.fundingStatus ?? "vault_empty"),
    hypercoreFundingStatus: String(row.hypercoreFundingStatus ?? "not_funded"),
    fundingLifecycleStage: lifecycle.stage,
    fundingLifecycleUpdatedAt: lifecycle.updatedAt,
    fundingLifecycleHistory: lifecycle.history,
    operationState: deriveBotVaultV3OperationState(row),
    statusCategory: statusDescriptor.category,
    statusReason: statusDescriptor.reason,
    statusDetail: statusDescriptor.detail,
    statusMismatchCategory: statusDescriptor.mismatchCategory,
    statusRecoveryAction: statusDescriptor.recoveryAction,
    statusRecoveryHint: statusDescriptor.recoveryHint,
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
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : toNullableString(row.updatedAt),
    feeConfigSummary
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

const erc20TransferAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)"
]);

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

function clearBotVaultV3ExecutionSettlementMetadataForClosedState(
  executionMetadata: Record<string, unknown>,
  settledAtIso: string
): Record<string, unknown> {
  const lifecycle = toRecord(executionMetadata.lifecycle);
  return {
    ...executionMetadata,
    lifecycle: {
      ...lifecycle,
      state: "closed",
      overrideState: null,
      updatedAt: settledAtIso,
      isTerminal: true,
      executionStatus: "closed",
      canAcceptNewOrders: false,
      needsIntervention: false,
      pendingActionType: null,
      pendingActionStatus: null
    },
    lifecycleOverrideState: null,
    settlementStage: null,
    settlementReadyAt: null,
    settlementLastUpdatedAt: null,
    settlementPerpToSpotAmountUsd: null,
    settlementPerpToSpotTxHash: null,
    settlementPerpToSpotStatus: null,
    settlementSpotToEvmAmountUsd: null,
    settlementSpotToEvmTxHash: null,
    settlementSpotToEvmStatus: null,
    settlementLastError: null,
    reconciliationMonitor: null
  };
}

async function resolveTemplateIdForBot(db: any): Promise<string> {
  const exact = await db.botTemplate.findUnique({
    where: { id: "legacy_grid_default" },
    select: { id: true }
  });
  if (exact?.id) return String(exact.id);
  const fallback = await db.botTemplate.findFirst({
    where: {},
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
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
  statusCategory?: BotVaultV4StatusCategory | null;
  mismatch?: BotVaultV4MismatchClassification | null;
  mismatchCategory?: BotVaultV4MismatchCategory | null;
  recoveryAction?: BotVaultV4MismatchRecoveryAction | null;
  field?: string | null;
  sourceOfTruth: "onchain" | "execution" | "local_settlement" | "derived";
  detail: string;
  autoRecoverable?: boolean;
  autoRecovered?: boolean;
  dbValue?: number | string | null;
  observedValue?: number | string | null;
  expectedValue?: number | string | null;
}): BotVaultV3ReconciliationIssue {
  const mismatchCategory = params.mismatch?.category ?? params.mismatchCategory ?? null;
  const recoveryAction = params.mismatch?.recoveryAction ?? params.recoveryAction ?? null;
  const recoveryHint = deriveBotVaultV4RecoveryHint({ mismatchCategory, recoveryAction });
  const statusCategory = params.statusCategory
    ?? classifyBotVaultV4Status({
      reason: params.code,
      detail: params.detail,
      mismatch: params.mismatch ?? null,
      mismatchCategory,
      recoveryAction,
      issueSeverity: params.severity
    }).category;
  return {
    code: params.code,
    severity: params.severity,
    statusCategory,
    mismatchCategory,
    recoveryAction,
    recoveryHint,
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

type BotVaultV3LifecycleCounterEvidence = {
  code: string;
  severity: "warning" | "blocking";
  mismatch: BotVaultV4MismatchClassification | null;
  sourceOfTruth: "onchain" | "execution" | "derived";
  detail: string;
  targetStage: BotVaultV3FundingLifecycleStage;
  forceRecovery: boolean;
  observedValue: number | string | null;
};

function isBotVaultV3ProgressStageAtLeast(
  stage: BotVaultV3FundingLifecycleStage,
  minimum: BotVaultV3FundingLifecycleStage
): boolean {
  const stageIndex = getBotVaultV3FundingLifecycleProgressIndex(stage);
  const minimumIndex = getBotVaultV3FundingLifecycleProgressIndex(minimum);
  return stageIndex >= 0 && minimumIndex >= 0 && stageIndex >= minimumIndex;
}

function hasBotVaultV3OnchainFundingEvidence(snapshot: BotVaultV3OnchainSnapshot | null): boolean {
  if (!snapshot) return false;
  const status = String(snapshot.status ?? "").trim().toUpperCase();
  return (
    snapshot.principalAllocated > USD_VERIFICATION_EPSILON
    || snapshot.availableUsd > USD_VERIFICATION_EPSILON
    || status === "FUNDED"
    || status === "ACTIVE"
    || status === "PAUSED"
    || status === "CLOSE_ONLY"
    || status === "CLOSED"
  );
}

function buildBotVaultV3LifecycleCounterEvidence(params: {
  currentStage: BotVaultV3FundingLifecycleStage;
  desiredStage: BotVaultV3FundingLifecycleStage;
  onchainSnapshot: BotVaultV3OnchainSnapshot | null;
  executionSnapshot: BotVaultV3ExecutionStateSnapshot;
  fundingIntentStatus: string;
  contractVersion: "v3" | "v4";
}): BotVaultV3LifecycleCounterEvidence | null {
  const executionStateKnown = params.executionSnapshot.state === "ok";
  const executionTotalUsd = toNonNegativeNumber(params.executionSnapshot.totalVisibleUsd);
  const executionPerpUsd = toNonNegativeNumber(params.executionSnapshot.perpEquityUsd);
  const executionSpotUsd = toNonNegativeNumber(params.executionSnapshot.coreSpotUsd);
  const onchainFundingEvidence = hasBotVaultV3OnchainFundingEvidence(params.onchainSnapshot);
  const executionFundingEvidence = executionStateKnown && executionTotalUsd > USD_VERIFICATION_EPSILON;
  const hasAnyFundingEvidence = onchainFundingEvidence || executionFundingEvidence;
  const hasContentSnapshot = Boolean(params.onchainSnapshot) || executionStateKnown;
  const buildV4Mismatch = (
    reason: string,
    detail: string,
    defaultCategory: BotVaultV4MismatchCategory = "local_ahead_of_observed_state"
  ) => params.contractVersion === "v4"
    ? classifyBotVaultV4Mismatch({ reason, detail, defaultCategory })
    : null;

  // Reconcile downgrade rules:
  // - A failed funding action with no observed funds may mark the lifecycle failed.
  // - If onchain reads disprove EVM funding and no venue funds are observed, optimistic funded stages require recovery.
  // - If venue reads prove HyperCore/perp prerequisites are missing, optimistic execution stages require recovery.
  // - If venue reads prove margin exists but final execution-ready prerequisites are incomplete, downgrade to the
  //   strongest observed non-ready stage instead of keeping execution_ready.
  // Read failures intentionally do not produce counterevidence; they are reported separately as blocking issues.
  if (
    params.desiredStage === "failed"
    && params.fundingIntentStatus === "failed"
    && hasContentSnapshot
    && !hasAnyFundingEvidence
  ) {
    return {
      code: "funding_lifecycle_failed_counterevidence",
      severity: "blocking",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_failed_counterevidence",
        "funding action failed and no onchain or venue funding was observed"
      ),
      sourceOfTruth: "derived",
      detail: "funding action failed and no onchain or venue funding was observed",
      targetStage: "failed",
      forceRecovery: false,
      observedValue: params.fundingIntentStatus
    };
  }

  if (
    params.onchainSnapshot
    && isBotVaultV3ProgressStageAtLeast(params.currentStage, "hyper_evm_confirmed")
    && !hasAnyFundingEvidence
  ) {
    return {
      code: "funding_lifecycle_funding_counterevidence",
      severity: "blocking",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_funding_counterevidence",
        "local lifecycle requires funded capital, but the onchain snapshot shows no funding and no venue funds were observed"
      ),
      sourceOfTruth: "onchain",
      detail: "local lifecycle requires funded capital, but the onchain snapshot shows no funding and no venue funds were observed",
      targetStage: "recovery_required",
      forceRecovery: true,
      observedValue: params.onchainSnapshot.status
    };
  }

  if (
    executionStateKnown
    && isBotVaultV3ProgressStageAtLeast(params.currentStage, "hypercore_funded")
    && executionTotalUsd <= USD_VERIFICATION_EPSILON
  ) {
    return {
      code: "funding_lifecycle_hypercore_counterevidence",
      severity: "blocking",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_hypercore_counterevidence",
        "local lifecycle requires HyperCore funding, but venue balances show no visible Core or perp funds"
      ),
      sourceOfTruth: "execution",
      detail: "local lifecycle requires HyperCore funding, but venue balances show no visible Core or perp funds",
      targetStage: "recovery_required",
      forceRecovery: true,
      observedValue: executionTotalUsd
    };
  }

  if (
    executionStateKnown
    && isBotVaultV3ProgressStageAtLeast(params.currentStage, "perp_margin_transferred")
    && executionPerpUsd <= USD_VERIFICATION_EPSILON
    && executionSpotUsd > USD_VERIFICATION_EPSILON
  ) {
    return {
      code: "funding_lifecycle_perp_margin_counterevidence",
      severity: "blocking",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_perp_margin_counterevidence",
        "local lifecycle requires perp margin, but venue balances only show Core spot funds"
      ),
      sourceOfTruth: "execution",
      detail: "local lifecycle requires perp margin, but venue balances only show Core spot funds",
      targetStage: "recovery_required",
      forceRecovery: true,
      observedValue: executionSpotUsd
    };
  }

  if (
    executionStateKnown
    && (
      (params.currentStage === "execution_ready" && (
        params.desiredStage === "hype_reserve_ready"
        || params.desiredStage === "perp_margin_transferred"
      ))
      || (params.currentStage === "hype_reserve_ready" && params.desiredStage === "perp_margin_transferred")
    )
  ) {
    return {
      code: "funding_lifecycle_execution_ready_counterevidence",
      severity: "warning",
      mismatch: buildV4Mismatch(
        "funding_lifecycle_execution_ready_counterevidence",
        `venue state supports ${params.desiredStage}, but not execution_ready`
      ),
      sourceOfTruth: "execution",
      detail: `venue state supports ${params.desiredStage}, but not execution_ready`,
      targetStage: params.desiredStage,
      forceRecovery: false,
      observedValue: executionTotalUsd
    };
  }

  return null;
}

// Compatibility implementation host. New product call sites should import the
// runtime/v4 facade so current BotVault v4 flows are not hidden behind v3 names.
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

  function formatContractBalancePendingReason(params: {
    action: BotVaultV3ContractBalanceAction;
    expectedAmountRaw: bigint;
    actualBalanceRaw: bigint;
  }): string {
    return [
      "bot_vault_v3_pending_reconciliation",
      "insufficient_contract_balance",
      params.action,
      `expectedAtomic=${params.expectedAmountRaw.toString()}`,
      `actualAtomic=${params.actualBalanceRaw.toString()}`
    ].join(":");
  }

  function buildContractBalanceReconciliationIssue(params: {
    action: BotVaultV3ContractBalanceAction;
    expectedAmountRaw: bigint;
    actualBalanceRaw: bigint;
  }) {
    return {
      code: "insufficient_contract_balance",
      action: params.action,
      severity: "blocking",
      statusCategory: "pending",
      mismatchCategory: "observed_state_incomplete",
      recoveryAction: "retry",
      recoveryHint: "retry_reconcile",
      field: "availableUsd",
      sourceOfTruth: "onchain",
      detail: "Vault contract USDC balance is below the expected amount; funds may still be reconciling from HyperCore to HyperEVM.",
      autoRecoverable: true,
      autoRecovered: false,
      dbValue: null,
      observedValue: formatUsdAtomicToNumber(params.actualBalanceRaw),
      expectedValue: formatUsdAtomicToNumber(params.expectedAmountRaw)
    };
  }

  async function markVaultContractBalancePendingReconciliation(params: {
    botVaultId: string;
    vaultAddress: string;
    action: BotVaultV3ContractBalanceAction;
    expectedAmountRaw: bigint;
    actualBalanceRaw: bigint;
  }): Promise<void> {
    const botVault = await findBotVaultRowForUpdate(db, params.botVaultId, {
      id: true,
      executionMetadata: true
    });
    if (!botVault?.id) {
      throw new Error(`bot_vault_v3_contract_balance_pending_target_missing:${params.action}:${params.botVaultId}`);
    }

    const nowIso = new Date().toISOString();
    const currentMetadata = toRecord(botVault.executionMetadata);
    const currentReconciliation = toRecord(currentMetadata.botVaultV3Reconciliation);
    const existingIssues = Array.isArray(currentReconciliation.issues)
      ? currentReconciliation.issues.filter((issue) => toRecord(issue).code !== "insufficient_contract_balance")
      : [];
    const issue = buildContractBalanceReconciliationIssue(params);
    await db.botVault.update({
      where: { id: params.botVaultId },
      data: {
        executionMetadata: {
          ...currentMetadata,
          contractBalanceReconciliation: {
            state: "pending_reconciliation",
            reasonCode: "insufficient_contract_balance",
            recoveryHint: "retry_reconcile",
            action: params.action,
            vaultAddress: params.vaultAddress,
            expectedAmountAtomic: params.expectedAmountRaw.toString(),
            actualBalanceAtomic: params.actualBalanceRaw.toString(),
            expectedAmountUsd: formatUsdAtomicToNumber(params.expectedAmountRaw),
            actualBalanceUsd: formatUsdAtomicToNumber(params.actualBalanceRaw),
            updatedAt: nowIso
          },
          botVaultV3Reconciliation: {
            ...currentReconciliation,
            status: "blocking",
            statusCategory: "pending",
            checkedAt: nowIso,
            detail: "pending_reconciliation:insufficient_contract_balance",
            issues: [issue, ...existingIssues]
          }
        }
      }
    });
  }

  async function clearVaultContractBalancePendingReconciliation(params: {
    botVaultId: string;
    action: BotVaultV3ContractBalanceAction;
  }): Promise<void> {
    const botVault = await findBotVaultRowForUpdate(db, params.botVaultId, {
      id: true,
      executionMetadata: true
    });
    if (!botVault?.id) return;
    const currentMetadata = toRecord(botVault.executionMetadata);
    const pending = toRecord(currentMetadata.contractBalanceReconciliation);
    if (
      pending.state !== "pending_reconciliation"
      || pending.reasonCode !== "insufficient_contract_balance"
      || pending.action !== params.action
    ) {
      return;
    }

    const nextMetadata: Record<string, unknown> = { ...currentMetadata };
    delete nextMetadata.contractBalanceReconciliation;

    const currentReconciliation = toRecord(currentMetadata.botVaultV3Reconciliation);
    const existingIssues = Array.isArray(currentReconciliation.issues)
      ? currentReconciliation.issues.filter((issue) => toRecord(issue).code !== "insufficient_contract_balance")
      : [];
    if (existingIssues.length > 0) {
      nextMetadata.botVaultV3Reconciliation = {
        ...currentReconciliation,
        issues: existingIssues,
        status: existingIssues.some((issue) => toRecord(issue).severity === "blocking") ? "blocking" : "warning"
      };
    } else {
      delete nextMetadata.botVaultV3Reconciliation;
    }

    await db.botVault.update({
      where: { id: params.botVaultId },
      data: {
        executionMetadata: nextMetadata
      }
    }).catch((error) => {
      logger.warn("bot_vault_v3_contract_balance_pending_clear_failed", {
        botVaultId: params.botVaultId,
        action: params.action,
        error: String(error)
      });
    });
  }

  async function ensureVaultContractBalanceReady(params: {
    botVaultId: string;
    vaultAddress: string;
    action: BotVaultV3ContractBalanceAction;
    expectedAmountRaw: bigint;
    actualBalanceRaw: bigint;
  }): Promise<void> {
    if (params.actualBalanceRaw >= params.expectedAmountRaw) {
      await clearVaultContractBalancePendingReconciliation({
        botVaultId: params.botVaultId,
        action: params.action
      });
      return;
    }
    await markVaultContractBalancePendingReconciliation(params);
    throw new Error(formatContractBalancePendingReason(params));
  }

  function logBotVaultV4FundingReserveFlowEvent(
    event: BotVaultV4FundingReserveFlowEvent,
    meta: Record<string, unknown>
  ) {
    logger.warn(`bot_vault_v4_${event}`, {
      operation: "bot_vault_v4_funding",
      flowEvent: event,
      reasonCode: event,
      contractVersion: "v4",
      ...meta
    });
  }

  function logBotVaultV4HypeReserveBootstrapStatus(params: {
    userId: string;
    botVaultId: string;
    source: string;
    status: BotVaultHypeReserveStatus;
    targetHype: number | null;
    budgetUsd: number | null;
    observedBalance: number | null;
    txHash?: string | null;
    resumed?: boolean;
  }) {
    const event = resolveBotVaultV4ReserveBootstrapFlowEvent(params.status);
    if (!event) return;
    const mismatchCategory = params.status.mismatch?.category ?? null;
    const recoveryAction = params.status.mismatch?.recoveryAction ?? null;
    logBotVaultV4FundingReserveFlowEvent(event, {
      userId: params.userId,
      botVaultId: params.botVaultId,
      source: params.source,
      resumed: params.resumed === true,
      reasonCode: params.status.reasonCode ?? event,
      statusCategory: params.status.statusCategory,
      mismatchCategory,
      recoveryAction,
      recoveryHint: deriveBotVaultV4RecoveryHint({ mismatchCategory, recoveryAction }),
      hypeReserveState: params.status.state,
      hypeReserveFailureClass: params.status.failureClass,
      hypeReserveReasonCode: params.status.reasonCode,
      hypeReserveTarget: params.targetHype,
      hypeReserveBudgetUsd: params.budgetUsd,
      hypeReserveObservedBalance: params.observedBalance,
      hypeReserveCanRetry: params.status.canRetry,
      hypeReserveNeedsUserAction: params.status.needsUserAction,
      hypeReserveRequiresRecovery: params.status.requiresRecovery,
      hypeReserveTxHash: params.txHash ?? null,
      detail: params.status.detail
    });
  }

  async function readCoreUsdcSpotBalanceFromAdapterOrNull(
    adapter: any,
    context: Record<string, unknown>,
    fallback: number | null = null
  ): Promise<number | null> {
    try {
      return await readCoreUsdcSpotBalanceFromAdapter(adapter);
    } catch (error) {
      logger.warn("bot_vault_v3_core_spot_balance_read_failed", {
        ...context,
        error: String(error)
      });
      return fallback;
    }
  }

  async function readPerpAccountStateFromAdapterOrNull(
    adapter: any,
    context: Record<string, unknown>
  ): Promise<{ availableMarginUsd: number; equityUsd: number } | null> {
    try {
      return await readPerpAccountStateFromAdapter(adapter);
    } catch (error) {
      logger.warn("bot_vault_v3_perp_account_state_read_failed", {
        ...context,
        error: String(error)
      });
      return null;
    }
  }

  async function readBotVaultEvmUsdcBalanceUsdOrNull(
    params: { vaultAddress: `0x${string}`; controllerAddress?: string | null },
    context: Record<string, unknown>,
    fallback: number | null = null
  ): Promise<number | null> {
    try {
      return await readBotVaultEvmUsdcBalanceUsd(params);
    } catch (error) {
      logger.warn("bot_vault_v3_evm_usdc_balance_read_failed", {
        ...context,
        vaultAddress: params.vaultAddress,
        error: String(error)
      });
      return fallback;
    }
  }

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
    });
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
      });
    }
    if (typeof feeDb?.feeEvent?.findFirst === "function") {
      return feeDb.feeEvent.findFirst({
        where: { sourceKey: params.sourceKey }
      });
    }
    return null;
  }

  async function findBotVaultOwnerUserId(params: {
    dbClient?: any;
    botVaultId: string;
  }): Promise<string | null> {
    const feeDb = params.dbClient ?? db;
    if (!params.botVaultId) return null;
    if (typeof feeDb?.botVault?.findUnique === "function") {
      const row = await feeDb.botVault.findUnique({
        where: { id: params.botVaultId },
        select: { userId: true }
      });
      return toNullableString(row?.userId);
    }
    if (typeof feeDb?.botVault?.findFirst === "function") {
      const row = await feeDb.botVault.findFirst({
        where: { id: params.botVaultId },
        select: { userId: true }
      });
      return toNullableString(row?.userId);
    }
    return null;
  }

  async function findBotVaultExecutionMetadata(params: {
    dbClient?: any;
    botVaultId: string;
  }): Promise<Record<string, unknown>> {
    const feeDb = params.dbClient ?? db;
    if (!params.botVaultId) return {};
    if (typeof feeDb?.botVault?.findUnique === "function") {
      const row = await feeDb.botVault.findUnique({
        where: { id: params.botVaultId },
        select: { executionMetadata: true }
      });
      return toRecord(row?.executionMetadata);
    }
    if (typeof feeDb?.botVault?.findFirst === "function") {
      const row = await feeDb.botVault.findFirst({
        where: { id: params.botVaultId },
        select: { executionMetadata: true }
      });
      return toRecord(row?.executionMetadata);
    }
    return {};
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
    if (existingBeforeCreate) {
      await createAffiliateAccrualFromFeeEventIfEligible({
        dbClient: feeDb,
        feeEvent: existingBeforeCreate
      });
      return "existing";
    }

    if (!feeDb?.feeEvent?.create) {
      throw new Error(`bot_vault_v3_fee_event_persistence_unavailable:${params.sourceAction}:${params.botVaultId}`);
    }

    const referredUserId = await findBotVaultOwnerUserId({
      dbClient: feeDb,
      botVaultId: params.botVaultId
    });
    const executionMetadata = toRecord(await findBotVaultExecutionMetadata({
      dbClient: feeDb,
      botVaultId: params.botVaultId
    }));
    const lockedFeeConfig = toRecord(executionMetadata.feeConfig);
    const contractVersion = normalizeOnchainContractVersion(executionMetadata.onchainContractVersion, "v3");
    const metadata = await decorateFeeEventMetadataWithAffiliateContext({
      dbClient: feeDb,
      referredUserId: referredUserId ?? "",
      feeAmountUsd: roundUsd(params.feeAmountUsd, 6),
      totalFeeRatePct: params.feeRatePct,
      metadata: {
        treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL,
        contractVersion: contractVersion === "v4"
          ? ONCHAIN_TREASURY_CONTRACT_VERSION_V4
          : ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
        onchainPayoutModel: contractVersion === "v4"
          ? ONCHAIN_AFFILIATE_DIRECT_SPLIT_PAYOUT_MODEL
          : ONCHAIN_TREASURY_PAYOUT_MODEL,
        treasuryRecipient: params.treasuryRecipient,
        feeRatePct: params.feeRatePct,
        txHash: params.txHash ?? null,
        sourceAction: params.sourceAction,
        grossAmountUsd: roundUsd(params.grossAmountUsd, 6),
        netReturnedUsd: roundUsd(params.netReturnedUsd, 6),
        netAmountUsd: roundUsd(params.netReturnedUsd, 6),
        excludedPrincipalUsd: roundUsd(params.excludedPrincipalUsd, 6),
        beneficiary: toNullableString(executionMetadata.beneficiaryAddress) ?? null,
        ...(lockedFeeConfig.platformFeeRatePct != null ? { platformFeeRatePct: lockedFeeConfig.platformFeeRatePct } : {}),
        ...(lockedFeeConfig.affiliateFeeRatePct != null ? { affiliateFeeRatePct: lockedFeeConfig.affiliateFeeRatePct } : {}),
        ...(lockedFeeConfig.affiliateUserId != null ? { affiliateUserId: lockedFeeConfig.affiliateUserId } : {}),
        ...(lockedFeeConfig.affiliateRecipientAddress != null ? { affiliateRecipientAddress: lockedFeeConfig.affiliateRecipientAddress } : {}),
        ...(lockedFeeConfig.feeConfigLockedAt != null ? { feeConfigLockedAt: lockedFeeConfig.feeConfigLockedAt } : {})
      }
    });
    metadata.platformFeeAmountUsd = metadata.platformAmountUsd;
    metadata.affiliateFeeAmountUsd = metadata.affiliateAmountUsd;

    try {
      const created = await feeDb.feeEvent.create({
        data: {
          botVaultId: params.botVaultId,
          eventType: "PROFIT_SHARE",
          profitBase: roundUsd(params.profitBaseUsd, 6),
          feeAmount: roundUsd(params.feeAmountUsd, 6),
          sourceKey,
          metadata
        }
      });
      await createAffiliateAccrualFromFeeEventIfEligible({
        dbClient: feeDb,
        feeEvent: created
      });
      return "created";
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existingAfterUnique = await findProfitShareFeeEventBySourceKey({
        dbClient: feeDb,
        sourceKey
      });
      if (existingAfterUnique) {
        await createAffiliateAccrualFromFeeEventIfEligible({
          dbClient: feeDb,
          feeEvent: existingAfterUnique
        });
        return "existing";
      }
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
      profitBaseUsd: 0,
      realizedClosedPnlUsd: null,
      highWaterMarkBeforeUsd: null,
      highWaterMarkAfterUsd: null,
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
      profitBaseUsd: roundUsd(params.settlement.profitBaseUsd, 6),
      realizedClosedPnlUsd: params.settlement.realizedClosedPnlUsd == null
        ? currentSettlement.realizedClosedPnlUsd
        : roundUsd(params.settlement.realizedClosedPnlUsd, 6),
      highWaterMarkBeforeUsd: params.settlement.highWaterMarkBeforeUsd == null
        ? currentSettlement.highWaterMarkBeforeUsd
        : roundUsd(toNonNegativeNumber(params.settlement.highWaterMarkBeforeUsd), 6),
      highWaterMarkAfterUsd: params.settlement.highWaterMarkAfterUsd == null
        ? currentSettlement.highWaterMarkAfterUsd
        : roundUsd(toNonNegativeNumber(params.settlement.highWaterMarkAfterUsd), 6),
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
    settlement: Omit<BotVaultV3ClaimSettlementState, "stage" | "preparedAt" | "confirmedAt" | "appliedAt" | "updatedAt" | "netReturnedUsd">;
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
      profitBaseUsd: 0,
      realizedClosedPnlUsd: null,
      highWaterMarkBeforeUsd: null,
      highWaterMarkAfterUsd: null,
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
      profitBaseUsd: roundUsd(params.settlement.profitBaseUsd, 6),
      realizedClosedPnlUsd: params.settlement.realizedClosedPnlUsd == null
        ? currentSettlement.realizedClosedPnlUsd
        : roundUsd(params.settlement.realizedClosedPnlUsd, 6),
      highWaterMarkBeforeUsd: params.settlement.highWaterMarkBeforeUsd == null
        ? currentSettlement.highWaterMarkBeforeUsd
        : roundUsd(toNonNegativeNumber(params.settlement.highWaterMarkBeforeUsd), 6),
      highWaterMarkAfterUsd: params.settlement.highWaterMarkAfterUsd == null
        ? currentSettlement.highWaterMarkAfterUsd
        : roundUsd(toNonNegativeNumber(params.settlement.highWaterMarkAfterUsd), 6),
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
      if (!botVault?.id) return null;

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
      if (!botVault?.id) return null;

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
      const cleanedExecutionMetadata = clearBotVaultV3ExecutionSettlementMetadataForClosedState({
        ...nextMetadata,
        fundingLifecycle: lifecycleMetadata.fundingLifecycle
      }, settledAtIso);

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
          executionMetadata: cleanedExecutionMetadata
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
      if (!botVault?.id) return null;

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
        profitBaseUsd: roundUsd(currentSettlement.profitBaseUsd, 6),
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
      if (!botVault?.id) return null;

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
        profitBaseUsd: currentSettlement.profitBaseUsd,
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
    onchainContractVersion: "v3" | "v4";
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
        executionMetadata: true,
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
      executionVaultAddress: toNullableString(row.vaultAddress),
      onchainContractVersion: readBotVaultOnchainContractVersion(row.executionMetadata)
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
      }).catch((error) => {
        logger.warn("bot_vault_v3_agent_credentials_read_failed", {
          userId: context.userId,
          botVaultId: context.id,
          agentWalletAddress: String(expectedAgentWallet).toLowerCase(),
          error: String(error)
        });
        return null;
      });
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

  function deriveStoredMarginAddState(executionMetadata: unknown): Record<string, unknown> {
    return toRecord(toRecord(executionMetadata).marginAddFinalization);
  }

  async function readBotVaultV3ExecutionSnapshotLive(params: {
    userId: string;
    botVaultId: string;
  }): Promise<BotVaultV3ExecutionStateSnapshot> {
    const context = await loadExecutionCloseoutContext({
      userId: params.userId,
      botVaultId: params.botVaultId
    }).catch((error) => {
      logger.warn("bot_vault_v3_execution_snapshot_context_read_failed", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        error: String(error)
      });
      return null;
    });
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

    const timeoutExecutionMetadata = toRecord(params.row?.executionMetadata);
    const contractVersion = readBotVaultOnchainContractVersion(timeoutExecutionMetadata);
    logger.warn("bot_vault_v3_funding_intent_timeout", {
      operation: contractVersion === "v4" ? "bot_vault_v4_funding" : "bot_vault_v3_funding",
      flowEvent: "funding_timed_out",
      reasonCode: contractVersion === "v4" ? "bot_vault_v4_funding_timed_out" : timeoutState.reason,
      legacyReasonCode: timeoutState.reason,
      contractVersion,
      statusCategory: "recovery_required",
      mismatchCategory: "funding_verification_missing",
      recoveryAction: "recovery_required",
      recoveryHint: "run_recovery",
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
    throwOnPersistFailure?: boolean;
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
      }).catch((error) => {
        logger.warn("bot_vault_v3_reconciliation_funding_action_read_failed", {
          userId: params.userId,
          botVaultId: String(row.id),
          error: String(error)
        });
        return null;
      })
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
      }).catch((error) => {
        logger.warn("bot_vault_v3_reconciliation_onchain_snapshot_read_failed", {
          userId: params.userId,
          botVaultId: String(row.id),
          vaultAddress,
          error: String(error)
        });
        return null;
      });
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
    const lifecycleExecutionMetadata = toRecord(row.executionMetadata);
    const lifecycleFundingIntent = toRecord(lifecycleExecutionMetadata.fundingIntent);
    const contractVersion = readBotVaultOnchainContractVersion(lifecycleExecutionMetadata);
    const executionTotalUsd = toNonNegativeNumber(executionSnapshot.totalVisibleUsd);
    const executionPerpUsd = toNonNegativeNumber(executionSnapshot.perpEquityUsd);
    const executionSpotUsd = toNonNegativeNumber(executionSnapshot.coreSpotUsd);
    const verificationState = String(marginAddFinalization.verificationState ?? "").trim().toLowerCase();
    const hypeReserveState = readBotVaultHypeReserveState(lifecycleExecutionMetadata);
    const hypeReserveReady = isBotVaultHypeReserveReady(hypeReserveState);
    const fundingIntentStatus = String(lifecycleFundingIntent.actionStatus ?? "").trim().toLowerCase();
    const onchainStatus = String(onchainSnapshot?.status ?? row.status ?? "DEPLOYED");
    const economicallyClosed = onchainStatus === "CLOSED"
      || (onchainStatus === "CLOSE_ONLY" && toNonNegativeNumber(onchainSnapshot?.availableUsd) <= USD_VERIFICATION_EPSILON && toNonNegativeNumber(onchainSnapshot?.principalReturned) > USD_VERIFICATION_EPSILON);

    let desiredLifecycleStage: BotVaultV3FundingLifecycleStage = currentLifecycle.stage;
    if (economicallyClosed) {
      desiredLifecycleStage = "settled";
    } else {
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
        desiredLifecycleStage = contractVersion === "v4" && !hypeReserveReady
          ? "perp_margin_transferred"
          : "execution_ready";
      } else if (executionPerpUsd > USD_VERIFICATION_EPSILON) {
        desiredLifecycleStage = contractVersion === "v4" && hypeReserveReady
          ? "hype_reserve_ready"
          : "perp_margin_transferred";
      } else if (verificationState === "transfer_observed" || verificationState === "transfer_submitted") {
        desiredLifecycleStage = contractVersion === "v4" && hypeReserveReady
          ? "hype_reserve_ready"
          : "perp_margin_transferred";
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

    const lifecycleCounterEvidence = buildBotVaultV3LifecycleCounterEvidence({
      currentStage: currentLifecycle.stage,
      desiredStage: desiredLifecycleStage,
      onchainSnapshot,
      executionSnapshot,
      fundingIntentStatus,
      contractVersion
    });
    const lifecycleComparison = compareBotVaultV3FundingLifecycleStage(currentLifecycle.stage, desiredLifecycleStage);
    const lifecycleTransition = (() => {
      if (desiredLifecycleStage === currentLifecycle.stage && !lifecycleCounterEvidence) return null;
      const canPromote =
        desiredLifecycleStage !== currentLifecycle.stage
        && (
          lifecycleComparison < 0
          || currentLifecycle.stage === "failed"
          || currentLifecycle.stage === "recovery_required"
        )
        && desiredLifecycleStage !== "deployed"
        && Boolean(findBotVaultV3FundingLifecyclePath(currentLifecycle.stage, desiredLifecycleStage));
      if (canPromote) {
        return {
          action: "promote" as const,
          targetStage: desiredLifecycleStage,
          reason: "observed_state_advance",
          detail: onchainStatus,
          issueCode: "funding_lifecycle_stage_out_of_sync",
          issueSeverity: "warning" as const,
          issueDetail: `funding lifecycle was promoted to ${desiredLifecycleStage}`,
          issueSource: "derived" as const,
          mismatch: null,
          observedValue: onchainStatus
        };
      }

      if (!lifecycleCounterEvidence) return null;

      const downgradeTarget = lifecycleCounterEvidence.targetStage;
      if (
        !lifecycleCounterEvidence.forceRecovery
        && downgradeTarget !== currentLifecycle.stage
        && Boolean(findBotVaultV3FundingLifecyclePath(currentLifecycle.stage, downgradeTarget))
      ) {
        return {
          action: "degrade" as const,
          targetStage: downgradeTarget,
          reason: lifecycleCounterEvidence.code,
          detail: lifecycleCounterEvidence.detail,
          issueCode: lifecycleCounterEvidence.code,
          issueSeverity: lifecycleCounterEvidence.severity,
          issueDetail: `funding lifecycle was downgraded to ${downgradeTarget}: ${lifecycleCounterEvidence.detail}`,
          issueSource: lifecycleCounterEvidence.sourceOfTruth,
          mismatch: lifecycleCounterEvidence.mismatch,
          observedValue: lifecycleCounterEvidence.observedValue
        };
      }

      if (
        currentLifecycle.stage !== "recovery_required"
        && Boolean(findBotVaultV3FundingLifecyclePath(currentLifecycle.stage, "recovery_required"))
      ) {
        return {
          action: "block" as const,
          targetStage: "recovery_required" as BotVaultV3FundingLifecycleStage,
          reason: lifecycleCounterEvidence.code,
          detail: lifecycleCounterEvidence.detail,
          issueCode: lifecycleCounterEvidence.code,
          issueSeverity: "blocking" as const,
          issueDetail: `funding lifecycle was moved to recovery_required: ${lifecycleCounterEvidence.detail}`,
          issueSource: lifecycleCounterEvidence.sourceOfTruth,
          mismatch: lifecycleCounterEvidence.mismatch,
          observedValue: lifecycleCounterEvidence.observedValue
        };
      }

      return null;
    })();

    if (lifecycleTransition) {
      Object.assign(
        patchData,
        buildBotVaultV3FundingLifecycleTransitionPatch({
          row,
          targetStage: lifecycleTransition.targetStage,
          source: "reconcile_bot_vault_v3",
          reason: lifecycleTransition.reason,
          detail: lifecycleTransition.detail
        })
      );
    }

    const desiredFundingStatus = String(patchData.fundingStatus ?? row.fundingStatus ?? "vault_empty");
    const desiredHypercoreFundingStatus = String(patchData.hypercoreFundingStatus ?? row.hypercoreFundingStatus ?? "not_funded");
    const desiredExecutionStatus = String(patchData.executionStatus ?? row.executionStatus ?? "created");

    if (currentLifecycle.stage !== desiredLifecycleStage || lifecycleTransition) {
      issues.push(buildBotVaultV3ReconciliationIssue({
        code: lifecycleTransition?.issueCode ?? "funding_lifecycle_stage_out_of_sync",
        severity: lifecycleTransition?.issueSeverity
          ?? (executionSnapshot.state === "ok" || desiredLifecycleStage === "settled" ? "warning" : "blocking"),
        field: "fundingLifecycleStage",
        sourceOfTruth: lifecycleTransition?.issueSource ?? "derived",
        mismatch: lifecycleTransition?.mismatch ?? null,
        detail: lifecycleTransition?.issueDetail
          ?? `funding lifecycle mismatch was left unchanged because actionable counterevidence was not available (${currentLifecycle.stage}->${desiredLifecycleStage})`,
        autoRecoverable: Boolean(lifecycleTransition),
        autoRecovered: Boolean(lifecycleTransition) && params.persist !== false,
        dbValue: currentLifecycle.stage,
        observedValue: lifecycleTransition?.observedValue ?? onchainStatus,
        expectedValue: lifecycleTransition?.targetStage ?? desiredLifecycleStage
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
        mismatch: contractVersion === "v4"
          ? classifyBotVaultV4Mismatch({
              reason: "execution_state_unavailable",
              detail: executionSnapshot.detail ?? "execution state could not be read for reconciliation",
              defaultCategory: "observed_state_incomplete"
            })
          : null,
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
      const reduceMarginContractVersion = String(
        reduceMarginFinalization.contractVersion
        ?? executionMetadata.onchainContractVersion
        ?? "v3"
      ).trim().toLowerCase() === "v4" ? "v4" : "v3";
      const verification = buildReduceMarginVerification({
        contractVersion: reduceMarginContractVersion,
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
        priorTransferObserved:
          reduceMarginFinalization.transferObserved === true
          || ["observed", "verified"].includes(String(reduceMarginFinalization.stage ?? "").trim().toLowerCase()),
        evmBalanceBeforeUsd: toNonNegativeNumber(reduceMarginFinalization.evmBalanceBeforeUsd, 0),
        evmBalanceAfterUsd: onchainSnapshot ? roundUsd(toNonNegativeNumber(onchainSnapshot.availableUsd), 6) : null,
        spotToEvmAmountUsd: toNonNegativeNumber(reduceMarginFinalization.spotToEvmAmountUsd, 0),
        spotToEvmTransferStatus: reduceMarginFinalization.spotToEvmTransferStatus,
        transferStatus: reduceMarginFinalization.transferResultStatus ?? reduceMarginFinalization.stage
      });
      if (!verification.transferObserved) {
        issues.push(buildBotVaultV3ReconciliationIssue({
          code: "reduce_margin_visibility_pending",
          severity: "warning",
          mismatch: reduceMarginContractVersion === "v4"
            ? classifyBotVaultV4Mismatch({
                reason: "reduce_margin_visibility_pending",
                detail: "reduce-margin transfer was submitted but the expected HyperCore spot increase is not visible yet",
                defaultCategory: "observed_state_incomplete"
              })
            : null,
          field: "executionBalances",
          sourceOfTruth: "execution",
          detail: "reduce-margin transfer was submitted but the expected HyperCore spot increase is not visible yet",
          autoRecoverable: false,
          autoRecovered: false,
          observedValue: executionSnapshot.coreSpotUsd,
          expectedValue: verification.expectedCoreSpotAfterUsd
        }));
      } else {
        if (reduceMarginContractVersion === "v4" && !verification.evmTransferObserved) {
          issues.push(buildBotVaultV3ReconciliationIssue({
            code: "reduce_margin_evm_visibility_pending",
            severity: "warning",
            mismatch: classifyBotVaultV4Mismatch({
              reason: "reduce_margin_evm_visibility_pending",
              detail: "reduce-margin drained HyperCore spot, but the expected EVM USDC increase is not visible yet",
              defaultCategory: "observed_state_incomplete"
            }),
            field: "availableUsd",
            sourceOfTruth: "onchain",
            detail: "reduce-margin drained HyperCore spot, but the expected EVM USDC increase is not visible yet",
            autoRecoverable: false,
            autoRecovered: false,
            observedValue: onchainSnapshot?.availableUsd ?? null,
            expectedValue: verification.expectedEvmBalanceAfterUsd
          }));
        } else if (!verification.finalPerpStateReadable) {
          issues.push(buildBotVaultV3ReconciliationIssue({
            code: "reduce_margin_final_state_unverified",
            severity: "warning",
            mismatch: reduceMarginContractVersion === "v4"
              ? classifyBotVaultV4Mismatch({
                  reason: "reduce_margin_final_state_unverified",
                  detail: "reduce-margin transfer is visible in HyperCore spot, but the final perp state could not be read",
                  defaultCategory: "observed_state_incomplete"
                })
              : null,
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
        const reduceMarginPostReconcileState = String(
          reduceMarginFinalization.postReconcileState ?? ""
        ).trim().toLowerCase();
        const reconcileFlowStatus = buildBotVaultV3ReduceMarginFlowStatus({
          contractVersion: reduceMarginContractVersion,
          transferVerificationState: verification.verificationState,
          transferVerificationBlockingReason: verification.verificationBlockingReason,
          postReconcileState: reduceMarginPostReconcileState === "pending"
            ? "pending"
            : reduceMarginPostReconcileState === "recovery_required"
              ? "recovery_required"
              : undefined
        });
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
            stage: verification.reductionVerified
              ? "verified"
              : (
                reduceMarginContractVersion === "v4"
                  ? verification.evmTransferObserved
                  : verification.transferObserved
              )
                ? "observed"
                : "submitted",
            coreSpotBalanceAfterUsd: executionSnapshot.coreSpotUsd,
            coreSpotExpectedAfterUsd: verification.expectedCoreSpotAfterUsd,
            evmBalanceAfterUsd: onchainSnapshot ? roundUsd(toNonNegativeNumber(onchainSnapshot.availableUsd), 6) : null,
            evmExpectedAfterUsd: verification.expectedEvmBalanceAfterUsd,
            perpAvailableMarginAfterUsd: executionSnapshot.perpAvailableMarginUsd,
            perpEquityAfterUsd: executionSnapshot.perpEquityUsd,
            transferObserved: verification.transferObserved,
            evmTransferObserved: verification.evmTransferObserved,
            finalPerpStateReadable: verification.finalPerpStateReadable,
            verificationState: verification.verificationState,
            verificationBlockingReason: verification.verificationBlockingReason,
            flowState: reconcileFlowStatus.flowState,
            statusReason: reconcileFlowStatus.statusReason,
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
    const primaryIssue = issues.find((issue) => issue.severity === "blocking") ?? issues[0] ?? null;
    const reconciliationStatusCategory = classifyBotVaultV4Status({
      reconciliationStatus,
      issueSeverity: primaryIssue?.severity ?? null,
      reason: primaryIssue?.code ?? `bot_vault_v3_reconciliation_${reconciliationStatus}`,
      detail: primaryIssue?.detail ?? null,
      mismatchCategory: primaryIssue?.mismatchCategory ?? null,
      recoveryAction: primaryIssue?.recoveryAction ?? null,
      fallbackCategory: reconciliationStatus === "ok"
        ? "execution_ready"
        : reconciliationStatus === "warning"
          ? "pending"
          : "blocked"
    }).category;
    const reconciliation: BotVaultV3Reconciliation = {
      status: reconciliationStatus,
      statusCategory: reconciliationStatusCategory,
      checkedAt,
      detail: reconciliationStatus === "ok"
        ? "bot_vault_v3_reconciliation_ok"
        : issues[0]?.detail ?? "bot_vault_v3_reconciliation_warning",
      autoApplied: autoApplied || Object.keys(patchData).length > 0,
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
    if (reconciliation.status !== "ok" && (primaryIssue?.mismatchCategory || primaryIssue?.severity === "blocking")) {
      logger.warn("bot_vault_v3_reconciliation_mismatch_detected", {
        userId: params.userId,
        botVaultId: String(row.id),
        status: reconciliation.status,
        statusCategory: reconciliation.statusCategory,
        issueCode: primaryIssue?.code ?? null,
        issueSeverity: primaryIssue?.severity ?? null,
        mismatchCategory: primaryIssue?.mismatchCategory ?? null,
        recoveryAction: primaryIssue?.recoveryAction ?? null,
        recoveryHint: primaryIssue?.recoveryHint ?? null,
        sourceOfTruth: primaryIssue?.sourceOfTruth ?? null,
        detail: primaryIssue?.detail ?? reconciliation.detail
      });
    }

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
        if (params.throwOnPersistFailure) {
          throw new Error(`bot_vault_v3_reconciliation_persist_failed:${String(error)}`);
        }
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

  async function readRequiresHypercoreExitGasTopUp(
    vaultAddress: `0x${string}`,
    contractVersion: "v3" | "v4" = "v3"
  ): Promise<boolean> {
    const targetHype = readBotVaultHypeReserveTarget(contractVersion);
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
    contractVersion?: "v3" | "v4";
  }): Promise<BotVaultHypeReserveResult> {
    const coreWriter = createVaultCoreWriterImpl(params.account);
    const spotClient = createVaultSpotClientImpl(params.account);
    if (!spotClient) {
      throw new Error("bot_vault_v3_hypercore_exit_gas_market_client_missing");
    }
    if (!coreWriter) {
      throw new Error("bot_vault_v3_hypercore_exit_corewriter_missing");
    }

    const contractVersion = params.contractVersion ?? "v3";
    const targetHype = readBotVaultHypeReserveTarget(contractVersion);
    const maxUsdcSpend = readBotVaultHypeReserveBudgetUsd(contractVersion);
    const hypeBefore = toNonNegativeFinite(await readHyperliquidSpotAssetBalanceLive(params.vaultAddress, "HYPE"));
    if (targetHype <= 0 || maxUsdcSpend <= 0) {
      return {
        contractVersion,
        targetHype,
        maxUsdcSpend,
        hypeBalanceBefore: hypeBefore,
        hypeBalanceAfter: hypeBefore,
        spotUsdcBefore: 0,
        spotUsdcBudget: 0,
        state: "not_required",
        txHash: null
      };
    }
    if (hypeBefore >= targetHype - 0.0000001) {
      return {
        contractVersion,
        targetHype,
        maxUsdcSpend,
        hypeBalanceBefore: hypeBefore,
        hypeBalanceAfter: hypeBefore,
        spotUsdcBefore: 0,
        spotUsdcBudget: 0,
        state: "ready",
        txHash: null
      };
    }
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
    const hypeAfter = toNonNegativeFinite(await readHyperliquidSpotAssetBalanceLive(params.vaultAddress, "HYPE"));
    return {
      contractVersion,
      targetHype,
      maxUsdcSpend,
      hypeBalanceBefore: hypeBefore,
      hypeBalanceAfter: hypeAfter,
      spotUsdcBefore,
      spotUsdcBudget: spendBudgetUsd,
      state: hypeAfter + 0.0000001 >= targetHype ? "ready" : "pending",
      txHash: toNullableString(gasOrderResult.txHash)
    };
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

  type HypercoreExitSettlementFailure = {
    step: string;
    error: string;
  };

  type HypercoreExitSettlementResult = {
    failure: HypercoreExitSettlementFailure | null;
    transferredToEvmUsd: number;
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

  function formatHypercoreExitRequiredError(
    check: HypercoreExitCheck,
    settlementFailure?: HypercoreExitSettlementFailure | null
  ): Error {
    return new Error(
      [
        "bot_vault_v3_hypercore_exit_required",
        `withdrawable=${check.state.withdrawable}`,
        `spotUsdc=${String(check.spotUsdcUsd)}`,
        `accountValue=${check.state.accountValue}`,
        `marginUsed=${check.state.totalMarginUsed}`,
        `openPositions=${String(check.openPositionCount)}`,
        ...(settlementFailure
          ? [
              `settlementStep=${settlementFailure.step}`,
              `settlementError=${encodeURIComponent(settlementFailure.error)}`
            ]
          : [])
      ].join(":")
    );
  }

  async function bestEffortSettleHypercoreExit(params: {
    userId: string;
    botVaultId: string;
    onchainStatus: string;
  }): Promise<HypercoreExitSettlementResult> {
    const context = await loadExecutionCloseoutContext(params);
    if (!context?.exchangeAccount || !context.executionVaultAddress || !isAddress(context.executionVaultAddress)) {
      return { failure: null, transferredToEvmUsd: 0 };
    }
    let lastFailure: HypercoreExitSettlementFailure | null = null;
    let transferredToEvmUsd = 0;
    const logSettlementStepFailure = (step: string, error: unknown) => {
      lastFailure = {
        step,
        error: String(error)
      };
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
      return { failure: lastFailure, transferredToEvmUsd };
    }
    const adapter = createPerpExecutionAdapterImpl(account);
    const adapterAny = adapter as any;
    const symbol = context.symbol ?? undefined;
    try {
      await cancelAllOrdersImpl(adapter, symbol).catch((error) => {
        logSettlementStepFailure("cancel_all_orders", error);
        return { requested: 0, cancelled: 0, failed: 0 };
      });
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
          onchainStatus: params.onchainStatus,
          contractVersion: context.onchainContractVersion
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
            transferredToEvmUsd = roundUsd(transferredToEvmUsd + spotUsdcUsd, 6);
            return result;
          }
        ).catch((error) => {
          logSettlementStepFailure("transfer_usdc_spot_to_evm", error);
          return null;
        });
        await sleepImpl(750);
      }
    } catch (error) {
      lastFailure ??= {
        step: "settlement",
        error: String(error)
      };
      logger.warn("bot_vault_v3_hypercore_exit_settlement_failed", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        error: String(error)
      });
    } finally {
      await adapter.close?.().catch(() => undefined);
    }
    return {
      failure: lastFailure,
      transferredToEvmUsd
    };
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
        })
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
        }).catch((error) => {
          logger.warn("bot_vault_v3_user_agent_balance_cache_persist_failed", {
            userId: String(params.user.id),
            error: String(error)
          });
        });
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

  async function refreshAffiliatePayoutWalletSummary(params: {
    userId: string;
    profile?: any;
    persist?: boolean;
  }): Promise<AffiliatePayoutWalletSummary> {
    const profile = params.profile ?? await ensureAffiliateProfileForUser(db, params.userId);
    const current = mapAffiliatePayoutWalletSummary(profile);
    if (!current.address || !isAddress(current.address)) return current;

    try {
      const { publicClient, walletConfig } = buildHyperEvmClient();
      const [hypeBalanceWei, usdcBalanceAtomic] = await Promise.all([
        publicClient.getBalance({ address: current.address as `0x${string}` }).catch(() => null),
        walletConfig.usdcAddress
          ? publicClient.readContract({
              address: walletConfig.usdcAddress,
              abi: erc20BalanceOfAbi,
              functionName: "balanceOf",
              args: [current.address as `0x${string}`]
            }).then((value) => BigInt(value as bigint)).catch(() => null)
          : Promise.resolve(null)
      ]);
      if (hypeBalanceWei == null && usdcBalanceAtomic == null) return current;

      const nextMetadata = writeAffiliatePayoutWalletMetadata(profile.metadata, {
        address: current.address,
        version: current.version,
        secretRef: current.secretRef,
        lastBalanceAt: new Date().toISOString(),
        lastHypeBalanceWei: hypeBalanceWei != null ? hypeBalanceWei.toString() : current.hypeBalanceWei,
        lastHypeBalanceFormatted: hypeBalanceWei != null ? formatUnits(hypeBalanceWei, 18) : current.hypeBalance,
        lastUsdcBalanceAtomic: usdcBalanceAtomic != null ? usdcBalanceAtomic.toString() : current.usdcBalanceAtomic,
        lastUsdcBalanceFormatted: usdcBalanceAtomic != null && walletConfig.usdcAddress
          ? formatUnits(usdcBalanceAtomic, walletConfig.usdcDecimals)
          : current.usdcBalance
      });
      if (params.persist !== false) {
        await db.affiliateProfile.update({
          where: { id: profile.id },
          data: { metadata: nextMetadata }
        }).catch((error) => {
          logger.warn("affiliate_payout_wallet_balance_cache_persist_failed", {
            userId: params.userId,
            affiliateProfileId: String(profile.id),
            error: String(error)
          });
        });
      }
      return mapAffiliatePayoutWalletSummary({ metadata: nextMetadata });
    } catch {
      return current;
    }
  }

  async function getAffiliatePayoutWalletSummary(params: { userId: string; refresh?: boolean }) {
    const profile = await ensureAffiliateProfileForUser(db, params.userId);
    if (params.refresh === false) return mapAffiliatePayoutWalletSummary(profile);
    return refreshAffiliatePayoutWalletSummary({
      userId: params.userId,
      profile
    });
  }

  async function createAffiliatePayoutWallet(params: CreateAffiliatePayoutWalletParams) {
    if (!process.env.SECRET_MASTER_KEY) {
      throw new Error("secret_master_key_missing");
    }
    const profile = await ensureAffiliateProfileForUser(db, params.userId);
    const existing = readAffiliatePayoutWalletConfig(profile.metadata);
    if (existing?.address && isAddress(existing.address)) {
      throw new Error("affiliate_payout_wallet_already_configured");
    }

    const secretPrefix = `affiliate_payout_wallet:${params.userId}:`;
    const lastSecret = await db.agentWalletSecret.findFirst({
      where: {
        userId: params.userId,
        secretRef: {
          startsWith: secretPrefix
        }
      },
      select: { version: true },
      orderBy: { version: "desc" }
    });
    const nextVersion = Math.max(1, Math.trunc(Number(lastSecret?.version ?? 0) || 0) + 1);
    const privateKey = `0x${crypto.randomBytes(32).toString("hex")}` as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    const secretRef = `${secretPrefix}${nextVersion}:${crypto.randomUUID()}`;

    const updatedProfile = await db.$transaction(async (tx: any) => {
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
      return tx.affiliateProfile.update({
        where: { id: profile.id },
        data: {
          metadata: writeAffiliatePayoutWalletMetadata(profile.metadata, {
            address: account.address,
            version: nextVersion,
            secretRef,
            lastBalanceAt: null,
            lastHypeBalanceWei: null,
            lastHypeBalanceFormatted: null,
            lastUsdcBalanceAtomic: null,
            lastUsdcBalanceFormatted: null
          })
        }
      });
    });

    return refreshAffiliatePayoutWalletSummary({
      userId: params.userId,
      profile: updatedProfile
    });
  }

  async function withdrawHypeFromAffiliatePayoutWallet(params: WithdrawAffiliatePayoutHypeParams) {
    const [user, profile] = await Promise.all([
      db.user.findUnique({
        where: { id: params.userId },
        select: {
          id: true,
          walletAddress: true
        }
      }),
      ensureAffiliateProfileForUser(db, params.userId)
    ]);
    if (!user) throw new Error("user_not_found");
    const payoutWallet = readAffiliatePayoutWalletConfig(profile.metadata);
    const targetAddress = toNullableString(user.walletAddress);
    if (!payoutWallet?.address || !isAddress(payoutWallet.address)) throw new Error("affiliate_payout_wallet_missing");
    if (!targetAddress || !isAddress(targetAddress)) throw new Error("linked_wallet_missing");
    const credentials = await agentSecretProvider.getAgentCredentials({
      userId: params.userId,
      masterVaultId: null,
      botVaultId: `affiliate:${params.userId}`,
      agentWalletAddress: payoutWallet.address,
      agentWalletVersion: payoutWallet.version,
      agentSecretRef: payoutWallet.secretRef
    });
    if (!credentials?.privateKey) throw new Error("affiliate_payout_secret_missing");

    const reserveHype = toNonNegativeNumber(params.reserveHype, 0.003);
    const { chain, publicClient, walletConfig } = buildHyperEvmClient();
    const account = privateKeyToAccount(credentials.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(walletConfig.hyperEvmRpcUrl)
    });
    const rawBalance = await publicClient.getBalance({ address: payoutWallet.address as `0x${string}` });
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
    const nextProfile = await db.affiliateProfile.update({
      where: { id: profile.id },
      data: {
        metadata: writeAffiliatePayoutWalletMetadata(profile.metadata, {
          address: payoutWallet.address,
          version: payoutWallet.version,
          secretRef: payoutWallet.secretRef,
          lastBalanceAt: new Date().toISOString(),
          lastHypeBalanceWei: (rawBalance - amountWei).toString(),
          lastHypeBalanceFormatted: formatUnits(rawBalance - amountWei, 18)
        })
      }
    }).catch((error) => {
      logger.warn("affiliate_payout_wallet_hype_withdraw_metadata_persist_failed", {
        userId: params.userId,
        affiliateProfileId: String(profile.id),
        txHash,
        error: String(error)
      });
      return { metadata: profile.metadata };
    });

    return {
      txHash,
      amountHype: formatUnits(amountWei, 18),
      remainingReserveHype: formatUnits(rawBalance - amountWei, 18),
      targetAddress,
      payoutWallet: mapAffiliatePayoutWalletSummary(nextProfile)
    };
  }

  async function withdrawUsdcFromAffiliatePayoutWallet(params: WithdrawAffiliatePayoutUsdcParams) {
    const [user, profile] = await Promise.all([
      db.user.findUnique({
        where: { id: params.userId },
        select: {
          id: true,
          walletAddress: true
        }
      }),
      ensureAffiliateProfileForUser(db, params.userId)
    ]);
    if (!user) throw new Error("user_not_found");
    const payoutWallet = readAffiliatePayoutWalletConfig(profile.metadata);
    const targetAddress = toNullableString(user.walletAddress);
    if (!payoutWallet?.address || !isAddress(payoutWallet.address)) throw new Error("affiliate_payout_wallet_missing");
    if (!targetAddress || !isAddress(targetAddress)) throw new Error("linked_wallet_missing");
    const credentials = await agentSecretProvider.getAgentCredentials({
      userId: params.userId,
      masterVaultId: null,
      botVaultId: `affiliate:${params.userId}`,
      agentWalletAddress: payoutWallet.address,
      agentWalletVersion: payoutWallet.version,
      agentSecretRef: payoutWallet.secretRef
    });
    if (!credentials?.privateKey) throw new Error("affiliate_payout_secret_missing");

    const { chain, publicClient, walletConfig } = buildHyperEvmClient();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");
    const account = privateKeyToAccount(credentials.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(walletConfig.hyperEvmRpcUrl)
    });
    const [rawUsdcBalance, rawHypeBalance] = await Promise.all([
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [payoutWallet.address as `0x${string}`]
      }).then((value) => BigInt(value as bigint)),
      publicClient.getBalance({ address: payoutWallet.address as `0x${string}` }).catch(() => null)
    ]);
    const requestedAtomic = params.amountUsdc != null
      ? parseUnits(roundUsd(Math.max(0, Number(params.amountUsdc)), 6).toFixed(6), walletConfig.usdcDecimals)
      : null;
    const amountAtomic = requestedAtomic ?? rawUsdcBalance;
    if (amountAtomic <= 0n) throw new Error("insufficient_usdc_balance");
    if (amountAtomic > rawUsdcBalance) throw new Error("insufficient_usdc_balance");

    const txHash = await walletClient.sendTransaction({
      account,
      chain,
      to: usdcAddress,
      data: encodeFunctionData({
        abi: erc20TransferAbi,
        functionName: "transfer",
        args: [targetAddress as `0x${string}`, amountAtomic]
      })
    });
    const nextProfile = await db.affiliateProfile.update({
      where: { id: profile.id },
      data: {
        metadata: writeAffiliatePayoutWalletMetadata(profile.metadata, {
          address: payoutWallet.address,
          version: payoutWallet.version,
          secretRef: payoutWallet.secretRef,
          lastBalanceAt: new Date().toISOString(),
          lastHypeBalanceWei: rawHypeBalance != null ? rawHypeBalance.toString() : payoutWallet.lastHypeBalanceWei,
          lastHypeBalanceFormatted: rawHypeBalance != null ? formatUnits(rawHypeBalance, 18) : payoutWallet.lastHypeBalanceFormatted,
          lastUsdcBalanceAtomic: (rawUsdcBalance - amountAtomic).toString(),
          lastUsdcBalanceFormatted: formatUnits(rawUsdcBalance - amountAtomic, walletConfig.usdcDecimals)
        })
      }
    }).catch((error) => {
      logger.warn("affiliate_payout_wallet_usdc_withdraw_metadata_persist_failed", {
        userId: params.userId,
        affiliateProfileId: String(profile.id),
        txHash,
        error: String(error)
      });
      return { metadata: profile.metadata };
    });

    return {
      txHash,
      amountUsdc: formatUnits(amountAtomic, walletConfig.usdcDecimals),
      targetAddress,
      payoutWallet: mapAffiliatePayoutWalletSummary(nextProfile)
    };
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
    });
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
    });

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
      });
      return refreshUserAgentWalletSummary({ user: restored });
    }

    const lastSecret = await db.agentWalletSecret.findFirst({
      where: { userId: params.userId },
      select: { version: true },
      orderBy: { version: "desc" }
    });
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
    }).catch((error) => {
      logger.warn("bot_vault_v3_user_agent_withdraw_balance_cache_persist_failed", {
        userId: params.userId,
        error: String(error)
      });
    });

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
    const onchainContractVersion = resolveBotVaultControllerContractVersion(
      process.env.BOT_VAULT_ONCHAIN_CONTRACT_VERSION
    );
    const lockedFeeConfig = await resolveLockedAffiliateFeeConfig(db, params.userId);

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
        executionMetadata: {
          ...createBotVaultV3FundingLifecycleMetadata("deployed"),
          onchainContractVersion,
          feeConfig: lockedFeeConfig
        }
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
      }).catch((error) => {
        logger.warn("bot_vault_v3_funding_action_read_failed", {
          userId: params.userId,
          botId: params.botId,
          botVaultId: String(botVault.id),
          error: String(error)
        });
        return null;
      })
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
      }).catch((error) => {
        logger.warn("bot_vault_v3_confirmed_funding_reconcile_failed", {
          userId: params.userId,
          botId: params.botId,
          botVaultId: String(botVault.id),
          actionKey: toNullableString(existingFundingAction.actionKey),
          error: String(error)
        });
        return null;
      });
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
    const updatedMetadata = toRecord(updated?.executionMetadata);
    if (readBotVaultOnchainContractVersion(updatedMetadata) === "v4") {
      logBotVaultV4FundingReserveFlowEvent("funding_requested", {
        userId: params.userId,
        botId: params.botId,
        botVaultId: String(botVault.id),
        reasonCode: "bot_vault_v4_funding_requested",
        statusCategory: "user_action_required",
        mismatchCategory: "observed_state_incomplete",
        recoveryAction: "user_action_required",
        recoveryHint: "request_user_action",
        fundingLifecycleStage: "funding_requested",
        fundingStatus: updated?.fundingStatus ?? "hyper_evm_funding_requested",
        hypercoreFundingStatus: updated?.hypercoreFundingStatus ?? "not_funded",
        amountUsd,
        moveToHyperCore,
        actionId: toNullableString(nextAction?.id),
        actionKey: toNullableString(nextAction?.actionKey) ?? nextFundingActionKey,
        actionStatus: nextActionStatus,
        retryAttempt: nextRetryAttempt,
        timeoutAt: nextTimeoutAt
      });
    }
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
        realizedPnlNet: true,
        highWaterMark: true,
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
    const contractVersion = readBotVaultOnchainContractVersion(botVault.executionMetadata);

    const controllerClient = buildControllerWalletClient(expectedControllerAddress);
    const { publicClient } = controllerClient;

    const [statusRaw, principalDepositedRaw, principalReturnedRaw, highWaterMarkProfitRaw, factoryAddress, evmUsdcBalanceRaw, excludedPrincipalUsd, hypercoreState, hypercoreSpotUsdcRaw] = await Promise.all([
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
      contractVersion === "v4"
        ? publicClient.readContract({
            address: vaultAddress as `0x${string}`,
            abi: botVaultV3Abi,
            functionName: "highWaterMarkProfit"
          }) as Promise<bigint>
        : Promise.resolve(0n),
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
      ),
      retryHyperliquidTransient(
        "claim_profit_spot_usdc_balance",
        () => readHyperliquidSpotUsdcBalanceLive(vaultAddress as `0x${string}`)
      )
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
    const feeRatePctRaw = await readBotVaultProfitShareFeeRatePct({
      publicClient,
      factoryAddress,
      vaultAddress: vaultAddress as `0x${string}`
    });
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
          feeBaseRaw: 0n,
          realizedClosedPnlRaw: 0n,
          highWaterMarkBeforeRaw: highWaterMarkProfitRaw,
          highWaterMarkAfterRaw: highWaterMarkProfitRaw,
          realizedClosedPnlUsd: 0,
          highWaterMarkBeforeUsd: formatUsdAtomicToNumber(highWaterMarkProfitRaw),
          highWaterMarkAfterUsd: formatUsdAtomicToNumber(highWaterMarkProfitRaw),
          contractVersion,
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

    const realizedClosedPnlUsd = roundUsd(Number(botVault.realizedPnlNet ?? 0), 6);
    const highWaterMarkBeforeUsd = contractVersion === "v4"
      ? formatUsdAtomicToNumber(highWaterMarkProfitRaw)
      : roundUsd(Number(botVault.highWaterMark ?? 0), 6);
    const profitShare = contractVersion === "v4"
      ? computeV4ProfitShareRaw({
          payoutProfitRaw: requestedAmountRaw,
          feeRatePctRaw,
          realizedClosedPnlUsd,
          highWaterMarkBeforeUsd
        })
      : {
          feeBaseRaw: requestedAmountRaw,
          feeAmountRaw: (requestedAmountRaw * feeRatePctRaw) / 100n,
          realizedClosedPnlRaw: 0n,
          highWaterMarkBeforeRaw: highWaterMarkProfitRaw,
          highWaterMarkAfterRaw: highWaterMarkProfitRaw,
          realizedClosedPnlUsd: 0,
          highWaterMarkBeforeUsd,
          highWaterMarkAfterUsd: highWaterMarkBeforeUsd
        };
    const feeAmountRaw = profitShare.feeAmountRaw;
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
      contractVersion,
      status,
      claimableProfitRaw,
      requestedAmountRaw,
      feeRatePctRaw,
      feeAmountRaw,
      feeBaseRaw: profitShare.feeBaseRaw,
      realizedClosedPnlRaw: profitShare.realizedClosedPnlRaw,
      highWaterMarkBeforeRaw: profitShare.highWaterMarkBeforeRaw,
      highWaterMarkAfterRaw: profitShare.highWaterMarkAfterRaw,
      realizedClosedPnlUsd: profitShare.realizedClosedPnlUsd,
      highWaterMarkBeforeUsd: profitShare.highWaterMarkBeforeUsd,
      highWaterMarkAfterUsd: profitShare.highWaterMarkAfterUsd,
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
      let spotUsdcUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny);
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
            )
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
        spotUsdcUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny);
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
          onchainStatus: params.onchainStatus,
          contractVersion: context.onchainContractVersion
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
      feeBaseUsd: formatUsdAtomicToNumber(quote.feeBaseRaw),
      realizedClosedPnlUsd: quote.realizedClosedPnlUsd,
      highWaterMarkBeforeUsd: quote.highWaterMarkBeforeUsd,
      highWaterMarkAfterUsd: quote.highWaterMarkAfterUsd,
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
      const refreshedEvmUsdcBalanceRaw = await quote.controllerClient.publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as bigint;
      quote = {
        ...quote,
        evmUsdcBalanceRaw: refreshedEvmUsdcBalanceRaw
      };
    }

    await ensureVaultContractBalanceReady({
      botVaultId,
      vaultAddress,
      action: "claim_profit",
      expectedAmountRaw: requestedAmountRaw,
      actualBalanceRaw: quote.evmUsdcBalanceRaw
    });

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
        abi: quote.contractVersion === "v4" ? botVaultV4Abi : botVaultV3Abi,
        functionName: "claimProfit",
        args: quote.contractVersion === "v4"
          ? [requestedAmountRaw, feeAmountRaw, 0n, quote.realizedClosedPnlRaw]
          : [requestedAmountRaw, feeAmountRaw, 0n]
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
        profitBaseUsd: formatUsdAtomicToNumber(quote.feeBaseRaw),
        realizedClosedPnlUsd: quote.realizedClosedPnlUsd,
        highWaterMarkBeforeUsd: quote.highWaterMarkBeforeUsd,
        highWaterMarkAfterUsd: quote.highWaterMarkAfterUsd,
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

  async function readBotVaultEvmUsdcBalanceUsd(params: {
    vaultAddress: `0x${string}`;
    controllerAddress?: string | null;
  }): Promise<number | null> {
    const walletConfig = resolveWalletReadConfig();
    if (!walletConfig.usdcAddress) return null;
    let publicClient: ReturnType<typeof createPublicClient>;
    if (params.controllerAddress && isAddress(params.controllerAddress)) {
      publicClient = buildControllerWalletClient(params.controllerAddress).publicClient;
    } else {
      publicClient = buildHyperEvmClient().publicClient;
    }
    const evmBalanceRaw = await publicClient.readContract({
      address: walletConfig.usdcAddress,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [params.vaultAddress]
    }) as bigint;
    return roundUsd(formatUsdAtomicToNumber(evmBalanceRaw), 6);
  }

  function buildReduceMarginVerification(params: {
    contractVersion?: "v3" | "v4";
    releasedAmountUsd: number;
    coreSpotBalanceBeforeUsd: number;
    coreSpotBalanceAfterUsd: number | null;
    perpAccountStateAfter: { availableMarginUsd: number; equityUsd: number } | null;
    priorTransferObserved?: boolean;
    evmBalanceBeforeUsd?: number | null;
    evmBalanceAfterUsd?: number | null;
    spotToEvmAmountUsd?: number | null;
    spotToEvmTransferStatus?: unknown;
    transferStatus?: unknown;
  }): {
    expectedCoreSpotAfterUsd: number;
    transferObserved: boolean;
    expectedEvmBalanceAfterUsd: number | null;
    evmTransferObserved: boolean;
    spotToEvmTransferConfirmed: boolean;
    finalPerpStateReadable: boolean;
    reductionVerified: boolean;
    verificationState: BotVaultV3ReduceMarginVerificationState;
    verificationBlockingReason: string | null;
  } {
    const contractVersion = params.contractVersion === "v4" ? "v4" : "v3";
    const spotToEvmAmountUsd = roundUsd(
      Math.max(0, toNonNegativeNumber(params.spotToEvmAmountUsd)),
      6
    );
    const expectedCoreSpotAfterUsd = roundUsd(
      params.coreSpotBalanceBeforeUsd + params.releasedAmountUsd - spotToEvmAmountUsd,
      6
    );
    const transferObservedBySpot =
      params.coreSpotBalanceAfterUsd != null
      && roundUsd(params.coreSpotBalanceAfterUsd, 6) + USD_VERIFICATION_EPSILON >= roundUsd(
        params.coreSpotBalanceBeforeUsd + params.releasedAmountUsd,
        6
      );
    const transferObserved =
      params.priorTransferObserved === true
      || transferObservedBySpot;
    const finalPerpStateReadable = params.perpAccountStateAfter != null;
    const transferStatus = String(params.transferStatus ?? "unknown").trim().toLowerCase() || "unknown";
    const transferConfirmed = transferStatus === "confirmed";
    const spotToEvmTransferStatus = String(params.spotToEvmTransferStatus ?? "").trim().toLowerCase();
    const spotToEvmTransferConfirmed =
      contractVersion !== "v4"
      || spotToEvmAmountUsd <= 0.000001
      || spotToEvmTransferStatus === "confirmed";
    const evmBalanceBeforeUsd =
      params.evmBalanceBeforeUsd == null
        ? null
        : roundUsd(toNonNegativeNumber(params.evmBalanceBeforeUsd), 6);
    const expectedEvmBalanceAfterUsd =
      contractVersion === "v4" && evmBalanceBeforeUsd != null
        ? roundUsd(evmBalanceBeforeUsd + spotToEvmAmountUsd, 6)
        : null;
    const evmTransferObserved =
      contractVersion !== "v4"
      || spotToEvmAmountUsd <= 0.000001
      || (
        params.evmBalanceAfterUsd != null
        && expectedEvmBalanceAfterUsd != null
        && roundUsd(params.evmBalanceAfterUsd, 6) + USD_VERIFICATION_EPSILON >= expectedEvmBalanceAfterUsd
      );
    const reductionVerified =
      transferConfirmed
      && transferObserved
      && spotToEvmTransferConfirmed
      && evmTransferObserved
      && finalPerpStateReadable;
    const verificationState =
      reductionVerified
        ? "reduction_verified"
        : contractVersion === "v4" && transferObserved && evmTransferObserved
          ? "evm_transfer_observed"
          : contractVersion === "v4" && transferObserved && spotToEvmAmountUsd > 0.000001
            ? "evm_transfer_submitted"
        : transferObserved
          ? "transfer_observed"
          : "transfer_submitted";
    const verificationBlockingReason = reductionVerified
      ? null
      : !transferConfirmed
        ? `transfer_${transferStatus}`
        : !transferObserved
          ? "transfer_not_yet_observed"
          : contractVersion === "v4" && spotToEvmAmountUsd > 0.000001 && !spotToEvmTransferConfirmed
            ? `spot_to_evm_${spotToEvmTransferStatus || "submitted"}`
          : contractVersion === "v4" && spotToEvmAmountUsd > 0.000001 && !evmTransferObserved
            ? "spot_to_evm_not_yet_observed"
          : !finalPerpStateReadable
            ? "perp_state_read_unavailable"
            : "reduce_margin_verification_incomplete";
    return {
      expectedCoreSpotAfterUsd,
      transferObserved,
      expectedEvmBalanceAfterUsd,
      evmTransferObserved,
      spotToEvmTransferConfirmed,
      finalPerpStateReadable,
      reductionVerified,
      verificationState,
      verificationBlockingReason
    };
  }

  function buildBotVaultV3ReduceMarginFlowStatus(params: {
    contractVersion?: "v3" | "v4";
    transferVerificationState: BotVaultV3ReduceMarginVerificationState;
    transferVerificationBlockingReason?: string | null;
    postReconcileState?: BotVaultV3ReduceMarginPostReconcileState | null;
  }): {
    flowState: BotVaultV3ReduceMarginFlowState;
    statusReason: string;
  } {
    if (params.postReconcileState === "pending") {
      return {
        flowState: "post_reconcile_pending",
        statusReason: "post_reconcile_pending"
      };
    }
    if (params.postReconcileState === "recovery_required") {
      return {
        flowState: "post_reconcile_recovery_required",
        statusReason: "post_reconcile_recovery_required"
      };
    }
    if (params.contractVersion === "v4") {
      if (
        params.transferVerificationState === "reduction_verified"
        || params.transferVerificationState === "evm_transfer_observed"
      ) {
        return {
          flowState: "evm_return_verified",
          statusReason: "evm_return_verified"
        };
      }
      if (
        params.transferVerificationState === "evm_transfer_submitted"
        || String(params.transferVerificationBlockingReason ?? "").startsWith("spot_to_evm")
      ) {
        return {
          flowState: "evm_return_pending",
          statusReason: "evm_return_pending"
        };
      }
    }
    if (params.transferVerificationState === "reduction_verified") {
      return {
        flowState: "transfer_verified",
        statusReason: "transfer_verified"
      };
    }
    return {
      flowState: "transfer_submitted",
      statusReason: "transfer_submitted"
    };
  }

  function logBotVaultV3ReduceMarginFlowEvent(
    event: BotVaultV3ReduceMarginFlowEvent,
    meta: Record<string, unknown>
  ) {
    const contractVersion = String(meta.contractVersion ?? "").trim().toLowerCase();
    const prefix =
      event.startsWith("evm_return")
      || ((event === "request_received" || event === "fully_settled") && contractVersion === "v4")
        ? "bot_vault_v4"
        : "bot_vault_v3";
    const eventFlowState = event === "request_received" || event === "fully_settled"
      ? null
      : event;
    logger.warn(`${prefix}_reduce_margin_${event}`, {
      operation: "reduce_margin",
      flowEvent: event,
      reasonCode: event,
      ...(eventFlowState ? { flowState: eventFlowState } : {}),
      ...meta
    });
  }

  type BotVaultV3ReduceMarginPostReconcileResult = {
    statusCategory: BotVaultV4StatusCategory;
    flowState: BotVaultV3ReduceMarginFlowState;
    statusReason: string;
    settlementState: BotVaultV3ReduceMarginSettlementState;
    settlementReason: string;
    postReconcileState: BotVaultV3ReduceMarginPostReconcileState;
    postReconcileStatusCategory: BotVaultV4StatusCategory | null;
    postReconcileReason: string | null;
    postReconcileError: string | null;
    postReconcileMismatchCategory: BotVaultV4MismatchCategory | null;
    postReconcileRecoveryAction: BotVaultV4MismatchRecoveryAction | null;
    postReconcileCanRetry: boolean;
    verificationState: BotVaultV3ReduceMarginResultState;
    verificationBlockingReason: string | null;
  };

  function buildBotVaultV3ReduceMarginResultStatus(params: {
    contractVersion?: "v3" | "v4";
    transferVerificationState: BotVaultV3ReduceMarginVerificationState;
    transferVerificationBlockingReason: string | null;
    postReconcileState: BotVaultV3ReduceMarginPostReconcileState;
    postReconcileReason: string | null;
    postReconcileCanRetry: boolean;
    postReconcileMismatch?: BotVaultV4MismatchClassification | null;
    postReconcileError?: string | null;
  }): BotVaultV3ReduceMarginPostReconcileResult {
    const flowStatus = buildBotVaultV3ReduceMarginFlowStatus({
      contractVersion: params.contractVersion,
      transferVerificationState: params.transferVerificationState,
      transferVerificationBlockingReason: params.transferVerificationBlockingReason,
      postReconcileState: params.postReconcileState
    });
    const settlementState: BotVaultV3ReduceMarginSettlementState =
      params.postReconcileState === "applied" ? "fully_settled" : flowStatus.flowState;
    const settlementReason =
      params.postReconcileState === "applied" ? "fully_settled" : flowStatus.statusReason;
    if (params.postReconcileState === "pending") {
      const statusCategory = classifyBotVaultV4Status({
        reason: params.postReconcileReason ?? "bot_vault_v3_reduce_margin_post_reconcile_pending",
        detail: params.postReconcileError,
        mismatch: params.postReconcileMismatch ?? null,
        fallbackCategory: "retryable"
      }).category;
      return {
        statusCategory,
        ...flowStatus,
        settlementState,
        settlementReason,
        postReconcileState: "pending",
        postReconcileStatusCategory: statusCategory,
        postReconcileReason: params.postReconcileReason ?? "bot_vault_v3_reduce_margin_post_reconcile_pending",
        postReconcileError: params.postReconcileError ?? null,
        postReconcileMismatchCategory: params.postReconcileMismatch?.category ?? "post_transfer_reconcile_failed",
        postReconcileRecoveryAction: params.postReconcileMismatch?.recoveryAction ?? "retry",
        postReconcileCanRetry: params.postReconcileCanRetry,
        verificationState: "post_reconcile_pending",
        verificationBlockingReason: params.postReconcileReason ?? "bot_vault_v3_reduce_margin_post_reconcile_pending"
      };
    }
    if (params.postReconcileState === "recovery_required") {
      const statusCategory = classifyBotVaultV4Status({
        reason: params.postReconcileReason ?? "bot_vault_v3_reduce_margin_post_reconcile_recovery_required",
        detail: params.postReconcileError,
        mismatch: params.postReconcileMismatch ?? null,
        fallbackCategory: "recovery_required"
      }).category;
      return {
        statusCategory,
        ...flowStatus,
        settlementState,
        settlementReason,
        postReconcileState: "recovery_required",
        postReconcileStatusCategory: statusCategory,
        postReconcileReason: params.postReconcileReason ?? "bot_vault_v3_reduce_margin_post_reconcile_recovery_required",
        postReconcileError: params.postReconcileError ?? null,
        postReconcileMismatchCategory: params.postReconcileMismatch?.category ?? "post_transfer_reconcile_failed",
        postReconcileRecoveryAction: params.postReconcileMismatch?.recoveryAction ?? "recovery_required",
        postReconcileCanRetry: false,
        verificationState: "post_reconcile_recovery_required",
        verificationBlockingReason: params.postReconcileReason ?? "bot_vault_v3_reduce_margin_post_reconcile_recovery_required"
      };
    }
    const statusCategory = classifyBotVaultV4Status({
      ready: params.transferVerificationState === "reduction_verified" && params.postReconcileState === "applied",
      reason: params.postReconcileReason ?? params.transferVerificationBlockingReason ?? params.transferVerificationState,
      detail: params.postReconcileError,
      mismatch: params.postReconcileMismatch ?? null,
      fallbackCategory: params.transferVerificationState === "reduction_verified"
        ? "execution_ready"
        : params.transferVerificationBlockingReason
          ? "retryable"
          : "pending"
    }).category;
    return {
      statusCategory,
      ...flowStatus,
      settlementState,
      settlementReason,
      postReconcileState: params.postReconcileState,
      postReconcileStatusCategory: params.postReconcileState === "not_required" ? null : statusCategory,
      postReconcileReason: params.postReconcileReason,
      postReconcileError: params.postReconcileError ?? null,
      postReconcileMismatchCategory: params.postReconcileMismatch?.category ?? null,
      postReconcileRecoveryAction: params.postReconcileMismatch?.recoveryAction ?? null,
      postReconcileCanRetry: params.postReconcileCanRetry,
      verificationState: params.transferVerificationState,
      verificationBlockingReason: params.transferVerificationBlockingReason
    };
  }

  function classifyBotVaultV3ReduceMarginPostReconcileBlocking(params: {
    summary: BotVaultV3Summary | null;
  }): {
    state: "applied" | "pending" | "recovery_required";
    reason: string | null;
    error: string | null;
    mismatch: BotVaultV4MismatchClassification | null;
    canRetry: boolean;
  } {
    const reconciliation = params.summary?.reconciliation ?? null;
    if (!params.summary || !reconciliation) {
      return {
        state: "pending",
        reason: "bot_vault_v3_reduce_margin_post_reconcile_summary_missing",
        error: "post-reconcile summary was not available after reduce-margin verification",
        mismatch: classifyBotVaultV4Mismatch({
          reason: "bot_vault_v3_reduce_margin_post_reconcile_summary_missing",
          detail: "post-reconcile summary was not available after reduce-margin verification",
          defaultCategory: "post_transfer_reconcile_failed"
        }),
        canRetry: true
      };
    }
    const blockingIssue = reconciliation.issues.find((issue) => issue.severity === "blocking") ?? null;
    if (!blockingIssue) {
      return {
        state: "applied",
        reason: null,
        error: null,
        mismatch: null,
        canRetry: false
      };
    }
    if (
      blockingIssue.code === "execution_state_unavailable"
      || /unavailable|could not be read|read/i.test(blockingIssue.detail)
    ) {
      return {
        state: "pending",
        reason: blockingIssue.code,
        error: blockingIssue.detail,
        mismatch: blockingIssue.mismatchCategory
          ? classifyBotVaultV4Mismatch({
              reason: blockingIssue.code,
              detail: blockingIssue.detail,
              defaultCategory: blockingIssue.mismatchCategory
            })
          : classifyBotVaultV4Mismatch({
              reason: blockingIssue.code,
              detail: blockingIssue.detail,
              defaultCategory: "post_transfer_reconcile_failed"
            }),
        canRetry: true
      };
    }
    return {
      state: "recovery_required",
      reason: blockingIssue.code,
      error: blockingIssue.detail,
      mismatch: classifyBotVaultV4Mismatch({
        reason: blockingIssue.code,
        detail: blockingIssue.detail,
        defaultCategory: blockingIssue.mismatchCategory ?? "post_transfer_reconcile_failed"
      }),
      canRetry: false
    };
  }

  async function finalizeBotVaultV3ReduceMarginPostReconcile(params: {
    userId: string;
    botVaultId: string;
    currentMetadata: Record<string, unknown>;
    reduceMarginFinalization: Record<string, unknown>;
    phase: string;
    transferVerificationState: BotVaultV3ReduceMarginVerificationState;
    transferVerificationBlockingReason: string | null;
    reductionVerified: boolean;
  }): Promise<BotVaultV3ReduceMarginPostReconcileResult> {
    const contractVersion = String(params.reduceMarginFinalization.contractVersion ?? "").trim().toLowerCase() === "v4"
      ? "v4"
      : "v3";
    if (!params.reductionVerified) {
      return buildBotVaultV3ReduceMarginResultStatus({
        contractVersion,
        transferVerificationState: params.transferVerificationState,
        transferVerificationBlockingReason: params.transferVerificationBlockingReason,
        postReconcileState: "not_required",
        postReconcileReason: null,
        postReconcileCanRetry: false
      });
    }

    let postReconcile: {
      state: "applied" | "pending" | "recovery_required";
      reason: string | null;
      error: string | null;
      mismatch: BotVaultV4MismatchClassification | null;
      canRetry: boolean;
    } = {
      state: "pending" as "applied" | "pending" | "recovery_required",
      reason: "bot_vault_v3_reduce_margin_post_reconcile_pending",
      error: null as string | null,
      mismatch: classifyBotVaultV4Mismatch({
        reason: "bot_vault_v3_reduce_margin_post_reconcile_pending",
        defaultCategory: "post_transfer_reconcile_failed"
      }),
      canRetry: true
    };
    let postReconcileSummary: BotVaultV3Summary | null = null;
    try {
      postReconcileSummary = await reconcileBotVaultV3ById({
        userId: params.userId,
        botVaultId: params.botVaultId,
        persist: true,
        throwOnPersistFailure: true
      });
      postReconcile = classifyBotVaultV3ReduceMarginPostReconcileBlocking({ summary: postReconcileSummary });
    } catch (error) {
      postReconcile = {
        state: "pending",
        reason: "bot_vault_v3_reduce_margin_post_reconcile_failed",
        error: String(error),
        mismatch: classifyBotVaultV4Mismatch({
          reason: "bot_vault_v3_reduce_margin_post_reconcile_failed",
          detail: String(error),
          defaultCategory: "post_transfer_reconcile_failed"
        }),
        canRetry: true
      };
      logger.warn("bot_vault_v3_reduce_margin_reconcile_failed", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        phase: params.phase,
        mismatchCategory: postReconcile.mismatch?.category ?? null,
        recoveryAction: postReconcile.mismatch?.recoveryAction ?? null,
        statusCategory: classifyBotVaultV4Status({
          reason: "bot_vault_v3_reduce_margin_post_reconcile_failed",
          detail: String(error),
          mismatch: postReconcile.mismatch,
          fallbackCategory: "retryable"
        }).category,
        error: String(error)
      });
    }

    const status = buildBotVaultV3ReduceMarginResultStatus({
      contractVersion,
      transferVerificationState: params.transferVerificationState,
      transferVerificationBlockingReason: params.transferVerificationBlockingReason,
      postReconcileState: postReconcile.state,
      postReconcileReason: postReconcile.reason,
      postReconcileError: postReconcile.error,
      postReconcileMismatch: postReconcile.mismatch,
      postReconcileCanRetry: postReconcile.canRetry
    });
    const now = new Date().toISOString();
    await persistBotVaultV3StateOrThrow({
      botVaultId: params.botVaultId,
      operation: "reduce_margin",
      phase: "post_reconcile_status",
      meta: {
        userId: params.userId,
        sourcePhase: params.phase
      },
      data: {
        executionMetadata: {
          ...params.currentMetadata,
          ...(postReconcileSummary?.reconciliation
            ? { botVaultV3Reconciliation: postReconcileSummary.reconciliation }
            : {}),
          lastAction: status.postReconcileState === "applied"
            ? "bot_vault_v3_reduce_margin_reconciled"
            : status.postReconcileState === "recovery_required"
              ? "bot_vault_v3_reduce_margin_post_reconcile_recovery_required"
              : "bot_vault_v3_reduce_margin_post_reconcile_pending",
          reduceMarginFinalization: {
            ...params.reduceMarginFinalization,
            transferVerificationState: params.transferVerificationState,
            statusCategory: status.statusCategory,
            flowState: status.flowState,
            statusReason: status.statusReason,
            settlementState: status.settlementState,
            settlementReason: status.settlementReason,
            postReconcileState: status.postReconcileState,
            postReconcileStatusCategory: status.postReconcileStatusCategory,
            postReconcileReason: status.postReconcileReason,
            postReconcileError: status.postReconcileError,
            postReconcileMismatchCategory: status.postReconcileMismatchCategory,
            postReconcileRecoveryAction: status.postReconcileRecoveryAction,
            postReconcileCanRetry: status.postReconcileCanRetry,
            postReconciledAt: status.postReconcileState === "applied" ? now : null,
            postReconcilePendingAt: status.postReconcileState === "pending" ? now : null,
            verificationState: status.verificationState,
            verificationBlockingReason: status.verificationBlockingReason,
            stage: status.postReconcileState === "applied"
              ? "verified"
              : status.postReconcileState === "recovery_required"
                ? "recovery_required"
                : "post_reconcile_pending",
            updatedAt: now
          }
        }
      }
    });
    if (status.postReconcileState === "pending") {
      logBotVaultV3ReduceMarginFlowEvent("post_reconcile_pending", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        phase: params.phase,
        statusCategory: status.statusCategory,
        statusReason: status.statusReason,
        postReconcileReason: status.postReconcileReason,
        mismatchCategory: status.postReconcileMismatchCategory,
        recoveryAction: status.postReconcileRecoveryAction,
        canRetry: status.postReconcileCanRetry,
        error: status.postReconcileError
      });
    } else if (status.postReconcileState === "recovery_required") {
      logBotVaultV3ReduceMarginFlowEvent("post_reconcile_recovery_required", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        phase: params.phase,
        statusCategory: status.statusCategory,
        statusReason: status.statusReason,
        postReconcileReason: status.postReconcileReason,
        mismatchCategory: status.postReconcileMismatchCategory,
        recoveryAction: status.postReconcileRecoveryAction,
        canRetry: status.postReconcileCanRetry,
        error: status.postReconcileError
      });
    } else if (status.postReconcileState === "applied") {
      logBotVaultV3ReduceMarginFlowEvent("fully_settled", {
        userId: params.userId,
        botVaultId: params.botVaultId,
        phase: params.phase,
        contractVersion,
        statusCategory: status.statusCategory,
        flowState: status.flowState,
        statusReason: status.statusReason,
        settlementState: status.settlementState,
        settlementReason: status.settlementReason,
        postReconcileState: status.postReconcileState,
        transferVerificationState: params.transferVerificationState,
        verificationBlockingReason: status.verificationBlockingReason,
        mismatchCategory: status.postReconcileMismatchCategory,
        recoveryAction: status.postReconcileRecoveryAction
      });
    }
    return status;
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

    const currentMetadata = toRecord(botVault.executionMetadata);
    const existingMarginAddFinalization = deriveStoredMarginAddState(botVault.executionMetadata);
    const existingMarginAddVerificationState = String(
      existingMarginAddFinalization.verificationState ?? ""
    ).trim().toLowerCase();
    const existingMarginAddRequestedAmountUsd = roundUsd(
      toNonNegativeNumber(existingMarginAddFinalization.requestedAmountUsd),
      6
    );
    const hasPendingMarginAddFinalization =
      Object.keys(existingMarginAddFinalization).length > 0
      && existingMarginAddVerificationState !== ""
      && existingMarginAddVerificationState !== "funding_verified";
    if (
      hasPendingMarginAddFinalization
      && existingMarginAddRequestedAmountUsd > 0
      && hasUsdDrift(existingMarginAddRequestedAmountUsd, requestedAmountUsd)
    ) {
      throw new Error("bot_vault_v3_margin_add_pending_conflict");
    }

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
    const contractVersion = readBotVaultOnchainContractVersion(botVault.executionMetadata);
    const hypeReserveTarget = readBotVaultHypeReserveTarget(contractVersion);
    const hypeReserveBudgetUsd = readBotVaultHypeReserveBudgetUsd(contractVersion);
    const requiresHypeReserve = contractVersion === "v4" && hypeReserveTarget > 0 && hypeReserveBudgetUsd > 0;

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

      if (hasPendingMarginAddFinalization) {
        let pauseRestoreTxHash: string | null = toNullableString(existingMarginAddFinalization.pauseTxHash);
        let pauseRestoreConfirmed = existingMarginAddFinalization.restoredPaused === true;
        const storedInitialStatus = String(
          existingMarginAddFinalization.initialStatus ?? initialStatus
        ).trim().toUpperCase();

        if (storedInitialStatus === "PAUSED" && currentStatus === "ACTIVE" && !pauseRestoreConfirmed) {
          try {
            pauseRestoreTxHash = await sendSerializedControllerTransaction({
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
              hash: pauseRestoreTxHash as `0x${string}`,
              confirmations: 1
            });
            pauseRestoreConfirmed = pauseReceipt.status === "success";
            if (pauseRestoreConfirmed) {
              currentStatus = "PAUSED";
            }
          } catch (error) {
            logger.warn("bot_vault_v3_margin_add_resume_pause_restore_failed", {
              userId: params.userId,
              botVaultId: String(botVault.id),
              error: String(error)
            });
          }
        } else if (storedInitialStatus === "PAUSED" && currentStatus === "PAUSED") {
          pauseRestoreConfirmed = true;
        }

        const resumedCoreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapterOrNull(adapterAny, {
          userId: params.userId,
          botVaultId: String(botVault.id),
          phase: "margin_add_resume_after_transfer"
        });
        const resumedPerpAccountStateAfter = await readPerpAccountStateFromAdapterOrNull(adapter, {
          userId: params.userId,
          botVaultId: String(botVault.id),
          phase: "margin_add_resume_after_transfer"
        });
        const storedCoreSpotBeforeUsd = roundUsd(
          toNonNegativeNumber(existingMarginAddFinalization.coreSpotBalanceBeforeUsd),
          6
        );
        const storedDepositedAmountUsd = roundUsd(
          toNonNegativeNumber(existingMarginAddFinalization.depositedAmountUsd),
          6
        );
        const expectedCoreSpotAfterUsd = roundUsd(
          existingMarginAddFinalization.coreSpotExpectedAfterUsd == null
            ? Math.max(0, storedCoreSpotBeforeUsd + storedDepositedAmountUsd - requestedAmountUsd)
            : toNonNegativeNumber(existingMarginAddFinalization.coreSpotExpectedAfterUsd),
          6
        );
        const storedPerpEquityBeforeUsd = existingMarginAddFinalization.perpEquityBeforeUsd == null
          ? null
          : roundUsd(toNonNegativeNumber(existingMarginAddFinalization.perpEquityBeforeUsd), 6);
        const transferObservedBySpot =
          resumedCoreSpotBalanceAfterUsd != null
          && roundUsd(resumedCoreSpotBalanceAfterUsd, 6) <= expectedCoreSpotAfterUsd + USD_VERIFICATION_EPSILON;
        const transferObservedByPerp =
          storedPerpEquityBeforeUsd != null
          && resumedPerpAccountStateAfter != null
          && roundUsd(resumedPerpAccountStateAfter.equityUsd, 6) + USD_VERIFICATION_EPSILON >= roundUsd(
            storedPerpEquityBeforeUsd + requestedAmountUsd,
            6
          );
        const transferObserved =
          existingMarginAddFinalization.transferObserved === true
          || transferObservedBySpot
          || transferObservedByPerp;
        let hypeReserveResult: BotVaultHypeReserveResult | null = null;
        let hypeReserveError: string | null = toNullableString(existingMarginAddFinalization.hypeReserveError);
        let hypeReserveState = requiresHypeReserve
          ? String(
              existingMarginAddFinalization.hypeReserveState
              ?? readBotVaultHypeReserveState(currentMetadata)
              ?? "pending"
            ).trim().toLowerCase()
          : "not_required";

        if (requiresHypeReserve && !isBotVaultHypeReserveReady(hypeReserveState)) {
          try {
            hypeReserveResult = await retryHyperliquidTransient(
              "resume_hypercore_start_hype_reserve",
              () => ensureHypercoreExitGas({
                account,
                vaultAddress: vaultAddress as `0x${string}`,
                onchainStatus: currentStatus,
                contractVersion
              })
            );
            hypeReserveState = hypeReserveResult.state;
            hypeReserveError = null;
          } catch (error) {
            hypeReserveError = String(error);
            const mismatch = classifyBotVaultV4Mismatch({
              reason: hypeReserveError,
              detail: hypeReserveError,
              defaultCategory: "reserve_bootstrap_incomplete"
            });
            logger.warn("bot_vault_v4_hype_reserve_resume_failed", {
              userId: params.userId,
              botVaultId: String(botVault.id),
              mismatchCategory: mismatch?.category ?? null,
              recoveryAction: mismatch?.recoveryAction ?? null,
              error: hypeReserveError
            });
          }
        }

        const hypeReserveStatus = buildBotVaultHypeReserveStatus({
          requiresHypeReserve,
          result: hypeReserveResult,
          error: hypeReserveError,
          fallbackState: hypeReserveState
        });
        hypeReserveState = hypeReserveStatus.state;
        hypeReserveError = hypeReserveStatus.detail;
        if (contractVersion === "v4" && requiresHypeReserve) {
          logBotVaultV4HypeReserveBootstrapStatus({
            userId: params.userId,
            botVaultId: String(botVault.id),
            source: "finalize_margin_add_resume",
            status: hypeReserveStatus,
            targetHype: hypeReserveTarget,
            budgetUsd: hypeReserveBudgetUsd,
            observedBalance: hypeReserveResult?.hypeBalanceAfter
              ?? (existingMarginAddFinalization.hypeReserveObservedBalance == null
                ? null
                : toNonNegativeNumber(existingMarginAddFinalization.hypeReserveObservedBalance)),
            txHash: hypeReserveResult?.txHash ?? toNullableString(existingMarginAddFinalization.hypeReserveTxHash),
            resumed: true
          });
        }

        const postResyncSnapshot = await resyncBotVaultV3StateFromChain({
          botVaultId: String(botVault.id),
          vaultAddress: vaultAddress as `0x${string}`,
          publicClient,
          usdcAddress
        }).catch((error) => {
          logger.warn("bot_vault_v3_margin_add_resume_post_resync_failed", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            error: String(error)
          });
          return null;
        });
        const finalStateResynced = postResyncSnapshot !== null;
        const finalPerpStateReadable = resumedPerpAccountStateAfter != null;
        const pauseStateSafe = storedInitialStatus !== "PAUSED" || pauseRestoreConfirmed;
        const transferStatus = String(
          existingMarginAddFinalization.transferResultStatus
          ?? existingMarginAddVerificationState
          ?? "unknown"
        ).trim().toLowerCase();
        const transferConfirmed =
          transferStatus === "confirmed"
          || existingMarginAddFinalization.transferSubmitted === true
          || Boolean(toNullableString(existingMarginAddFinalization.transferTxHash))
          || transferObserved;
        const marginFundingVerified =
          transferConfirmed
          && transferObserved
          && finalPerpStateReadable
          && finalStateResynced
          && pauseStateSafe;
        const hypeReserveReady = !requiresHypeReserve || isBotVaultHypeReserveReady(hypeReserveState);
        const fundingVerified = marginFundingVerified && hypeReserveReady;
        const hypeReserveBlockingReason = !hypeReserveReady
          ? hypeReserveStatus.reasonCode ?? "bot_vault_v4_hype_reserve_pending"
          : null;
        const verificationState =
          fundingVerified
            ? "funding_verified"
            : marginFundingVerified && hypeReserveBlockingReason
              ? (
                  hypeReserveStatus.failureClass === "user_action_required"
                    ? "hype_reserve_user_action_required"
                    : hypeReserveStatus.failureClass === "recovery_required"
                      ? "hype_reserve_recovery_required"
                      : hypeReserveStatus.failureClass === "retryable"
                        ? "hype_reserve_retryable"
                        : "hype_reserve_pending"
                )
            : transferObserved
              ? "transfer_observed"
              : "transfer_submitted";
        const verificationBlockingReason = fundingVerified
          ? null
          : marginFundingVerified && hypeReserveBlockingReason
            ? hypeReserveBlockingReason
          : !transferConfirmed
            ? `transfer_${transferStatus || "unknown"}`
            : !transferObserved
              ? "transfer_not_yet_observed"
              : !finalPerpStateReadable
                ? "perp_state_read_unavailable"
                : !finalStateResynced
                  ? "final_state_resync_unavailable"
                : !pauseStateSafe
                    ? "paused_restore_unconfirmed"
                    : "funding_verification_incomplete";
        const lifecycleTargetStage: BotVaultV3FundingLifecycleStage =
          contractVersion === "v4" && hypeReserveStatus.requiresRecovery
            ? "recovery_required"
            : contractVersion === "v4"
            ? (
                hypeReserveReady
                  ? (fundingVerified ? "execution_ready" : "hype_reserve_ready")
                  : "perp_margin_transferred"
              )
            : (
                fundingVerified
                  ? "execution_ready"
                  : "perp_margin_transferred"
              );
        const lifecyclePatch = buildBotVaultV3FundingLifecycleTransitionPatch({
          row: botVault,
          targetStage: lifecycleTargetStage,
          source: "finalize_margin_add_resume",
          reason: fundingVerified
            ? "perp_margin_verified"
            : hypeReserveBlockingReason ?? "perp_margin_transfer_pending_resume",
          detail: verificationBlockingReason ?? hypeReserveError ?? hypeReserveState,
          metadataPatch: {
            lastAction: fundingVerified && hypeReserveReady
              ? "bot_vault_v3_margin_add_verified"
              : hypeReserveStatus.failureClass === "user_action_required"
                ? "bot_vault_v4_hype_reserve_user_action_required"
              : hypeReserveStatus.failureClass === "recovery_required"
                ? "bot_vault_v4_hype_reserve_recovery_required"
              : hypeReserveStatus.failureClass === "retryable"
                ? "bot_vault_v4_hype_reserve_retryable"
              : verificationState === "transfer_observed"
                ? "bot_vault_v3_margin_add_observed"
                : "bot_vault_v3_margin_add_submitted",
            hypeReserveState,
            hypeReserveTarget: requiresHypeReserve ? hypeReserveTarget : null,
            hypeReserveObservedBalance: hypeReserveResult?.hypeBalanceAfter ?? existingMarginAddFinalization.hypeReserveObservedBalance ?? null,
            hypeReserveFailureClass: hypeReserveStatus.failureClass,
            hypeReserveReasonCode: hypeReserveStatus.reasonCode,
            hypeReserveStatusCategory: hypeReserveStatus.statusCategory,
            hypeReserveMismatchCategory: hypeReserveStatus.mismatch?.category ?? null,
            hypeReserveRecoveryAction: hypeReserveStatus.mismatch?.recoveryAction ?? null,
            hypeReserveCanRetry: hypeReserveStatus.canRetry,
            hypeReserveNeedsUserAction: hypeReserveStatus.needsUserAction,
            hypeReserveRequiresRecovery: hypeReserveStatus.requiresRecovery,
            hypeReserveUpdatedAt: new Date().toISOString(),
            marginAddFinalization: {
              ...existingMarginAddFinalization,
              contractVersion,
              requestedAmountUsd,
              depositedAmountUsd: storedDepositedAmountUsd,
              transferToPerpAmountUsd: requestedAmountUsd,
              pauseTxHash: pauseRestoreTxHash,
              restoredPaused: pauseRestoreConfirmed,
              finalStatusObserved: postResyncSnapshot?.status ?? null,
              transferObserved,
              fundingVerified,
              marginFundingVerified,
              verificationState,
              verificationBlockingReason,
              finalPerpStateReadable,
              finalStateResynced,
              pauseStateSafe,
              hypeReserveState,
              hypeReserveTarget: requiresHypeReserve ? hypeReserveTarget : null,
              hypeReserveBudgetUsd: requiresHypeReserve ? hypeReserveBudgetUsd : null,
              hypeReserveReady,
              hypeReserveObservedBalance: hypeReserveResult?.hypeBalanceAfter ?? existingMarginAddFinalization.hypeReserveObservedBalance ?? null,
              hypeReserveTxHash: hypeReserveResult?.txHash ?? existingMarginAddFinalization.hypeReserveTxHash ?? null,
              hypeReserveError,
              hypeReserveFailureClass: hypeReserveStatus.failureClass,
              hypeReserveReasonCode: hypeReserveStatus.reasonCode,
              hypeReserveStatusCategory: hypeReserveStatus.statusCategory,
              hypeReserveMismatchCategory: hypeReserveStatus.mismatch?.category ?? null,
              hypeReserveRecoveryAction: hypeReserveStatus.mismatch?.recoveryAction ?? null,
              hypeReserveCanRetry: hypeReserveStatus.canRetry,
              hypeReserveNeedsUserAction: hypeReserveStatus.needsUserAction,
              hypeReserveRequiresRecovery: hypeReserveStatus.requiresRecovery,
              coreSpotExpectedAfterUsd: expectedCoreSpotAfterUsd,
              coreSpotBalanceAfterUsd: resumedCoreSpotBalanceAfterUsd == null ? null : roundUsd(resumedCoreSpotBalanceAfterUsd, 6),
              perpAvailableMarginAfterUsd: resumedPerpAccountStateAfter?.availableMarginUsd ?? null,
              perpEquityAfterUsd: resumedPerpAccountStateAfter?.equityUsd ?? null,
              resumedAt: new Date().toISOString(),
              verifiedAt: fundingVerified ? new Date().toISOString() : null,
              updatedAt: new Date().toISOString()
            }
          }
        });
        await persistBotVaultV3StateOrThrow({
          botVaultId: String(botVault.id),
          data: lifecyclePatch,
          operation: "margin_add",
          phase: "resume_pending",
          meta: {
            userId: params.userId
          }
        });
        if (contractVersion === "v4" && marginFundingVerified) {
          logBotVaultV4FundingReserveFlowEvent("margin_add_verified", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            source: "finalize_margin_add_resume",
            resumed: true,
            reasonCode: "bot_vault_v4_margin_add_verified",
            statusCategory: hypeReserveStatus.statusCategory,
            fundingLifecycleStage: lifecycleTargetStage,
            verificationState,
            verificationBlockingReason,
            transferObserved,
            finalPerpStateReadable,
            finalStateResynced,
            pauseStateSafe,
            hypeReserveState,
            hypeReserveReady,
            hypeReserveReasonCode: hypeReserveStatus.reasonCode,
            mismatchCategory: hypeReserveStatus.mismatch?.category ?? null,
            recoveryAction: hypeReserveStatus.mismatch?.recoveryAction ?? null
          });
        }
        if (contractVersion === "v4" && fundingVerified) {
          logBotVaultV4FundingReserveFlowEvent("execution_ready_confirmed", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            source: "finalize_margin_add_resume",
            resumed: true,
            reasonCode: "bot_vault_v4_execution_ready_confirmed",
            statusCategory: "execution_ready",
            fundingLifecycleStage: "execution_ready",
            verificationState,
            transferObserved,
            finalPerpStateReadable,
            finalStateResynced,
            pauseStateSafe,
            hypeReserveState,
            hypeReserveReady
          });
        }
        if (!fundingVerified) {
          logger.warn("bot_vault_v3_margin_add_verification_incomplete", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            verificationState,
            verificationBlockingReason,
            resumed: true,
            transferObserved,
            finalPerpStateReadable,
            finalStateResynced,
            pauseStateSafe,
            hypeReserveState,
            hypeReserveReady,
            mismatchCategory: hypeReserveStatus.mismatch?.category ?? null,
            recoveryAction: hypeReserveStatus.mismatch?.recoveryAction ?? null,
            statusCategory: classifyBotVaultV4Status({
              ready: fundingVerified,
              reason: verificationBlockingReason ?? verificationState,
              detail: hypeReserveError,
              mismatch: hypeReserveStatus.mismatch,
              fallbackCategory: hypeReserveStatus.failureClass ? hypeReserveStatus.statusCategory : "pending"
            }).category,
            hypeReserveError
          });
        }
        return {
          botVaultId: String(botVault.id),
          vaultAddress,
          onchainBotVaultAddress: vaultAddress,
          requestedAmountUsd,
          depositedAmountUsd: storedDepositedAmountUsd,
          transferToPerpAmountUsd: requestedAmountUsd,
          coreSpotBalanceBeforeUsd: storedCoreSpotBeforeUsd,
          coreSpotBalanceAfterUsd: resumedCoreSpotBalanceAfterUsd == null ? null : roundUsd(resumedCoreSpotBalanceAfterUsd, 6),
          activateTxHash: toNullableString(existingMarginAddFinalization.activateTxHash),
          depositTxHash: toNullableString(existingMarginAddFinalization.depositTxHash),
          pauseTxHash: pauseRestoreTxHash,
          restoredPaused: pauseRestoreConfirmed,
          hypeReserveState: requiresHypeReserve ? hypeReserveState : null,
          hypeReserveTarget: requiresHypeReserve ? hypeReserveTarget : null,
          hypeReserveBudgetUsd: requiresHypeReserve ? hypeReserveBudgetUsd : null,
          hypeReserveFailureClass: requiresHypeReserve ? hypeReserveStatus.failureClass : null,
          hypeReserveReasonCode: requiresHypeReserve ? hypeReserveStatus.reasonCode : null,
          hypeReserveStatusCategory: requiresHypeReserve ? hypeReserveStatus.statusCategory : null,
          hypeReserveMismatchCategory: requiresHypeReserve ? hypeReserveStatus.mismatch?.category ?? null : null,
          hypeReserveRecoveryAction: requiresHypeReserve ? hypeReserveStatus.mismatch?.recoveryAction ?? null : null,
          hypeReserveCanRetry: requiresHypeReserve ? hypeReserveStatus.canRetry : false,
          hypeReserveNeedsUserAction: requiresHypeReserve ? hypeReserveStatus.needsUserAction : false,
          hypeBalanceAfter: hypeReserveResult?.hypeBalanceAfter
            ?? (existingMarginAddFinalization.hypeReserveObservedBalance == null
              ? null
              : toNonNegativeNumber(existingMarginAddFinalization.hypeReserveObservedBalance))
        };
      }

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

      const coreSpotBalanceBeforeUsd = await readCoreUsdcSpotBalanceFromAdapter(adapterAny);
      const perpAccountStateBefore = await readPerpAccountStateFromAdapterOrNull(adapter, {
        userId: params.userId,
        botVaultId: String(botVault.id),
        phase: "margin_add_before_transfer"
      });
      const totalRequiredCoreSpotUsd = roundUsd(
        requestedAmountUsd + (requiresHypeReserve ? hypeReserveBudgetUsd : 0),
        6
      );
      const missingHypercoreFundingUsd = roundUsd(
        Math.max(0, totalRequiredCoreSpotUsd - coreSpotBalanceBeforeUsd),
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

      let coreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapterOrNull(adapterAny, {
        userId: params.userId,
        botVaultId: String(botVault.id),
        phase: "margin_add_after_transfer"
      });
      const perpAccountStateAfter = await readPerpAccountStateFromAdapterOrNull(adapter, {
        userId: params.userId,
        botVaultId: String(botVault.id),
        phase: "margin_add_after_transfer"
      });
      let hypeReserveResult: BotVaultHypeReserveResult | null = null;
      let hypeReserveError: string | null = null;

      if (requiresHypeReserve) {
        try {
          hypeReserveResult = await retryHyperliquidTransient(
            "ensure_hypercore_start_hype_reserve",
            () => ensureHypercoreExitGas({
              account,
              vaultAddress: vaultAddress as `0x${string}`,
              onchainStatus: currentStatus,
              contractVersion
            })
          );
        } catch (error) {
          hypeReserveError = String(error);
          const mismatch = classifyBotVaultV4Mismatch({
            reason: hypeReserveError,
            detail: hypeReserveError,
            defaultCategory: "reserve_bootstrap_incomplete"
          });
          logger.warn("bot_vault_v4_hype_reserve_bootstrap_failed", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            mismatchCategory: mismatch?.category ?? null,
            recoveryAction: mismatch?.recoveryAction ?? null,
            error: hypeReserveError
          });
        }
        coreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapterOrNull(adapterAny, {
          userId: params.userId,
          botVaultId: String(botVault.id),
          phase: "margin_add_after_hype_reserve"
        }, coreSpotBalanceAfterUsd);
      }

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
      }).catch((error) => {
        logger.warn("bot_vault_v3_margin_add_post_resync_failed", {
          userId: params.userId,
          botVaultId: String(botVault.id),
          error: String(error)
        });
        return null;
      });
      const finalStateResynced = postResyncSnapshot !== null;
      const hypeReserveState = requiresHypeReserve
        ? (
            hypeReserveResult?.state
            ?? (hypeReserveError ? "failed" : "pending")
          )
        : "not_required";
      const hypeReserveStatus = buildBotVaultHypeReserveStatus({
        requiresHypeReserve,
        result: hypeReserveResult,
        error: hypeReserveError,
        fallbackState: hypeReserveState
      });
      const effectiveHypeReserveState = hypeReserveStatus.state;
      const effectiveHypeReserveError = hypeReserveStatus.detail;
      if (contractVersion === "v4" && requiresHypeReserve) {
        logBotVaultV4HypeReserveBootstrapStatus({
          userId: params.userId,
          botVaultId: String(botVault.id),
          source: "finalize_margin_add",
          status: hypeReserveStatus,
          targetHype: hypeReserveTarget,
          budgetUsd: hypeReserveBudgetUsd,
          observedBalance: hypeReserveResult?.hypeBalanceAfter ?? null,
          txHash: hypeReserveResult?.txHash ?? null
        });
      }
      const effectiveHypeReserveReady = !requiresHypeReserve || isBotVaultHypeReserveReady(effectiveHypeReserveState);
      const marginFundingVerified =
        transferConfirmed
        && transferObserved
        && finalPerpStateReadable
        && finalStateResynced
        && pauseStateSafe;
      const executionFundingVerified = marginFundingVerified && effectiveHypeReserveReady;
      const hypeReserveBlockingReason = !effectiveHypeReserveReady
        ? hypeReserveStatus.reasonCode ?? "bot_vault_v4_hype_reserve_pending"
        : null;
      const verificationState =
        executionFundingVerified
          ? "funding_verified"
          : marginFundingVerified && hypeReserveBlockingReason
            ? (
                hypeReserveStatus.failureClass === "user_action_required"
                  ? "hype_reserve_user_action_required"
                  : hypeReserveStatus.failureClass === "recovery_required"
                    ? "hype_reserve_recovery_required"
                    : hypeReserveStatus.failureClass === "retryable"
                      ? "hype_reserve_retryable"
                      : "hype_reserve_pending"
              )
          : transferObserved
            ? "transfer_observed"
            : "transfer_submitted";
      const verificationBlockingReason = executionFundingVerified
        ? null
        : marginFundingVerified && hypeReserveBlockingReason
          ? hypeReserveBlockingReason
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
      const lifecycleTargetStage: BotVaultV3FundingLifecycleStage =
        contractVersion === "v4" && hypeReserveStatus.requiresRecovery
          ? "recovery_required"
          : contractVersion === "v4"
          ? (
              effectiveHypeReserveReady
                ? (executionFundingVerified ? "execution_ready" : "hype_reserve_ready")
                : "perp_margin_transferred"
            )
          : (
              executionFundingVerified
                ? "execution_ready"
                : "perp_margin_transferred"
            );
      const lifecyclePatch = buildBotVaultV3FundingLifecycleTransitionPatch({
        row: botVault,
        targetStage: lifecycleTargetStage,
        source: "finalize_margin_add",
        reason: executionFundingVerified
          ? "perp_margin_verified"
          : hypeReserveBlockingReason ?? "perp_margin_transfer_submitted",
        detail: verificationBlockingReason ?? effectiveHypeReserveError ?? effectiveHypeReserveState,
        metadataPatch: {
          lastAction: executionFundingVerified && effectiveHypeReserveReady
            ? "bot_vault_v3_margin_add_verified"
            : hypeReserveStatus.failureClass === "user_action_required"
              ? "bot_vault_v4_hype_reserve_user_action_required"
            : hypeReserveStatus.failureClass === "recovery_required"
              ? "bot_vault_v4_hype_reserve_recovery_required"
            : hypeReserveStatus.failureClass === "retryable"
              ? "bot_vault_v4_hype_reserve_retryable"
            : verificationState === "transfer_observed"
              ? "bot_vault_v3_margin_add_observed"
              : "bot_vault_v3_margin_add_submitted",
          hypeReserveState: effectiveHypeReserveState,
          hypeReserveTarget: requiresHypeReserve ? hypeReserveTarget : null,
          hypeReserveObservedBalance: hypeReserveResult?.hypeBalanceAfter ?? null,
          hypeReserveFailureClass: hypeReserveStatus.failureClass,
          hypeReserveReasonCode: hypeReserveStatus.reasonCode,
          hypeReserveStatusCategory: hypeReserveStatus.statusCategory,
          hypeReserveMismatchCategory: hypeReserveStatus.mismatch?.category ?? null,
          hypeReserveRecoveryAction: hypeReserveStatus.mismatch?.recoveryAction ?? null,
          hypeReserveCanRetry: hypeReserveStatus.canRetry,
          hypeReserveNeedsUserAction: hypeReserveStatus.needsUserAction,
          hypeReserveRequiresRecovery: hypeReserveStatus.requiresRecovery,
          hypeReserveUpdatedAt: new Date().toISOString(),
          marginAddFinalization: {
            contractVersion,
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
            fundingVerified: executionFundingVerified,
            marginFundingVerified,
            verificationState,
            verificationBlockingReason,
            finalPerpStateReadable,
            finalStateResynced,
            pauseStateSafe,
            hypeReserveState: effectiveHypeReserveState,
            hypeReserveTarget: requiresHypeReserve ? hypeReserveTarget : null,
            hypeReserveBudgetUsd: requiresHypeReserve ? hypeReserveBudgetUsd : null,
            hypeReserveReady: effectiveHypeReserveReady,
            hypeReserveObservedBalance: hypeReserveResult?.hypeBalanceAfter ?? null,
            hypeReserveTxHash: hypeReserveResult?.txHash ?? null,
            hypeReserveError: effectiveHypeReserveError,
            hypeReserveFailureClass: hypeReserveStatus.failureClass,
            hypeReserveReasonCode: hypeReserveStatus.reasonCode,
            hypeReserveStatusCategory: hypeReserveStatus.statusCategory,
            hypeReserveMismatchCategory: hypeReserveStatus.mismatch?.category ?? null,
            hypeReserveRecoveryAction: hypeReserveStatus.mismatch?.recoveryAction ?? null,
            hypeReserveCanRetry: hypeReserveStatus.canRetry,
            hypeReserveNeedsUserAction: hypeReserveStatus.needsUserAction,
            hypeReserveRequiresRecovery: hypeReserveStatus.requiresRecovery,
            coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
            coreSpotExpectedAfterUsd: expectedCoreSpotAfterUsd,
            coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6),
            perpAvailableMarginBeforeUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
            perpAvailableMarginAfterUsd: perpAccountStateAfter?.availableMarginUsd ?? null,
            perpEquityBeforeUsd: perpAccountStateBefore?.equityUsd ?? null,
            perpEquityAfterUsd: perpAccountStateAfter?.equityUsd ?? null,
            verifiedAt: executionFundingVerified ? new Date().toISOString() : null,
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
      if (contractVersion === "v4" && marginFundingVerified) {
        logBotVaultV4FundingReserveFlowEvent("margin_add_verified", {
          userId: params.userId,
          botVaultId: String(botVault.id),
          source: "finalize_margin_add",
          reasonCode: "bot_vault_v4_margin_add_verified",
          statusCategory: hypeReserveStatus.statusCategory,
          fundingLifecycleStage: lifecycleTargetStage,
          verificationState,
          verificationBlockingReason,
          transferObserved,
          finalPerpStateReadable,
          finalStateResynced,
          pauseStateSafe,
          hypeReserveState: effectiveHypeReserveState,
          hypeReserveReady: effectiveHypeReserveReady,
          hypeReserveReasonCode: hypeReserveStatus.reasonCode,
          mismatchCategory: hypeReserveStatus.mismatch?.category ?? null,
          recoveryAction: hypeReserveStatus.mismatch?.recoveryAction ?? null
        });
      }
      if (contractVersion === "v4" && executionFundingVerified) {
        logBotVaultV4FundingReserveFlowEvent("execution_ready_confirmed", {
          userId: params.userId,
          botVaultId: String(botVault.id),
          source: "finalize_margin_add",
          reasonCode: "bot_vault_v4_execution_ready_confirmed",
          statusCategory: "execution_ready",
          fundingLifecycleStage: "execution_ready",
          verificationState,
          transferObserved,
          finalPerpStateReadable,
          finalStateResynced,
          pauseStateSafe,
          hypeReserveState: effectiveHypeReserveState,
          hypeReserveReady: effectiveHypeReserveReady
        });
      }
      if (!executionFundingVerified) {
        logger.warn("bot_vault_v3_margin_add_verification_incomplete", {
          userId: params.userId,
          botVaultId: String(botVault.id),
          verificationState,
          verificationBlockingReason,
          transferStatus: transferToPerpResult?.status ?? null,
          transferObserved,
          finalPerpStateReadable,
          finalStateResynced,
          pauseStateSafe,
          hypeReserveState: effectiveHypeReserveState,
          hypeReserveReady: effectiveHypeReserveReady,
          hypeReserveFailureClass: hypeReserveStatus.failureClass,
          hypeReserveReasonCode: hypeReserveStatus.reasonCode,
          mismatchCategory: hypeReserveStatus.mismatch?.category ?? null,
          recoveryAction: hypeReserveStatus.mismatch?.recoveryAction ?? null,
          statusCategory: classifyBotVaultV4Status({
            ready: executionFundingVerified,
            reason: verificationBlockingReason ?? verificationState,
            detail: effectiveHypeReserveError,
            mismatch: hypeReserveStatus.mismatch,
            fallbackCategory: hypeReserveStatus.failureClass ? hypeReserveStatus.statusCategory : "pending"
          }).category,
          hypeReserveError: effectiveHypeReserveError
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
        restoredPaused,
        hypeReserveState: requiresHypeReserve ? effectiveHypeReserveState : null,
        hypeReserveTarget: requiresHypeReserve ? hypeReserveTarget : null,
        hypeReserveBudgetUsd: requiresHypeReserve ? hypeReserveBudgetUsd : null,
        hypeReserveFailureClass: requiresHypeReserve ? hypeReserveStatus.failureClass : null,
        hypeReserveReasonCode: requiresHypeReserve ? hypeReserveStatus.reasonCode : null,
        hypeReserveStatusCategory: requiresHypeReserve ? hypeReserveStatus.statusCategory : null,
        hypeReserveMismatchCategory: requiresHypeReserve ? hypeReserveStatus.mismatch?.category ?? null : null,
        hypeReserveRecoveryAction: requiresHypeReserve ? hypeReserveStatus.mismatch?.recoveryAction ?? null : null,
        hypeReserveCanRetry: requiresHypeReserve ? hypeReserveStatus.canRetry : false,
        hypeReserveNeedsUserAction: requiresHypeReserve ? hypeReserveStatus.needsUserAction : false,
        hypeBalanceAfter: hypeReserveResult?.hypeBalanceAfter ?? null
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
        controllerAddress: true,
        status: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    const vaultAddress = toNullableString(botVault.vaultAddress);
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    const currentMetadata = toRecord(botVault.executionMetadata);
    const existingReduceMarginFinalization = deriveStoredReduceMarginState(botVault.executionMetadata);
    const contractVersion = readBotVaultOnchainContractVersion(botVault.executionMetadata);
    const autoDrainToEvm = contractVersion === "v4";
    const onchainStatus = String(botVault.status ?? "ACTIVE").trim().toUpperCase() || "ACTIVE";

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
      const coreSpotBalanceBeforeUsd = await readCoreUsdcSpotBalanceFromAdapterOrNull(adapterAny, {
        userId: params.userId,
        botVaultId: String(botVault.id),
        phase: "reduce_margin_before_transfer"
      }, 0) ?? 0;
      const perpAccountStateBefore = await readPerpAccountStateFromAdapterOrNull(adapter, {
        userId: params.userId,
        botVaultId: String(botVault.id),
        phase: "reduce_margin_before_transfer"
      });
      const evmBalanceBeforeUsd = autoDrainToEvm
        ? await readBotVaultEvmUsdcBalanceUsdOrNull({
          vaultAddress: vaultAddress as `0x${string}`,
          controllerAddress: expectedControllerAddress
        }, {
          userId: params.userId,
          botVaultId: String(botVault.id),
          phase: "reduce_margin_before_transfer"
        })
        : null;
      const existingStage = String(existingReduceMarginFinalization.stage ?? "").trim().toLowerCase();
      const existingPostReconcileState = String(existingReduceMarginFinalization.postReconcileState ?? "").trim().toLowerCase();
      const existingReleasedAmountUsd = roundUsd(toNonNegativeNumber(existingReduceMarginFinalization.releasedAmountUsd), 6);
      const hasPendingReduceMargin =
        Object.keys(existingReduceMarginFinalization).length > 0
        && existingStage !== "failed"
        && (
          (existingStage !== "observed" && existingStage !== "verified")
          || existingPostReconcileState === "pending"
          || existingPostReconcileState === "recovery_required"
        );
      logBotVaultV3ReduceMarginFlowEvent("request_received", {
        userId: params.userId,
        botVaultId: String(botVault.id),
        vaultAddress,
        contractVersion,
        releasedAmountUsd,
        statusCategory: "pending",
        statusReason: "request_received",
        settlementState: "transfer_submitted",
        settlementReason: hasPendingReduceMargin ? "resume_pending" : "request_received",
        source: hasPendingReduceMargin ? "resume_pending" : "fresh_request",
        existingStage: existingStage || null,
        existingPostReconcileState: existingPostReconcileState || null,
        hasPendingReduceMargin
      });
      if (hasPendingReduceMargin) {
        if (hasUsdDrift(existingReleasedAmountUsd, releasedAmountUsd)) {
          throw new Error("bot_vault_v3_reduce_margin_pending_conflict");
        }
        const existingContractVersion = String(existingReduceMarginFinalization.contractVersion ?? "").trim().toLowerCase();
        if ((existingContractVersion === "v3" || existingContractVersion === "v4") && existingContractVersion !== contractVersion) {
          logger.warn("bot_vault_v3_reduce_margin_pending_contract_version_conflict", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            existingContractVersion,
            contractVersion,
            stage: existingStage,
            postReconcileState: existingPostReconcileState
          });
          throw new Error("bot_vault_v3_reduce_margin_pending_contract_version_conflict");
        }
        const resumedCoreSpotBalanceBeforeUsd = roundUsd(
          toNonNegativeNumber(existingReduceMarginFinalization.coreSpotBalanceBeforeUsd, coreSpotBalanceBeforeUsd),
          6
        );
        let resumedCoreSpotBalanceAfterUsd = roundUsd(coreSpotBalanceBeforeUsd, 6);
        let resumedEvmBalanceAfterUsd = autoDrainToEvm ? evmBalanceBeforeUsd : null;
        let spotToEvmAmountUsd = autoDrainToEvm
          ? roundUsd(
            Math.max(
              0,
              toNonNegativeNumber(existingReduceMarginFinalization.spotToEvmAmountUsd, releasedAmountUsd)
            ),
            6
          )
          : 0;
        let spotToEvmTransferStatus = toNullableString(existingReduceMarginFinalization.spotToEvmTransferStatus);
        let spotToEvmTransferTxHash = toNullableString(existingReduceMarginFinalization.spotToEvmTransferTxHash);
        let spotToEvmTransferSubmitted =
          existingReduceMarginFinalization.spotToEvmTransferSubmitted === true;
        let spotToEvmTransferConfirmationSource = toNullableString(existingReduceMarginFinalization.spotToEvmTransferConfirmationSource);
        let spotToEvmTransferReceiptStatus = toNullableString(existingReduceMarginFinalization.spotToEvmTransferReceiptStatus);
        let spotToEvmTransferError = toNullableString(existingReduceMarginFinalization.spotToEvmTransferError);
        const resumedEvmBalanceBeforeUsd = autoDrainToEvm
          ? (
            existingReduceMarginFinalization.evmBalanceBeforeUsd == null
              ? evmBalanceBeforeUsd
              : toNonNegativeNumber(existingReduceMarginFinalization.evmBalanceBeforeUsd)
          )
          : null;
        const priorTransferObserved =
          existingReduceMarginFinalization.transferObserved === true
          || existingStage === "observed"
          || existingStage === "verified";
        const spotTransferVisibleNow =
          resumedCoreSpotBalanceAfterUsd + USD_VERIFICATION_EPSILON >= roundUsd(
            resumedCoreSpotBalanceBeforeUsd + releasedAmountUsd,
            6
          );
        const shouldSubmitSpotToEvm =
          autoDrainToEvm
          && (priorTransferObserved || spotTransferVisibleNow)
          && (!spotToEvmTransferStatus || ["failed", "pending_timeout"].includes(String(spotToEvmTransferStatus).trim().toLowerCase()))
          && typeof adapterAny.transferUsdcSpotToEvm === "function";
        if (shouldSubmitSpotToEvm) {
          try {
            const needsExitGasTopUp = await readRequiresHypercoreExitGasTopUp(
              vaultAddress as `0x${string}`,
              contractVersion
            );
            if (needsExitGasTopUp) {
              await retryHyperliquidTransient(
                "reduce_margin_ensure_exit_gas",
                () => ensureHypercoreExitGas({
                  account,
                  vaultAddress: vaultAddress as `0x${string}`,
                  onchainStatus,
                  contractVersion
                })
              );
            }
            const spotToEvmResult: any = await retryHyperliquidTransient(
              "reduce_margin_transfer_usdc_spot_to_evm",
              () => adapterAny.transferUsdcSpotToEvm({
                amountUsd: spotToEvmAmountUsd
              })
            );
            resumedCoreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapterOrNull(adapterAny, {
              userId: params.userId,
              botVaultId: String(botVault.id),
              phase: "reduce_margin_resume_after_evm_drain"
            }, resumedCoreSpotBalanceAfterUsd) ?? resumedCoreSpotBalanceAfterUsd;
            resumedEvmBalanceAfterUsd = await readBotVaultEvmUsdcBalanceUsdOrNull({
              vaultAddress: vaultAddress as `0x${string}`,
              controllerAddress: expectedControllerAddress
            }, {
              userId: params.userId,
              botVaultId: String(botVault.id),
              phase: "reduce_margin_resume_after_evm_drain"
            }, resumedEvmBalanceAfterUsd);
            spotToEvmTransferStatus = String(spotToEvmResult?.status ?? "unknown");
            spotToEvmTransferTxHash = toNullableString(spotToEvmResult?.txHash);
            spotToEvmTransferSubmitted = spotToEvmResult?.submitted === true;
            spotToEvmTransferConfirmationSource = toNullableString(spotToEvmResult?.confirmationSource);
            spotToEvmTransferReceiptStatus = toNullableString(spotToEvmResult?.receiptStatus);
            spotToEvmTransferError = null;
          } catch (error) {
            spotToEvmTransferStatus = "failed";
            spotToEvmTransferError = String(error);
          }
        }
        const resumedVerification = buildReduceMarginVerification({
          contractVersion,
          releasedAmountUsd,
          coreSpotBalanceBeforeUsd: resumedCoreSpotBalanceBeforeUsd,
          coreSpotBalanceAfterUsd: resumedCoreSpotBalanceAfterUsd,
          perpAccountStateAfter: perpAccountStateBefore,
          priorTransferObserved,
          evmBalanceBeforeUsd: resumedEvmBalanceBeforeUsd,
          evmBalanceAfterUsd: resumedEvmBalanceAfterUsd,
          spotToEvmAmountUsd,
          spotToEvmTransferStatus,
          transferStatus: existingReduceMarginFinalization.transferResultStatus ?? existingStage
        });
        const resumedFlowStatus = buildBotVaultV3ReduceMarginFlowStatus({
          contractVersion,
          transferVerificationState: resumedVerification.verificationState,
          transferVerificationBlockingReason: resumedVerification.verificationBlockingReason,
          postReconcileState: resumedVerification.reductionVerified ? "pending" : "not_required"
        });
        const resumedReduceMarginFinalization = {
          ...existingReduceMarginFinalization,
          releasedAmountUsd,
          coreSpotBalanceBeforeUsd: resumedCoreSpotBalanceBeforeUsd,
          coreSpotExpectedAfterUsd: resumedVerification.expectedCoreSpotAfterUsd,
          coreSpotBalanceAfterUsd: resumedCoreSpotBalanceAfterUsd,
          contractVersion,
          perpAvailableMarginBeforeUsd: existingReduceMarginFinalization.perpAvailableMarginBeforeUsd ?? perpAccountStateBefore?.availableMarginUsd ?? null,
          perpAvailableMarginAfterUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
          perpEquityBeforeUsd: existingReduceMarginFinalization.perpEquityBeforeUsd ?? perpAccountStateBefore?.equityUsd ?? null,
          perpEquityAfterUsd: perpAccountStateBefore?.equityUsd ?? null,
          evmBalanceBeforeUsd: resumedEvmBalanceBeforeUsd,
          evmExpectedAfterUsd: resumedVerification.expectedEvmBalanceAfterUsd,
          evmBalanceAfterUsd: resumedEvmBalanceAfterUsd,
          evmTransferObserved: resumedVerification.evmTransferObserved,
          spotToEvmAmountUsd: autoDrainToEvm ? spotToEvmAmountUsd : null,
          spotToEvmTransferStatus,
          spotToEvmTransferTxHash,
          spotToEvmTransferSubmitted,
          spotToEvmTransferConfirmationSource,
          spotToEvmTransferReceiptStatus,
          spotToEvmTransferError,
          transferObserved: resumedVerification.transferObserved,
          finalPerpStateReadable: resumedVerification.finalPerpStateReadable,
          transferVerificationState: resumedVerification.verificationState,
          flowState: resumedFlowStatus.flowState,
          statusReason: resumedFlowStatus.statusReason,
          settlementState: resumedFlowStatus.flowState,
          settlementReason: resumedFlowStatus.statusReason,
          statusCategory: classifyBotVaultV4Status({
            reason: resumedVerification.reductionVerified
              ? "bot_vault_v3_reduce_margin_post_reconcile_pending"
              : resumedVerification.verificationBlockingReason ?? resumedVerification.verificationState,
            fallbackCategory: resumedVerification.reductionVerified ? "retryable" : "pending"
          }).category,
          postReconcileState: resumedVerification.reductionVerified ? "pending" : "not_required",
          postReconcileStatusCategory: resumedVerification.reductionVerified ? "retryable" : null,
          postReconcileReason: resumedVerification.reductionVerified ? "bot_vault_v3_reduce_margin_post_reconcile_pending" : null,
          postReconcileMismatchCategory: resumedVerification.reductionVerified ? "post_transfer_reconcile_failed" : null,
          postReconcileRecoveryAction: resumedVerification.reductionVerified ? "retry" : null,
          postReconcileCanRetry: resumedVerification.reductionVerified,
          verificationState: resumedVerification.verificationState,
          verificationBlockingReason: resumedVerification.verificationBlockingReason,
          stage: resumedVerification.reductionVerified
            ? "verified"
            : (
              contractVersion === "v4"
                ? resumedVerification.evmTransferObserved
                : resumedVerification.transferObserved
            )
              ? "observed"
              : "submitted",
          observedAt: resumedVerification.transferObserved
            ? toNullableString(existingReduceMarginFinalization.observedAt) ?? new Date().toISOString()
            : null,
          verifiedAt: resumedVerification.reductionVerified ? new Date().toISOString() : null,
          resumedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
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
                : (
                  contractVersion === "v4"
                    ? resumedVerification.evmTransferObserved
                    : resumedVerification.transferObserved
                )
                  ? "bot_vault_v3_reduce_margin_observed"
                  : "bot_vault_v3_reduce_margin_submitted",
              reduceMarginFinalization: {
                ...resumedReduceMarginFinalization
              }
            }
          }
        });
        if (resumedVerification.reductionVerified) {
          logBotVaultV3ReduceMarginFlowEvent("transfer_verified", {
            userId: params.userId,
            botVaultId: String(botVault.id),
            phase: "resume_pending",
            resumed: true,
            contractVersion,
            releasedAmountUsd,
            statusCategory: resumedReduceMarginFinalization.statusCategory,
            statusReason: "transfer_verified",
            settlementState: resumedReduceMarginFinalization.settlementState,
            settlementReason: resumedReduceMarginFinalization.settlementReason,
            transferVerificationState: resumedVerification.verificationState,
            verificationBlockingReason: resumedVerification.verificationBlockingReason,
            transferResultStatus: existingReduceMarginFinalization.transferResultStatus ?? existingStage,
            transferObserved: resumedVerification.transferObserved,
            finalPerpStateReadable: resumedVerification.finalPerpStateReadable
          });
        }
        if (contractVersion === "v4") {
          logBotVaultV3ReduceMarginFlowEvent(
            resumedVerification.evmTransferObserved ? "evm_return_verified" : "evm_return_pending",
            {
              userId: params.userId,
              botVaultId: String(botVault.id),
              phase: "resume_pending",
              resumed: true,
              contractVersion,
              releasedAmountUsd,
              statusCategory: resumedReduceMarginFinalization.statusCategory,
              statusReason: resumedVerification.evmTransferObserved ? "evm_return_verified" : "evm_return_pending",
              settlementState: resumedReduceMarginFinalization.settlementState,
              settlementReason: resumedReduceMarginFinalization.settlementReason,
              verificationBlockingReason: resumedVerification.verificationBlockingReason,
              spotToEvmAmountUsd: autoDrainToEvm ? spotToEvmAmountUsd : null,
              spotToEvmTransferStatus,
              spotToEvmTransferError,
              evmTransferObserved: resumedVerification.evmTransferObserved,
              evmBalanceBeforeUsd: resumedEvmBalanceBeforeUsd,
              evmBalanceAfterUsd: resumedEvmBalanceAfterUsd
            }
          );
        }
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
        const resumedPostReconcileStatus = await finalizeBotVaultV3ReduceMarginPostReconcile({
          userId: params.userId,
          botVaultId: String(botVault.id),
          currentMetadata,
          reduceMarginFinalization: resumedReduceMarginFinalization,
          phase: "resume_pending",
          transferVerificationState: resumedVerification.verificationState,
          transferVerificationBlockingReason: resumedVerification.verificationBlockingReason,
          reductionVerified: resumedVerification.reductionVerified
        });
        return {
          botVaultId: String(botVault.id),
          vaultAddress,
          onchainBotVaultAddress: vaultAddress,
          releasedAmountUsd,
          coreSpotBalanceBeforeUsd: resumedCoreSpotBalanceBeforeUsd,
          coreSpotBalanceAfterUsd: resumedCoreSpotBalanceAfterUsd,
          evmBalanceBeforeUsd: resumedEvmBalanceBeforeUsd,
          evmBalanceAfterUsd: resumedEvmBalanceAfterUsd,
          spotToEvmAmountUsd: autoDrainToEvm ? spotToEvmAmountUsd : null,
          spotToEvmTransferStatus,
          statusCategory: resumedPostReconcileStatus.statusCategory,
          flowState: resumedPostReconcileStatus.flowState,
          statusReason: resumedPostReconcileStatus.statusReason,
          settlementState: resumedPostReconcileStatus.settlementState,
          settlementReason: resumedPostReconcileStatus.settlementReason,
          verificationState: resumedPostReconcileStatus.verificationState,
          verificationBlockingReason: resumedPostReconcileStatus.verificationBlockingReason,
          transferVerificationState: resumedVerification.verificationState,
          postReconcileState: resumedPostReconcileStatus.postReconcileState,
          postReconcileStatusCategory: resumedPostReconcileStatus.postReconcileStatusCategory,
          postReconcileReason: resumedPostReconcileStatus.postReconcileReason,
          postReconcileMismatchCategory: resumedPostReconcileStatus.postReconcileMismatchCategory,
          postReconcileRecoveryAction: resumedPostReconcileStatus.postReconcileRecoveryAction,
          postReconcileCanRetry: resumedPostReconcileStatus.postReconcileCanRetry,
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
              contractVersion,
              releasedAmountUsd,
              coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
              coreSpotExpectedAfterUsd: roundUsd(coreSpotBalanceBeforeUsd + releasedAmountUsd, 6),
              coreSpotBalanceAfterUsd: null,
              evmBalanceBeforeUsd,
              evmExpectedAfterUsd: autoDrainToEvm
                ? roundUsd(toNonNegativeNumber(evmBalanceBeforeUsd) + releasedAmountUsd, 6)
                : null,
              evmBalanceAfterUsd: evmBalanceBeforeUsd,
              perpAvailableMarginBeforeUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
              perpAvailableMarginAfterUsd: null,
              perpEquityBeforeUsd: perpAccountStateBefore?.equityUsd ?? null,
              perpEquityAfterUsd: null,
              spotToEvmAmountUsd: autoDrainToEvm ? releasedAmountUsd : null,
              evmTransferObserved: false,
              statusCategory: "pending",
              flowState: "transfer_submitted",
              statusReason: "transfer_submitted",
              settlementState: "transfer_submitted",
              settlementReason: "request_received",
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
                statusCategory: "recovery_required",
                flowState: "transfer_submitted",
                statusReason: "transfer_failed",
                settlementState: "transfer_submitted",
                settlementReason: "transfer_failed",
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
      logBotVaultV3ReduceMarginFlowEvent("transfer_submitted", {
        userId: params.userId,
        botVaultId: String(botVault.id),
        phase: "post_transfer_submission",
        contractVersion,
        releasedAmountUsd,
        statusCategory: "pending",
        statusReason: "transfer_submitted",
        settlementState: "transfer_submitted",
        settlementReason: "transfer_submitted",
        transferResultStatus: String(transferResult?.status ?? "unknown"),
        transferSubmitted: transferResult?.submitted === true,
        transferConfirmationSource: String(transferResult?.confirmationSource ?? "none"),
        transferReceiptStatus: String(transferResult?.receiptStatus ?? "unknown"),
        transferTxHash: toNullableString(transferResult?.txHash)
      });
      let coreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapterOrNull(adapterAny, {
        userId: params.userId,
        botVaultId: String(botVault.id),
        phase: "reduce_margin_after_transfer"
      });
      const perpAccountStateAfter = await readPerpAccountStateFromAdapterOrNull(adapter, {
        userId: params.userId,
        botVaultId: String(botVault.id),
        phase: "reduce_margin_after_transfer"
      });
      let evmBalanceAfterUsd = autoDrainToEvm ? evmBalanceBeforeUsd : null;
      let spotToEvmTransferStatus: string | null = null;
      let spotToEvmTransferTxHash: string | null = null;
      let spotToEvmTransferSubmitted = false;
      let spotToEvmTransferConfirmationSource: string | null = null;
      let spotToEvmTransferReceiptStatus: string | null = null;
      let spotToEvmTransferError: string | null = null;
      const spotTransferVisible =
        coreSpotBalanceAfterUsd != null
        && roundUsd(coreSpotBalanceAfterUsd, 6) + USD_VERIFICATION_EPSILON >= roundUsd(
          coreSpotBalanceBeforeUsd + releasedAmountUsd,
          6
        );
      if (autoDrainToEvm && spotTransferVisible) {
        if (typeof adapterAny.transferUsdcSpotToEvm !== "function") {
          spotToEvmTransferStatus = "failed";
          spotToEvmTransferError = "bot_vault_v4_reduce_margin_spot_to_evm_unavailable";
        } else {
          try {
            const needsExitGasTopUp = await readRequiresHypercoreExitGasTopUp(
              vaultAddress as `0x${string}`,
              contractVersion
            );
            if (needsExitGasTopUp) {
              await retryHyperliquidTransient(
                "reduce_margin_ensure_exit_gas",
                () => ensureHypercoreExitGas({
                  account,
                  vaultAddress: vaultAddress as `0x${string}`,
                  onchainStatus,
                  contractVersion
                })
              );
            }
            const spotToEvmResult: any = await retryHyperliquidTransient(
              "reduce_margin_transfer_usdc_spot_to_evm",
              () => adapterAny.transferUsdcSpotToEvm({
                amountUsd: releasedAmountUsd
              })
            );
            spotToEvmTransferStatus = String(spotToEvmResult?.status ?? "unknown");
            spotToEvmTransferTxHash = toNullableString(spotToEvmResult?.txHash);
            spotToEvmTransferSubmitted = spotToEvmResult?.submitted === true;
            spotToEvmTransferConfirmationSource = String(spotToEvmResult?.confirmationSource ?? "none");
            spotToEvmTransferReceiptStatus = String(spotToEvmResult?.receiptStatus ?? "unknown");
            coreSpotBalanceAfterUsd = await readCoreUsdcSpotBalanceFromAdapterOrNull(adapterAny, {
              userId: params.userId,
              botVaultId: String(botVault.id),
              phase: "reduce_margin_after_evm_drain"
            }, coreSpotBalanceAfterUsd);
            evmBalanceAfterUsd = await readBotVaultEvmUsdcBalanceUsdOrNull({
              vaultAddress: vaultAddress as `0x${string}`,
              controllerAddress: expectedControllerAddress
            }, {
              userId: params.userId,
              botVaultId: String(botVault.id),
              phase: "reduce_margin_after_evm_drain"
            }, evmBalanceAfterUsd);
          } catch (error) {
            spotToEvmTransferStatus = "failed";
            spotToEvmTransferError = String(error);
          }
        }
      }
      const verification = buildReduceMarginVerification({
        contractVersion,
        releasedAmountUsd,
        coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
        coreSpotBalanceAfterUsd,
        perpAccountStateAfter,
        priorTransferObserved: spotTransferVisible,
        evmBalanceBeforeUsd,
        evmBalanceAfterUsd,
        spotToEvmAmountUsd: autoDrainToEvm ? releasedAmountUsd : null,
        spotToEvmTransferStatus,
        transferStatus: transferResult?.status
      });
      const flowStatus = buildBotVaultV3ReduceMarginFlowStatus({
        contractVersion,
        transferVerificationState: verification.verificationState,
        transferVerificationBlockingReason: verification.verificationBlockingReason,
        postReconcileState: verification.reductionVerified ? "pending" : "not_required"
      });
      const reduceMarginFinalization = {
        contractVersion,
        releasedAmountUsd,
        coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
        coreSpotExpectedAfterUsd: verification.expectedCoreSpotAfterUsd,
        coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6),
        evmBalanceBeforeUsd,
        evmExpectedAfterUsd: verification.expectedEvmBalanceAfterUsd,
        evmBalanceAfterUsd,
        evmTransferObserved: verification.evmTransferObserved,
        perpAvailableMarginBeforeUsd: perpAccountStateBefore?.availableMarginUsd ?? null,
        perpAvailableMarginAfterUsd: perpAccountStateAfter?.availableMarginUsd ?? null,
        perpEquityBeforeUsd: perpAccountStateBefore?.equityUsd ?? null,
        perpEquityAfterUsd: perpAccountStateAfter?.equityUsd ?? null,
        transferResultStatus: String(transferResult?.status ?? "unknown"),
        transferSubmitted: transferResult?.submitted === true,
        transferConfirmationSource: String(transferResult?.confirmationSource ?? "none"),
        transferReceiptStatus: String(transferResult?.receiptStatus ?? "unknown"),
        transferTxHash: toNullableString(transferResult?.txHash),
        spotToEvmAmountUsd: autoDrainToEvm ? releasedAmountUsd : null,
        spotToEvmTransferStatus,
        spotToEvmTransferTxHash,
        spotToEvmTransferSubmitted,
        spotToEvmTransferConfirmationSource,
        spotToEvmTransferReceiptStatus,
        spotToEvmTransferError,
        transferObserved: verification.transferObserved,
        finalPerpStateReadable: verification.finalPerpStateReadable,
        transferVerificationState: verification.verificationState,
        flowState: flowStatus.flowState,
        statusReason: flowStatus.statusReason,
        settlementState: flowStatus.flowState,
        settlementReason: flowStatus.statusReason,
        statusCategory: classifyBotVaultV4Status({
          reason: verification.reductionVerified
            ? "bot_vault_v3_reduce_margin_post_reconcile_pending"
            : verification.verificationBlockingReason ?? verification.verificationState,
          fallbackCategory: verification.reductionVerified ? "retryable" : "pending"
        }).category,
        postReconcileState: verification.reductionVerified ? "pending" : "not_required",
        postReconcileStatusCategory: verification.reductionVerified ? "retryable" : null,
        postReconcileReason: verification.reductionVerified ? "bot_vault_v3_reduce_margin_post_reconcile_pending" : null,
        postReconcileMismatchCategory: verification.reductionVerified ? "post_transfer_reconcile_failed" : null,
        postReconcileRecoveryAction: verification.reductionVerified ? "retry" : null,
        postReconcileCanRetry: verification.reductionVerified,
        verificationState: verification.verificationState,
        verificationBlockingReason: verification.verificationBlockingReason,
        stage: verification.reductionVerified
          ? "verified"
          : (
            contractVersion === "v4"
              ? verification.evmTransferObserved
              : verification.transferObserved
          )
            ? "observed"
            : "submitted",
        requestedAt: new Date().toISOString(),
        observedAt: verification.transferObserved ? new Date().toISOString() : null,
        verifiedAt: verification.reductionVerified ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString()
      };
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
              : (
                contractVersion === "v4"
                  ? verification.evmTransferObserved
                  : verification.transferObserved
              )
                ? "bot_vault_v3_reduce_margin_observed"
                : "bot_vault_v3_reduce_margin_submitted",
            reduceMarginFinalization: {
              ...reduceMarginFinalization
            }
          }
        }
      });
      if (verification.reductionVerified) {
        logBotVaultV3ReduceMarginFlowEvent("transfer_verified", {
          userId: params.userId,
          botVaultId: String(botVault.id),
          phase: "post_transfer_verification",
          contractVersion,
          releasedAmountUsd,
          statusCategory: reduceMarginFinalization.statusCategory,
          statusReason: "transfer_verified",
          settlementState: reduceMarginFinalization.settlementState,
          settlementReason: reduceMarginFinalization.settlementReason,
          transferVerificationState: verification.verificationState,
          verificationBlockingReason: verification.verificationBlockingReason,
          transferResultStatus: String(transferResult?.status ?? "unknown"),
          transferObserved: verification.transferObserved,
          finalPerpStateReadable: verification.finalPerpStateReadable
        });
      }
      if (contractVersion === "v4") {
        logBotVaultV3ReduceMarginFlowEvent(
          verification.evmTransferObserved ? "evm_return_verified" : "evm_return_pending",
          {
            userId: params.userId,
            botVaultId: String(botVault.id),
            phase: "post_transfer_verification",
            contractVersion,
            releasedAmountUsd,
            statusCategory: reduceMarginFinalization.statusCategory,
            statusReason: verification.evmTransferObserved ? "evm_return_verified" : "evm_return_pending",
            settlementState: reduceMarginFinalization.settlementState,
            settlementReason: reduceMarginFinalization.settlementReason,
            verificationBlockingReason: verification.verificationBlockingReason,
            spotToEvmAmountUsd: autoDrainToEvm ? releasedAmountUsd : null,
            spotToEvmTransferStatus,
            spotToEvmTransferError,
            spotToEvmTransferSubmitted,
            evmTransferObserved: verification.evmTransferObserved,
            evmBalanceBeforeUsd,
            evmBalanceAfterUsd
          }
        );
      }
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
      const postReconcileStatus = await finalizeBotVaultV3ReduceMarginPostReconcile({
        userId: params.userId,
        botVaultId: String(botVault.id),
        currentMetadata,
        reduceMarginFinalization,
        phase: "post_transfer_verification",
        transferVerificationState: verification.verificationState,
        transferVerificationBlockingReason: verification.verificationBlockingReason,
        reductionVerified: verification.reductionVerified
      });
      return {
        botVaultId: String(botVault.id),
        vaultAddress,
        onchainBotVaultAddress: vaultAddress,
        releasedAmountUsd,
        coreSpotBalanceBeforeUsd: roundUsd(coreSpotBalanceBeforeUsd, 6),
        coreSpotBalanceAfterUsd: coreSpotBalanceAfterUsd == null ? null : roundUsd(coreSpotBalanceAfterUsd, 6),
        evmBalanceBeforeUsd,
        evmBalanceAfterUsd,
        spotToEvmAmountUsd: autoDrainToEvm ? releasedAmountUsd : null,
        spotToEvmTransferStatus,
        statusCategory: postReconcileStatus.statusCategory,
        flowState: postReconcileStatus.flowState,
        statusReason: postReconcileStatus.statusReason,
        settlementState: postReconcileStatus.settlementState,
        settlementReason: postReconcileStatus.settlementReason,
        verificationState: postReconcileStatus.verificationState,
        verificationBlockingReason: postReconcileStatus.verificationBlockingReason,
        transferVerificationState: verification.verificationState,
        postReconcileState: postReconcileStatus.postReconcileState,
        postReconcileStatusCategory: postReconcileStatus.postReconcileStatusCategory,
        postReconcileReason: postReconcileStatus.postReconcileReason,
        postReconcileMismatchCategory: postReconcileStatus.postReconcileMismatchCategory,
        postReconcileRecoveryAction: postReconcileStatus.postReconcileRecoveryAction,
        postReconcileCanRetry: postReconcileStatus.postReconcileCanRetry,
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
        realizedPnlNet: true,
        highWaterMark: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");
    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");
    const contractVersion = readBotVaultOnchainContractVersion(botVault.executionMetadata);

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");
    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);
    const [statusBeforeRaw, principalDepositedRaw, principalReturnedRaw, feePaidTotalBeforeRaw, highWaterMarkProfitRaw, factoryAddress, usdcBalanceBeforeRaw, excludedPrincipalUsd] = await Promise.all([
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
      contractVersion === "v4"
        ? publicClient.readContract({
            address: vaultAddress as `0x${string}`,
            abi: botVaultV3Abi,
            functionName: "highWaterMarkProfit"
          }) as Promise<bigint>
        : Promise.resolve(0n),
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
    let expectedContractBalanceRaw = usdcBalanceRaw;
    let lastHypercoreSettlementFailure: HypercoreExitSettlementFailure | null = null;
    let hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);
    if (hypercoreExitCheck.requiresExit && (currentStatus === "PAUSED" || currentStatus === "FUNDED")) {
      const needsExitGasTopUp = await readRequiresHypercoreExitGasTopUp(vaultAddress as `0x${string}`, contractVersion);
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
      const balanceBeforeSettlementRaw = usdcBalanceRaw;
      const settlementResult = await bestEffortSettleHypercoreExit({
        userId: params.userId,
        botVaultId: String(botVault.id),
        onchainStatus: currentStatus
      });
      lastHypercoreSettlementFailure = settlementResult.failure;
      if (settlementResult.transferredToEvmUsd > 0) {
        const settlementExpectedRaw = balanceBeforeSettlementRaw + toAtomicUsd(settlementResult.transferredToEvmUsd);
        if (settlementExpectedRaw > expectedContractBalanceRaw) {
          expectedContractBalanceRaw = settlementExpectedRaw;
        }
      }
      usdcBalanceRaw = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [vaultAddress as `0x${string}`]
      }) as bigint;
      hypercoreExitCheck = await readHypercoreExitCheckWithRetry(vaultAddress as `0x${string}`, usdcBalanceRaw);
    }

    if (
      hypercoreExitCheck.requiresExit
      && currentStatus === "ACTIVE"
      && statusBefore !== "CLOSE_ONLY"
    ) {
      const needsExitGasTopUp = await readRequiresHypercoreExitGasTopUp(vaultAddress as `0x${string}`, contractVersion);
      if (needsExitGasTopUp) {
        throw formatHypercoreExitRequiredError(
          hypercoreExitCheck,
          lastHypercoreSettlementFailure
            ?? {
                step: "ensure_hypercore_exit_gas",
                error: "bot_vault_v3_hypercore_exit_gas_missing"
              }
        );
      }
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
      if (statusAfterCloseOnly === "CLOSE_ONLY") {
        const needsExitGasTopUp = await readRequiresHypercoreExitGasTopUp(vaultAddress as `0x${string}`, contractVersion);
        if (needsExitGasTopUp) {
          throw formatHypercoreExitRequiredError(
            hypercoreExitCheck,
            {
              step: "ensure_hypercore_exit_gas",
              error: "bot_vault_v3_hypercore_exit_gas_missing_in_close_only"
            }
          );
        }
      }
      const balanceBeforeSettlementRaw = usdcBalanceRaw;
      const settlementResult = await bestEffortSettleHypercoreExit({
        userId: params.userId,
        botVaultId: String(botVault.id),
        onchainStatus: statusAfterCloseOnly
      });
      lastHypercoreSettlementFailure = settlementResult.failure;
      if (settlementResult.transferredToEvmUsd > 0) {
        const settlementExpectedRaw = balanceBeforeSettlementRaw + toAtomicUsd(settlementResult.transferredToEvmUsd);
        if (settlementExpectedRaw > expectedContractBalanceRaw) {
          expectedContractBalanceRaw = settlementExpectedRaw;
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
        throw formatHypercoreExitRequiredError(hypercoreExitCheck, lastHypercoreSettlementFailure);
      }
    }

    await ensureVaultContractBalanceReady({
      botVaultId: String(botVault.id),
      vaultAddress,
      action: "close_vault",
      expectedAmountRaw: expectedContractBalanceRaw,
      actualBalanceRaw: usdcBalanceRaw
    });

    const excludedPrincipalRaw = toAtomicUsd(excludedPrincipalUsd);
    const effectivePrincipalOutstandingRaw = deriveEffectivePrincipalOutstandingRaw({
      principalDepositedRaw,
      principalReturnedRaw,
      excludedPrincipalRaw
    });
    const principalToReturnRaw = effectivePrincipalOutstandingRaw > usdcBalanceRaw
      ? usdcBalanceRaw
      : effectivePrincipalOutstandingRaw;
    const feeRatePctRaw = await readBotVaultProfitShareFeeRatePct({
      publicClient,
      factoryAddress,
      vaultAddress: vaultAddress as `0x${string}`
    });
    const profitComponentRaw = usdcBalanceRaw > principalToReturnRaw
      ? usdcBalanceRaw - principalToReturnRaw
      : 0n;
    const realizedClosedPnlUsd = roundUsd(Number(botVault.realizedPnlNet ?? 0), 6);
    const highWaterMarkBeforeUsd = contractVersion === "v4"
      ? formatUsdAtomicToNumber(highWaterMarkProfitRaw)
      : roundUsd(Number(botVault.highWaterMark ?? 0), 6);
    const profitShare = contractVersion === "v4"
      ? computeV4ProfitShareRaw({
          payoutProfitRaw: profitComponentRaw,
          feeRatePctRaw,
          realizedClosedPnlUsd,
          highWaterMarkBeforeUsd
        })
      : {
          feeBaseRaw: profitComponentRaw,
          feeAmountRaw: (profitComponentRaw * feeRatePctRaw) / 100n,
          realizedClosedPnlRaw: 0n,
          highWaterMarkBeforeRaw: highWaterMarkProfitRaw,
          highWaterMarkAfterRaw: highWaterMarkProfitRaw,
          realizedClosedPnlUsd: 0,
          highWaterMarkBeforeUsd,
          highWaterMarkAfterUsd: highWaterMarkBeforeUsd
        };
    const feeAmountRaw = profitShare.feeAmountRaw;
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
      profitBaseUsd: formatUsdAtomicToNumber(profitShare.feeBaseRaw),
      realizedClosedPnlUsd: profitShare.realizedClosedPnlUsd,
      highWaterMarkBeforeUsd: profitShare.highWaterMarkBeforeUsd,
      highWaterMarkAfterUsd: profitShare.highWaterMarkAfterUsd,
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
        abi: contractVersion === "v4" ? botVaultV4Abi : botVaultV3Abi,
        functionName: "closeVault",
        args: contractVersion === "v4"
          ? [principalToReturnRaw, usdcBalanceRaw, feeAmountRaw, profitShare.realizedClosedPnlRaw]
          : [principalToReturnRaw, usdcBalanceRaw, feeAmountRaw]
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
        realizedPnlNet: true,
        highWaterMark: true,
        executionMetadata: true
      }
    });
    if (!botVault) throw new Error("bot_vault_not_found");
    const vaultAddress = toNullableString(botVault.vaultAddress);
    const expectedControllerAddress = toNullableString(botVault.controllerAddress) ?? controllerAddress;
    if (!vaultAddress || !isAddress(vaultAddress)) throw new Error("bot_vault_onchain_address_missing");
    if (!expectedControllerAddress || !isAddress(expectedControllerAddress)) throw new Error("bot_vault_v3_controller_missing");
    const contractVersion = readBotVaultOnchainContractVersion(botVault.executionMetadata);

    const walletConfig = resolveWalletReadConfig();
    const usdcAddress = walletConfig.usdcAddress;
    if (!usdcAddress) throw new Error("usdc_address_missing");
    const { account, chain, publicClient, walletClient } = buildControllerWalletClient(expectedControllerAddress);
    const [
      statusRaw,
      principalDepositedRaw,
      principalReturnedRaw,
      feePaidTotalBeforeRaw,
      highWaterMarkProfitRaw,
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
      contractVersion === "v4"
        ? publicClient.readContract({
            address: vaultAddress as `0x${string}`,
            abi: botVaultV3Abi,
            functionName: "highWaterMarkProfit"
          }) as Promise<bigint>
        : Promise.resolve(0n),
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
    const recoveryHypercoreExitCheck = await readHypercoreExitCheckWithRetry(
      vaultAddress as `0x${string}`,
      usdcBalanceRaw
    ).catch((error) => {
      logger.warn("bot_vault_v3_recovery_hypercore_exit_check_failed", {
        userId: params.userId,
        botVaultId: String(botVault.id),
        error: String(error)
      });
      return null;
    });
    const pendingHypercoreUsd = recoveryHypercoreExitCheck
      ? roundUsd(
          Math.max(recoveryHypercoreExitCheck.accountValueUsd, recoveryHypercoreExitCheck.withdrawableUsd)
          + recoveryHypercoreExitCheck.spotUsdcUsd,
          6
        )
      : 0;
    const expectedRecoveryContractBalanceRaw = usdcBalanceRaw + toAtomicUsd(pendingHypercoreUsd);
    await ensureVaultContractBalanceReady({
      botVaultId: String(botVault.id),
      vaultAddress,
      action: "recover_closed_funds",
      expectedAmountRaw: expectedRecoveryContractBalanceRaw,
      actualBalanceRaw: usdcBalanceRaw
    });
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
    const feeRatePctRaw = await readBotVaultProfitShareFeeRatePct({
      publicClient,
      factoryAddress,
      vaultAddress: vaultAddress as `0x${string}`
    });
    const realizedClosedPnlUsd = roundUsd(Number(botVault.realizedPnlNet ?? 0), 6);
    const highWaterMarkBeforeUsd = contractVersion === "v4"
      ? formatUsdAtomicToNumber(highWaterMarkProfitRaw)
      : roundUsd(Number(botVault.highWaterMark ?? 0), 6);
    const profitShare = contractVersion === "v4"
      ? computeV4ProfitShareRaw({
          payoutProfitRaw: profitComponentRaw,
          feeRatePctRaw,
          realizedClosedPnlUsd,
          highWaterMarkBeforeUsd
        })
      : {
          feeBaseRaw: profitComponentRaw,
          feeAmountRaw: (profitComponentRaw * feeRatePctRaw) / 100n,
          realizedClosedPnlRaw: 0n,
          highWaterMarkBeforeRaw: highWaterMarkProfitRaw,
          highWaterMarkAfterRaw: highWaterMarkProfitRaw,
          realizedClosedPnlUsd: 0,
          highWaterMarkBeforeUsd,
          highWaterMarkAfterUsd: highWaterMarkBeforeUsd
        };
    const feeAmountRaw = profitShare.feeAmountRaw;
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
      profitBaseUsd: formatUsdAtomicToNumber(profitShare.feeBaseRaw),
      realizedClosedPnlUsd: profitShare.realizedClosedPnlUsd,
      highWaterMarkBeforeUsd: profitShare.highWaterMarkBeforeUsd,
      highWaterMarkAfterUsd: profitShare.highWaterMarkAfterUsd,
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
        abi: contractVersion === "v4" ? botVaultV4Abi : botVaultV3Abi,
        functionName: "recoverClosedFunds",
        args: contractVersion === "v4"
          ? [principalToReturnRaw, usdcBalanceRaw, feeAmountRaw, profitShare.realizedClosedPnlRaw]
          : [principalToReturnRaw, usdcBalanceRaw, feeAmountRaw]
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
    getAffiliatePayoutWalletSummary,
    createAffiliatePayoutWallet,
    withdrawHypeFromAffiliatePayoutWallet,
    withdrawUsdcFromAffiliatePayoutWallet,
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
