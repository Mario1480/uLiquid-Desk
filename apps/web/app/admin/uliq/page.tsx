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
import { AppIcon } from "../../components/AppIcon";
import ReauthDialog from "../../components/ReauthDialog";
import Web3Providers from "../../components/Web3Providers";
import AdminDetailSection from "../_components/AdminDetailSection";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminStatsCard from "../_components/AdminStatsCard";
import AdminStatusBadge from "../_components/AdminStatusBadge";

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
  }>;
  alerts: Array<{ id: string; severity: string; status: string; message: string; createdAt: string }>;
  audit: Array<{ id: string; action: string; actorUserId: string; createdAt: string }>;
};

type SafePreparation = {
  safeTransaction: { chainId: number; to: string; data: string; value: string; operation: number; expectedSender: string | null };
  preflight: Record<string, unknown>;
};

type ReauthAction = "dex-pending" | "dex-prepare" | "dex-submit" | "treasury-save" | "treasury-propose" | "treasury-accept" | "treasury-cancel";

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
  const [treasuryInput, setTreasuryInput] = useState("");
  const [poolReady, setPoolReady] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthAction, setReauthAction] = useState<ReauthAction>("dex-submit");
  const [preparation, setPreparation] = useState<SafePreparation | null>(null);
  const [preparationLabel, setPreparationLabel] = useState<string | null>(null);
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

  function requestReauth(action: ReauthAction) {
    setReauthAction(action);
    setReauthOpen(true);
  }

  async function runReauthenticatedAction() {
    if (reauthAction === "dex-pending") return prepareDexPending();
    if (reauthAction === "dex-prepare") return prepareSafeTransaction(false);
    if (reauthAction === "dex-submit") return prepareSafeTransaction(true);
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
          </div>

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
  return <Web3Providers><UliqAdminPageContent /></Web3Providers>;
}
