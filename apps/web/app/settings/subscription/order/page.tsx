"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { erc20Abi, formatUnits, isAddress, type Address, type Hex } from "viem";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient
} from "wagmi";
import { ApiError, apiGet, apiPost } from "../../../../lib/api";
import { shortenWalletAddress } from "../../../../lib/auth/siwe";
import { openWeb3Modal } from "../../../../lib/web3/modal";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";
import { AppIcon } from "../../../components/AppIcon";
import Web3Providers from "../../../components/Web3Providers";
import {
  buildOrderPageModel,
  centsToCurrency,
  type AuthMePayload,
  type BillingOnchainPayment,
  type BillingOrder,
  type BillingOrderStatus,
  type BillingPackage,
  type UliqBenefitSnapshot,
  type SubscriptionPayload
} from "../../../../src/billing/subscriptionViewModel";
import {
  executeBillingWriteIfFresh,
  isBillingPaymentExpired,
  selectResumableBillingCheckout
} from "../../../../src/billing/onchainCheckout";

type CartItemPayload = {
  packageId: string;
  quantity: number;
};

type CartLine = {
  packageId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineAmountCents: number;
  kind: "plan" | "addon";
};

type CheckoutResponse = {
  mode?: "onchain" | "instant";
  orderId?: string;
  merchantOrderId?: string;
  status?: BillingOrderStatus;
  order?: BillingOrder;
  payment?: BillingOnchainPayment | null;
  uliqBenefit?: UliqBenefitSnapshot | null;
};

type OrderStatusResponse = Partial<BillingOrder> & {
  order?: BillingOrder;
  payment?: BillingOnchainPayment | null;
  status?: BillingOrderStatus;
};

type ActiveCheckout = {
  orderId: string;
  merchantOrderId: string | null;
  status: BillingOrderStatus;
  payment: BillingOnchainPayment;
  uliqBenefit: UliqBenefitSnapshot | null;
};

type PaymentStage =
  | "ready"
  | "awaiting_signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "review_required"
  | "error";

const PENDING_BILLING_TX_STORAGE_KEY = "uliquid.billing.pendingTxHashes.v1";

function readPendingBillingTxHash(orderId: string): Hex | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_BILLING_TX_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    const value = typeof parsed[orderId] === "string" ? parsed[orderId] : "";
    return /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() as Hex : null;
  } catch {
    return null;
  }
}

function storePendingBillingTxHash(orderId: string, txHash: Hex): void {
  if (typeof window === "undefined") return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_BILLING_TX_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(PENDING_BILLING_TX_STORAGE_KEY, JSON.stringify({
      ...parsed,
      [orderId]: txHash.toLowerCase()
    }));
  } catch {
    // The backend discovery scanner remains the recovery path if storage is unavailable.
  }
}

function clearPendingBillingTxHash(orderId: string): void {
  if (typeof window === "undefined") return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_BILLING_TX_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    delete parsed[orderId];
    window.localStorage.setItem(PENDING_BILLING_TX_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore unavailable or malformed browser storage.
  }
}

function parseCheckoutErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (typeof error.payload?.error === "string") return error.payload.error;
  return null;
}

function formatUliqRaw(value: unknown): string {
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
      Number(formatUnits(BigInt(String(value ?? "0")), 18))
    );
  } catch {
    return "0";
  }
}

function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(20, Math.trunc(value)));
}

