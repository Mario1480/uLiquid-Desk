import type { Express } from "express";
import { z } from "zod";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import { isAddress } from "viem";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { createFundingReadService } from "../funding/fundingRead.service.js";
import { readRouteParam } from "../routeParams.js";
import type { FundingReadService } from "../funding/types.js";
import { createRelayFundingService, type RelayFundingService } from "../funding/relayFunding.service.js";
import { createTransferReadService } from "../transfers/transferRead.service.js";
import type { TransferReadService } from "../transfers/types.js";
import type { VaultService } from "../vaults/service.js";
import type { OnchainActionService } from "../vaults/onchainAction.service.js";
import type { FundingVaultService } from "../vaults/fundingVault.service.js";
import {
  closeBotVaultOnchain,
  reconcileBotVaultById,
  recoverBotVaultClosedFunds,
  type BotVaultRuntimeService,
  type BotVaultV3Service
} from "../vaults/botVaultRuntime.service.js";
import { createWalletReadService, type WalletReadService } from "../wallet/hyperliquidRead.service.js";

const botVaultListQuerySchema = z.object({
  gridInstanceId: z.string().trim().min(1).optional(),
  reusableOnly: z.coerce.boolean().optional()
});

const ledgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const feeEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const executionEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const pnlReportQuerySchema = z.object({
  fillsLimit: z.coerce.number().int().min(1).max(100).default(20)
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional()
});

const closeOnlyMutationSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});

const onchainActionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const onchainCreateMasterTxSchema = z.object({
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainDepositMasterTxSchema = z.object({
  amountUsd: z.number().positive(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainWithdrawMasterTxSchema = z.object({
  amountUsd: z.number().positive(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const fundingVaultCreateTxSchema = z.object({
  actionKey: z.string().trim().min(1).max(190).optional()
});

const fundingVaultAmountTxSchema = z.object({
  amountUsd: z.number().positive(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainCreateBotTxSchema = z.object({
  allocationUsd: z.number().positive(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainReserveBotTxSchema = z.object({
  amountUsd: z.number().positive().optional(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainFundBotHypercoreTxSchema = z.object({
  amountUsd: z.number().positive().optional(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainClaimTxSchema = z.object({
  releasedReservedUsd: z.number().min(0).optional(),
  returnedToFreeUsd: z.number().min(0).optional(),
  grossReturnedUsd: z.number().min(0).optional(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainCloseTxSchema = z.object({
  releasedReservedUsd: z.number().min(0).optional(),
  returnedToFreeUsd: z.number().min(0).optional(),
  grossReturnedUsd: z.number().min(0).optional(),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainSetBotAgentTxSchema = z.object({
  agentWallet: z.string().trim().min(1),
  actionKey: z.string().trim().min(1).max(190).optional()
});

const onchainSubmitTxSchema = z.object({
  txHash: z.string().trim().min(66).max(66)
});

const onchainFailTxSchema = z.object({
  txHash: z.string().trim().min(66).max(66).optional()
});

const accrualQuerySchema = z.object({
  botVaultId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const masterVaultCashMutationSchema = z.object({
  amountUsd: z.number().positive(),
  idempotencyKey: z.string().trim().min(1),
  metadata: z.record(z.unknown()).optional()
});

const masterVaultAgentWalletSchema = z.object({
  agentWallet: z.string().trim().min(1),
  agentWalletVersion: z.number().int().min(1).max(999).optional(),
  agentSecretRef: z.string().trim().min(1).max(190).nullable().optional()
});

const masterVaultAgentThresholdSchema = z.object({
  thresholdHype: z.number().min(0).max(1_000_000)
});

const masterVaultWithdrawHypeSchema = z.object({
  amountHype: z.number().positive().optional(),
  reserveHype: z.number().min(0).max(1000).optional()
});

const agentWalletFundHypeSchema = z.object({
  txHash: z.string().trim().regex(/^0x[a-fA-F0-9]{64}$/),
  amountHype: z.number().positive(),
  fromAddress: z.string().trim().min(1).optional()
});

const walletAddressParamSchema = z.object({
  address: z.string().trim().min(1)
});

const fundingIntentActionTypeSchema = z.enum([
  "funding_bridge_deposit",
  "funding_bridge_withdraw",
  "funding_relay_usdc_to_hyperevm",
  "funding_relay_usdc_to_arbitrum",
  "funding_relay_hype_topup",
  "funding_transfer_core_to_evm",
  "funding_transfer_evm_to_core",
  "funding_usd_class_transfer"
]);

const fundingIntentCreateSchema = z.object({
  actionType: fundingIntentActionTypeSchema,
  actionKey: z.string().trim().min(1).max(190).optional(),
  chainId: z.number().int().min(0),
  toAddress: z.string().trim().min(1).optional(),
  asset: z.enum(["USDC", "HYPE"]),
  direction: z.string().trim().min(1).max(64),
  amountRaw: z.string().trim().regex(/^\d+$/),
  amountFormatted: z.string().trim().min(1).max(80),
  sourceLocation: z.string().trim().min(1).max(64),
  destinationLocation: z.string().trim().min(1).max(64),
  beforeSourceRaw: z.string().trim().regex(/^\d+$/),
  beforeDestinationRaw: z.string().trim().regex(/^\d+$/),
  targetDestinationRaw: z.string().trim().regex(/^\d+$/),
  reasonCode: z.string().trim().min(1).max(120).optional(),
  recoveryHint: z.string().trim().min(1).max(240).optional()
});

const fundingIntentSubmitSchema = z.object({
  txHash: z.string().trim().min(66).max(66).nullable().optional(),
  status: z.enum(["submitted", "failed"]).default("submitted"),
  reasonCode: z.string().trim().min(1).max(120).optional(),
  recoveryHint: z.string().trim().min(1).max(240).optional()
});

const relayQuoteSchema = z.object({
  direction: z.enum(["arbitrum_to_hyperevm", "hyperevm_to_arbitrum"]).optional(),
  usdcAmount: z.string().trim().min(1).max(80),
  includeHypeTopup: z.boolean().optional(),
  hypeTopupUsdcAmount: z.string().trim().min(1).max(80).optional()
});

const relayStatusQuerySchema = z.object({
  requestId: z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/)
});

const walletActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const vaultAddressParamSchema = z.object({
  vaultAddress: z.string().trim().min(1)
});

const vaultDetailQuerySchema = z.object({
  user: z.string().trim().min(1).optional()
});

type BotVaultOverviewUsageState = "in_use" | "unused" | "pending" | "error" | "settled";
type BotVaultOverviewManualEmptyActionType = "close" | "recover_closed" | null;

const OVERVIEW_USD_EPSILON = 0.000001;
const IN_USE_GRID_STATES = new Set(["running", "funding_pending", "starting", "stopping"]);
const IN_USE_BOT_STATUSES = new Set(["running", "starting", "stopping"]);
const PENDING_ACTION_STATUSES = new Set(["prepared", "submitted", "pending"]);
const PENDING_STATUS_CATEGORIES = new Set(["pending", "retryable"]);
const ERROR_STATUS_CATEGORIES = new Set(["blocked", "recovery_required", "user_action_required"]);

function overviewNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundOverviewUsd(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 1_000_000) / 1_000_000;
}

function normalizedOverviewText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function botVaultIsEconomicallyEmptySettlement(item: any): boolean {
  const availableUsd = overviewNumber(item?.availableUsd);
  const withdrawableUsd = overviewNumber(item?.withdrawableUsd);
  if (availableUsd > OVERVIEW_USD_EPSILON || withdrawableUsd > OVERVIEW_USD_EPSILON) return false;

  const statusCategory = normalizedOverviewText(item?.statusCategory);
  const fundingDisplayStatus = normalizedOverviewText(item?.fundingDisplayStatus);
  const fundingDisplayReason = normalizedOverviewText(item?.fundingDisplayReasonCode);
  const status = normalizedOverviewText(item?.status);
  const executionStatus = normalizedOverviewText(item?.executionStatus);
  const lifecycleState = normalizedOverviewText(item?.lifecycle?.state);

  return (
    statusCategory === "settled"
    || fundingDisplayReason === "settled"
    || (
      fundingDisplayStatus === "funding_confirmed"
      && (status === "closed" || status === "close_only" || executionStatus === "closed" || lifecycleState === "closed")
    )
  );
}

function botVaultPrincipalOutstandingUsd(item: any): number {
  if (botVaultIsEconomicallyEmptySettlement(item)) return 0;
  return Math.max(
    0,
    overviewNumber(item?.principalAllocated ?? item?.allocatedUsd) - overviewNumber(item?.principalReturned)
  );
}

function botVaultCapitalUsd(item: any): number {
  if (botVaultIsEconomicallyEmptySettlement(item)) return 0;
  return roundOverviewUsd(Math.max(
    0,
    overviewNumber(item?.allocatedUsd),
    overviewNumber(item?.availableUsd),
    overviewNumber(item?.withdrawableUsd),
    botVaultPrincipalOutstandingUsd(item)
  ));
}

function botVaultResidualCapitalUsd(item: any): number {
  return roundOverviewUsd(Math.max(
    0,
    overviewNumber(item?.availableUsd),
    overviewNumber(item?.withdrawableUsd),
    botVaultPrincipalOutstandingUsd(item)
  ));
}

function botVaultHasPendingFlow(item: any): boolean {
  const operationState = normalizedOverviewText(item?.operationState?.state);
  const displayStatus = normalizedOverviewText(item?.fundingDisplayStatus);
  const lifecycleState = normalizedOverviewText(item?.lifecycle?.state);
  const pendingActionStatus = normalizedOverviewText(item?.lifecycle?.pendingActionStatus);
  return (
    PENDING_STATUS_CATEGORIES.has(normalizedOverviewText(item?.statusCategory))
    || (operationState.length > 0 && operationState !== "confirmed")
    || displayStatus.includes("pending")
    || displayStatus.includes("retryable")
    || lifecycleState.includes("pending")
    || PENDING_ACTION_STATUSES.has(pendingActionStatus)
  );
}

function botVaultHasErrorState(item: any): boolean {
  return (
    ERROR_STATUS_CATEGORIES.has(normalizedOverviewText(item?.statusCategory))
    || normalizedOverviewText(item?.status) === "error"
    || normalizedOverviewText(item?.executionStatus) === "error"
    || Boolean(String(item?.executionLastError ?? "").trim())
  );
}

function botVaultIsSettled(item: any, residualCapitalUsd: number): boolean {
  const status = normalizedOverviewText(item?.status);
  const executionStatus = normalizedOverviewText(item?.executionStatus);
  return (
    normalizedOverviewText(item?.statusCategory) === "settled"
    || (
      residualCapitalUsd <= OVERVIEW_USD_EPSILON
      && (status === "closed" || executionStatus === "closed" || normalizedOverviewText(item?.fundingDisplayStatus) === "funding_confirmed")
      && normalizedOverviewText(item?.lifecycle?.state) !== "pending"
    )
  );
}

function botVaultIsInUse(item: any): boolean {
  const gridState = normalizedOverviewText(item?.ownerSummary?.gridState);
  const botStatus = normalizedOverviewText(item?.ownerSummary?.botStatus);
  const executionStatus = normalizedOverviewText(item?.executionStatus);
  if (IN_USE_GRID_STATES.has(gridState) || IN_USE_BOT_STATUSES.has(botStatus) || executionStatus === "running") {
    return true;
  }
  return Boolean((item?.gridInstanceId || item?.botId) && item?.reusable === false);
}

function deriveBotVaultOverviewUsageState(item: any, residualCapitalUsd: number): BotVaultOverviewUsageState {
  if (botVaultIsInUse(item)) return "in_use";
  if (botVaultHasErrorState(item)) return "error";
  if (botVaultHasPendingFlow(item)) return "pending";
  if (botVaultIsSettled(item, residualCapitalUsd)) return "settled";
  return "unused";
}

function deriveBotVaultManualEmptyAction(item: any, usageState: BotVaultOverviewUsageState): {
  type: BotVaultOverviewManualEmptyActionType;
  enabled: boolean;
  reason: string | null;
} {
  if (usageState === "in_use") {
    return { type: null, enabled: false, reason: "vault_in_use" };
  }
  if (item?.canRecover === true) {
    return { type: "recover_closed", enabled: true, reason: null };
  }
  if (item?.canClose === true) {
    return { type: "close", enabled: true, reason: null };
  }
  if (botVaultHasPendingFlow(item)) {
    return { type: null, enabled: false, reason: "pending_flow" };
  }
  if (!(item?.hasOnchainVault === true || String(item?.onchainVaultAddress ?? "").trim())) {
    return { type: null, enabled: false, reason: "vault_not_deployed" };
  }
  if (usageState === "settled" || botVaultResidualCapitalUsd(item) <= OVERVIEW_USD_EPSILON) {
    return { type: null, enabled: false, reason: "already_empty" };
  }
  return { type: null, enabled: false, reason: "not_available" };
}

function mapBotVaultOverviewItem(item: any) {
  const capitalUsd = botVaultCapitalUsd(item);
  const residualCapitalUsd = botVaultResidualCapitalUsd(item);
  const usageState = deriveBotVaultOverviewUsageState(item, residualCapitalUsd);
  const manualEmptyAction = deriveBotVaultManualEmptyAction(item, usageState);
  return {
    id: String(item?.id ?? ""),
    botId: item?.botId ? String(item.botId) : null,
    gridInstanceId: item?.gridInstanceId ? String(item.gridInstanceId) : null,
    vaultModel: item?.vaultModel ? String(item.vaultModel) : null,
    contractVersion: item?.contractVersion ? String(item.contractVersion) : null,
    onchainVaultAddress: item?.onchainVaultAddress ? String(item.onchainVaultAddress) : null,
    agentWallet: item?.providerMetadataSummary?.agentWallet ? String(item.providerMetadataSummary.agentWallet) : null,
    usageState,
    manualEmptyAction,
    capitalUsd,
    residualCapitalUsd,
    availableUsd: roundOverviewUsd(overviewNumber(item?.availableUsd)),
    allocatedUsd: roundOverviewUsd(overviewNumber(item?.allocatedUsd)),
    principalOutstandingUsd: roundOverviewUsd(botVaultPrincipalOutstandingUsd(item)),
    withdrawnUsd: roundOverviewUsd(overviewNumber(item?.withdrawnUsd)),
    claimableProfitUsd: roundOverviewUsd(overviewNumber(item?.claimableProfitUsd)),
    profitShareAccruedUsd: roundOverviewUsd(overviewNumber(item?.profitShareAccruedUsd)),
    feePaidTotal: roundOverviewUsd(overviewNumber(item?.feePaidTotal)),
    status: item?.status ? String(item.status) : null,
    executionStatus: item?.executionStatus ? String(item.executionStatus) : null,
    executionLastError: item?.executionLastError ? String(item.executionLastError) : null,
    executionLastErrorAt: item?.executionLastErrorAt ?? null,
    statusCategory: item?.statusCategory ? String(item.statusCategory) : null,
    statusReason: item?.statusReason ? String(item.statusReason) : null,
    statusDetail: item?.statusDetail ?? null,
    statusRecoveryHint: item?.statusRecoveryHint ?? item?.fundingDisplayRecoveryHint ?? null,
    fundingDisplayStatus: item?.fundingDisplayStatus ?? null,
    fundingDisplayReasonCode: item?.fundingDisplayReasonCode ?? null,
    fundingDisplayDetail: item?.fundingDisplayDetail ?? null,
    fundingDisplayNextRecommendedAction: item?.fundingDisplayNextRecommendedAction ?? null,
    operationState: item?.operationState ?? null,
    lifecycle: item?.lifecycle ?? null,
    ownerSummary: item?.ownerSummary ?? null,
    reusable: item?.reusable === true,
    reuseBlockedReason: item?.reuseBlockedReason ?? null,
    canClaim: item?.canClaim === true,
    canClose: item?.canClose === true,
    canRecover: item?.canRecover === true,
    hasOnchainVault: item?.hasOnchainVault === true,
    updatedAt: item?.updatedAt ?? null
  };
}

function extractRiskErrorCode(error: unknown): string | null {
  if (error && typeof error === "object") {
    const rawCode = "code" in error ? String((error as any).code ?? "").trim() : "";
    if (rawCode.startsWith("risk_")) return rawCode;
  }
  const message = error instanceof Error
    ? String(error.message ?? "")
    : String(error ?? "");
  const match = message.match(/risk_[a-z0-9_]+/i);
  if (!match?.[0]) return null;
  return match[0].toLowerCase();
}

function mapRiskErrorToHttp(error: unknown): { status: number; code: string; reason: string } | null {
  const code = extractRiskErrorCode(error);
  if (!code) return null;
  const status = code === "risk_invalid_status_transition" ? 409 : 400;
  return {
    status,
    code,
    reason: error instanceof Error ? String(error.message ?? code) : code
  };
}

function includesBotVaultRuntimeReason(reason: string, suffix: string): boolean {
  return reason.includes(`bot_vault_v3_${suffix}`) || reason.includes(`bot_vault_v4_${suffix}`);
}

function sendMasterVaultRemoved(res: any) {
  return res.status(410).json({
    error: "master_vault_removed",
    reason: "The legacy MasterVault flow was removed. Use the per-bot vault and /agent-wallet APIs instead."
  });
}

function normalizeAddressLower(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  return raw.toLowerCase();
}

function rawBigInt(value: unknown): bigint {
  try {
    const raw = String(value ?? "0").trim();
    return BigInt(raw || "0");
  } catch {
    return 0n;
  }
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function fundingRawBalance(balance: { raw?: string | null } | null | undefined): string {
  return String(balance?.raw ?? "0");
}

function fundingIntentActionId(actionType: string, direction: string): string {
  if (actionType === "funding_bridge_deposit") return "deposit_usdc_to_hyperliquid";
  if (actionType === "funding_bridge_withdraw") return "withdraw_usdc_from_hyperliquid";
  if (actionType === "funding_relay_usdc_to_hyperevm") return "relay_botvault_usdc_funding";
  if (actionType === "funding_relay_usdc_to_arbitrum") return "relay_botvault_usdc_withdrawal";
  if (actionType === "funding_relay_hype_topup") return "relay_botvault_hype_topup";
  if (actionType === "funding_transfer_core_to_evm") return "transfer_core_to_evm";
  if (actionType === "funding_transfer_evm_to_core") return "transfer_evm_to_core";
  if (actionType === "funding_usd_class_transfer") {
    return direction === "spot_to_perp" ? "transfer_usdc_spot_to_perp" : "transfer_usdc_perp_to_spot";
  }
  return actionType;
}

async function resolveFundingIntentObservedRaw(params: {
  action: any;
  fundingReadService: FundingReadService;
  transferReadService: TransferReadService;
}): Promise<string> {
  const metadata = metadataRecord(params.action.metadata);
  const walletAddress = String(metadata.walletAddress ?? "").trim();
  if (!walletAddress) throw new Error("wallet_address_required");
  const actionType = String(params.action.actionType ?? "");
  const asset = String(metadata.asset ?? "USDC").trim().toUpperCase();
  const direction = String(metadata.direction ?? "").trim().toLowerCase();

  if (actionType === "funding_bridge_deposit") {
    const overview = await params.fundingReadService.getFundingOverview({ address: walletAddress });
    return fundingRawBalance(overview.bridge.creditedBalance);
  }
  if (actionType === "funding_bridge_withdraw") {
    const overview = await params.fundingReadService.getFundingOverview({ address: walletAddress });
    return fundingRawBalance(overview.arbitrum.usdc);
  }
  if (actionType === "funding_relay_usdc_to_hyperevm") {
    const overview = await params.fundingReadService.getFundingOverview({ address: walletAddress });
    return fundingRawBalance(overview.hyperEvm.usdc);
  }
  if (actionType === "funding_relay_usdc_to_arbitrum") {
    const overview = await params.fundingReadService.getFundingOverview({ address: walletAddress });
    return fundingRawBalance(overview.arbitrum.usdc);
  }
  if (actionType === "funding_relay_hype_topup") {
    const overview = await params.fundingReadService.getFundingOverview({ address: walletAddress });
    return fundingRawBalance(overview.hyperEvm.hype);
  }
  if (actionType === "funding_transfer_core_to_evm") {
    const overview = await params.transferReadService.getTransferOverview({ address: walletAddress });
    return asset === "HYPE" ? fundingRawBalance(overview.hyperEvm.hype) : fundingRawBalance(overview.hyperEvm.usdc);
  }
  if (actionType === "funding_transfer_evm_to_core") {
    const overview = await params.transferReadService.getTransferOverview({ address: walletAddress });
    return asset === "HYPE" ? fundingRawBalance(overview.hyperCore.hype) : fundingRawBalance(overview.hyperCore.usdc);
  }
  if (actionType === "funding_usd_class_transfer") {
    const overview = await params.fundingReadService.getFundingOverview({ address: walletAddress });
    return direction === "spot_to_perp"
      ? fundingRawBalance(overview.bridge.creditedBalance)
      : fundingRawBalance(overview.hyperCore.usdc);
  }
  throw new Error("funding_intent_invalid_action_type");
}

export function registerVaultRoutes(
  app: Express,
  deps: {
    vaultService: VaultService;
    botVaultRuntimeService?: BotVaultRuntimeService | null;
    /** @deprecated Use botVaultRuntimeService for new call sites. */
    botVaultV3Service?: BotVaultRuntimeService | BotVaultV3Service | null;
    onchainActionService?: OnchainActionService | null;
    fundingVaultService?: FundingVaultService | null;
    walletReadService?: WalletReadService | null;
    fundingReadService?: FundingReadService | null;
    transferReadService?: TransferReadService | null;
    relayFundingService?: RelayFundingService | null;
    resolvePlanCapabilitiesForUserId?(input: {
      userId: string;
    }): Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
    isCapabilityAllowed?(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
    sendCapabilityDenied?(
      res: any,
      params: {
        capability: CapabilityKey;
        currentPlan: PlanTier;
        legacyCode?: string;
      }
    ): any;
  }
) {
  const onchainActionService = deps.onchainActionService ?? null;
  const fundingVaultService = deps.fundingVaultService ?? null;
  const botVaultRuntimeService = deps.botVaultRuntimeService ?? deps.botVaultV3Service ?? null;
  const walletReadService = deps.walletReadService ?? createWalletReadService();
  const fundingReadService = deps.fundingReadService ?? createFundingReadService();
  const transferReadService = deps.transferReadService ?? createTransferReadService();
  const relayFundingService = deps.relayFundingService ?? createRelayFundingService();
  const requireVaultProductAccess = async (_req: unknown, res: any, next: () => void) => {
    if (!deps.resolvePlanCapabilitiesForUserId || !deps.isCapabilityAllowed || !deps.sendCapabilityDenied) {
      next();
      return;
    }
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
      userId: user.id
    });
    if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "product.vaults")) {
      deps.sendCapabilityDenied(res, {
        capability: "product.vaults",
        currentPlan: capabilityContext.plan,
        legacyCode: "vaults_not_available"
      });
      return;
    }
    next();
  };

  if (botVaultRuntimeService) {
    app.get("/agent-wallet", requireAuth, async (_req, res) => {
      const user = getUserFromLocals(res);
      try {
        const summary = await botVaultRuntimeService.getUserAgentWalletSummary({ userId: user.id });
        return res.json(summary);
      } catch (error) {
        return res.status(500).json({ error: "agent_wallet_load_failed", message: String(error) });
      }
    });

    app.post("/agent-wallet/create", requireAuth, async (_req, res) => {
      const user = getUserFromLocals(res);
      try {
        const summary = await botVaultRuntimeService.createUserAgentWallet({ userId: user.id });
        return res.json({ ok: true, agentWalletSummary: summary });
      } catch (error) {
        const code = String(error instanceof Error ? error.message : error);
        const status = code === "agent_wallet_already_configured" ? 409 : 400;
        return res.status(status).json({ error: "agent_wallet_create_failed", code, message: String(error) });
      }
    });

    app.post("/agent-wallet/set", requireAuth, async (req, res) => {
      const user = getUserFromLocals(res);
      const parsed = masterVaultAgentWalletSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      try {
        const summary = await botVaultRuntimeService.setUserAgentWallet({
          userId: user.id,
          agentWallet: parsed.data.agentWallet,
          agentWalletVersion: parsed.data.agentWalletVersion ?? null,
          agentSecretRef: parsed.data.agentSecretRef ?? null
        });
        return res.json({ ok: true, agentWalletSummary: summary });
      } catch (error) {
        return res.status(400).json({ error: "agent_wallet_set_failed", message: String(error) });
      }
    });

    app.post("/agent-wallet/threshold", requireAuth, async (req, res) => {
      const user = getUserFromLocals(res);
      const parsed = masterVaultAgentThresholdSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      try {
        const summary = await botVaultRuntimeService.setUserAgentThreshold({
          userId: user.id,
          thresholdHype: parsed.data.thresholdHype
        });
        return res.json({ ok: true, agentWalletSummary: summary });
      } catch (error) {
        return res.status(400).json({ error: "agent_wallet_threshold_set_failed", message: String(error) });
      }
    });

    app.post("/agent-wallet/fund-hype", requireAuth, async (req, res) => {
      const user = getUserFromLocals(res);
      const parsed = agentWalletFundHypeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      try {
        const result = await botVaultRuntimeService.recordUserAgentWalletHypeFunding({
          userId: user.id,
          txHash: parsed.data.txHash,
          amountHype: parsed.data.amountHype,
          fromAddress: parsed.data.fromAddress ?? null
        });
        return res.json({ ok: true, ...result });
      } catch (error) {
        return res.status(400).json({ error: "agent_wallet_fund_hype_track_failed", message: String(error) });
      }
    });

    app.post("/agent-wallet/withdraw-hype", requireAuth, async (req, res) => {
      const user = getUserFromLocals(res);
      const parsed = masterVaultWithdrawHypeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      try {
        const result = await botVaultRuntimeService.withdrawHypeFromUserAgentWallet({
          userId: user.id,
          amountHype: parsed.data.amountHype ?? null,
          reserveHype: parsed.data.reserveHype ?? null
        });
        return res.json({ ok: true, ...result });
      } catch (error) {
        return res.status(400).json({ error: "agent_wallet_withdraw_hype_failed", message: String(error) });
      }
    });

    app.post("/vaults/bot-vaults/:id/controller-close", requireAuth, requireVaultProductAccess, async (req, res) => {
      const user = getUserFromLocals(res);
      const id = readRouteParam(req, "id");
      try {
        const result = await closeBotVaultOnchain(botVaultRuntimeService, {
          userId: user.id,
          botVaultId: id
        });
        return res.json({ ok: true, result });
      } catch (error) {
        const mapped = mapOnchainError(error);
        return res.status(mapped.status).json({
          error: mapped.error,
          reason: mapped.reason,
          code: mapped.code,
          recoveryHint: mapped.recoveryHint
        });
      }
    });

    app.post("/vaults/bot-vaults/:id/controller-recover-closed", requireAuth, requireVaultProductAccess, async (req, res) => {
      const user = getUserFromLocals(res);
      const id = readRouteParam(req, "id");
      try {
        const result = await recoverBotVaultClosedFunds(botVaultRuntimeService, {
          userId: user.id,
          botVaultId: id
        });
        return res.json({ ok: true, result });
      } catch (error) {
        const mapped = mapOnchainError(error);
        return res.status(mapped.status).json({
          error: mapped.error,
          reason: mapped.reason,
          code: mapped.code,
          recoveryHint: mapped.recoveryHint
        });
      }
    });

    app.post("/vaults/bot-vaults/:id/reconcile", requireAuth, requireVaultProductAccess, async (req, res) => {
      const user = getUserFromLocals(res);
      const id = readRouteParam(req, "id");
      try {
        const summary = await reconcileBotVaultById(botVaultRuntimeService, {
          userId: user.id,
          botVaultId: id,
          persist: true
        });
        if (!summary) {
          return res.status(404).json({ error: "bot_vault_not_found" });
        }
        return res.json({ ok: true, botVault: summary });
      } catch (error) {
        const mapped = mapOnchainError(error);
        return res.status(mapped.status).json({
          error: mapped.error,
          reason: mapped.reason,
          code: mapped.code,
          recoveryHint: mapped.recoveryHint
        });
      }
    });
  }

  function mapOnchainError(error: unknown): {
    status: number;
    error: string;
    reason: string;
    code?: string;
    recoveryHint?: string;
  } {
    const reason = String(error ?? "");
    if (
      reason.includes("bot_vault_onchain_close_only_already_set")
      || reason.includes("bot_vault_onchain_close_only_invalid_status")
    ) {
      return { status: 409, error: "onchain_close_only_unavailable", reason };
    }
    if (reason.includes("bot_vault_onchain_close_only_required")) {
      return { status: 409, error: "onchain_close_only_required", reason };
    }
    if (reason.includes("bot_vault_onchain_closed_required")) {
      return { status: 409, error: "onchain_closed_required", reason };
    }
    if (reason.includes("vault_execution_mode_offchain_shadow")) {
      return { status: 409, error: "vault_execution_mode_offchain_shadow", reason };
    }
    if (reason.includes("unrecoverable_closed_vault")) {
      return { status: 409, error: "unrecoverable_closed_vault", reason };
    }
    if (reason.includes("bot_vault_agent_wallet_v1_unsupported")) {
      return { status: 409, error: "onchain_agent_wallet_unavailable", reason };
    }
    if (
      reason.includes("bot_vault_onchain_claim_not_allowed")
    ) {
      return { status: 409, error: "onchain_claim_unavailable", reason };
    }
    if (reason.includes("funding_vault_launches_disabled") || reason.includes("funding_vault_withdraws_disabled")) {
      return { status: 409, error: "funding_vault_disabled", reason };
    }
    if (reason.includes("funding_vault_insufficient_usdc") || reason.includes("funding_vault_agent_hype_low")) {
      return { status: 409, error: "funding_vault_not_ready", reason };
    }
    if (includesBotVaultRuntimeReason(reason, "controller_action_required")) {
      return { status: 409, error: "onchain_controller_action_required", reason };
    }
    if (includesBotVaultRuntimeReason(reason, "hypercore_exit_required")) {
      return { status: 409, error: "onchain_hypercore_exit_required", reason };
    }
    if (
      includesBotVaultRuntimeReason(reason, "close_post_processing_pending")
      || includesBotVaultRuntimeReason(reason, "recovery_post_processing_pending")
    ) {
      return { status: 409, error: "onchain_post_processing_pending", reason };
    }
    if (
      includesBotVaultRuntimeReason(reason, "pending_reconciliation")
      && reason.includes("insufficient_contract_balance")
    ) {
      return {
        status: 409,
        error: "onchain_pending_reconciliation",
        reason,
        code: "insufficient_contract_balance",
        recoveryHint: "retry_reconcile"
      };
    }
    if (includesBotVaultRuntimeReason(reason, "recovery_requires_closed_status")) {
      return { status: 409, error: "onchain_closed_required", reason };
    }
    if (includesBotVaultRuntimeReason(reason, "recovery_no_vault_balance")) {
      return { status: 409, error: "onchain_recovery_no_vault_balance", reason };
    }
    if (
      reason.includes("wallet_address_required")
      || reason.includes("master_vault_onchain_address_missing")
      || reason.includes("funding_vault_onchain_address_missing")
      || reason.includes("funding_vault_factory_address_missing")
      || reason.includes("funding_vault_operator_missing")
      || reason.includes("agent_wallet_required")
      || reason.includes("agent_wallet_secret_missing")
      || reason.includes("agent_wallet_secret_mismatch")
      || reason.includes("controller_address_required")
      || reason.includes("bot_vault_onchain_address_missing")
      || includesBotVaultRuntimeReason(reason, "factory_address_missing")
      || includesBotVaultRuntimeReason(reason, "beneficiary_missing")
      || includesBotVaultRuntimeReason(reason, "controller_missing")
      || includesBotVaultRuntimeReason(reason, "provider_unavailable")
      || reason.includes("claim_profit_unavailable")
      || reason.includes("invalid_amount_usd")
      || reason.includes("invalid_tx_hash")
      || reason.includes("bot_vault_released_reserved_exceeds_outstanding")
      || reason.includes("bot_vault_released_reserved_exceeds_master_reserved")
      || reason.includes("bot_vault_gross_return_exceeds_limit")
      || reason.includes("vault_onchain_")
    ) {
      return { status: 400, error: "onchain_invalid_request", reason };
    }
    if (
      reason.includes("bot_vault_not_found")
      || reason.includes("master_vault_not_found")
      || reason.includes("funding_vault_not_found")
      || reason.includes("onchain_action_not_found")
      || reason.includes("user_not_found")
    ) {
      return { status: 404, error: "onchain_resource_not_found", reason };
    }
    if (reason.includes("tx_hash_already_linked") || reason.includes("already")) {
      return { status: 409, error: "onchain_conflict", reason };
    }
    return { status: 500, error: "onchain_action_failed", reason };
  }

  app.post("/vaults/master/create", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));
  app.post("/vaults/master/deposit", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));
  app.post("/vaults/master/withdraw", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));
  app.post("/vaults/master/agent-wallet/set", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));
  app.post("/vaults/master/agent-wallet/threshold", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));
  app.post("/vaults/master/agent-wallet/withdraw-hype", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));
  app.get("/vaults/master", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));

  app.get("/vaults/bot-templates", requireAuth, requireVaultProductAccess, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listCopyBotTemplates({
        userId: user.id
      });
      return res.json({
        items
      });
    } catch (error) {
      return res.status(500).json({
        error: "vault_bot_templates_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = botVaultListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listBotVaults({
        userId: user.id,
        gridInstanceId: parsed.data.gridInstanceId,
        reusableOnly: parsed.data.reusableOnly
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_bot_list_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/overview", requireAuth, requireVaultProductAccess, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      const rawItems = await deps.vaultService.listBotVaults({
        userId: user.id
      });
      const items = (rawItems ?? []).map((item: any) => mapBotVaultOverviewItem(item));
      const counts = items.reduce((acc: Record<string, number>, item: any) => {
        acc.total += 1;
        acc[item.usageState] = (acc[item.usageState] ?? 0) + 1;
        if (item.manualEmptyAction?.enabled) acc.manualEmptyAvailable += 1;
        return acc;
      }, {
        total: 0,
        in_use: 0,
        unused: 0,
        pending: 0,
        error: 0,
        settled: 0,
        manualEmptyAvailable: 0
      });
      const totals = items.reduce((acc: Record<string, number>, item: any) => {
        acc.capitalUsd = roundOverviewUsd(acc.capitalUsd + overviewNumber(item.capitalUsd));
        acc.residualCapitalUsd = roundOverviewUsd(acc.residualCapitalUsd + overviewNumber(item.residualCapitalUsd));
        acc.availableUsd = roundOverviewUsd(acc.availableUsd + overviewNumber(item.availableUsd));
        acc.claimableProfitUsd = roundOverviewUsd(acc.claimableProfitUsd + overviewNumber(item.claimableProfitUsd));
        return acc;
      }, {
        capitalUsd: 0,
        residualCapitalUsd: 0,
        availableUsd: 0,
        claimableProfitUsd: 0
      });
      return res.json({
        updatedAt: new Date().toISOString(),
        counts,
        totals,
        items
      });
    } catch (error) {
      return res.status(500).json({
        error: "vault_bot_vault_overview_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/ledger", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = ledgerQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const items = await deps.vaultService.listBotVaultLedger({
        userId: user.id,
        botVaultId: id,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_ledger_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/fee-events", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = feeEventsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const items = await deps.vaultService.listFeeEvents({
        userId: user.id,
        botVaultId: id,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_fee_events_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/execution-events", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = executionEventsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const items = await deps.vaultService.listBotExecutionEvents({
        userId: user.id,
        botVaultId: id,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_execution_events_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/pnl-report", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = pnlReportQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const report = await deps.vaultService.getBotVaultPnlReport({
        userId: user.id,
        botVaultId: id,
        fillsLimit: parsed.data.fillsLimit
      });
      return res.json(report);
    } catch (error) {
      const reason = String(error);
      if (reason.includes("bot_vault_not_found")) {
        return res.status(404).json({ error: "bot_vault_not_found" });
      }
      if (
        reason.includes("bot_vault_report_not_ready")
        || reason.includes("bot_vault_reconciliation_unavailable")
      ) {
        return res.status(409).json({
          error: reason.includes("bot_vault_reconciliation_unavailable")
            ? "bot_vault_reconciliation_unavailable"
            : "bot_vault_report_not_ready"
        });
      }
      return res.status(500).json({
        error: "vault_bot_vault_pnl_report_failed",
        reason
      });
    }
  });

  app.get("/vaults/bot-vaults/:id/audit", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = auditQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const report = await deps.vaultService.getBotVaultAudit({
        userId: user.id,
        botVaultId: id,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor
      });
      return res.json(report);
    } catch (error) {
      const reason = String(error);
      if (reason.includes("bot_vault_not_found")) {
        return res.status(404).json({ error: "bot_vault_not_found" });
      }
      return res.status(500).json({
        error: "vault_bot_vault_audit_failed",
        reason
      });
    }
  });

  app.post("/vaults/bot-vaults/:id/close-only", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = closeOnlyMutationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }

    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const botVault = await deps.vaultService.setBotVaultCloseOnly({
        userId: user.id,
        botVaultId: id,
        reason: parsed.data.reason
      });
      if (!botVault) {
        return res.status(404).json({
          error: "bot_vault_not_found"
        });
      }
      return res.json({
        ok: true,
        botVault
      });
    } catch (error) {
      const mappedRisk = mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      const reason = String(error ?? "");
      if (reason.includes("bot_vault_not_found")) {
        return res.status(404).json({
          error: "bot_vault_not_found"
        });
      }
      if (reason.includes("insufficient_")) {
        return res.status(400).json({
          error: reason
        });
      }
      return res.status(500).json({
        error: "vault_bot_close_only_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/profit-share/accruals", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = accrualQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const items = await deps.vaultService.listProfitShareAccruals({
        userId: user.id,
        botVaultId: parsed.data.botVaultId,
        limit: parsed.data.limit
      });
      return res.json({ items });
    } catch (error) {
      return res.status(500).json({
        error: "vault_profit_share_accruals_fetch_failed",
        reason: String(error)
      });
    }
  });

  app.get("/vaults/onchain/actions", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainActionListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const mode = await onchainActionService.getMode();
      const items = await onchainActionService.listActionsForUser({
        userId: user.id,
        limit: parsed.data.limit
      });
      return res.json({ mode, items });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({
        error: mapped.error,
        reason: mapped.reason
      });
    }
  });

  app.post("/vaults/onchain/master/create-tx", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));
  app.post("/vaults/onchain/master/deposit-tx", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));
  app.post("/vaults/onchain/master/withdraw-tx", requireAuth, requireVaultProductAccess, async (_req, res) => sendMasterVaultRemoved(res));

  app.get("/vaults/funding-vault", requireAuth, requireVaultProductAccess, async (_req, res) => {
    if (!fundingVaultService) {
      return res.status(503).json({ error: "funding_vault_service_unavailable" });
    }
    const user = getUserFromLocals(res);
    try {
      return res.json(await fundingVaultService.getOverview({ userId: user.id }));
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/funding-vault/create-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!fundingVaultService) {
      return res.status(503).json({ error: "funding_vault_service_unavailable" });
    }
    const parsed = fundingVaultCreateTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      const result = await fundingVaultService.buildCreateTx({
        userId: user.id,
        actionKey: parsed.data.actionKey
      });
      return res.json(result);
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/funding-vault/deposit-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!fundingVaultService) {
      return res.status(503).json({ error: "funding_vault_service_unavailable" });
    }
    const parsed = fundingVaultAmountTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      const result = await fundingVaultService.buildDepositTx({
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json(result);
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/funding-vault/withdraw-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!fundingVaultService) {
      return res.status(503).json({ error: "funding_vault_service_unavailable" });
    }
    const parsed = fundingVaultAmountTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      const result = await fundingVaultService.buildOwnerWithdrawTx({
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json(result);
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/funding-vault/agent-withdraw", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!fundingVaultService) {
      return res.status(503).json({ error: "funding_vault_service_unavailable" });
    }
    const parsed = fundingVaultAmountTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      const result = await fundingVaultService.agentWithdrawToOwner({
        userId: user.id,
        amountUsd: parsed.data.amountUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json(result);
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/create-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainCreateBotTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const result = await onchainActionService.buildCreateBotVault({
        userId: user.id,
        botVaultId: id,
        allocationUsd: parsed.data.allocationUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/reserve-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainReserveBotTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const result = await onchainActionService.buildReserveForBotVault({
        userId: user.id,
        botVaultId: id,
        amountUsd: parsed.data.amountUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/fund-hypercore-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainFundBotHypercoreTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const result = await onchainActionService.buildFundBotVaultOnHyperCore({
        userId: user.id,
        botVaultId: id,
        amountUsd: parsed.data.amountUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/set-close-only-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainCreateMasterTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const result = await onchainActionService.buildSetBotVaultCloseOnly({
        userId: user.id,
        botVaultId: id,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/claim-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainClaimTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const result = await onchainActionService.buildClaimFromBotVault({
        userId: user.id,
        botVaultId: id,
        releasedReservedUsd: parsed.data.releasedReservedUsd,
        returnedToFreeUsd: parsed.data.returnedToFreeUsd,
        grossReturnedUsd: parsed.data.grossReturnedUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/close-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainCloseTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const result = await onchainActionService.buildCloseBotVault({
        userId: user.id,
        botVaultId: id,
        releasedReservedUsd: parsed.data.releasedReservedUsd,
        returnedToFreeUsd: parsed.data.returnedToFreeUsd,
        grossReturnedUsd: parsed.data.grossReturnedUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/set-agent-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainSetBotAgentTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const result = await onchainActionService.buildSetBotVaultAgentWallet({
        userId: user.id,
        botVaultId: id,
        agentWallet: parsed.data.agentWallet,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/bot-vaults/:id/recover-closed-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainCloseTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const result = await onchainActionService.buildRecoverClosedBotVault({
        userId: user.id,
        botVaultId: id,
        releasedReservedUsd: parsed.data.releasedReservedUsd,
        returnedToFreeUsd: parsed.data.returnedToFreeUsd,
        grossReturnedUsd: parsed.data.grossReturnedUsd,
        actionKey: parsed.data.actionKey
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/actions/:id/submit-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainSubmitTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const action = await onchainActionService.submitActionTxHash({
        userId: user.id,
        actionId: id,
        txHash: parsed.data.txHash
      });
      return res.json({
        ok: true,
        action
      });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.post("/vaults/onchain/actions/:id/fail-tx", requireAuth, requireVaultProductAccess, async (req, res) => {
    if (!onchainActionService) {
      return res.status(503).json({ error: "onchain_action_service_unavailable" });
    }
    const parsed = onchainFailTxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    const id = readRouteParam(req, "id");
    try {
      const action = await onchainActionService.markActionFailed({
        userId: user.id,
        actionId: id,
        txHash: parsed.data.txHash
      });
      return res.json({
        ok: true,
        action
      });
    } catch (error) {
      const mapped = mapOnchainError(error);
      return res.status(mapped.status).json({ error: mapped.error, reason: mapped.reason });
    }
  });

  app.get("/wallet/:address/overview", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await walletReadService.getWalletOverview({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "wallet_overview_fetch_failed",
        reason
      });
    }
  });

  app.get("/wallet/:address/vaults", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await walletReadService.getWalletVaults({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "wallet_vaults_fetch_failed",
        reason
      });
    }
  });

  app.get("/wallet/:address/activity", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsedParams = walletAddressParamSchema.safeParse(req.params ?? {});
    const parsedQuery = walletActivityQuerySchema.safeParse(req.query ?? {});
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({
        error: "invalid_wallet_activity_request",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          query: parsedQuery.success ? null : parsedQuery.error.flatten()
        }
      });
    }

    try {
      const user = getUserFromLocals(res);
      const actions = onchainActionService
        ? await onchainActionService.listActionsForUser({
            userId: user.id,
            limit: 50
          })
        : [];
      const payload = await walletReadService.getWalletActivity({
        address: parsedParams.data.address,
        limit: parsedQuery.data.limit,
        items: actions
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "wallet_activity_fetch_failed",
        reason
      });
    }
  });

  app.get("/funding/:address/overview", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await fundingReadService.getFundingOverview({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "funding_overview_fetch_failed",
        reason
      });
    }
  });

  app.get("/funding/:address/readiness", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await fundingReadService.getFundingReadiness({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "funding_readiness_fetch_failed",
        reason
      });
    }
  });

  app.get("/funding/:address/history", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    const user = getUserFromLocals(res);

    try {
      const actions = onchainActionService
        ? await onchainActionService.listActionsForUser({
            userId: user.id,
            limit: 50
          })
        : [];
      const payload = await fundingReadService.getFundingHistory({
        address: parsed.data.address,
        items: actions
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "funding_history_fetch_failed",
        reason
      });
    }
  });

  app.post("/funding/:address/relay/quote", requireAuth, async (req, res) => {
    const parsedParams = walletAddressParamSchema.safeParse(req.params ?? {});
    const parsedBody = relayQuoteSchema.safeParse(req.body ?? {});
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({
        error: "invalid_relay_quote_request",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          body: parsedBody.success ? null : parsedBody.error.flatten()
        }
      });
    }
    const user = getUserFromLocals(res);
    const requestedAddress = normalizeAddressLower(parsedParams.data.address);
    const userAddress = normalizeAddressLower(user.walletAddress);
    if (!userAddress) return res.status(400).json({ error: "wallet_address_required" });
    if (!requestedAddress || requestedAddress !== userAddress) {
      return res.status(403).json({ error: "wallet_address_mismatch" });
    }

    try {
      const quote = await relayFundingService.getQuote({
        user: userAddress,
        direction: parsedBody.data.direction,
        usdcAmount: parsedBody.data.usdcAmount,
        includeHypeTopup: parsedBody.data.includeHypeTopup,
        hypeTopupUsdcAmount: parsedBody.data.hypeTopupUsdcAmount
      });
      return res.json(quote);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("relay_invalid") || reason.includes("relay_token_config_missing") || reason.includes("relay_hype_topup_not_supported") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_relay_quote_request" : "relay_quote_failed",
        reason
      });
    }
  });

  app.get("/funding/relay/status", requireAuth, async (req, res) => {
    const parsed = relayStatusQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_relay_status_request",
        details: parsed.error.flatten()
      });
    }
    try {
      const status = await relayFundingService.getStatus({
        requestId: parsed.data.requestId
      });
      return res.json(status);
    } catch (error) {
      const reason = String(error);
      const statusCode = reason.includes("relay_invalid_request_id") ? 400 : 502;
      return res.status(statusCode).json({
        error: statusCode === 400 ? "invalid_relay_status_request" : "relay_status_failed",
        reason
      });
    }
  });

  app.post("/funding/:address/intents", requireAuth, async (req, res) => {
    if (!onchainActionService || typeof onchainActionService.createFundingIntent !== "function") {
      return res.status(503).json({ error: "funding_intent_service_unavailable" });
    }
    const parsedParams = walletAddressParamSchema.safeParse(req.params ?? {});
    const parsedBody = fundingIntentCreateSchema.safeParse(req.body ?? {});
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({
        error: "invalid_funding_intent_request",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          body: parsedBody.success ? null : parsedBody.error.flatten()
        }
      });
    }
    const user = getUserFromLocals(res);
    const requestedAddress = normalizeAddressLower(parsedParams.data.address);
    const userAddress = normalizeAddressLower(user.walletAddress);
    if (!userAddress) return res.status(400).json({ error: "wallet_address_required" });
    if (!requestedAddress || requestedAddress !== userAddress) {
      return res.status(403).json({ error: "wallet_address_mismatch" });
    }
    const body = parsedBody.data;
    const toAddress = body.toAddress ? normalizeAddressLower(body.toAddress) : null;
    if (body.toAddress && !toAddress) return res.status(400).json({ error: "invalid_to_address" });

    try {
      const action = await onchainActionService.createFundingIntent({
        userId: user.id,
        walletAddress: userAddress as `0x${string}`,
        actionType: body.actionType,
        actionKey: body.actionKey,
        chainId: body.chainId,
        toAddress: toAddress as `0x${string}` | null,
        asset: body.asset,
        direction: body.direction,
        amountRaw: body.amountRaw,
        amountFormatted: body.amountFormatted,
        sourceLocation: body.sourceLocation,
        destinationLocation: body.destinationLocation,
        beforeSourceRaw: body.beforeSourceRaw,
        beforeDestinationRaw: body.beforeDestinationRaw,
        targetDestinationRaw: body.targetDestinationRaw,
        reasonCode: body.reasonCode,
        recoveryHint: body.recoveryHint
      });
      return res.json({ ok: true, action });
    } catch (error) {
      const reason = String(error);
      if (reason.includes("funding_intent_pending_reconciliation")) {
        return res.status(409).json({ error: "funding_intent_pending_reconciliation", reason });
      }
      return res.status(500).json({ error: "funding_intent_create_failed", reason });
    }
  });

  app.post("/funding/intents/:id/submit", requireAuth, async (req, res) => {
    if (!onchainActionService || typeof onchainActionService.updateFundingIntentStatus !== "function") {
      return res.status(503).json({ error: "funding_intent_service_unavailable" });
    }
    const parsed = fundingIntentSubmitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_funding_intent_submit_request",
        details: parsed.error.flatten()
      });
    }
    const user = getUserFromLocals(res);
    try {
      const action = await onchainActionService.updateFundingIntentStatus({
        userId: user.id,
        actionId: String(req.params.id ?? ""),
        status: parsed.data.status,
        txHash: parsed.data.txHash,
        metadata: {
          reasonCode: parsed.data.reasonCode ?? (parsed.data.status === "failed" ? "funding_intent_failed" : "funding_intent_submitted"),
          recoveryHint: parsed.data.recoveryHint ?? (parsed.data.status === "failed" ? "retry_action" : "wait_for_reconciliation"),
          lastCheckedAt: new Date().toISOString()
        }
      });
      return res.json({ ok: true, action });
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("funding_intent_not_found") ? 404 : 500;
      return res.status(status).json({
        error: status === 404 ? "funding_intent_not_found" : "funding_intent_submit_failed",
        reason
      });
    }
  });

  app.post("/funding/intents/:id/reconcile", requireAuth, async (req, res) => {
    if (
      !onchainActionService
      || typeof onchainActionService.getFundingIntentForUser !== "function"
      || typeof onchainActionService.updateFundingIntentStatus !== "function"
    ) {
      return res.status(503).json({ error: "funding_intent_service_unavailable" });
    }
    const user = getUserFromLocals(res);
    try {
      const action = await onchainActionService.getFundingIntentForUser({
        userId: user.id,
        actionId: String(req.params.id ?? "")
      });
      const metadata = metadataRecord(action.metadata);
      const walletAddress = normalizeAddressLower(metadata.walletAddress);
      const userAddress = normalizeAddressLower(user.walletAddress);
      if (!userAddress) return res.status(400).json({ error: "wallet_address_required" });
      if (!walletAddress || walletAddress !== userAddress) {
        return res.status(403).json({ error: "wallet_address_mismatch" });
      }

      const observedRaw = await resolveFundingIntentObservedRaw({
        action,
        fundingReadService,
        transferReadService
      });
      const targetRaw = String(metadata.targetDestinationRaw ?? "0");
      const toleranceRaw = rawBigInt(metadata.toleranceRaw ?? "1");
      const confirmed = rawBigInt(observedRaw) + toleranceRaw >= rawBigInt(targetRaw);
      const reasonCode = confirmed ? "funding_reconciled" : "funding_reconciliation_pending";
      const recoveryHint = confirmed ? "none" : "wait_for_destination_balance";
      const updated = await onchainActionService.updateFundingIntentStatus({
        userId: user.id,
        actionId: action.id,
        status: confirmed ? "confirmed" : "pending_reconciliation",
        metadata: {
          reasonCode,
          recoveryHint,
          observedDestinationRaw: observedRaw,
          lastCheckedAt: new Date().toISOString()
        }
      });
      return res.json({
        ok: true,
        action: updated,
        reconciliation: {
          status: confirmed ? "confirmed" : "pending_reconciliation",
          actionId: fundingIntentActionId(action.actionType, String(metadata.direction ?? "")),
          observedRaw,
          targetRaw,
          toleranceRaw: toleranceRaw.toString(),
          confirmed,
          reasonCode,
          recoveryHint
        }
      });
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("funding_intent_not_found") ? 404 : 502;
      return res.status(status).json({
        error: status === 404 ? "funding_intent_not_found" : "funding_reconciliation_failed",
        reason
      });
    }
  });

  app.get("/funding/:address/external-links", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await fundingReadService.getFundingExternalLinks({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "funding_external_links_fetch_failed",
        reason
      });
    }
  });

  app.get("/transfers/:address/overview", requireAuth, async (req, res) => {
    const parsed = walletAddressParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_wallet_address",
        details: parsed.error.flatten()
      });
    }

    try {
      const payload = await transferReadService.getTransferOverview({
        address: parsed.data.address
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_wallet_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_wallet_address" : "transfer_overview_fetch_failed",
        reason
      });
    }
  });

  app.get("/vaults/:vaultAddress", requireAuth, requireVaultProductAccess, async (req, res) => {
    const parsedParams = vaultAddressParamSchema.safeParse(req.params ?? {});
    const parsedQuery = vaultDetailQuerySchema.safeParse(req.query ?? {});
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({
        error: "invalid_vault_request",
        details: {
          params: parsedParams.success ? null : parsedParams.error.flatten(),
          query: parsedQuery.success ? null : parsedQuery.error.flatten()
        }
      });
    }

    try {
      const payload = await walletReadService.getVaultDetails({
        vaultAddress: parsedParams.data.vaultAddress,
        userAddress: parsedQuery.data.user
      });
      return res.json(payload);
    } catch (error) {
      const reason = String(error);
      const status = reason.includes("invalid_vault_address") ? 400 : 502;
      return res.status(status).json({
        error: status === 400 ? "invalid_vault_address" : "vault_detail_fetch_failed",
        reason
      });
    }
  });
}
