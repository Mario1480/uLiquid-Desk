"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { erc20Abi, formatUnits, isAddress, parseUnits, type Address, type Hex } from "viem";
import { useAccount, useReadContract, useSendTransaction, useSwitchChain } from "wagmi";
import { getTransactionReceipt, waitForTransactionReceipt } from "wagmi/actions";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import { wagmiConfig } from "../../lib/web3/config";
import { AppIcon } from "../components/AppIcon";
import Web3Providers from "../components/Web3Providers";
import PageHeader from "../components/ui/PageHeader";
import {
  isWalletWatchAssetProvider,
  requestWalletWatchAsset,
  ULIQ_TOKEN_IMAGE_PATH
} from "../../src/wallet/watchAsset";

type PresaleOverview = {
  chainId: number;
  contractAddress: string;
  state: string;
  saleEnd: string | null;
  withdrawalPeriodSeconds: string;
  hardCapUsdcRaw: string;
  totalRaisedUsdcRaw: string;
  totalSoldUliqRaw: string;
  pendingAllocationUliqRaw: string;
  pendingPurchaseCount: string;
  maximumPurchasableUsdcRaw: string;
  tokenAddress: string;
  paymentTokenAddress: string;
  referencePriceUsd: string;
  asOfBlock: string;
  blockHash: string;
};

type Purchase = {
  id: string;
  purchaseIdOnchain: string;
  status: "PENDING_WITHDRAWAL" | "WITHDRAWN" | "FINALIZED";
  usdcAmountRaw: string;
  uliqAllocationRaw: string;
  withdrawalDeadline: string;
  transactionHash: string;
  confirmationStatus: "FINALIZED";
};

type PurchaseConfirmationStatus = "SUBMITTED" | "SOFT_CONFIRMED" | "SAFE" | "FINALIZED" | "FAILED" | "REORGED" | "REVIEW_REQUIRED";

type TrackedPurchase = {
  id: string;
  chainId: number;
  transactionHash: string;
  confirmationStatus: PurchaseConfirmationStatus;
  maxUsdcAmountRaw: string;
  minUliqAllocationRaw: string;
  usdcAmountRaw: string | null;
  uliqAllocationRaw: string | null;
  purchaseIdOnchain: string | null;
  receiptBlockNumber: string | null;
  statusReason: string | null;
  submittedAt: string;
  receiptObservedAt: string | null;
  networkFinalizedAt: string | null;
};

type UserPresale = {
  walletAddress: string;
  purchases: Purchase[];
  trackedPurchases: TrackedPurchase[];
};

type Entitlement = {
  walletAddress: string;
  asOfBlock: string;
  eligibleRaw: string;
  walletRaw: string;
  vestingRaw: string;
  lockedRaw: string;
  monetaryEligibleRaw: string;
  pendingPresaleRaw: string;
  referencePriceUsd: string;
  priceMode: string;
  priceQualityStatus: string;
  degradationReason: string | null;
  effectiveTier: string;
  subscriptionDiscountBps: number;
  aiDiscountBps: number;
  featureFlags: Record<string, unknown>;
  validUntil: string;
};

type Vesting = {
  allocatedRaw: string;
  releasedRaw: string;
  unreleasedRaw: string;
  claimableRaw: string;
  vestedRaw: string;
  vestingStart: string | null;
  vestingEnd: string | null;
};

type LockPosition = {
  id: string;
  lockIdOnchain: string;
  amountRaw: string;
  durationDays: number;
  startAt: string;
  unlockAt: string;
  status: string;
};

type Locks = {
  lockedBalanceRaw: string;
  positions: LockPosition[];
  supportedDurationsDays: number[];
};

type PurchaseQuote = {
  requestedUsdcRaw: string;
  acceptedUsdcRaw: string;
  uliqAllocationRaw: string;
  partialFill: boolean;
  asOfBlock: string;
};

type PreparedTx = {
  chainId: number;
  to: `0x${string}`;
  data: Hex;
  value: string;
  expectedSender: string | null;
};

type TransactionResult = {
  submittedHash: Hex;
  receiptHash: Hex;
  replacementReason: "cancelled" | "replaced" | "repriced" | null;
};

const PENDING_FINALIZE_TX_STORAGE_KEY = "uliquid.uliq.pendingFinalizeTxHashes.v1";
const PENDING_WITHDRAW_TX_STORAGE_KEY = "uliquid.uliq.pendingWithdrawTxHashes.v1";
const PURCHASE_TRACKING_REQUEST_TIMEOUT_MS = 5_000;

async function purchaseTrackingRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      apiPost<T>(path, body),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("purchase_tracking_request_timeout")), PURCHASE_TRACKING_REQUEST_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function purchaseTxKey(chainId: number, contractAddress: string, purchaseId: string): string {
  return `${chainId}:${contractAddress.toLowerCase()}:${purchaseId}`;
}

function readPendingTxHashes(storageKey: string): Record<string, Hex> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, Hex] => (
      typeof entry[1] === "string" && /^0x[0-9a-fA-F]{64}$/.test(entry[1])
    )).map(([key, hash]) => [key, hash.toLowerCase() as Hex]));
  } catch {
    return {};
  }
}

