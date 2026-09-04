"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, type Address, type Hex } from "viem";
import { useLocale, useTranslations } from "next-intl";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { getBlock, getTransactionReceipt, waitForTransactionReceipt } from "wagmi/actions";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { wagmiConfig } from "../../../lib/web3/config";
import {
  deriveDexLaunchConfirmationStatus,
  isDexLaunchTracking,
  type DexLaunchConfirmationStatus,
  type DexLaunchTracking
} from "../../../src/uliq/adminDexLaunch";
import {
  applyUliqBenefitPreset,
  buildUliqTierBenefitRequest,
  createUliqTierBenefitDraft,
  type UliqTierBenefitDraft
} from "../../../src/uliq/tierBenefits";
import {
  isUliqPresaleScheduleValid,
  presaleScheduleIsoToLocalValue,
  presaleScheduleLocalValueToIso,
  type UliqPresaleScheduleDraft
} from "../../../src/uliq/presaleSchedule";
import { AppIcon } from "../../components/AppIcon";
import ReauthDialog from "../../components/ReauthDialog";
import Web3Providers from "../../components/Web3Providers";
import AdminDetailSection from "../_components/AdminDetailSection";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminStatsCard from "../_components/AdminStatsCard";
import AdminStatusBadge from "../_components/AdminStatusBadge";
import { isUliqPublicPresaleAdminVisible } from "../../../lib/uliqPublicPresale";
import PublicPresaleAdminPreview from "./PublicPresaleAdminPreview";

type GroupedCount = { status: string; _count: { _all: number }; _sum?: Record<string, string | null> };
type AdminUliqPayload = {
  overview: {
    chainId: number;
    contractAddress: string;
    state: string;
    dexLaunchTimestamp: string | null;
    totalSoldUliqRaw: string;
    totalRaisedUsdcRaw: string;
    pendingPurchaseCount: string;
    presaleInventoryUliqRaw: string;
    vestingInventoryUliqRaw: string;
    asOfBlock: string;
    rpcSource: string;
    rpcHealth: {
      primary: string;
      secondary: string;
      finalizedHeadAgreement: boolean;
    };
  };
  publicPresaleReadiness: {
    publicPreviewEnabled: boolean;
    apiReadsEnabled: boolean;
    contractsConfigured: boolean;
    purchasesEnabled: boolean;
    mainnetApproved: boolean;
    legalApproved: boolean;
  };
  presaleSchedule: {
    version: number;
    status: "NOT_CONFIGURED" | "DRAFT_CONFIGURED" | "INVALID";
    onchainStatus: string;
    chainId?: number;
    asOfBlock?: string;
    updatedAt: string | null;
    rounds: Array<{
      id: "round-1" | "round-2";
      number: number;
      allocationUliq: string;
      priceUsdcPerUliq: string;
      hardCapUsdc: string;
      minPurchaseUsdc: string;
      maxPurchaseUsdc: string;
      initialUnlockBps: number;
      cliffMonths: number;
      vestingMonths: number;
      predecessorRoundId: "round-1" | null;
      saleStart: string | null;
      saleEnd: string | null;
      onchain?: {
        contractAddress: string;
        owner: string;
        state: number;
        saleStart: string | null;
        saleEnd: string | null;
        saleWindowVersion: string;
        inventorySourceAddress: string;
        inventoryFunded: boolean;
        inventoryUliqRaw: string;
        allocationCapUliqRaw: string;
        pendingPurchaseCount: string;
        unsoldReleasedUliqRaw: string;
        unsoldInventoryUliqRaw: string;
        bindingStatus: string;
        actionId: string | null;
        transactionHash: string | null;
      };
    }>;
  };
  treasury: {
    desiredTreasury: string | null;
    desiredUpdatedAt: string | null;
    syncStatus: string;
    integrityStatus: string;
    custodyAddress: string;
    owner: string;
    activeTreasury: string;
    pendingTreasury: string | null;
    escrowBalanceUsdcRaw: string;
    totalCollectedUsdcRaw: string;
    totalRefundedUsdcRaw: string;
    totalReleasedUsdcRaw: string;
    asOfBlock: string;
  };
  indexer: null | {
    lastProcessedBlock: string | null;
    lastProcessedBlockHash: string | null;
    lastFinalizedBlock: string | null;
    failureCount: number;
    nextRetryAt: string | null;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    lastError: string | null;
    updatedAt: string;
  };
  reconciliation: null | {
    status: string;
    mismatchCount: number;
    asOfBlock: string;
    startedAt: string;
    finishedAt: string | null;
  };
  reservations: GroupedCount[];
  price: null | {
    mode: string;
    qualityStatus: string;
    priceUsd: string;
    degradationReason: string | null;
    observedAt: string;
    validUntil: string;
  };
  stats: {
    purchases: GroupedCount[];
    vesting: { _count: { _all: number }; _sum: { allocatedRaw: string | null; releasedRaw: string | null } };
    locks: { _count: { _all: number }; _sum: { amountRaw: string | null } };
  };
  tiers: Array<{
    id: string;
    code: string;
    version: number;
    minUsdValue: string;
    subscriptionDiscountBps: number;
    aiDiscountBps: number;
    monetaryBenefitCaps: { aiCreditDiscountMonthlyCents?: number | string } | null;
  }>;
  lockGate: {
    version: string;
    coverageShareBps: number;
    supportedTerms: Array<{ billingMonths: number; durationDays: number; label: string }>;
    tierCapStatus: Array<{
      code: string;
      version: number;
      aiCreditDiscountMonthlyCents: number | string | null;
      configured: boolean;
    }>;
  };
  benefitPreset: Array<{
    code: string;
    subscriptionDiscountBps: number;
    aiDiscountBps: number;
  }>;
  alerts: Array<{ id: string; severity: string; status: string; message: string; createdAt: string }>;
  audit: Array<{ id: string; action: string; actorUserId: string; createdAt: string }>;
};

type SafePreparation = {
  actionId?: string;
  safeTransaction: { chainId: number; to: string; data: string; value: string; operation: number; expectedSender: string | null };
  safeTransactions?: Array<{ chainId: number; to: string; data: string; value: string; operation: number; expectedSender: string | null }>;
  preflight: Record<string, unknown>;
};

type ReauthAction = "presale-schedule" | "schedule-prepare" | "schedule-record" | "round-ready-prepare" | "inventory-fund-prepare" | "inventory-release-prepare" | "inventory-record" | "dex-pending" | "dex-prepare" | "dex-submit" | "tier-benefits" | "treasury-save" | "treasury-propose" | "treasury-accept" | "treasury-cancel";

const DEX_LAUNCH_TRACKING_STORAGE_KEY = "uliquid.uliq.admin.dexLaunchTracking.v1";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return String(error.payload?.error ?? error.message);
  return error instanceof Error ? error.message : String(error);
}