function normalizeWalletAddress(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function getPaymentRecipient(payment: BillingOnchainPayment | null | undefined): string | null {
  const value = payment?.recipientAddress ?? payment?.treasuryAddress ?? null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stageFromStatus(status: BillingOrderStatus, payment: BillingOnchainPayment): PaymentStage {
  if (status === "paid") return "confirmed";
  if (status === "review_required") return "review_required";
  if (status === "confirming") return "confirming";
  if (status === "failed" || status === "expired") return "error";
  return payment.txHash ? "submitted" : "ready";
}

function explorerUrl(chainId: number, txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  if (chainId === 42161) return `https://arbiscan.io/tx/${txHash}`;
  if (chainId === 421614) return `https://sepolia.arbiscan.io/tx/${txHash}`;
  return null;
}

function normalizePaymentDetails(
  payment: BillingOnchainPayment,
  fallback?: BillingOnchainPayment | null,
  order?: BillingOrder
): BillingOnchainPayment {
  const tokenDecimals = Number(payment.tokenDecimals ?? fallback?.tokenDecimals ?? 6);
  const amountRaw = String(payment.amountRaw ?? fallback?.amountRaw ?? "0");
  let amountFormatted = payment.amountFormatted ?? fallback?.amountFormatted ?? "";
  if (!amountFormatted && /^\d+$/.test(amountRaw)) {
    try {
      amountFormatted = formatUnits(BigInt(amountRaw), tokenDecimals);
    } catch {
      amountFormatted = "";
    }
  }
  const txHash = payment.txHash ?? fallback?.txHash ?? null;
  const chainId = Number(payment.chainId ?? fallback?.chainId ?? 42161);
  return {
    ...fallback,
    ...payment,
    chainId,
    tokenDecimals,
    amountRaw,
    amountFormatted,
    expiresAt: payment.expiresAt ?? order?.expiresAt ?? fallback?.expiresAt ?? "",
    confirmationsRequired:
      payment.confirmationsRequired
      ?? payment.requiredConfirmations
      ?? fallback?.confirmationsRequired
      ?? fallback?.requiredConfirmations
      ?? 12,
    txHash,
    explorerUrl:
      payment.explorerUrl
      ?? order?.explorerUrl
      ?? fallback?.explorerUrl
      ?? explorerUrl(chainId, txHash)
  };
}

function checkoutFromOrder(order: BillingOrder): ActiveCheckout | null {
  if (!order.onchainPayment) return null;
  const storedTxHash = readPendingBillingTxHash(order.id);
  return {
    orderId: order.id,
    merchantOrderId: order.merchantOrderId ?? null,
    status: order.status,
    payment: normalizePaymentDetails({
      ...order.onchainPayment,
      txHash: order.onchainPayment.txHash ?? storedTxHash
    }, null, order),
    uliqBenefit: order.uliqBenefit ?? null
  };
}

function SubscriptionOrderPageContent() {
  const t = useTranslations("settings.subscription");
  const tCommon = useTranslations("settings.common");
  const tUliq = useTranslations("uliq.billing");
  const locale = useLocale() as AppLocale;
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [payload, setPayload] = useState<SubscriptionPayload | null>(null);
  const [me, setMe] = useState<AuthMePayload | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [requiredLockUntil, setRequiredLockUntil] = useState<string | null>(null);
  const [activeCheckout, setActiveCheckout] = useState<ActiveCheckout | null>(null);
  const [paymentStage, setPaymentStage] = useState<PaymentStage>("ready");
  const [applyUliqDiscount, setApplyUliqDiscount] = useState(false);
  const publicUliqEnabled = process.env.NEXT_PUBLIC_ULIQ_ENABLED === "true";

  const model = useMemo(() => buildOrderPageModel(payload), [payload]);
  const payment = activeCheckout?.payment ?? null;
  const paymentChainId = payment?.chainId;
  const paymentTokenAddress = payment && isAddress(payment.tokenAddress)
    ? (payment.tokenAddress as Address)
    : undefined;
  const paymentRecipient = getPaymentRecipient(payment);
  const recipientAddress = paymentRecipient && isAddress(paymentRecipient)
    ? (paymentRecipient as Address)
    : undefined;
  const connectedAddress = address && isAddress(address) ? (address as Address) : undefined;
  const publicClient = usePublicClient({ chainId: paymentChainId });
  const nativeBalance = useBalance({
    address: connectedAddress,
    chainId: paymentChainId,
    query: { enabled: Boolean(connectedAddress && paymentChainId) }
  });
  const tokenBalance = useReadContract({
    address: paymentTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    chainId: paymentChainId,
    query: {
      enabled: Boolean(connectedAddress && paymentTokenAddress && paymentChainId)
    }
  });

  const selectedPlanPackage: BillingPackage | null = useMemo(() => {
    if (!selectedPlanId) return null;
    return model.planPackages.find((pkg) => pkg.id === selectedPlanId) ?? null;
  }, [model.planPackages, selectedPlanId]);

  const linkedWalletAddress = String(me?.walletAddress ?? me?.user?.walletAddress ?? "").trim();
  const expectedSenderAddress = String(payment?.expectedSenderAddress ?? "").trim();
  const linkedWalletMatchesCheckout = Boolean(
    linkedWalletAddress
    && expectedSenderAddress
    && normalizeWalletAddress(linkedWalletAddress) === normalizeWalletAddress(expectedSenderAddress)
  );
  const connectedWalletMatchesCheckout = Boolean(
    connectedAddress
    && expectedSenderAddress
    && normalizeWalletAddress(connectedAddress) === normalizeWalletAddress(expectedSenderAddress)
  );
  const walletMatches = Boolean(
    linkedWalletMatchesCheckout
    && connectedWalletMatchesCheckout
  );
  const paymentExpired = Boolean(
    payment && isBillingPaymentExpired(payment.expiresAt)
  );
  const amountRaw = payment?.amountRaw && /^\d+$/.test(payment.amountRaw)
    ? BigInt(payment.amountRaw)
    : null;
  const availableTokenRaw = typeof tokenBalance.data === "bigint" ? tokenBalance.data : null;
  const hasEnoughUsdc = amountRaw !== null && availableTokenRaw !== null && availableTokenRaw >= amountRaw;
  const hasGasBalance = Boolean(
    nativeBalance.data?.value && nativeBalance.data.value > BigInt(0)
  );
  const transactionUrl = payment?.explorerUrl
    ?? explorerUrl(payment?.chainId ?? 0, payment?.txHash);

  useEffect(() => {
    setAddonQuantities((current) => {
      const next: Record<string, number> = {};
      for (const pkg of model.addonPackages) {
        next[pkg.id] = clampQuantity(current[pkg.id] ?? 0);
      }
      return next;
    });
  }, [model.addonPackages]);

  function applyOrderStatus(
    response: OrderStatusResponse,
    fallback?: ActiveCheckout | null
  ): BillingOrderStatus | null {
    const order = response.order ?? (typeof response.id === "string" ? response as BillingOrder : undefined);
    const nextOrderId = order?.id ?? fallback?.orderId ?? null;
    const responsePayment = response.payment ?? order?.onchainPayment ?? null;
    const storedTxHash = nextOrderId ? readPendingBillingTxHash(nextOrderId) : null;
    const fallbackPayment = fallback?.payment
      ? { ...fallback.payment, txHash: fallback.payment.txHash ?? storedTxHash }
      : null;
    const nextPayment = responsePayment
      ? normalizePaymentDetails({
          ...responsePayment,
          txHash: responsePayment.txHash ?? storedTxHash
        }, fallbackPayment, order)
      : fallbackPayment;
    if (!nextPayment || !nextOrderId) return null;
    const nextStatus = response.status ?? order?.status ?? fallback?.status ?? "pending";
    if (responsePayment?.txHash || order?.onchainPayment?.txHash || nextStatus === "paid") {
      clearPendingBillingTxHash(nextOrderId);
    }
    const nextCheckout: ActiveCheckout = {
      orderId: nextOrderId,
      merchantOrderId: order?.merchantOrderId ?? fallback?.merchantOrderId ?? null,
      status: nextStatus,
      payment: nextPayment,
      uliqBenefit: response.uliqBenefit ?? order?.uliqBenefit ?? fallback?.uliqBenefit ?? null
    };
    setActiveCheckout(nextCheckout);
    setPaymentStage(stageFromStatus(nextStatus, nextPayment));
    if (nextStatus === "paid") setMessage(t("order.payment.confirmed"));
    return nextStatus;
  }

  async function fetchOrderStatus(orderId: string, fallback?: ActiveCheckout | null) {
    try {
      const response = await apiGet<OrderStatusResponse>(
        `/settings/subscription/orders/${encodeURIComponent(orderId)}`
      );
      return applyOrderStatus(response, fallback);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }

    const summary = await apiGet<SubscriptionPayload>("/settings/subscription");
    setPayload(summary);
    const order = summary.orders.find((item) => item.id === orderId);
    return order
      ? applyOrderStatus({ order, payment: order.onchainPayment }, fallback)
      : null;
  }

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const [subscription, account] = await Promise.all([
        apiGet<SubscriptionPayload>("/settings/subscription"),
        apiGet<AuthMePayload>("/auth/me")
      ]);
      setPayload(subscription);
      setMe(account);

      const query = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;
      const requestedOrderId = query?.get("order") ?? null;
      const requestedPlan = query?.get("plan") ?? null;
      const requestedPlanPackage = subscription.packages.find(
        (pkg) => pkg.kind === "plan" && pkg.plan === requestedPlan && pkg.isActive
      );
      if (requestedPlanPackage) setSelectedPlanId(requestedPlanPackage.id);
      const resumeCandidates = subscription.orders.map((order) => ({
        order,
        status: order.status,
        hasOnchainPayment: Boolean(order.onchainPayment),
        hasStoredTxHash: Boolean(readPendingBillingTxHash(order.id))
      }));
      const resumable = (requestedOrderId
        ? subscription.orders.find((order) => order.id === requestedOrderId)
        : selectResumableBillingCheckout(resumeCandidates)?.order) ?? null;
      const checkout = resumable ? checkoutFromOrder(resumable) : null;
      if (checkout) {
        setActiveCheckout(checkout);
        setPaymentStage(stageFromStatus(checkout.status, checkout.payment));
      } else if (requestedOrderId) {
        await fetchOrderStatus(requestedOrderId, null);
      }
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!activeCheckout) return;
    if (!["submitted", "confirming"].includes(paymentStage)) return;
    const timer = window.setInterval(() => {
      void fetchOrderStatus(activeCheckout.orderId, activeCheckout).catch(() => {
        // A temporary polling failure must not replace the submitted transaction state.
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [activeCheckout?.orderId, paymentStage]);

  const canSelectAddons = (payload?.plan !== undefined && payload.plan !== "free") || Boolean(selectedPlanId);
  const isImmediatePremiumUpgrade = Boolean(
    payload?.plan === "pro"
    && selectedPlanPackage?.plan === "premium"
    && payload.upgradePreview?.kind === "IMMEDIATE_PLAN_UPGRADE"
    && payload.upgradePreview.targetPriceCents === selectedPlanPackage.priceCents
    && payload.upgradePreview.billingMonths === selectedPlanPackage.billingMonths
  );
  const cartItems = useMemo<CartItemPayload[]>(() => {
    const out: CartItemPayload[] = [];
    if (selectedPlanId) out.push({ packageId: selectedPlanId, quantity: 1 });
    if (canSelectAddons) {
      for (const pkg of model.addonPackages) {
        const quantity = clampQuantity(addonQuantities[pkg.id] ?? 0);
        if (quantity > 0) out.push({ packageId: pkg.id, quantity });
      }
    }
    return out;
  }, [addonQuantities, canSelectAddons, model.addonPackages, selectedPlanId]);

  const cartLines = useMemo<CartLine[]>(() => {
    if (!payload) return [];
    const byId = new Map(payload.packages.map((pkg) => [pkg.id, pkg]));
    return cartItems
      .map((item) => {
        const pkg = byId.get(item.packageId);
        if (!pkg) return null;
        const unitPriceCents = pkg.kind === "plan" && isImmediatePremiumUpgrade
          ? payload.upgradePreview?.differenceCents ?? pkg.priceCents
          : pkg.priceCents;
        return {
          packageId: pkg.id,
          name: pkg.name,
          quantity: item.quantity,
          unitPriceCents,
          lineAmountCents: unitPriceCents * item.quantity,
          kind: pkg.kind
        } satisfies CartLine;
      })
      .filter((line): line is CartLine => Boolean(line));
  }, [cartItems, isImmediatePremiumUpgrade, payload]);

  const planLine = cartLines.find((line) => line.kind === "plan") ?? null;
  const addonLines = cartLines.filter((line) => line.kind === "addon");
  const hasBlockingCheckout = Boolean(
    activeCheckout
    && (activeCheckout.status === "pending" || activeCheckout.status === "confirming")
  );
  const selectedAddonUnits = addonLines.reduce((sum, line) => sum + line.quantity, 0);
  const planPrice = planLine?.unitPriceCents ?? 0;
  const addonsPrice = addonLines.reduce((sum, line) => sum + line.lineAmountCents, 0);
  const checkoutTotal = planPrice + addonsPrice;

  async function startCartCheckout() {
    if (!payload?.billingEnabled) return;
    if (cartItems.length === 0) {
      setMessage(t("order.errors.cartEmpty"));
      return;
    }
    setCheckoutLoading(true);
    setMessage(null);
    setRequiredLockUntil(null);
    try {
      const response = await apiPost<CheckoutResponse>("/settings/subscription/checkout", {
        items: cartItems,
        applyUliqDiscount: publicUliqEnabled && applyUliqDiscount
      });
      if (response.mode === "instant" || response.status === "paid" || response.order?.status === "paid") {
        setMessage(t("messages.activatedInstantly"));
        await load();
        return;
      }
      const orderId = response.orderId ?? response.order?.id;
      const rawPaymentDetails = response.payment ?? response.order?.onchainPayment ?? null;
      if (!orderId || !rawPaymentDetails || !getPaymentRecipient(rawPaymentDetails)) {
        setMessage(t("order.errors.paymentConfigMissing"));
        return;
      }
      const nextCheckout: ActiveCheckout = {
        orderId,
        merchantOrderId: response.merchantOrderId ?? response.order?.merchantOrderId ?? null,
        status: response.status ?? response.order?.status ?? "pending",
        payment: normalizePaymentDetails(rawPaymentDetails, null, response.order),
        uliqBenefit: response.uliqBenefit ?? response.order?.uliqBenefit ?? null
      };
      setActiveCheckout(nextCheckout);
      setPaymentStage(stageFromStatus(nextCheckout.status, nextCheckout.payment));
      setMessage(null);
    } catch (error) {
      const code = parseCheckoutErrorCode(error);
      const knownErrors: Record<string, string> = {
        cart_capacity_requires_pro: "cartCapacityRequiresPro",
        cart_plan_count_invalid: "cartPlanCountInvalid",
        cart_duplicate_package: "cartDuplicatePackage",
        cart_item_not_found: "cartItemNotFound",
        cart_quantity_invalid: "cartQuantityInvalid",
        cart_total_out_of_range: "invalidCartPayload",
        cart_free_plan_not_purchasable: "freePlanNotPurchasable",
        invalid_cart_payload: "invalidCartPayload",
        cart_empty: "cartEmpty",
        billing_payment_not_configured: "paymentConfigMissing",
        payment_config_missing: "paymentConfigMissing",
        payment_config_not_ready: "paymentConfigMissing",
        wallet_not_linked: "walletNotLinked",
        wallet_mismatch: "walletMismatch",
        open_billing_order_conflict: "openOrderConflict",
        open_order_conflict: "openOrderConflict",
        open_order_cart_mismatch: "openOrderConflict",
        open_order_exists: "openOrderConflict",
        premium_upgrade_active_term_required: "premiumUpgradeUnavailable",
        premium_upgrade_scheduled_term_conflict: "premiumUpgradeScheduledConflict",
        premium_upgrade_term_mismatch: "premiumUpgradeTermMismatch",
        premium_upgrade_price_evidence_invalid: "premiumUpgradeUnavailable"
      };
      const lockGateCodes = new Set([
        "uliq_lock_required",
        "uliq_lock_amount_insufficient",
        "uliq_lock_term_insufficient"
      ]);
      const lockGateMessage = error instanceof ApiError && code && lockGateCodes.has(code)
        ? tUliq("lockGateFailure", {
          required: formatUliqRaw(error.payload?.requiredLockedRaw),
          qualifying: formatUliqRaw(error.payload?.qualifyingLockedRaw),
          until: error.payload?.requiredBenefitUntil
            ? new Date(String(error.payload.requiredBenefitUntil)).toLocaleString(locale)
            : "—"
        })
        : code === "uliq_lock_state_stale"
          ? tUliq("lockStateStale")
          : code === "uliq_ai_discounted_subscription_required"
            ? tUliq("aiSubscriptionRequired")
            : code === "uliq_ai_cap_exceeded" || code === "uliq_ai_cap_unconfigured"
              ? tUliq("aiCapExceeded")
              : null;
      if (
        error instanceof ApiError
        && code
        && lockGateCodes.has(code)
        && typeof error.payload?.requiredBenefitUntil === "string"
      ) {
        setRequiredLockUntil(error.payload.requiredBenefitUntil);
      }
      setMessage(lockGateMessage ?? (code?.startsWith("uliq_")
        ? tUliq("unavailable")
        : code && knownErrors[code]
        ? t(`order.errors.${knownErrors[code]}`)
        : error instanceof ApiError
          ? error.message
          : String(error)));
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function connectWallet() {
    setMessage(null);
    try {
      await openWeb3Modal({ view: "Connect" });
    } catch {
      setMessage(t("order.errors.walletUnavailable"));
    }
  }

  async function switchNetwork() {
    if (!paymentChainId) return;
    setMessage(null);
    try {
      await switchChainAsync({ chainId: paymentChainId });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("order.errors.switchNetworkFailed"));
    }
  }

  async function submitTransactionHash(txHash: Hex) {
    if (!activeCheckout) return;
    const response = await apiPost<OrderStatusResponse>(
      `/settings/subscription/orders/${encodeURIComponent(activeCheckout.orderId)}/submit`,
      { txHash }
    );
    applyOrderStatus(response, {
      ...activeCheckout,
      payment: { ...activeCheckout.payment, txHash }
    });
  }

  async function sendPayment() {
    if (!activeCheckout || !payment || !paymentChainId || !amountRaw) return;
    setMessage(null);
    if (!linkedWalletAddress) {
      setMessage(t("order.errors.walletNotLinked"));
      return;
    }
    if (!isConnected || !connectedAddress) {
      setMessage(t("order.errors.walletNotConnected"));
      return;
    }
    if (!walletMatches) {
      setMessage(t("order.errors.walletMismatch"));
      return;
    }
    if (!paymentTokenAddress || !recipientAddress || !walletClient || !publicClient) {
      setMessage(t("order.errors.paymentConfigMissing"));
      return;
    }
    if (isBillingPaymentExpired(payment.expiresAt)) {
      setPaymentStage("error");
      setMessage(t("order.errors.paymentExpired"));
      return;
    }
    if (chainId !== paymentChainId) {
      setMessage(t("order.errors.wrongNetwork"));
      return;
    }
    if (!hasEnoughUsdc) {
      setMessage(t("order.errors.insufficientUsdc"));
      return;
    }
    if (!hasGasBalance) {
      setMessage(t("order.errors.insufficientGas"));
      return;
    }

    let submittedHash: Hex | null = null;
    try {
      const preflight = await apiGet<OrderStatusResponse>(
        `/settings/subscription/orders/${encodeURIComponent(activeCheckout.orderId)}`
      );
      const preflightStatus = applyOrderStatus(preflight, activeCheckout);
      if (preflightStatus !== "pending") {
        if (preflightStatus === "expired") {
          setPaymentStage("error");
          setMessage(t("order.errors.paymentExpired"));
        }
        return;
      }

      const estimatedGas = await publicClient.estimateContractGas({
        account: connectedAddress,
        address: paymentTokenAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipientAddress, amountRaw]
      });
      const gasPrice = await publicClient.getGasPrice();
      if ((nativeBalance.data?.value ?? BigInt(0)) < estimatedGas * gasPrice) {
        setMessage(t("order.errors.insufficientGas"));
        return;
      }
      setPaymentStage("awaiting_signature");
      const writeResult = await executeBillingWriteIfFresh({
        expiresAt: payment.expiresAt,
        write: () => walletClient.writeContract({
          account: connectedAddress,
          chain: walletClient.chain,
          address: paymentTokenAddress,
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipientAddress, amountRaw]
        })
      });
      if (writeResult.status === "expired") {
        setPaymentStage("error");
        setMessage(t("order.errors.paymentExpired"));
        return;
      }
      const txHash = writeResult.value;
      submittedHash = txHash;
      storePendingBillingTxHash(activeCheckout.orderId, txHash);
      const submittedCheckout: ActiveCheckout = {
        ...activeCheckout,
        payment: { ...payment, txHash }
      };
      setActiveCheckout(submittedCheckout);
      setPaymentStage("submitted");
      await submitTransactionHash(txHash);
      await reconcileOrder(false);
    } catch (error) {
      setPaymentStage(submittedHash || payment.txHash ? "submitted" : "error");
      setMessage(submittedHash || error instanceof ApiError
        ? t("order.errors.submitFailed")
        : error instanceof Error
          ? error.message
          : t("order.errors.transactionFailed"));
    }
  }

  async function reconcileOrder(showSuccess = true) {
    if (!activeCheckout) return;
    setStatusLoading(true);
    if (showSuccess) setMessage(null);
    try {
      if (["expired", "failed"].includes(activeCheckout.status) && payment?.txHash) {
        const status = await fetchOrderStatus(activeCheckout.orderId, activeCheckout);
        if (showSuccess) {
          setMessage(
            status === "expired" || status === "failed"
              ? t("order.payment.expiredTransactionRecovery")
              : t("order.statusUpdated")
          );
        }
        return;
      }
      const response = await apiPost<OrderStatusResponse>(
        `/settings/subscription/orders/${encodeURIComponent(activeCheckout.orderId)}/reconcile`
      );
      applyOrderStatus(response, activeCheckout);
      await fetchOrderStatus(activeCheckout.orderId, activeCheckout);
      if (showSuccess) setMessage(t("order.statusUpdated"));
    } catch (error) {
      if (showSuccess) {
        setMessage(error instanceof ApiError ? error.message : String(error));
      }
    } finally {
      setStatusLoading(false);
    }
  }

  async function retrySubmitTransaction() {
    if (!payment?.txHash || !/^0x[0-9a-fA-F]{64}$/.test(payment.txHash)) return;
    setStatusLoading(true);
    setMessage(null);
    try {
      await submitTransactionHash(payment.txHash as Hex);
      await reconcileOrder(false);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : String(error));
    } finally {
      setStatusLoading(false);
    }
  }

  async function cancelOpenOrder() {
    if (!activeCheckout || activeCheckout.status !== "pending" || payment?.txHash) return;
    setStatusLoading(true);
    setMessage(null);
    try {
      await apiPost(`/settings/subscription/orders/${encodeURIComponent(activeCheckout.orderId)}/cancel`);
      setActiveCheckout(null);
      setPaymentStage("ready");
      await load();
      setMessage(t("order.payment.cancelled"));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : String(error));
    } finally {
      setStatusLoading(false);
    }
  }

  function setAddonQuantity(packageId: string, quantity: number) {
    setAddonQuantities((current) => ({ ...current, [packageId]: clampQuantity(quantity) }));
  }

  function resetAddons() {
    setAddonQuantities((current) => Object.fromEntries(Object.keys(current).map((key) => [key, 0])));
  }

  const primaryPaymentAction = !isConnected
    ? { label: t("order.payment.connectWallet"), icon: "wallet" as const, action: connectWallet }
    : chainId !== paymentChainId
      ? { label: t("order.payment.switchNetwork"), icon: "switch" as const, action: switchNetwork }
      : { label: t("order.payment.sendPayment"), icon: "transfer" as const, action: sendPayment };

  return (
    <div className="subscriptionPortalWrap">
      <div className="subscriptionPortalTopActions">
        <Link className="btn" href={withLocalePath("/settings/subscription", locale)}>
          <AppIcon name="back" />
          {t("license.backToLicense")}
        </Link>
      </div>

      <div className="subscriptionPortalHeader">
        <p className="subscriptionPortalEyebrow">{t("portalEyebrow")}</p>
        <h2>{t("order.title")}</h2>
        <p className="subscriptionPortalMuted">{t("order.subtitle")}</p>
      </div>

      <div className="card subscriptionOrderCard">
        {loading ? (
          <div className="subscriptionPortalMuted">{tCommon("loading")}</div>
        ) : (
          <div className="subscriptionOrderGrid">
            <div className="subscriptionOrderSection">
              <div className="subscriptionOrderSectionTitle">{t("order.packageLabel")}</div>
              <select className="input" value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
                <option value="">{t("order.noPlanSelected")}</option>
                {model.planPackages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} - {centsToCurrency(pkg.priceCents)} / {Math.max(1, pkg.billingMonths)}m
                  </option>
                ))}
              </select>
              {!model.hasPlans ? <div className="subscriptionPortalMuted">{t("order.noPlans")}</div> : null}
              {selectedPlanPackage ? (
                <div className="subscriptionOrderIncluded">
                  <div className="subscriptionOrderIncludedTitle">{t("order.includedTitle")}</div>
                  <div>{t("order.includedBots", { running: selectedPlanPackage.maxRunningBots ?? 0 })}</div>
                  <div>{t("order.includedPredictionsAi", { running: selectedPlanPackage.maxRunningPredictionsAi ?? 0 })}</div>
                  <div>{t("order.includedPredictionsComposite", { running: selectedPlanPackage.maxRunningPredictionsComposite ?? 0 })}</div>
                  <div>{t("order.includedAiTokens", { tokens: selectedPlanPackage.monthlyAiCredits })}</div>
                  {isImmediatePremiumUpgrade && payload?.upgradePreview ? (
                    <div className="uiNotice uiNotice-success">
                      {t("order.immediateUpgrade", {
                        amount: centsToCurrency(payload.upgradePreview.differenceCents),
                        endsAt: new Date(payload.upgradePreview.sourceTermEndsAt).toLocaleDateString(locale)
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="subscriptionOrderSection">
              <div className="subscriptionOrderSectionHead">
                <div className="subscriptionOrderSectionTitle">{t("order.capacityAddonsTitle")}</div>
                {selectedAddonUnits > 0 ? (
                  <button type="button" className="btn" onClick={resetAddons}>
                    <AppIcon name="reset" />
                    {t("order.clearCapacityAddons")}
                  </button>
                ) : null}
              </div>
              <div className="subscriptionPortalMuted">{t("order.selectedCapacityUnits", { count: selectedAddonUnits })}</div>
              {!canSelectAddons ? (
                <div className="uiNotice uiNotice-info">{t("order.addonsRequirePro")}</div>
              ) : null}
              {!model.hasAddons ? (
                <div className="subscriptionPortalMuted">{t("order.noCapacityAddons")}</div>
              ) : (
                <div className="subscriptionAddonList">
                  {model.addonPackages.map((pkg) => {
                    const quantity = clampQuantity(addonQuantities[pkg.id] ?? 0);
                    return (
                      <div key={pkg.id} className={`subscriptionAddonItem ${quantity > 0 ? "subscriptionAddonItemSelected" : ""}`}>
                        <div>
                          <div className="subscriptionAddonTitle">{pkg.name}</div>
                          <div className="subscriptionPortalMuted">
                            {pkg.addonType === "ai_credits"
                              ? t("order.addonAiTopupDetails", { tokens: pkg.aiCredits })
                              : t("order.addonCapacityDetails", {
                                  runningBots: pkg.deltaRunningBots ?? 0,
                                  runningAi: pkg.deltaRunningPredictionsAi ?? 0,
                                  runningComposite: pkg.deltaRunningPredictionsComposite ?? 0
                                })}
                          </div>
                          <div className="subscriptionAddonPrice">{centsToCurrency(pkg.priceCents)}</div>
                        </div>
                        <div className="subscriptionAddonQuantityWrap">
                          <button type="button" className="btn" onClick={() => setAddonQuantity(pkg.id, quantity - 1)} disabled={!canSelectAddons || quantity === 0} aria-label={`decrease ${pkg.name}`}>
                            <AppIcon name="remove" />
                          </button>
                          <span className="subscriptionAddonQuantityValue">{quantity}</span>
                          <button type="button" className="btn" onClick={() => setAddonQuantity(pkg.id, quantity + 1)} disabled={!canSelectAddons || quantity >= 20} aria-label={`increase ${pkg.name}`}>
                            <AppIcon name="add" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="subscriptionOrderSummary subscriptionOrderSummarySticky">
              <div className="subscriptionOrderSummaryHeader">
                <div className="subscriptionOrderSummaryTitle">{t("order.summaryTitle")}</div>
                <div className="subscriptionPortalMuted">{t("order.summaryTypeCart")}</div>
              </div>
              {cartLines.length > 0 ? (
                <>
                  <div className="subscriptionOrderLineList">
                    {cartLines.map((line) => (
                      <div key={line.packageId} className="subscriptionOrderSummaryItem">
                        <span>{line.name} x{line.quantity}</span>
                        <span>{centsToCurrency(line.lineAmountCents)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="subscriptionOrderSummaryDivider" />
                  <div className="subscriptionOrderSummaryItem"><span>{t(isImmediatePremiumUpgrade ? "order.upgradeDifference" : "order.planPrice")}</span><span>{centsToCurrency(planPrice)}</span></div>
                  <div className="subscriptionOrderSummaryItem"><span>{t("order.addonsPrice")}</span><span>{centsToCurrency(addonsPrice)}</span></div>
                  <div className="subscriptionOrderSummaryDivider" />
                  <div className="subscriptionOrderSummaryItem subscriptionOrderSummaryStrong"><span>{t("order.checkoutTotal")}</span><span>{centsToCurrency(checkoutTotal)}</span></div>
                  {publicUliqEnabled ? (
                    <label className="subscriptionUliqDiscountToggle">
                      <input type="checkbox" checked={applyUliqDiscount} onChange={(event) => setApplyUliqDiscount(event.target.checked)} disabled={hasBlockingCheckout} />
                      <span><strong>{tUliq("apply")}</strong><small>{tUliq("hint")}</small></span>
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="btn btnPrimary subscriptionOrderPayButton"
                    onClick={() => void startCartCheckout()}
                    disabled={checkoutLoading || cartItems.length === 0 || !payload?.billingEnabled || hasBlockingCheckout}
                  >
                    <AppIcon name="billing" />
                    {checkoutLoading ? t("order.creatingPayment") : hasBlockingCheckout ? t("order.payment.activeOrder") : t("order.payWithUsdc")}
                  </button>
                </>
              ) : (
                <div className="subscriptionPortalMuted">{t("order.selectPackageFirst")}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {activeCheckout && payment ? (
        <section className="card subscriptionPaymentPanel">
          <div className="subscriptionCardHead">
            <div>
              <div className="subscriptionCardTitle">{t("order.payment.title")}</div>
              <div className="subscriptionPortalMuted">{t("order.payment.orderId", { id: activeCheckout.merchantOrderId ?? activeCheckout.orderId })}</div>
            </div>
            <span className={`subscriptionStatusPill subscriptionStatusPill${activeCheckout.status}`}>
              {t(`orders.statuses.${activeCheckout.status === "review_required" ? "reviewRequired" : activeCheckout.status}`)}
            </span>
          </div>

          <div className="subscriptionPaymentSteps" aria-label={t("order.payment.progressLabel")}>
            {(["ready", "awaiting_signature", "submitted", "confirming", "confirmed"] as PaymentStage[]).map((stage) => (
              <span key={stage} className={stage === paymentStage ? "subscriptionPaymentStepActive" : ""}>
                {t(`order.payment.stages.${stage}`)}
              </span>
            ))}
          </div>

          <div className="subscriptionPaymentDetails">
            <div><span>{t("order.payment.amount")}</span><strong>{payment.amountFormatted} USDC</strong></div>
            {activeCheckout.uliqBenefit ? (
              <>
                <div><span>{tUliq("tier")}</span><strong>{activeCheckout.uliqBenefit.tier ?? "Basic"}</strong></div>
                <div><span>{tUliq("base")}</span><strong>{centsToCurrency(activeCheckout.uliqBenefit.baseAmountCents ?? 0)}</strong></div>
                <div><span>{tUliq("discount")}</span><strong>-{centsToCurrency(activeCheckout.uliqBenefit.discountAmountCents ?? 0)} ({(activeCheckout.uliqBenefit.discountBps ?? 0) / 100}%)</strong></div>
                <div><span>{tUliq("final")}</span><strong>{centsToCurrency(activeCheckout.uliqBenefit.finalAmountCents ?? 0)}</strong></div>
                <div><span>{tUliq("lockedForBenefit")}</span><strong>{formatUliqRaw(activeCheckout.uliqBenefit.qualifyingLockedRaw)} ULIQ</strong></div>
                <div><span>{tUliq("lockCoverage")}</span><strong>{activeCheckout.uliqBenefit.requiredBenefitUntil ? new Date(activeCheckout.uliqBenefit.requiredBenefitUntil).toLocaleString(locale) : "—"}</strong></div>
                <div><span>{tUliq("expires")}</span><strong>{activeCheckout.uliqBenefit.expiresAt ? new Date(activeCheckout.uliqBenefit.expiresAt).toLocaleString(locale) : "—"}</strong></div>
              </>
            ) : null}
            <div><span>{t("order.payment.network")}</span><strong>Arbitrum One ({payment.chainId})</strong></div>
            <div><span>{t("order.payment.recipient")}</span><strong className="subscriptionMono">{paymentRecipient ?? "-"}</strong></div>
            <div><span>{t("order.payment.expiresAt")}</span><strong>{new Date(payment.expiresAt).toLocaleString(locale)}</strong></div>
          </div>

          <div className="subscriptionPaymentReadiness">
            <div className={expectedSenderAddress ? "subscriptionReady" : "subscriptionBlocked"}>
              <AppIcon name={expectedSenderAddress ? "check" : "help"} />
              <span>{t("order.payment.checkoutWallet")}</span>
              <strong>{shortenWalletAddress(expectedSenderAddress) || t("order.payment.missing")}</strong>
            </div>
            <div className={linkedWalletMatchesCheckout ? "subscriptionReady" : "subscriptionBlocked"}>
              <AppIcon name={linkedWalletMatchesCheckout ? "check" : "help"} />
              <span>{t("order.payment.linkedWallet")}</span>
              <strong>{shortenWalletAddress(linkedWalletAddress) || t("order.payment.missing")}</strong>
            </div>
            <div className={connectedWalletMatchesCheckout ? "subscriptionReady" : "subscriptionBlocked"}>
              <AppIcon name={connectedWalletMatchesCheckout ? "check" : "help"} />
              <span>{t("order.payment.connectedWallet")}</span>
              <strong>{shortenWalletAddress(connectedAddress) || t("order.payment.missing")}</strong>
            </div>
            <div className={chainId === payment.chainId ? "subscriptionReady" : "subscriptionBlocked"}>
              <AppIcon name={chainId === payment.chainId ? "check" : "help"} />
              <span>{t("order.payment.network")}</span>
              <strong>{chainId === payment.chainId ? t("order.payment.ready") : t("order.payment.wrongNetwork")}</strong>
            </div>
            <div className={hasEnoughUsdc ? "subscriptionReady" : "subscriptionBlocked"}>
              <AppIcon name={hasEnoughUsdc ? "check" : "help"} />
              <span>{t("order.payment.usdcBalance")}</span>
              <strong>{tokenBalance.isLoading ? tCommon("loading") : tokenBalance.data !== undefined ? `${formatUnits(tokenBalance.data, payment.tokenDecimals)} USDC` : "-"}</strong>
            </div>
            <div className={hasGasBalance ? "subscriptionReady" : "subscriptionBlocked"}>
              <AppIcon name={hasGasBalance ? "check" : "help"} />
              <span>{t("order.payment.gasBalance")}</span>
              <strong>{nativeBalance.isLoading ? tCommon("loading") : nativeBalance.data ? `${formatUnits(nativeBalance.data.value, nativeBalance.data.decimals)} ETH` : "-"}</strong>
            </div>
          </div>

          {!linkedWalletMatchesCheckout && linkedWalletAddress && expectedSenderAddress ? (
            <div className="uiNotice uiNotice-warning">
              {t("order.payment.checkoutWalletChanged", {
                expected: shortenWalletAddress(expectedSenderAddress),
                linked: shortenWalletAddress(linkedWalletAddress)
              })}
            </div>
          ) : null}
          {linkedWalletMatchesCheckout && !connectedWalletMatchesCheckout && isConnected ? (
            <div className="uiNotice uiNotice-warning">
              {t("order.payment.walletMismatch", { wallet: shortenWalletAddress(expectedSenderAddress) })}
            </div>
          ) : null}
          {paymentStage === "review_required" ? (
            <div className="uiNotice uiNotice-warning">{t("order.payment.reviewRequired")}</div>
          ) : null}
          {["expired", "failed"].includes(activeCheckout.status) && payment.txHash ? (
            <div className="uiNotice uiNotice-warning">{t("order.payment.expiredTransactionRecovery")}</div>
          ) : null}
          {paymentStage === "confirmed" ? (
            <div className="uiNotice uiNotice-success">{t("order.payment.confirmed")}</div>
          ) : null}

          <div className="subscriptionPaymentActions">
            {!["submitted", "confirming", "confirmed", "review_required"].includes(paymentStage) ? (
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() => void primaryPaymentAction.action()}
                disabled={paymentStage === "awaiting_signature" || paymentExpired}
              >
                <AppIcon name={primaryPaymentAction.icon} />
                {paymentStage === "awaiting_signature" ? t("order.payment.awaitingSignature") : primaryPaymentAction.label}
              </button>
            ) : null}
            {payment.txHash && activeCheckout.status === "pending" ? (
              <button type="button" className="btn" onClick={() => void retrySubmitTransaction()} disabled={statusLoading}>
                <AppIcon name="send" />
                {t("order.payment.submitAgain")}
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => void reconcileOrder()} disabled={statusLoading}>
              <AppIcon name="refresh" />
              {statusLoading ? t("order.payment.checkingStatus") : t("order.payment.checkStatus")}
            </button>
            {activeCheckout.status === "pending" && !payment.txHash ? (
              <button type="button" className="btn" onClick={() => void cancelOpenOrder()} disabled={statusLoading}>
                <AppIcon name="close" />
                {t("order.payment.cancelOrder")}
              </button>
            ) : null}
            {payment.txHash && transactionUrl ? (
              <a className="btn" href={transactionUrl} target="_blank" rel="noreferrer">
                <AppIcon name="external" />
                {t("order.payment.openExplorer")}
              </a>
            ) : null}
          </div>

          {payment.txHash ? (
            <div className="subscriptionPaymentConfirmationMeta">
              <span className="subscriptionMono">{payment.txHash}</span>
              <span>{t("order.payment.confirmations", {
                count: payment.confirmations ?? 0,
                required: payment.confirmationsRequired ?? payment.requiredConfirmations ?? 12
              })}</span>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="subscriptionOrderSimpleHint">{t("order.cartHint")}</div>
      {message ? <div className="subscriptionPortalMessage">
        <span>{message}</span>
        {requiredLockUntil ? <Link className="btn" href={`${withLocalePath("/uliq/locking", locale)}?requiredUntil=${encodeURIComponent(requiredLockUntil)}`}><AppIcon name="shield" /> {tUliq("manageLock")}</Link> : null}
      </div> : null}
    </div>
  );
}

export default function SubscriptionOrderPage() {
  return (
    <Web3Providers>
      <SubscriptionOrderPageContent />
    </Web3Providers>
  );
}