function writePendingTxHashes(storageKey: string, value: Record<string, Hex>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // The contract-state preflight remains the safety fallback if browser storage is unavailable.
  }
}

function formatRaw(value: string | null | undefined, decimals: number, maximumFractionDigits = 4): string {
  try {
    const formatted = formatUnits(BigInt(value ?? "0"), decimals);
    const numeric = Number(formatted);
    if (!Number.isFinite(numeric)) return formatted;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(numeric);
  } catch {
    return "0";
  }
}

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return "–";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "–" : parsed.toLocaleString(locale);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return String(error.payload?.error ?? error.message);
  return error instanceof Error ? error.message : String(error);
}

function statusTone(value: string): string {
  const state = value.toLowerCase();
  if (["active", "finalized", "healthy", "dex_launched", "completed", "soft_confirmed"].includes(state)) return "success";
  if (["paused", "pending_withdrawal", "market_observation", "degraded", "submitted", "safe", "review_required"].includes(state)) return "warning";
  if (["cancelled", "withdrawn", "invalid", "stale", "failed", "reorged"].includes(state)) return "danger";
  return "info";
}

function UliqHubContent() {
  const t = useTranslations("uliq");
  const locale = useLocale();
  const { address, chainId, connector, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [overview, setOverview] = useState<PresaleOverview | null>(null);
  const [me, setMe] = useState<UserPresale | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [vesting, setVesting] = useState<Vesting | null>(null);
  const [locks, setLocks] = useState<Locks | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [quote, setQuote] = useState<PurchaseQuote | null>(null);
  const [lockAmount, setLockAmount] = useState("");
  const [lockDuration, setLockDuration] = useState(30);
  const [lastTxHash, setLastTxHash] = useState<Hex | null>(null);
  const [pendingFinalizeTxHashes, setPendingFinalizeTxHashes] = useState<Record<string, Hex>>({});
  const [pendingWithdrawTxHashes, setPendingWithdrawTxHashes] = useState<Record<string, Hex>>({});
  const publicEnabled = process.env.NEXT_PUBLIC_ULIQ_ENABLED === "true";
  const paymentTokenAddress = overview?.paymentTokenAddress && isAddress(overview.paymentTokenAddress)
    ? overview.paymentTokenAddress as Address
    : undefined;
  const usdcBalance = useReadContract({
    address: paymentTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: overview?.chainId,
    query: { enabled: Boolean(publicEnabled && paymentTokenAddress && address && overview?.chainId) }
  });

  const linkedWallet = me?.walletAddress?.toLowerCase() ?? "";
  const walletMatches = Boolean(address && linkedWallet && address.toLowerCase() === linkedWallet);
  const canSign = publicEnabled && isConnected && walletMatches;

  const rememberPendingFinalize = useCallback((key: string, hash: Hex) => {
    setPendingFinalizeTxHashes((current) => {
      const next = { ...current, [key]: hash.toLowerCase() as Hex };
      writePendingTxHashes(PENDING_FINALIZE_TX_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const forgetPendingFinalize = useCallback((key: string) => {
    setPendingFinalizeTxHashes((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      writePendingTxHashes(PENDING_FINALIZE_TX_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const rememberPendingWithdraw = useCallback((key: string, hash: Hex) => {
    setPendingWithdrawTxHashes((current) => {
      const next = { ...current, [key]: hash.toLowerCase() as Hex };
      writePendingTxHashes(PENDING_WITHDRAW_TX_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const forgetPendingWithdraw = useCallback((key: string) => {
    setPendingWithdrawTxHashes((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      writePendingTxHashes(PENDING_WITHDRAW_TX_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!publicEnabled) {
      setLoading(false);
      return;
    }
    setError(null);
    const [overviewResult, meResult, entitlementResult, vestingResult, locksResult] = await Promise.allSettled([
      apiGet<PresaleOverview>("/uliq/presale"),
      apiGet<UserPresale>("/uliq/me"),
      apiGet<Entitlement>("/uliq/entitlement"),
      apiGet<Vesting>("/uliq/vesting"),
      apiGet<Locks>("/uliq/locking")
    ]);
    if (overviewResult.status === "fulfilled") setOverview(overviewResult.value);
    else setError(errorMessage(overviewResult.reason));
    if (meResult.status === "fulfilled") setMe(meResult.value);
    if (entitlementResult.status === "fulfilled") setEntitlement(entitlementResult.value);
    if (vestingResult.status === "fulfilled") setVesting(vestingResult.value);
    if (locksResult.status === "fulfilled") setLocks(locksResult.value);
    setLoading(false);
  }, [publicEnabled]);

  useEffect(() => { void load(); }, [load]);

  const hasPendingPurchaseTracking = Boolean(me?.trackedPurchases?.some((purchase) => (
    ["SUBMITTED", "SOFT_CONFIRMED", "SAFE", "FINALIZED"].includes(purchase.confirmationStatus)
  )));

  useEffect(() => {
    if (!hasPendingPurchaseTracking) return;
    const timer = window.setInterval(() => { void load(); }, 10_000);
    const refreshOnFocus = () => { void load(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [hasPendingPurchaseTracking, load]);

  useEffect(() => {
    setPendingFinalizeTxHashes(readPendingTxHashes(PENDING_FINALIZE_TX_STORAGE_KEY));
    setPendingWithdrawTxHashes(readPendingTxHashes(PENDING_WITHDRAW_TX_STORAGE_KEY));
  }, []);

  useEffect(() => {
    if (!overview || !me) return;
    for (const purchase of me.purchases) {
      if (purchase.status !== "PENDING_WITHDRAWAL") {
        const key = purchaseTxKey(overview.chainId, overview.contractAddress, purchase.purchaseIdOnchain);
        forgetPendingFinalize(key);
        forgetPendingWithdraw(key);
      }
    }
  }, [forgetPendingFinalize, forgetPendingWithdraw, me, overview]);

  useEffect(() => {
    if (!overview || !me) return;
    let cancelled = false;
    const pendingReceipts = me.purchases.flatMap((purchase) => {
      if (purchase.status !== "PENDING_WITHDRAWAL") return [];
      const key = purchaseTxKey(overview.chainId, overview.contractAddress, purchase.purchaseIdOnchain);
      const receipts: Array<{ action: "finalize" | "withdraw"; key: string; hash: Hex }> = [];
      const finalizeHash = pendingFinalizeTxHashes[key];
      const withdrawHash = pendingWithdrawTxHashes[key];
      if (finalizeHash) receipts.push({ action: "finalize", key, hash: finalizeHash });
      if (withdrawHash) receipts.push({ action: "withdraw", key, hash: withdrawHash });
      return receipts;
    });
    for (const pending of pendingReceipts) {
      void getTransactionReceipt(wagmiConfig, { chainId: overview.chainId, hash: pending.hash })
        .then((receipt) => {
          if (cancelled || receipt.status !== "reverted") return;
          if (pending.action === "finalize") forgetPendingFinalize(pending.key);
          else forgetPendingWithdraw(pending.key);
        })
        .catch(() => {
          // A missing receipt remains fail-closed until the transaction or indexer resolves it.
        });
    }
    return () => { cancelled = true; };
  }, [
    forgetPendingFinalize,
    forgetPendingWithdraw,
    me,
    overview,
    pendingFinalizeTxHashes,
    pendingWithdrawTxHashes
  ]);

  const saleProgress = useMemo(() => {
    if (!overview) return 0;
    const cap = BigInt(overview.hardCapUsdcRaw);
    return cap === BigInt(0) ? 0 : Number(BigInt(overview.totalRaisedUsdcRaw) * BigInt(10_000) / cap) / 100;
  }, [overview]);
  const remainingUsdcRaw = overview
    ? (BigInt(overview.hardCapUsdcRaw) - BigInt(overview.totalRaisedUsdcRaw)).toString()
    : "0";
  const saleActive = overview?.state === "ACTIVE";
  const activeBenefits = entitlement
    ? Object.entries(entitlement.featureFlags ?? {}).filter(([, enabled]) => enabled === true).map(([key]) => key)
    : [];
  const vestingProgress = vesting && BigInt(vesting.allocatedRaw) > BigInt(0)
    ? Number(BigInt(vesting.vestedRaw) * BigInt(10_000) / BigInt(vesting.allocatedRaw)) / 100
    : 0;
  const trackedPurchases = me?.trackedPurchases ?? [];
  const hasPurchaseHistory = Boolean(me && (me.purchases.length > 0 || trackedPurchases.length > 0));

  function trackingPresentation(purchase: TrackedPurchase): { label: string; message: string; noticeTone: string } {
    const usdc = formatRaw(purchase.usdcAmountRaw ?? purchase.maxUsdcAmountRaw, 6, 2);
    const uliq = formatRaw(purchase.uliqAllocationRaw ?? purchase.minUliqAllocationRaw, 18, 2);
    switch (purchase.confirmationStatus) {
      case "SUBMITTED":
        return { label: t("purchases.confirmationStatus.submitted"), message: t("purchases.trackedSubmitted"), noticeTone: "info" };
      case "SOFT_CONFIRMED":
        return { label: t("purchases.confirmationStatus.softConfirmed"), message: t("purchases.trackedSoftConfirmed", { usdc, uliq }), noticeTone: "success" };
      case "SAFE":
        return { label: t("purchases.confirmationStatus.safe"), message: t("purchases.trackedSafe", { usdc, uliq }), noticeTone: "info" };
      case "FINALIZED":
        return { label: t("purchases.confirmationStatus.finalized"), message: t("purchases.trackedFinalized"), noticeTone: "success" };
      case "FAILED":
        return { label: t("purchases.confirmationStatus.failed"), message: t("purchases.trackedFailed"), noticeTone: "danger" };
      case "REORGED":
        return { label: t("purchases.confirmationStatus.reorged"), message: t("purchases.trackedReorged"), noticeTone: "danger" };
      default:
        return { label: t("purchases.confirmationStatus.reviewRequired"), message: t("purchases.trackedReviewRequired"), noticeTone: "warning" };
    }
  }

  function parsePositiveAmount(value: string, decimals: number): bigint {
    const normalized = value.trim().replace(",", ".");
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(t("messages.invalidAmount"));
    const raw = parseUnits(normalized, decimals);
    if (raw <= BigInt(0)) throw new Error(t("messages.invalidAmount"));
    return raw;
  }

  async function executeTransaction(
    tx: PreparedTx,
    stage: string,
    onSubmitted?: (hash: Hex) => void | Promise<void>,
    onReverted?: () => void
  ): Promise<TransactionResult> {
    if (!canSign || !address) throw new Error(t("messages.walletRequired"));
    if (chainId !== tx.chainId) await switchChainAsync({ chainId: tx.chainId });
    setNotice(stage);
    const hash = await sendTransactionAsync({
      account: address,
      chainId: tx.chainId,
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || "0")
    });
    setLastTxHash(hash);
    await onSubmitted?.(hash);
    setNotice(t("messages.txSubmitted"));
    let replacementReason: TransactionResult["replacementReason"] = null;
    let replacementHash: Hex | null = null;
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      chainId: tx.chainId,
      hash,
      confirmations: 1,
      onReplaced: (replacement) => {
        replacementReason = replacement.reason;
        replacementHash = replacement.transaction.hash;
        setLastTxHash(replacement.transaction.hash);
      }
    });
    if (receipt.status !== "success") {
      onReverted?.();
      throw new Error(t("messages.txReverted"));
    }
    const receiptHash = (receipt.transactionHash ?? replacementHash ?? hash) as Hex;
    return { submittedHash: hash, receiptHash, replacementReason };
  }

  async function runAction<T>(key: string, action: () => Promise<T>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const successMessage = await action();
      setNotice(typeof successMessage === "string" ? successMessage : t("messages.txConfirmed"));
      await load();
    } catch (actionError) {
      setError(errorMessage(actionError) || t("messages.actionFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function requestQuote() {
    setBusy("quote");
    setError(null);
    try {
      const raw = parsePositiveAmount(purchaseAmount, 6);
      setQuote(await apiPost<PurchaseQuote>("/uliq/presale/quote", { requestedUsdcRaw: raw.toString() }));
    } catch (quoteError) {
      setError(errorMessage(quoteError));
      setQuote(null);
    } finally {
      setBusy(null);
    }
  }

  async function addUliqTokenToWallet(): Promise<string> {
    if (!overview || !isAddress(overview.tokenAddress) || !connector) {
      throw new Error(t("messages.walletRequired"));
    }
    if (chainId !== overview.chainId) await switchChainAsync({ chainId: overview.chainId });
    const provider = await connector.getProvider();
    if (!isWalletWatchAssetProvider(provider)) throw new Error(t("messages.tokenAddUnsupported"));
    let added = false;
    try {
      added = await requestWalletWatchAsset(provider, {
        tokenAddress: overview.tokenAddress,
        imageUrl: new URL(ULIQ_TOKEN_IMAGE_PATH, window.location.origin).toString()
      });
    } catch (watchError) {
      const code = typeof watchError === "object" && watchError !== null && "code" in watchError
        ? Number((watchError as { code?: unknown }).code)
        : null;
      if (code === 4001) throw new Error(t("messages.tokenAddRejected"));
      throw new Error(t("messages.tokenAddUnsupported"));
    }
    if (!added) throw new Error(t("messages.tokenAddRejected"));
    return t("messages.tokenAdded");
  }

  async function purchase() {
    if (!quote) throw new Error(t("purchase.quote"));
    const prepared = await apiPost<{ approval: PreparedTx; purchase: PreparedTx }>("/uliq/presale/purchase/prepare", {
      maxUsdcAmountRaw: quote.requestedUsdcRaw,
      minUliqAllocationRaw: quote.uliqAllocationRaw
    });
    const approvalResult = await executeTransaction(prepared.approval, t("messages.txSubmitted"));
    if (approvalResult.replacementReason === "cancelled") throw new Error(t("messages.txCancelled"));
    setNotice(t("messages.approvalConfirmed"));
    let tracked: TrackedPurchase | null = null;
    const purchaseResult = await executeTransaction(
      prepared.purchase,
      t("purchase.buy"),
      async (transactionHash) => {
        try {
          tracked = await purchaseTrackingRequest<TrackedPurchase>("/uliq/presale/purchase/track", {
            transactionHash,
            maxUsdcAmountRaw: quote.requestedUsdcRaw,
            minUliqAllocationRaw: quote.uliqAllocationRaw
          });
        } catch {
          // A second registration attempt uses the mined hash after the receipt resolves.
        }
      }
    );
    try {
      if (purchaseResult.receiptHash !== purchaseResult.submittedHash && tracked) {
        tracked = await purchaseTrackingRequest<TrackedPurchase>("/uliq/presale/purchase/track/replace", {
          transactionHash: purchaseResult.submittedHash,
          replacementTransactionHash: purchaseResult.receiptHash,
          reason: purchaseResult.replacementReason ?? "replaced"
        });
      } else if (!tracked && purchaseResult.replacementReason !== "cancelled") {
        tracked = await purchaseTrackingRequest<TrackedPurchase>("/uliq/presale/purchase/track", {
          transactionHash: purchaseResult.receiptHash,
          maxUsdcAmountRaw: quote.requestedUsdcRaw,
          minUliqAllocationRaw: quote.uliqAllocationRaw
        });
      }
      if (purchaseResult.replacementReason !== "cancelled") {
        tracked = await purchaseTrackingRequest<TrackedPurchase>("/uliq/presale/purchase/track/refresh", {
          transactionHash: purchaseResult.receiptHash
        });
      }
    } catch {
      // The persisted background job retries matching; benefits remain fail-closed meanwhile.
    }
    if (purchaseResult.replacementReason === "cancelled") throw new Error(t("messages.txCancelled"));
    setQuote(null);
    setPurchaseAmount("");
    if (tracked?.usdcAmountRaw && tracked.uliqAllocationRaw) {
      return t("messages.purchaseSoftConfirmed", {
        usdc: formatRaw(tracked.usdcAmountRaw, 6, 2),
        uliq: formatRaw(tracked.uliqAllocationRaw, 18, 2)
      });
    }
    if (tracked && ["FAILED", "REORGED", "REVIEW_REQUIRED"].includes(tracked.confirmationStatus)) {
      throw new Error(t("messages.purchaseTrackingReview"));
    }
    return t("messages.purchaseTrackingDelayed");
  }

  async function executePrepared(
    path: string,
    body: Record<string, unknown>,
    label: string,
    onSubmitted?: (hash: Hex) => void | Promise<void>,
    onReverted?: () => void
  ): Promise<TransactionResult> {
    const prepared = await apiPost<PreparedTx>(path, body);
    const result = await executeTransaction(prepared, label, onSubmitted, onReverted);
    if (result.replacementReason === "cancelled") {
      onReverted?.();
      throw new Error(t("messages.txCancelled"));
    }
    return result;
  }

  async function finalizePurchase(purchase: Purchase): Promise<void> {
    if (!overview) throw new Error(t("messages.actionFailed"));
    const key = purchaseTxKey(overview.chainId, overview.contractAddress, purchase.purchaseIdOnchain);
    let submitted = false;
    try {
      const result = await executePrepared(
        "/uliq/presale/finalize/prepare",
        { purchaseId: purchase.purchaseIdOnchain },
        t("purchases.finalize"),
        (hash) => {
          submitted = true;
          rememberPendingFinalize(key, hash);
        },
        () => forgetPendingFinalize(key)
      );
      if (result.receiptHash !== result.submittedHash) rememberPendingFinalize(key, result.receiptHash);
    } catch (finalizeError) {
      if (!submitted) forgetPendingFinalize(key);
      throw finalizeError;
    }
  }

  async function withdrawPurchase(purchase: Purchase): Promise<void> {
    if (!overview) throw new Error(t("messages.actionFailed"));
    const key = purchaseTxKey(overview.chainId, overview.contractAddress, purchase.purchaseIdOnchain);
    let submitted = false;
    try {
      const result = await executePrepared(
        "/uliq/presale/withdraw/prepare",
        { purchaseId: purchase.purchaseIdOnchain },
        t("purchases.withdraw"),
        (hash) => {
          submitted = true;
          rememberPendingWithdraw(key, hash);
        },
        () => forgetPendingWithdraw(key)
      );
      if (result.receiptHash !== result.submittedHash) rememberPendingWithdraw(key, result.receiptHash);
    } catch (withdrawError) {
      if (!submitted) forgetPendingWithdraw(key);
      throw withdrawError;
    }
  }

  async function lockTokens() {
    const amountRaw = parsePositiveAmount(lockAmount, 18);
    const prepared = await apiPost<{ approval: PreparedTx; lock: PreparedTx }>("/uliq/locking/lock/prepare", {
      amountRaw: amountRaw.toString(),
      durationDays: lockDuration
    });
    const approvalResult = await executeTransaction(prepared.approval, t("messages.txSubmitted"));
    if (approvalResult.replacementReason === "cancelled") throw new Error(t("messages.txCancelled"));
    setNotice(t("messages.approvalConfirmed"));
    const lockResult = await executeTransaction(prepared.lock, t("locking.lock"));
    if (lockResult.replacementReason === "cancelled") throw new Error(t("messages.txCancelled"));
    setLockAmount("");
  }

  if (!publicEnabled) {
    return <div className="uiPage"><div className="uiNotice uiNotice-warning">{t("unavailable")}</div></div>;
  }

  return (
    <div className="uiPage uliqPage">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("subtitle")}
        tone="accent"
        actions={(
          <>
            <button type="button" className="btn btnPrimary" onClick={() => void runAction("watch-uliq", addUliqTokenToWallet)} disabled={!canSign || !overview?.tokenAddress || busy !== null}>
              <AppIcon name="wallet" /> {t("token.addToWallet")}
            </button>
            <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
              <AppIcon name="refresh" /> {t("refresh")}
            </button>
          </>
        )}
      />

      <div className="uiNotice uiNotice-warning uliqLegalNotice">
        <AppIcon name="shield" />
        <div><strong>{t("testnetBadge")}</strong><span>{t("legalNotice")}</span></div>
      </div>
      {loading ? <div className="uiNotice uiNotice-info">{t("loading")}</div> : null}
      {error ? <div className="uiNotice uiNotice-danger">{error}</div> : null}
      {notice ? <div className="uiNotice uiNotice-success">{notice}</div> : null}
      {linkedWallet && (!isConnected || !walletMatches) ? (
        <div className="uiNotice uiNotice-warning">{t("walletMismatch", { wallet: linkedWallet })}</div>
      ) : null}

      {overview ? (
        <section className="uiSection">
          <div className="uiSectionHeader">
            <div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("sale.title")}</h2><p className="uiSectionDescription">{t("sale.description")}</p></div>
            <span className={`uiStatusBadge uiStatusBadge-${statusTone(overview.state)}`}>{overview.state.replaceAll("_", " ")}</span>
          </div>
          <div className="uliqMetricGrid">
            <div className="uiMetricTile"><span>{t("sale.raised")}</span><strong>{formatRaw(overview.totalRaisedUsdcRaw, 6, 2)} USDC</strong></div>
            <div className="uiMetricTile"><span>{t("sale.hardCap")}</span><strong>{formatRaw(overview.hardCapUsdcRaw, 6, 0)} USDC</strong></div>
            <div className="uiMetricTile"><span>{t("sale.maximum")}</span><strong>{formatRaw(overview.maximumPurchasableUsdcRaw, 6, 2)} USDC</strong></div>
            <div className="uiMetricTile"><span>{t("sale.remaining")}</span><strong>{formatRaw(remainingUsdcRaw, 6, 2)} USDC</strong></div>
            <div className="uiMetricTile"><span>{t("sale.price")}</span><strong>${overview.referencePriceUsd}</strong></div>
            <div className="uiMetricTile"><span>{t("sale.usdcBalance")}</span><strong>{formatRaw(usdcBalance.data?.toString(), 6, 2)} USDC</strong></div>
            <div className="uiMetricTile"><span>{t("sale.withdrawal")}</span><strong>{Number(overview.withdrawalPeriodSeconds).toLocaleString(locale)} s</strong></div>
            <div className="uiMetricTile"><span>{t("sale.ends")}</span><strong>{formatDate(overview.saleEnd, locale)}</strong></div>
            <div className="uiMetricTile"><span>{t("sale.block")}</span><strong>#{overview.asOfBlock}</strong></div>
          </div>
          <div className="uliqProgress" aria-label={`${saleProgress}%`}><span style={{ width: `${Math.min(100, saleProgress)}%` }} /></div>
        </section>
      ) : null}

      <div className="uliqTwoColumn">
        <section className="uiSection">
          <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("purchase.title")}</h2><p className="uiSectionDescription">{t("purchase.description")}</p></div></div>
          {overview && !saleActive ? <div className="uiNotice uiNotice-warning">{t("purchase.inactive", { state: overview.state })}</div> : null}
          <div className="uliqFormRow">
            <label><span>{t("purchase.amount")}</span><input className="input" inputMode="decimal" value={purchaseAmount} onChange={(event) => { setPurchaseAmount(event.target.value); setQuote(null); }} placeholder="100.00" /></label>
            <button type="button" className="btn" onClick={() => void requestQuote()} disabled={!saleActive || busy !== null}><AppIcon name="preview" /> {t("purchase.quote")}</button>
          </div>
          {quote ? (
            <div className="uliqQuote">
              <div><span>{t("purchase.accepted")}</span><strong>{formatRaw(quote.acceptedUsdcRaw, 6, 2)} USDC</strong></div>
              <div><span>{t("purchase.allocation")}</span><strong>{formatRaw(quote.uliqAllocationRaw, 18, 2)} ULIQ</strong></div>
              {quote.partialFill ? <p>{t("purchase.partial")}</p> : null}
              <button type="button" className="btn btnPrimary" disabled={!saleActive || !canSign || busy !== null} onClick={() => void runAction("purchase", purchase)}><AppIcon name="wallet" /> {t("purchase.buy")}</button>
            </div>
          ) : null}
          <div className="uiNotice uiNotice-info">{t("purchase.pending")}</div>
        </section>

        {entitlement ? (
          <section className="uiSection">
            <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("entitlement.title")}</h2><p className="uiSectionDescription">{t("entitlement.description")}</p></div><span className={`uiStatusBadge uiStatusBadge-${statusTone(entitlement.priceQualityStatus)}`}>{entitlement.priceQualityStatus}</span></div>
            <div className="uliqDetailList">
              <div><span>{t("entitlement.tier")}</span><strong>{entitlement.effectiveTier}</strong></div>
              <div><span>{t("entitlement.eligible")}</span><strong>{formatRaw(entitlement.eligibleRaw, 18)} ULIQ</strong></div>
              <div><span>{t("entitlement.wallet")}</span><strong>{formatRaw(entitlement.walletRaw, 18)} ULIQ</strong></div>
              <div><span>{t("entitlement.vesting")}</span><strong>{formatRaw(entitlement.vestingRaw, 18)} ULIQ</strong></div>
              <div><span>{t("entitlement.locked")}</span><strong>{formatRaw(entitlement.lockedRaw, 18)} ULIQ</strong></div>
              <div><span>{t("entitlement.monetary")}</span><strong>{formatRaw(entitlement.monetaryEligibleRaw, 18)} ULIQ</strong></div>
              <div><span>{t("entitlement.pending")}</span><strong>{formatRaw(entitlement.pendingPresaleRaw, 18)} ULIQ</strong></div>
              <div><span>{t("entitlement.price")}</span><strong>${entitlement.referencePriceUsd} · {entitlement.priceMode}</strong></div>
              <div><span>{t("entitlement.discounts")}</span><strong>{entitlement.subscriptionDiscountBps / 100}% / {entitlement.aiDiscountBps / 100}%</strong></div>
              <div><span>{t("entitlement.validUntil")}</span><strong>{formatDate(entitlement.validUntil, locale)}</strong></div>
              <div><span>{t("entitlement.benefits")}</span><strong>{activeBenefits.length ? activeBenefits.join(", ") : t("entitlement.none")}</strong></div>
            </div>
            {entitlement.degradationReason ? <div className="uiNotice uiNotice-warning">{entitlement.degradationReason}</div> : null}
          </section>
        ) : null}
      </div>

      <div className="uliqTwoColumn">
        {vesting ? (
          <section className="uiSection">
            <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("vesting.title")}</h2><p className="uiSectionDescription">{t("vesting.description")}</p></div></div>
            <div className="uliqMetricGrid uliqMetricGridCompact">
              <div className="uiMetricTile"><span>{t("vesting.allocated")}</span><strong>{formatRaw(vesting.allocatedRaw, 18)} ULIQ</strong></div>
              <div className="uiMetricTile"><span>{t("vesting.released")}</span><strong>{formatRaw(vesting.releasedRaw, 18)} ULIQ</strong></div>
              <div className="uiMetricTile"><span>{t("vesting.unreleased")}</span><strong>{formatRaw(vesting.unreleasedRaw, 18)} ULIQ</strong></div>
              <div className="uiMetricTile"><span>{t("vesting.claimable")}</span><strong>{formatRaw(vesting.claimableRaw, 18)} ULIQ</strong></div>
              <div className="uiMetricTile"><span>{t("vesting.vested")}</span><strong>{formatRaw(vesting.vestedRaw, 18)} ULIQ</strong></div>
            </div>
            <div className="uliqSchedule"><span>{t("vesting.schedule")}</span><strong>{formatDate(vesting.vestingStart, locale)} → {formatDate(vesting.vestingEnd, locale)}</strong></div>
            {!vesting.vestingStart ? <div className="uiNotice uiNotice-info">{t("vesting.waiting")}</div> : <div className="uliqProgress" aria-label={`${vestingProgress}%`}><span style={{ width: `${Math.min(100, vestingProgress)}%` }} /></div>}
            <button type="button" className="btn btnPrimary" disabled={!canSign || BigInt(vesting.claimableRaw) === BigInt(0) || busy !== null} onClick={() => void runAction("claim", () => executePrepared("/uliq/vesting/claim/prepare", {}, t("vesting.claim")))}><AppIcon name="withdraw" /> {t("vesting.claim")}</button>
          </section>
        ) : null}

        {locks ? (
          <section className="uiSection">
            <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("locking.title")}</h2><p className="uiSectionDescription">{t("locking.description")}</p></div><strong>{formatRaw(locks.lockedBalanceRaw, 18)} ULIQ</strong></div>
            <div className="uliqFormRow uliqLockForm">
              <div className="uliqAvailableBalance"><span>{t("locking.available")}</span><strong>{formatRaw(entitlement?.walletRaw, 18)} ULIQ</strong></div>
              <label><span>{t("locking.amount")}</span><input className="input" inputMode="decimal" value={lockAmount} onChange={(event) => setLockAmount(event.target.value)} placeholder="100000" /></label>
              <label><span>{t("locking.duration")}</span><select className="input" value={lockDuration} onChange={(event) => setLockDuration(Number(event.target.value))}>{locks.supportedDurationsDays.map((days) => <option key={days} value={days}>{days} days</option>)}</select></label>
              <button type="button" className="btn btnPrimary" disabled={!canSign || busy !== null} onClick={() => void runAction("lock", lockTokens)}><AppIcon name="shield" /> {t("locking.lock")}</button>
            </div>
          </section>
        ) : null}
      </div>

      <section className="uiSection">
        <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("purchases.title")}</h2><p className="uiSectionDescription">{t("connected")}: <span className="uliqMono">{linkedWallet || "–"}</span></p></div></div>
        {hasPurchaseHistory ? <div className="uliqPositionList">
          {trackedPurchases.map((trackedPurchase) => {
            const presentation = trackingPresentation(trackedPurchase);
            return <article key={`tracking-${trackedPurchase.id}`} className="uliqPositionCard">
              <div>
                <strong>{trackedPurchase.purchaseIdOnchain ? `#${trackedPurchase.purchaseIdOnchain}` : t("purchases.pendingId")}</strong>
                <span className={`uiStatusBadge uiStatusBadge-${statusTone(trackedPurchase.confirmationStatus)}`}>{presentation.label}</span>
              </div>
              <dl>
                <div><dt>{t("purchases.amount")}</dt><dd>{formatRaw(trackedPurchase.usdcAmountRaw ?? trackedPurchase.maxUsdcAmountRaw, 6, 2)} USDC</dd></div>
                <div><dt>{t("purchases.allocation")}</dt><dd>{formatRaw(trackedPurchase.uliqAllocationRaw ?? trackedPurchase.minUliqAllocationRaw, 18, 2)} ULIQ</dd></div>
              </dl>
              <div className={`uiNotice uiNotice-${presentation.noticeTone}`}>{presentation.message}</div>
              <div className="uliqActions">
                <a className="btn" href={`${process.env.NEXT_PUBLIC_ULIQ_EXPLORER_URL ?? "https://sepolia.arbiscan.io"}/tx/${trackedPurchase.transactionHash}`} target="_blank" rel="noreferrer"><AppIcon name="external" /> {t("purchases.transaction")}</a>
              </div>
            </article>;
          })}
          {me?.purchases.map((purchaseRow) => {
          const deadlinePassed = new Date(purchaseRow.withdrawalDeadline).getTime() < Date.now();
          const actionKey = overview ? purchaseTxKey(overview.chainId, overview.contractAddress, purchaseRow.purchaseIdOnchain) : null;
          const finalizeSyncPending = Boolean(actionKey && pendingFinalizeTxHashes[actionKey]);
          const withdrawSyncPending = Boolean(actionKey && pendingWithdrawTxHashes[actionKey]);
          const settlementSyncPending = finalizeSyncPending || withdrawSyncPending;
          const syncingStatus = withdrawSyncPending
            ? t("purchases.withdrawSyncingStatus")
            : finalizeSyncPending
              ? t("purchases.finalizeSyncingStatus")
              : purchaseRow.status.replaceAll("_", " ");
          return <article key={purchaseRow.id} className="uliqPositionCard">
            <div><strong>#{purchaseRow.purchaseIdOnchain}</strong><span className="uliqStatusGroup"><span className="uiStatusBadge uiStatusBadge-success">{t("purchases.confirmationStatus.finalized")}</span><span className={`uiStatusBadge uiStatusBadge-${statusTone(settlementSyncPending ? "completed" : purchaseRow.status)}`}>{syncingStatus}</span></span></div>
            <dl><div><dt>{t("purchases.allocation")}</dt><dd>{formatRaw(purchaseRow.uliqAllocationRaw, 18)} ULIQ</dd></div><div><dt>{t("purchases.deadline")}</dt><dd>{formatDate(purchaseRow.withdrawalDeadline, locale)}</dd></div></dl>
            {purchaseRow.status === "PENDING_WITHDRAWAL" ? <div className="uliqActions">
              <div className={`uiNotice ${settlementSyncPending ? "uiNotice-success" : "uiNotice-warning"}`}>{t(withdrawSyncPending ? "purchases.withdrawSyncingHint" : finalizeSyncPending ? "purchases.finalizeSyncingHint" : "purchases.pendingInactive")}</div>
              <button type="button" className="btn" disabled={!canSign || deadlinePassed || busy !== null || settlementSyncPending} onClick={() => void runAction(`withdraw-${purchaseRow.id}`, () => withdrawPurchase(purchaseRow))}><AppIcon name="restore" /> {t(withdrawSyncPending ? "purchases.withdrawSyncing" : "purchases.withdraw")}</button>
              <button type="button" className="btn btnPrimary" disabled={!canSign || !deadlinePassed || busy !== null || settlementSyncPending} onClick={() => void runAction(`finalize-${purchaseRow.id}`, () => finalizePurchase(purchaseRow))}><AppIcon name="check" /> {t(finalizeSyncPending ? "purchases.finalizeSyncing" : "purchases.finalize")}</button>
            </div> : null}
          </article>;
          })}
        </div> : <div className="uiEmptyState">{t("purchases.empty")}</div>}
      </section>

      {locks ? <section className="uiSection"><div className="uiSectionHeader"><h2 className="uiSectionTitle">{t("locking.positions")}</h2></div>{locks.positions.length ? <div className="uliqPositionList">{locks.positions.map((position) => <article key={position.id} className="uliqPositionCard"><div><strong>Lock #{position.lockIdOnchain}</strong><span className={`uiStatusBadge uiStatusBadge-${statusTone(position.status)}`}>{position.status}</span></div><dl><div><dt>{t("locking.amount")}</dt><dd>{formatRaw(position.amountRaw, 18)} ULIQ</dd></div><div><dt>{t("purchases.deadline")}</dt><dd>{formatDate(position.unlockAt, locale)}</dd></div></dl>{position.status !== "WITHDRAWN" ? <button type="button" className="btn" disabled={!canSign || new Date(position.unlockAt).getTime() > Date.now() || busy !== null} onClick={() => void runAction(`unlock-${position.id}`, () => executePrepared("/uliq/locking/unlock/prepare", { lockId: position.lockIdOnchain }, t("locking.unlock")))}><AppIcon name="withdraw" /> {t("locking.unlock")}</button> : null}</article>)}</div> : <div className="uiEmptyState">{t("locking.empty")}</div>}</section> : null}

      {lastTxHash ? <a className="btn uliqExplorerLink" href={`${process.env.NEXT_PUBLIC_ULIQ_EXPLORER_URL ?? "https://sepolia.arbiscan.io"}/tx/${lastTxHash}`} target="_blank" rel="noreferrer"><AppIcon name="external" /> {lastTxHash.slice(0, 12)}…</a> : null}
    </div>
  );
}

export default function UliqPage() {
  return <Web3Providers><UliqHubContent /></Web3Providers>;
}