function formatToken(raw: string | null | undefined, decimals: number, fractionDigits = 2): string {
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: fractionDigits }).format(Number(formatUnits(BigInt(raw ?? "0"), decimals)));
  } catch {
    return "0";
  }
}

function initialDexTime(): string {
  const date = new Date(Date.now() + 30 * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function readDexLaunchTracking(): DexLaunchTracking | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEX_LAUNCH_TRACKING_STORAGE_KEY) ?? "null");
    return isDexLaunchTracking(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeDexLaunchTracking(value: DexLaunchTracking): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEX_LAUNCH_TRACKING_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Finalized contract state remains the authoritative recovery path.
  }
}

function localDateTimeMin(): string {
  const date = new Date(Date.now() + 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function dexTrackingTone(status: DexLaunchConfirmationStatus): "success" | "warning" | "danger" | "info" {
  if (status === "FINALIZED") return "success";
  if (status === "FAILED" || status === "REORGED") return "danger";
  if (status === "SUBMITTED" || status === "AWAITING_SIGNATURE") return "warning";
  return "info";
}

function UliqAdminPageContent() {
  const t = useTranslations("uliq.admin");
  const locale = useLocale();
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [data, setData] = useState<AdminUliqPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dexLaunchTime, setDexLaunchTime] = useState(initialDexTime);
  const [roundScheduleDrafts, setRoundScheduleDrafts] = useState<UliqPresaleScheduleDraft[]>([]);
  const [roundScheduleReason, setRoundScheduleReason] = useState("");
  const [treasuryInput, setTreasuryInput] = useState("");
  const [tierBenefitDrafts, setTierBenefitDrafts] = useState<UliqTierBenefitDraft[]>([]);
  const [tierBenefitReason, setTierBenefitReason] = useState("");
  const [poolReady, setPoolReady] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthAction, setReauthAction] = useState<ReauthAction>("dex-submit");
  const [preparation, setPreparation] = useState<SafePreparation | null>(null);
  const [preparationLabel, setPreparationLabel] = useState<string | null>(null);
  const [schedulePrepareRoundId, setSchedulePrepareRoundId] = useState<"round-1" | "round-2">("round-1");
  const [scheduleActionId, setScheduleActionId] = useState<string | null>(null);
  const [scheduleExecutionHash, setScheduleExecutionHash] = useState("");
  const [inventoryActionId, setInventoryActionId] = useState<string | null>(null);
  const [inventoryActionRoundId, setInventoryActionRoundId] = useState<"round-1" | "round-2" | null>(null);
  const [inventoryExecutionHash, setInventoryExecutionHash] = useState("");
  const [dexSubmitting, setDexSubmitting] = useState(false);
  const [dexTracking, setDexTracking] = useState<DexLaunchTracking | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const payload = await apiGet<AdminUliqPayload>("/admin/uliq");
      setData(payload);
      if (!options?.silent) {
        setTreasuryInput(payload.treasury.desiredTreasury ?? payload.treasury.activeTreasury ?? "");
        setTierBenefitDrafts(payload.tiers.map(createUliqTierBenefitDraft));
        setRoundScheduleDrafts(payload.presaleSchedule.rounds.map((round) => ({
          id: round.id,
          saleStart: presaleScheduleIsoToLocalValue(round.saleStart),
          saleEnd: presaleScheduleIsoToLocalValue(round.saleEnd)
        })));
      }
      return payload;
    } catch (loadError) {
      if (!options?.silent) setError(errorMessage(loadError));
      return null;
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDexTracking(readDexLaunchTracking()); }, []);

  const persistDexTracking = useCallback((tracking: DexLaunchTracking) => {
    setDexTracking(tracking);
    writeDexLaunchTracking(tracking);
  }, []);

  const refreshDexTracking = useCallback(async (tracking: DexLaunchTracking) => {
    if (["FINALIZED", "FAILED", "REORGED"].includes(tracking.confirmationStatus)) return;
    try {
      const receipt = await getTransactionReceipt(wagmiConfig, {
        chainId: tracking.chainId,
        hash: tracking.transactionHash
      });
      if (receipt.status !== "success") {
        persistDexTracking({ ...tracking, confirmationStatus: "FAILED", receiptBlockNumber: receipt.blockNumber.toString(), updatedAt: new Date().toISOString() });
        return;
      }
      const [canonicalBlock, safeBlock, finalizedBlock] = await Promise.all([
        getBlock(wagmiConfig, { chainId: tracking.chainId, blockNumber: receipt.blockNumber }),
        getBlock(wagmiConfig, { chainId: tracking.chainId, blockTag: "safe" }),
        getBlock(wagmiConfig, { chainId: tracking.chainId, blockTag: "finalized" })
      ]);
      if (!canonicalBlock.hash || !receipt.blockHash) return;
      const confirmationStatus = deriveDexLaunchConfirmationStatus({
        receiptStatus: receipt.status,
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        canonicalBlockHash: canonicalBlock.hash,
        safeBlockNumber: safeBlock.number,
        finalizedBlockNumber: finalizedBlock.number
      });
      const next = {
        ...tracking,
        confirmationStatus,
        receiptBlockNumber: receipt.blockNumber.toString(),
        updatedAt: new Date().toISOString()
      };
      persistDexTracking(next);
      if (confirmationStatus === "FINALIZED") await load({ silent: true });
    } catch {
      // A submitted transaction may not have a receipt yet; the next poll retries.
    }
  }, [load, persistDexTracking]);

  useEffect(() => {
    if (!dexTracking || ["FINALIZED", "FAILED", "REORGED"].includes(dexTracking.confirmationStatus)) return;
    void refreshDexTracking(dexTracking);
    const timer = window.setInterval(() => void refreshDexTracking(dexTracking), 12_000);
    return () => window.clearInterval(timer);
  }, [dexTracking, refreshDexTracking]);

  useEffect(() => {
    if (!data || !["ENDED", "DEX_PENDING"].includes(data.overview.state)) return;
    const timer = window.setInterval(() => void load({ silent: true }), 15_000);
    return () => window.clearInterval(timer);
  }, [data, load]);

  const purchaseCounts = useMemo(() => Object.fromEntries(
    (data?.stats.purchases ?? []).map((row) => [row.status, row._count._all])
  ), [data]);
  const roundScheduleValid = useMemo(() => isUliqPresaleScheduleValid(roundScheduleDrafts), [roundScheduleDrafts]);
  const parsedDexLaunchTime = new Date(dexLaunchTime);
  const dexLaunchTimeValid = !Number.isNaN(parsedDexLaunchTime.getTime()) && parsedDexLaunchTime.getTime() >= Date.now();
  const ownerMatches = Boolean(address && data?.treasury.owner && address.toLowerCase() === data.treasury.owner.toLowerCase());
  const dexPreflightReady = Boolean(
    data
    && data.overview.state === "DEX_PENDING"
    && data.overview.pendingPurchaseCount === "0"
    && dexLaunchTimeValid
    && poolReady
    && !dexSubmitting
  );
  const activeDexTracking = dexTracking
    && data
    && dexTracking.chainId === data.overview.chainId
    && dexTracking.contractAddress.toLowerCase() === data.overview.contractAddress.toLowerCase()
      ? dexTracking
      : null;

  function dexTrackingLabel(status: DexLaunchConfirmationStatus): string {
    switch (status) {
      case "AWAITING_SIGNATURE": return t("confirmation.awaitingSignature");
      case "SUBMITTED": return t("confirmation.submitted");
      case "SOFT_CONFIRMED": return t("confirmation.softConfirmed");
      case "SAFE": return t("confirmation.safe");
      case "FINALIZED": return t("confirmation.finalized");
      case "FAILED": return t("confirmation.failed");
      case "REORGED": return t("confirmation.reorged");
    }
  }

  function dexLaunchTimestamp(): string {
    const parsed = new Date(dexLaunchTime);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.now()) throw new Error(t("invalidTimestamp"));
    return Math.floor(parsed.getTime() / 1_000).toString();
  }

  async function submitDexLaunch(response: SafePreparation, timestamp: string) {
    const tx = response.safeTransaction;
    if (!isConnected || !address) throw new Error(t("walletRequired"));
    if (!isAddress(tx.to) || !/^0x[0-9a-fA-F]*$/.test(tx.data) || tx.operation !== 0) {
      throw new Error(t("invalidPreparedTransaction"));
    }
    if (!tx.expectedSender || tx.expectedSender.toLowerCase() !== address.toLowerCase()) {
      throw new Error(t("ownerMismatch", { owner: tx.expectedSender ?? data?.treasury.owner ?? "—" }));
    }

    setDexSubmitting(true);
    setError(null);
    try {
      if (chainId !== tx.chainId) await switchChainAsync({ chainId: tx.chainId });
      setNotice(t("awaitingSignature"));
      const submittedAt = new Date().toISOString();
      const hash = await sendTransactionAsync({
        account: address,
        chainId: tx.chainId,
        to: tx.to as Address,
        data: tx.data as Hex,
        value: BigInt(tx.value || "0")
      });
      let activeHash = hash;
      persistDexTracking({
        chainId: tx.chainId,
        contractAddress: tx.to as Address,
        transactionHash: hash,
        dexLaunchTimestamp: timestamp,
        confirmationStatus: "SUBMITTED",
        receiptBlockNumber: null,
        submittedAt,
        updatedAt: submittedAt
      });
      setNotice(t("transactionSubmitted"));

      let replacementReason: "cancelled" | "replaced" | "repriced" | null = null;
      void waitForTransactionReceipt(wagmiConfig, {
        chainId: tx.chainId,
        hash,
        confirmations: 1,
        onReplaced: (replacement) => {
          replacementReason = replacement.reason;
          activeHash = replacement.transaction.hash;
          persistDexTracking({
            chainId: tx.chainId,
            contractAddress: tx.to as Address,
            transactionHash: activeHash,
            dexLaunchTimestamp: timestamp,
            confirmationStatus: replacement.reason === "cancelled" ? "FAILED" : "SUBMITTED",
            receiptBlockNumber: null,
            submittedAt,
            updatedAt: new Date().toISOString()
          });
          if (replacement.reason === "cancelled") {
            setNotice(null);
            setError(t("transactionCancelled"));
          }
        }
      }).then(async (receipt) => {
        if (replacementReason === "cancelled") return;
        if (receipt.status !== "success") {
          persistDexTracking({
            chainId: tx.chainId,
            contractAddress: tx.to as Address,
            transactionHash: activeHash,
            dexLaunchTimestamp: timestamp,
            confirmationStatus: "FAILED",
            receiptBlockNumber: receipt.blockNumber.toString(),
            submittedAt,
            updatedAt: new Date().toISOString()
          });
          setNotice(null);
          setError(t("transactionReverted"));
          return;
        }
        persistDexTracking({
          chainId: tx.chainId,
          contractAddress: tx.to as Address,
          transactionHash: activeHash,
          dexLaunchTimestamp: timestamp,
          confirmationStatus: "SOFT_CONFIRMED",
          receiptBlockNumber: receipt.blockNumber.toString(),
          submittedAt,
          updatedAt: new Date().toISOString()
        });
        setNotice(t("receiptConfirmed"));
        await load({ silent: true });
      }).catch(() => {
        // Local persistence and the polling effect continue receipt/finality recovery.
      });
    } finally {
      setDexSubmitting(false);
    }
  }

  async function prepareSafeTransaction(submit: boolean) {
    if (!poolReady) throw new Error(t("poolConfirmationRequired"));
    const timestamp = dexLaunchTimestamp();
    const response = await apiPost<SafePreparation>("/admin/uliq/safe/set-dex-launch/prepare", {
      dexLaunchTimestamp: timestamp
    });
    setPreparation(response);
    setPreparationLabel("setDexLaunchTimestamp");
    if (submit) await submitDexLaunch(response, timestamp);
    else setNotice(t("prepared"));
  }

  async function prepareDexPending() {
    const response = await apiPost<SafePreparation>("/admin/uliq/safe/mark-dex-pending/prepare", {});
    setPreparation(response);
    setPreparationLabel("markDexPending");
    setNotice(t("prepared"));
  }

  async function saveTreasury() {
    const treasury = await apiPut<AdminUliqPayload["treasury"]>("/admin/uliq/treasury", {
      desiredAddress: treasuryInput
    });
    setData((current) => current ? { ...current, treasury } : current);
    setTreasuryInput(treasury.desiredTreasury ?? treasuryInput);
    setNotice(t("treasurySaved"));
  }

  async function saveTierBenefits() {
    let payload;
    try {
      payload = buildUliqTierBenefitRequest(tierBenefitDrafts, tierBenefitReason);
    } catch (validationError) {
      const code = validationError instanceof Error ? validationError.message : "";
      if (code === "uliq_tier_benefit_reason_required") throw new Error(t("tierBenefitsReasonRequired"));
      if (code === "uliq_tier_benefit_ai_cap_required") throw new Error(t("tierBenefitsAiCapRequired"));
      if (code === "uliq_tier_threshold_basic_zero") throw new Error(t("tierBenefitsBasicThresholdFixed"));
      if (code === "uliq_tier_threshold_order_invalid") throw new Error(t("tierBenefitsThresholdOrderInvalid"));
      throw new Error(t("tierBenefitsInvalid"));
    }
    const response = await apiPut<{ version: number }>("/admin/uliq/tier-benefits", payload);
    setTierBenefitReason("");
    await load();
    setNotice(t("tierBenefitsSaved", { version: response.version }));
  }

  async function savePresaleSchedule() {
    if (!roundScheduleValid) throw new Error(t("presaleScheduleInvalid"));
    const presaleSchedule = await apiPut<AdminUliqPayload["presaleSchedule"]>("/admin/uliq/presale-rounds/schedule", {
      reason: roundScheduleReason,
      rounds: roundScheduleDrafts.map((round) => ({
        id: round.id,
        saleStart: presaleScheduleLocalValueToIso(round.saleStart),
        saleEnd: presaleScheduleLocalValueToIso(round.saleEnd)
      }))
    });
    setData((current) => current ? { ...current, presaleSchedule } : current);
    setRoundScheduleDrafts(presaleSchedule.rounds.map((round) => ({
      id: round.id,
      saleStart: presaleScheduleIsoToLocalValue(round.saleStart),
      saleEnd: presaleScheduleIsoToLocalValue(round.saleEnd)
    })));
    setRoundScheduleReason("");
    setNotice(t("presaleScheduleSaved", { version: presaleSchedule.version }));
  }

  async function prepareTreasuryAction(action: "treasury-propose" | "treasury-accept" | "treasury-cancel") {
    const route = {
      "treasury-propose": "/admin/uliq/treasury/propose/prepare",
      "treasury-accept": "/admin/uliq/treasury/accept/prepare",
      "treasury-cancel": "/admin/uliq/treasury/cancel/prepare"
    }[action];
    const response = await apiPost<SafePreparation>(route, {});
    setPreparation(response);
    setPreparationLabel({
      "treasury-propose": "proposeTreasury",
      "treasury-accept": "acceptTreasury",
      "treasury-cancel": "cancelTreasuryTransfer"
    }[action]);
    setNotice(t("prepared"));
  }

  async function prepareRoundSchedule() {
    if (!data?.presaleSchedule.version) throw new Error(t("presaleScheduleNotSaved"));
    const response = await apiPost<SafePreparation>(
      `/admin/uliq/presale-rounds/${schedulePrepareRoundId}/schedule/prepare`,
      { draftVersion: data.presaleSchedule.version }
    );
    setPreparation(response);
    setPreparationLabel(t("presaleSchedulePreparedLabel", { round: schedulePrepareRoundId === "round-1" ? 1 : 2 }));
    setScheduleActionId(response.actionId ?? null);
    setScheduleExecutionHash("");
    setNotice(t("prepared"));
    await load({ silent: true });
  }

  async function prepareRoundReady() {
    if (!data?.presaleSchedule.version) throw new Error(t("presaleScheduleNotSaved"));
    const response = await apiPost<SafePreparation>(
      `/admin/uliq/presale-rounds/${schedulePrepareRoundId}/ready/prepare`,
      { draftVersion: data.presaleSchedule.version }
    );
    setPreparation(response);
    setPreparationLabel(t("presaleReadyPreparedLabel", { round: schedulePrepareRoundId === "round-1" ? 1 : 2 }));
    setNotice(t("presaleReadyPrepared"));
  }

  async function prepareInventoryAction(action: "fund" | "release") {
    const response = await apiPost<SafePreparation>(
      `/admin/uliq/presale-rounds/${schedulePrepareRoundId}/inventory/${action}/prepare`,
      {}
    );
    setPreparation(response);
    setPreparationLabel(t(action === "fund" ? "presaleInventoryFundingPreparedLabel" : "presaleUnsoldReleasePreparedLabel", {
      round: schedulePrepareRoundId === "round-1" ? 1 : 2
    }));
    setInventoryActionId(response.actionId ?? null);
    setInventoryActionRoundId(schedulePrepareRoundId);
    setInventoryExecutionHash("");
    setNotice(t(action === "fund" ? "presaleInventoryFundingPrepared" : "presaleUnsoldReleasePrepared"));
    await load({ silent: true });
  }

  async function recordInventoryExecution() {
    if (!inventoryActionId) throw new Error(t("presaleInventoryActionMissing"));
    await apiPost("/admin/uliq/presale-rounds/inventory/record-execution", {
      actionId: inventoryActionId,
      transactionHash: inventoryExecutionHash
    });
    setNotice(t("presaleInventoryExecutionRecorded"));
    await load({ silent: true });
  }

  async function recordRoundScheduleExecution() {
    if (!scheduleActionId) throw new Error(t("presaleScheduleActionMissing"));
    await apiPost("/admin/uliq/presale-rounds/schedule/record-execution", {
      actionId: scheduleActionId,
      transactionHash: scheduleExecutionHash
    });
    setNotice(t("presaleScheduleExecutionRecorded"));
    await load({ silent: true });
  }

  function requestReauth(action: ReauthAction) {
    setReauthAction(action);
    setReauthOpen(true);
  }

  async function runReauthenticatedAction() {
    if (reauthAction === "presale-schedule") return savePresaleSchedule();
    if (reauthAction === "schedule-prepare") return prepareRoundSchedule();
    if (reauthAction === "schedule-record") return recordRoundScheduleExecution();
    if (reauthAction === "round-ready-prepare") return prepareRoundReady();
    if (reauthAction === "inventory-fund-prepare") return prepareInventoryAction("fund");
    if (reauthAction === "inventory-release-prepare") return prepareInventoryAction("release");
    if (reauthAction === "inventory-record") return recordInventoryExecution();
    if (reauthAction === "dex-pending") return prepareDexPending();
    if (reauthAction === "dex-prepare") return prepareSafeTransaction(false);
    if (reauthAction === "dex-submit") return prepareSafeTransaction(true);
    if (reauthAction === "tier-benefits") return saveTierBenefits();
    if (reauthAction === "treasury-save") return saveTreasury();
    return prepareTreasuryAction(reauthAction);
  }

  async function copyPayload() {
    if (!preparation) return;
    await navigator.clipboard.writeText(JSON.stringify(preparation, null, 2));
    setNotice(t("copied"));
  }

  return (
    <div className="adminPageStack uliqPage">
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("subtitle")} />
      <div className="adminToolbarRow">
        <AdminNotice tone="warning">{t("testnetNotice")}</AdminNotice>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          <AppIcon name="refresh" /> {t("refresh")}
        </button>
      </div>
      {error ? <AdminNotice tone="danger">{error}</AdminNotice> : null}
      {notice ? <AdminNotice tone="success" onDismiss={() => setNotice(null)}>{notice}</AdminNotice> : null}

      {data ? (
        <>
          <div className="adminStatsGrid">
            <AdminStatsCard label={t("saleState")} value={data.overview.state} hint={`#${data.overview.asOfBlock}`} />
            <AdminStatsCard label={t("sold")} value={`${formatToken(data.overview.totalSoldUliqRaw, 18, 0)} ULIQ`} />
            <AdminStatsCard label={t("pending")} value={data.overview.pendingPurchaseCount} />
            <AdminStatsCard label={t("withdrawals")} value={purchaseCounts.WITHDRAWN ?? 0} />
            <AdminStatsCard label={t("finalized")} value={purchaseCounts.FINALIZED ?? 0} />
            <AdminStatsCard label={t("activeLocks")} value={data.stats.locks._count._all} />
            <AdminStatsCard label={t("mainnetApprovalStatus")} value={data.publicPresaleReadiness.mainnetApproved ? t("approved") : t("notApproved")} />
            <AdminStatsCard label={t("legalApprovalStatus")} value={data.publicPresaleReadiness.legalApproved ? t("approved") : t("notApproved")} />
          </div>

          <AdminDetailSection title={t("presaleScheduleTitle")} description={t("presaleScheduleDescription")}>
            <div className="adminToolbarRow">
              <AdminStatusBadge value={data.presaleSchedule.status} />
              <AdminStatusBadge value={data.presaleSchedule.onchainStatus} />
              <span className="settingsMutedText">
                {data.presaleSchedule.updatedAt
                  ? t("presaleScheduleUpdated", { date: new Date(data.presaleSchedule.updatedAt).toLocaleString(locale), version: data.presaleSchedule.version })
                  : t("presaleScheduleNotSaved")}
              </span>
            </div>
            <AdminNotice tone="info">{t("presaleScheduleBackendNotice")}</AdminNotice>
            <div className="uliqAdminRoundList">
              {data.presaleSchedule.rounds.map((round) => {
                const draft = roundScheduleDrafts.find((item) => item.id === round.id) ?? { id: round.id, saleStart: "", saleEnd: "" };
                return (
                  <div className="uliqAdminRoundRow" key={round.id}>
                    <div className="uliqAdminRoundHeader">
                      <div>
                        <strong>{t("presaleRound", { number: round.number })}</strong>
                        <small>{round.predecessorRoundId ? t("presaleRoundPredecessor") : t("presaleRoundIndependent")}</small>
                      </div>
                      <AdminStatusBadge value={round.onchain?.bindingStatus ?? (draft.saleStart && draft.saleEnd ? "configured" : "missing")} />
                    </div>
                    <div className="uliqAdminRoundParameters">
                      <div><span>{t("presaleAllocation")}</span><strong>{Number(round.allocationUliq).toLocaleString(locale)} ULIQ</strong></div>
                      <div><span>{t("presalePrice")}</span><strong>{round.priceUsdcPerUliq} USDC</strong></div>
                      <div><span>{t("presaleHardCap")}</span><strong>{Number(round.hardCapUsdc).toLocaleString(locale)} USDC</strong></div>
                      <div><span>{t("presaleBuyerLimits")}</span><strong>{Number(round.minPurchaseUsdc).toLocaleString(locale)}–{Number(round.maxPurchaseUsdc).toLocaleString(locale)} USDC</strong></div>
                      <div><span>{t("presaleUnlock")}</span><strong>{round.initialUnlockBps / 100}%</strong></div>
                      <div><span>{t("presaleVesting")}</span><strong>{round.cliffMonths ? t("presaleVestingWithCliff", { cliff: round.cliffMonths, vesting: round.vestingMonths }) : t("presaleVestingWithoutCliff", { vesting: round.vestingMonths })}</strong></div>
                    </div>
                    <div className="adminFormGridCompact">
                      <label className="adminFormField">
                        <span className="adminFormFieldLabel">{t("presaleStart")}</span>
                        <input
                          className="input"
                          type="datetime-local"
                          min={localDateTimeMin()}
                          value={draft.saleStart}
                          onChange={(event) => setRoundScheduleDrafts((current) => current.map((item) => item.id === round.id ? { ...item, saleStart: event.target.value } : item))}
                        />
                      </label>
                      <label className="adminFormField">
                        <span className="adminFormFieldLabel">{t("presaleEnd")}</span>
                        <input
                          className="input"
                          type="datetime-local"
                          min={draft.saleStart || localDateTimeMin()}
                          value={draft.saleEnd}
                          onChange={(event) => setRoundScheduleDrafts((current) => current.map((item) => item.id === round.id ? { ...item, saleEnd: event.target.value } : item))}
                        />
                      </label>
                    </div>
                    {draft.saleStart && draft.saleEnd && new Date(draft.saleStart).getTime() >= new Date(draft.saleEnd).getTime()
                      ? <AdminNotice tone="danger">{t("presaleRoundEndAfterStart")}</AdminNotice>
                      : null}
                    {round.onchain ? (
                      <div className="adminKeyValueList">
                        <div className="adminKeyValueRow"><span>{t("presaleOnchainVersion")}</span><strong>{round.onchain.saleWindowVersion}</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleOnchainStart")}</span><strong>{round.onchain.saleStart ? new Date(round.onchain.saleStart).toLocaleString(locale) : "—"}</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleOnchainEnd")}</span><strong>{round.onchain.saleEnd ? new Date(round.onchain.saleEnd).toLocaleString(locale) : "—"}</strong></div>
                        <div className="adminKeyValueRow"><span>{t("ownerWallet")}</span><strong className="uliqMono">{round.onchain.owner}</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleInventorySource")}</span><strong className="uliqMono">{round.onchain.inventorySourceAddress}</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleInventoryFundingStatus")}</span><AdminStatusBadge value={round.onchain.inventoryFunded ? "funded" : "not_funded"} /></div>
                        <div className="adminKeyValueRow"><span>{t("presaleInventoryBalance")}</span><strong>{formatToken(round.onchain.inventoryUliqRaw, 18, 0)} ULIQ</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleUnsoldInventory")}</span><strong>{formatToken(round.onchain.unsoldInventoryUliqRaw, 18, 0)} ULIQ</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleUnsoldReleased")}</span><strong>{formatToken(round.onchain.unsoldReleasedUliqRaw, 18, 0)} ULIQ</strong></div>
                      </div>
                    ) : null}
                    {round.onchain?.state === 0 && !round.onchain.inventoryFunded ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setSchedulePrepareRoundId(round.id);
                          requestReauth("inventory-fund-prepare");
                        }}
                      >
                        <AppIcon name="funding" /> {t("presaleInventoryFundPrepareSafe")}
                      </button>
                    ) : null}
                    {round.onchain && ["DRAFT_ONLY", "DRIFTED", "PREPARED"].includes(round.onchain.bindingStatus) ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setSchedulePrepareRoundId(round.id);
                          requestReauth("schedule-prepare");
                        }}
                        disabled={!data.presaleSchedule.version}
                      >
                        <AppIcon name="shield" /> {t("presaleSchedulePrepareSafe")}
                      </button>
                    ) : null}
                    {round.onchain?.bindingStatus === "BOUND" && round.onchain.state === 0 ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setSchedulePrepareRoundId(round.id);
                          requestReauth("round-ready-prepare");
                        }}
                        disabled={!round.onchain.inventoryFunded}
                      >
                        <AppIcon name="shield" /> {t("presaleReadyPrepareSafe")}
                      </button>
                    ) : null}
                    {round.onchain && round.onchain.state >= 4 && round.onchain.pendingPurchaseCount === "0" && round.onchain.unsoldReleasedUliqRaw === "0" && BigInt(round.onchain.unsoldInventoryUliqRaw) > BigInt(0) ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setSchedulePrepareRoundId(round.id);
                          requestReauth("inventory-release-prepare");
                        }}
                      >
                        <AppIcon name="wallet" /> {t("presaleUnsoldReleasePrepareSafe")}
                      </button>
                    ) : null}
                    {inventoryActionId && inventoryActionRoundId === round.id ? (
                      <div className="adminFormGridCompact">
                        <label className="adminFormField">
                          <span className="adminFormFieldLabel">{t("presaleInventoryExecutionHash")}</span>
                          <input
                            className="input uliqMono"
                            value={inventoryExecutionHash}
                            placeholder="0x…"
                            onChange={(event) => setInventoryExecutionHash(event.target.value.trim())}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => requestReauth("inventory-record")}
                          disabled={!/^0x[0-9a-fA-F]{64}$/.test(inventoryExecutionHash)}
                        >
                          <AppIcon name="audit" /> {t("presaleInventoryRecordExecution")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <label className="adminFormField">
              <span className="adminFormFieldLabel">{t("presaleScheduleReason")}</span>
              <input
                className="input"
                value={roundScheduleReason}
                maxLength={500}
                placeholder={t("presaleScheduleReasonPlaceholder")}
                onChange={(event) => setRoundScheduleReason(event.target.value)}
              />
              <span className="adminFormFieldHint">{t("presaleScheduleReasonProgress", { count: roundScheduleReason.trim().length })}</span>
            </label>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => requestReauth("presale-schedule")}
              disabled={!roundScheduleValid || roundScheduleReason.trim().length < 8}
            >
              <AppIcon name="save" /> {t("presaleScheduleSave")}
            </button>
            {scheduleActionId ? (
              <div className="adminFormGridCompact">
                <label className="adminFormField">
                  <span className="adminFormFieldLabel">{t("presaleScheduleExecutionHash")}</span>
                  <input
                    className="input uliqMono"
                    value={scheduleExecutionHash}
                    placeholder="0x…"
                    onChange={(event) => setScheduleExecutionHash(event.target.value.trim())}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  onClick={() => requestReauth("schedule-record")}
                  disabled={!/^0x[0-9a-fA-F]{64}$/.test(scheduleExecutionHash)}
                >
                  <AppIcon name="audit" /> {t("presaleScheduleRecordExecution")}
                </button>
              </div>
            ) : null}
          </AdminDetailSection>

          <div className="adminDetailGrid">
            <AdminDetailSection title={t("inventory")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>Presale</span><strong>{formatToken(data.overview.presaleInventoryUliqRaw, 18, 0)} ULIQ</strong></div>
                <div className="adminKeyValueRow"><span>Vesting</span><strong>{formatToken(data.overview.vestingInventoryUliqRaw, 18, 0)} ULIQ</strong></div>
                <div className="adminKeyValueRow"><span>{t("raised")}</span><strong>{formatToken(data.overview.totalRaisedUsdcRaw, 6)} USDC</strong></div>
                <div className="adminKeyValueRow"><span>RPC read</span><AdminStatusBadge value={data.overview.rpcSource} /></div>
                <div className="adminKeyValueRow"><span>RPC primary</span><AdminStatusBadge value={data.overview.rpcHealth.primary} /></div>
                <div className="adminKeyValueRow"><span>RPC secondary</span><AdminStatusBadge value={data.overview.rpcHealth.secondary} /></div>
                <div className="adminKeyValueRow"><span>Finalized head</span><AdminStatusBadge value={data.overview.rpcHealth.finalizedHeadAgreement ? "matched" : "mismatch"} /></div>
              </div>
            </AdminDetailSection>

            <AdminDetailSection title={t("indexer")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("processedBlock")}</span><strong>{data.indexer?.lastProcessedBlock ?? "—"}</strong></div>
                <div className="adminKeyValueRow"><span>{t("finalizedBlock")}</span><strong>{data.indexer?.lastFinalizedBlock ?? "—"}</strong></div>
                <div className="adminKeyValueRow"><span>{t("failures")}</span><strong>{data.indexer?.failureCount ?? 0}</strong></div>
                <div className="adminKeyValueRow"><span>{t("lease")}</span><AdminStatusBadge value={data.indexer?.leaseOwner ? "active" : "idle"} /></div>
              </div>
              {data.indexer?.lastError ? <AdminNotice tone="warning">{data.indexer.lastError}</AdminNotice> : null}
            </AdminDetailSection>

            <AdminDetailSection title={t("reconciliation")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("status")}</span><AdminStatusBadge value={data.reconciliation?.status} /></div>
                <div className="adminKeyValueRow"><span>{t("mismatches")}</span><strong>{data.reconciliation?.mismatchCount ?? "—"}</strong></div>
                <div className="adminKeyValueRow"><span>{t("block")}</span><strong>{data.reconciliation?.asOfBlock ?? "—"}</strong></div>
              </div>
            </AdminDetailSection>

            <AdminDetailSection title={t("price")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("mode")}</span><AdminStatusBadge value={data.price?.mode} /></div>
                <div className="adminKeyValueRow"><span>{t("quality")}</span><AdminStatusBadge value={data.price?.qualityStatus} /></div>
                <div className="adminKeyValueRow"><span>USD</span><strong>{data.price?.priceUsd ?? "—"}</strong></div>
              </div>
              {data.price?.degradationReason ? <AdminNotice tone="warning">{data.price.degradationReason}</AdminNotice> : null}
            </AdminDetailSection>

            <AdminDetailSection title={t("reservations")}>
              <div className="adminKeyValueList">
                {data.reservations.length ? data.reservations.map((row) => <div className="adminKeyValueRow" key={row.status}><AdminStatusBadge value={row.status} /><strong>{row._count._all}</strong></div>) : <span>—</span>}
              </div>
            </AdminDetailSection>

            <AdminDetailSection title={t("vestingStats")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("positions")}</span><strong>{data.stats.vesting._count._all}</strong></div>
                <div className="adminKeyValueRow"><span>{t("allocated")}</span><strong>{formatToken(data.stats.vesting._sum.allocatedRaw, 18, 0)} ULIQ</strong></div>
                <div className="adminKeyValueRow"><span>{t("released")}</span><strong>{formatToken(data.stats.vesting._sum.releasedRaw, 18, 0)} ULIQ</strong></div>
              </div>
            </AdminDetailSection>
          </div>

          <AdminDetailSection title={t("tiers")} description={t("tiersDescription")}>
            <div className="adminKeyValueList">
              {data.tiers.map((tier) => <div className="adminKeyValueRow" key={tier.id}><strong>{tier.code} · v{tier.version}</strong><span>${tier.minUsdValue} · Sub {tier.subscriptionDiscountBps / 100}% · AI {tier.aiDiscountBps / 100}%</span></div>)}
            </div>
            <div className="adminToolbarRow">
              <button type="button" className="btn" onClick={() => setTierBenefitDrafts((current) => applyUliqBenefitPreset(current, data.benefitPreset))}>
                <AppIcon name="refresh" /> {t("tierBenefitsApplyPreset")}
              </button>
            </div>
            <div className="adminListStack">
              {tierBenefitDrafts.map((draft, index) => (
                <div className="adminFormGridCompact" key={draft.code}>
                  <label className="adminFormField">
                    <span className="adminFormFieldLabel">{draft.code}</span>
                    <span className="adminFormFieldHint">{t("tierBenefitsVersioned")}</span>
                  </label>
                  <label className="adminFormField">
                    <span className="adminFormFieldLabel">{t("tierBenefitsMinimumUsd")}</span>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={draft.minUsdValue}
                      disabled={draft.code === "BASIC"}
                      aria-describedby={`uliq-tier-threshold-${draft.code}`}
                      onChange={(event) => setTierBenefitDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, minUsdValue: event.target.value } : item))}
                    />
                    <span id={`uliq-tier-threshold-${draft.code}`} className="adminFormFieldHint">
                      {draft.code === "BASIC" ? t("tierBenefitsBasicThresholdFixed") : t("tierBenefitsThresholdHint")}
                    </span>
                  </label>
                  <label className="adminFormField">
                    <span className="adminFormFieldLabel">{t("tierBenefitsSubscriptionPercent")}</span>
                    <input className="input" inputMode="decimal" value={draft.subscriptionDiscountPercent} onChange={(event) => setTierBenefitDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, subscriptionDiscountPercent: event.target.value } : item))} />
                  </label>
                  <label className="adminFormField">
                    <span className="adminFormFieldLabel">{t("tierBenefitsAiPercent")}</span>
                    <input className="input" inputMode="decimal" value={draft.aiDiscountPercent} onChange={(event) => setTierBenefitDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, aiDiscountPercent: event.target.value } : item))} />
                  </label>
                  <label className="adminFormField">
                    <span className="adminFormFieldLabel">{t("tierBenefitsAiCap")}</span>
                    <input className="input" inputMode="decimal" value={draft.aiCreditDiscountMonthlyUsd} placeholder={t("tierBenefitsAiCapPlaceholder")} onChange={(event) => setTierBenefitDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, aiCreditDiscountMonthlyUsd: event.target.value } : item))} />
                  </label>
                </div>
              ))}
            </div>
            <label className="adminFormField">
              <span className="adminFormFieldLabel">{t("tierBenefitsReason")}</span>
              <input className="input" value={tierBenefitReason} maxLength={500} placeholder={t("tierBenefitsReasonPlaceholder")} onChange={(event) => setTierBenefitReason(event.target.value)} />
              <span className="adminFormFieldHint">{t("tierBenefitsReasonProgress", { count: tierBenefitReason.trim().length })}</span>
              <span className="adminFormFieldHint">{t("tierBenefitsCapHint")}</span>
            </label>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => requestReauth("tier-benefits")}
              disabled={tierBenefitDrafts.length === 0 || tierBenefitReason.trim().length < 8}
              title={tierBenefitReason.trim().length < 8 ? t("tierBenefitsReasonRequired") : undefined}
            >
              <AppIcon name="save" /> {t("tierBenefitsSave")}
            </button>
          </AdminDetailSection>

          <AdminDetailSection title={t("lockGateTitle")} description={t("lockGateDescription")}>
            <div className="adminKeyValueList">
              <div className="adminKeyValueRow"><span>{t("lockGateVersion")}</span><strong>{data.lockGate.version}</strong></div>
              <div className="adminKeyValueRow"><span>{t("coverageShare")}</span><strong>{data.lockGate.coverageShareBps / 100}%</strong></div>
              <div className="adminKeyValueRow"><span>{t("supportedTerms")}</span><strong>{data.lockGate.supportedTerms.map((term) => `${term.billingMonths}M / ${term.durationDays}d`).join(" · ")}</strong></div>
              {data.lockGate.tierCapStatus.map((tier) => <div className="adminKeyValueRow" key={`${tier.code}-${tier.version}`}><span>{tier.code} · v{tier.version}</span><span><AdminStatusBadge value={tier.configured ? "configured" : "missing"} /> {tier.aiCreditDiscountMonthlyCents == null ? "—" : `${Number(tier.aiCreditDiscountMonthlyCents) / 100} USD`}</span></div>)}
            </div>
            <AdminNotice tone="info">{t("lockGateAuditHint")}</AdminNotice>
          </AdminDetailSection>

          <AdminDetailSection title={t("treasuryTitle")} description={t("treasuryDescription")}>
            <AdminNotice tone="warning">{t("treasuryTwoStep")}</AdminNotice>
            <div className="adminDetailGrid">
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("treasurySync")}</span><AdminStatusBadge value={data.treasury.syncStatus} /></div>
                <div className="adminKeyValueRow"><span>{t("treasuryIntegrity")}</span><AdminStatusBadge value={data.treasury.integrityStatus} /></div>
                <div className="adminKeyValueRow"><span>{t("treasuryActive")}</span><strong className="uliqMono">{data.treasury.activeTreasury}</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryPending")}</span><strong className="uliqMono">{data.treasury.pendingTreasury ?? "—"}</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryOwner")}</span><strong className="uliqMono">{data.treasury.owner}</strong></div>
              </div>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("escrowBalance")}</span><strong>{formatToken(data.treasury.escrowBalanceUsdcRaw, 6)} tUSDC</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryCollected")}</span><strong>{formatToken(data.treasury.totalCollectedUsdcRaw, 6)} tUSDC</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryRefunded")}</span><strong>{formatToken(data.treasury.totalRefundedUsdcRaw, 6)} tUSDC</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryReleased")}</span><strong>{formatToken(data.treasury.totalReleasedUsdcRaw, 6)} tUSDC</strong></div>
                <div className="adminKeyValueRow"><span>{t("block")}</span><strong>#{data.treasury.asOfBlock}</strong></div>
              </div>
            </div>
            <div className="adminFormGridCompact">
              <label className="adminFormField">
                <span className="adminFormFieldLabel">{t("treasuryDesired")}</span>
                <input className="input uliqMono" value={treasuryInput} onChange={(event) => setTreasuryInput(event.target.value.trim())} placeholder="0x…" />
                <span className="adminFormFieldHint">{t("treasuryDesiredHint")}</span>
              </label>
            </div>
            <div className="adminToolbarRow">
              <button type="button" className="btn btnPrimary" onClick={() => requestReauth("treasury-save")} disabled={!treasuryInput}>
                <AppIcon name="save" /> {t("treasurySave")}
              </button>
              <button type="button" className="btn" onClick={() => requestReauth("treasury-propose")} disabled={data.treasury.syncStatus !== "proposal_required"}>
                <AppIcon name="send" /> {t("treasuryPropose")}
              </button>
              <button type="button" className="btn" onClick={() => requestReauth("treasury-accept")} disabled={data.treasury.syncStatus !== "acceptance_required"}>
                <AppIcon name="check" /> {t("treasuryAccept")}
              </button>
              <button type="button" className="btn" onClick={() => requestReauth("treasury-cancel")} disabled={!data.treasury.pendingTreasury}>
                <AppIcon name="cancel" /> {t("treasuryCancel")}
              </button>
            </div>
          </AdminDetailSection>

          <AdminDetailSection title={t("dexPendingTitle")} description={t("dexPendingDescription")}>
            <div className="adminKeyValueList">
              <div className="adminKeyValueRow"><span>{t("saleState")}</span><AdminStatusBadge value={data.overview.state} /></div>
              <div className="adminKeyValueRow"><span>{t("pending")}</span><strong>{data.overview.pendingPurchaseCount}</strong></div>
              <div className="adminKeyValueRow"><span>{t("presaleInventory")}</span><strong>{formatToken(data.overview.presaleInventoryUliqRaw, 18, 0)} ULIQ</strong></div>
            </div>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => requestReauth("dex-pending")}
              disabled={data.overview.state !== "ENDED" || data.overview.pendingPurchaseCount !== "0"}
            >
              <AppIcon name="launch" /> {t("dexPendingPrepare")}
            </button>
          </AdminDetailSection>

          <AdminDetailSection title={t("safeTitle")} description={t("safeDescription")}>
            <AdminNotice tone="warning">{t("externalPoolNotice")}</AdminNotice>
            <ol className="uliqLaunchSteps">
              <li>
                <span className="uliqLaunchStepIndex">1</span>
                <div><strong>{t("stepDexPending")}</strong><small>{t("stepDexPendingHint")}</small></div>
                <AdminStatusBadge value={["DEX_PENDING", "DEX_LAUNCHED", "COMPLETED"].includes(data.overview.state) ? "completed" : "pending"} />
              </li>
              <li>
                <span className="uliqLaunchStepIndex">2</span>
                <div><strong>{t("stepSchedule")}</strong><small>{data.overview.dexLaunchTimestamp ? new Date(data.overview.dexLaunchTimestamp).toLocaleString(locale) : t("stepScheduleHint")}</small></div>
                <AdminStatusBadge value={data.overview.dexLaunchTimestamp ? "completed" : "pending"} />
              </li>
              <li>
                <span className="uliqLaunchStepIndex">3</span>
                <div><strong>{t("stepFinality")}</strong><small>{["DEX_LAUNCHED", "COMPLETED"].includes(data.overview.state) ? t("confirmation.finalized") : activeDexTracking ? dexTrackingLabel(activeDexTracking.confirmationStatus) : t("stepFinalityHint")}</small></div>
                <AdminStatusBadge value={["DEX_LAUNCHED", "COMPLETED"].includes(data.overview.state) ? "finalized" : activeDexTracking?.confirmationStatus ?? "pending"} />
              </li>
            </ol>
            <div className="adminFormGridCompact">
              <label className="adminFormField">
                <span className="adminFormFieldLabel">{t("timestamp")}</span>
                <input
                  className="input"
                  type="datetime-local"
                  min={localDateTimeMin()}
                  value={dexLaunchTime}
                  onChange={(event) => setDexLaunchTime(event.target.value)}
                  disabled={data.overview.state !== "DEX_PENDING" || dexSubmitting}
                />
                <span className="adminFormFieldHint">{t("immutableTimestamp")}</span>
              </label>
            </div>
            <label className="uliqLaunchConfirmation">
              <input type="checkbox" checked={poolReady} onChange={(event) => setPoolReady(event.target.checked)} disabled={data.overview.state !== "DEX_PENDING" || dexSubmitting} />
              <span>{t("externalPoolConfirmation")}</span>
            </label>
            <div className="adminKeyValueList">
              <div className="adminKeyValueRow"><span>{t("ownerWallet")}</span><strong className="uliqMono">{data.treasury.owner}</strong></div>
              <div className="adminKeyValueRow"><span>{t("connectedWallet")}</span><strong className="uliqMono">{address ?? "—"}</strong></div>
            </div>
            {!isConnected ? <AdminNotice tone="warning">{t("walletRequired")}</AdminNotice> : null}
            {isConnected && !ownerMatches ? <AdminNotice tone="warning">{t("ownerMismatch", { owner: data.treasury.owner })}</AdminNotice> : null}
            <div className="adminToolbarRow">
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() => requestReauth("dex-submit")}
                disabled={!dexPreflightReady || !isConnected || !ownerMatches}
              >
                <AppIcon name="launch" /> {dexSubmitting ? t("awaitingSignature") : t("submitLaunch")}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => requestReauth("dex-prepare")}
                disabled={!dexPreflightReady}
              >
                <AppIcon name="shield" /> {t("prepareSafeFallback")}
              </button>
            </div>
            {activeDexTracking ? (
              <AdminNotice tone={dexTrackingTone(activeDexTracking.confirmationStatus)}>
                <span>{dexTrackingLabel(activeDexTracking.confirmationStatus)} · </span>
                <a href={`${process.env.NEXT_PUBLIC_ULIQ_EXPLORER_URL ?? "https://sepolia.arbiscan.io"}/tx/${activeDexTracking.transactionHash}`} target="_blank" rel="noreferrer">
                  {activeDexTracking.transactionHash.slice(0, 12)}…
                </a>
              </AdminNotice>
            ) : null}
          </AdminDetailSection>

          <AdminDetailSection title={t("payload")} description={preparationLabel ?? undefined}>
            {preparation ? (
              <>
                <pre className="card uliqAdminPayload uliqMono">{JSON.stringify(preparation, null, 2)}</pre>
                <button type="button" className="btn" onClick={() => void copyPayload()}><AppIcon name="copy" /> {t("copy")}</button>
              </>
            ) : <div className="settingsMutedText">{t("noPayload")}</div>}
          </AdminDetailSection>

          <div className="adminDetailGrid">
            <AdminDetailSection title={t("alerts")}>
              <div className="adminListStack">{data.alerts.length ? data.alerts.map((alert) => <div className="adminKeyValueRow" key={alert.id}><span>{alert.message}</span><AdminStatusBadge value={alert.status} label={alert.severity} /></div>) : <span>—</span>}</div>
            </AdminDetailSection>
            <AdminDetailSection title={t("audit")}>
              <div className="adminListStack">{data.audit.length ? data.audit.map((event) => <div className="adminKeyValueRow" key={event.id}><span>{event.action}</span><small>{new Date(event.createdAt).toLocaleString(locale)}</small></div>) : <span>—</span>}</div>
            </AdminDetailSection>
          </div>
        </>
      ) : loading ? <div className="settingsMutedText">Loading…</div> : null}

      <ReauthDialog
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onVerified={runReauthenticatedAction}
      />
    </div>
  );
}

export default function UliqAdminPage() {
  if (isUliqPublicPresaleAdminVisible() && process.env.NEXT_PUBLIC_ULIQ_ENABLED !== "true") {
    return <PublicPresaleAdminPreview />;
  }
  return <Web3Providers><UliqAdminPageContent /></Web3Providers>;
}
