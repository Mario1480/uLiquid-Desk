"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";
import {
  buildOrderPageModel,
  centsToCurrency,
  type BillingPackage,
  type SubscriptionPayload
} from "../../../../src/billing/subscriptionViewModel";

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

function parseCheckoutErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (typeof error.payload?.error === "string") return error.payload.error;
  return null;
}

function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(20, Math.trunc(value)));
}

export default function SubscriptionOrderPage() {
  const t = useTranslations("settings.subscription");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [payload, setPayload] = useState<SubscriptionPayload | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  const model = useMemo(() => buildOrderPageModel(payload), [payload]);

  const selectedPlanPackage: BillingPackage | null = useMemo(() => {
    if (!selectedPlanId) return null;
    return model.planPackages.find((pkg) => pkg.id === selectedPlanId) ?? null;
  }, [model.planPackages, selectedPlanId]);

  useEffect(() => {
    setAddonQuantities((current) => {
      const next: Record<string, number> = {};
      for (const pkg of model.addonPackages) {
        next[pkg.id] = clampQuantity(current[pkg.id] ?? 0);
      }
      return next;
    });
  }, [model.addonPackages]);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await apiGet<SubscriptionPayload>("/settings/subscription");
      setPayload(response);
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.message);
      } else {
        setMessage(String(error));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const cartItems = useMemo<CartItemPayload[]>(() => {
    const out: CartItemPayload[] = [];
    if (selectedPlanId) {
      out.push({ packageId: selectedPlanId, quantity: 1 });
    }
    for (const pkg of model.addonPackages) {
      const quantity = clampQuantity(addonQuantities[pkg.id] ?? 0);
      if (quantity > 0) {
        out.push({ packageId: pkg.id, quantity });
      }
    }
    return out;
  }, [addonQuantities, model.addonPackages, selectedPlanId]);

  const cartLines = useMemo<CartLine[]>(() => {
    if (!payload) return [];
    const byId = new Map<string, BillingPackage>();
    for (const pkg of payload.packages) {
      byId.set(pkg.id, pkg);
    }
    return cartItems
      .map((item) => {
        const pkg = byId.get(item.packageId);
        if (!pkg) return null;
        if (pkg.kind !== "plan" && pkg.kind !== "addon") return null;
        return {
          packageId: pkg.id,
          name: pkg.name,
          quantity: item.quantity,
          unitPriceCents: pkg.priceCents,
          lineAmountCents: pkg.priceCents * item.quantity,
          kind: pkg.kind
        } satisfies CartLine;
      })
      .filter((line): line is CartLine => Boolean(line));
  }, [cartItems, payload]);

  const planLine = cartLines.find((line) => line.kind === "plan") ?? null;
  const addonLines = cartLines.filter((line) => line.kind === "addon");
  const selectedAddonUnits = addonLines.reduce((sum, line) => sum + line.quantity, 0);
  const summaryCurrency = "USD";
  const baseMonthly = planLine?.unitPriceCents ?? 0;
  const addonsMonthly = addonLines.reduce((sum, line) => sum + line.lineAmountCents, 0);
  const monthlyTotal = baseMonthly + addonsMonthly;
  const totalBilled = cartLines.reduce((sum, line) => sum + line.lineAmountCents, 0);

  async function startCartCheckout() {
    if (!payload?.billingEnabled) return;
    if (cartItems.length === 0) {
      setMessage(t("order.errors.cartEmpty"));
      return;
    }
    setCheckoutLoading(true);
    setMessage(null);
    try {
      const res = await apiPost<{ payUrl?: string | null; mode?: "redirect" | "instant" }>(
        "/settings/subscription/checkout",
        { items: cartItems }
      );
      if (res.payUrl) {
        window.location.assign(res.payUrl);
        return;
      }
      if (res.mode === "instant") {
        setMessage(t("messages.activatedInstantly"));
        await load();
        return;
      }
      setMessage(t("order.errors.checkoutUrlMissing"));
    } catch (error) {
      const code = parseCheckoutErrorCode(error);
      if (code === "cart_capacity_requires_pro") {
        setMessage(t("order.errors.cartCapacityRequiresPro"));
      } else if (code === "cart_plan_count_invalid") {
        setMessage(t("order.errors.cartPlanCountInvalid"));
      } else if (code === "cart_duplicate_package") {
        setMessage(t("order.errors.cartDuplicatePackage"));
      } else if (code === "cart_item_not_found") {
        setMessage(t("order.errors.cartItemNotFound"));
      } else if (code === "cart_quantity_invalid") {
        setMessage(t("order.errors.cartQuantityInvalid"));
      } else if (code === "invalid_cart_payload") {
        setMessage(t("order.errors.invalidCartPayload"));
      } else if (code === "cart_empty") {
        setMessage(t("order.errors.cartEmpty"));
      } else if (code === "ccpay_not_configured") {
        setMessage(t("order.errors.ccpayNotConfigured"));
      } else if (code === "ccpayment_error") {
        setMessage(t("order.errors.ccpaymentError"));
      } else if (error instanceof ApiError) {
        setMessage(error.message);
      } else {
        setMessage(String(error));
      }
    } finally {
      setCheckoutLoading(false);
    }
  }

  function setAddonQuantity(packageId: string, quantity: number) {
    setAddonQuantities((current) => ({
      ...current,
      [packageId]: clampQuantity(quantity)
    }));
  }

  function resetAddons() {
    setAddonQuantities((current) => {
      const next: Record<string, number> = {};
      for (const key of Object.keys(current)) {
        next[key] = 0;
      }
      return next;
    });
  }

  return (
    <div className="subscriptionPortalWrap">

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
              <select
                className="input"
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
              >
                <option value="">{t("order.noPlanSelected")}</option>
                {model.planPackages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} - {centsToCurrency(pkg.priceCents)} / {Math.max(1, pkg.billingMonths)}m
                  </option>
                ))}
              </select>
              {!model.hasPlans ? (
                <div className="subscriptionPortalMuted">{t("order.noPlans")}</div>
              ) : null}

              {selectedPlanPackage ? (
                <div className="subscriptionOrderIncluded">
                  <div className="subscriptionOrderIncludedTitle">{t("order.includedTitle")}</div>
                  <div>{t("order.includedBots", { running: selectedPlanPackage.maxRunningBots ?? 0 })}</div>
                  <div>{t("order.includedPredictionsAi", { running: selectedPlanPackage.maxRunningPredictionsAi ?? 0 })}</div>
                  <div>{t("order.includedPredictionsComposite", { running: selectedPlanPackage.maxRunningPredictionsComposite ?? 0 })}</div>
                  <div>{t("order.includedAiTokens", { tokens: selectedPlanPackage.monthlyAiTokens })}</div>
                </div>
              ) : null}
            </div>

            <div className="subscriptionOrderSection">
              <div className="subscriptionOrderSectionHead">
                <div className="subscriptionOrderSectionTitle">{t("order.capacityAddonsTitle")}</div>
                {selectedAddonUnits > 0 ? (
                  <button type="button" className="btn" onClick={resetAddons}>
                    {t("order.clearCapacityAddons")}
                  </button>
                ) : null}
              </div>
              <div className="subscriptionPortalMuted">
                {t("order.selectedCapacityUnits", { count: selectedAddonUnits })}
              </div>
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
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setAddonQuantity(pkg.id, quantity - 1)}
                            aria-label={`decrease ${pkg.name}`}
                          >
                            -
                          </button>
                          <span className="subscriptionAddonQuantityValue">{quantity}</span>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setAddonQuantity(pkg.id, quantity + 1)}
                            aria-label={`increase ${pkg.name}`}
                          >
                            +
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
                  <div className="subscriptionOrderSummaryItem">
                    <span>{t("order.baseMonthly")}</span>
                    <span>{centsToCurrency(baseMonthly, summaryCurrency)}</span>
                  </div>
                  <div className="subscriptionOrderSummaryItem">
                    <span>{t("order.addonsMonthly")}</span>
                    <span>{centsToCurrency(addonsMonthly, summaryCurrency)}</span>
                  </div>
                  <div className="subscriptionOrderSummaryDivider" />
                  <div className="subscriptionOrderSummaryItem subscriptionOrderSummaryStrong">
                    <span>{t("order.monthlyTotal")}</span>
                    <span>{centsToCurrency(monthlyTotal, summaryCurrency)}</span>
                  </div>
                  <div className="subscriptionOrderSummaryItem subscriptionOrderSummaryStrong">
                    <span>{t("order.totalBilled")}</span>
                    <span>{centsToCurrency(totalBilled, summaryCurrency)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btnPrimary subscriptionOrderPayButton"
                    onClick={() => void startCartCheckout()}
                    disabled={checkoutLoading || cartItems.length === 0 || !payload?.billingEnabled}
                  >
                    {checkoutLoading ? t("order.redirecting") : t("order.payWithCrypto")}
                  </button>
                </>
              ) : (
                <div className="subscriptionPortalMuted">{t("order.selectPackageFirst")}</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="subscriptionOrderSimpleHint">{t("order.cartHint")}</div>
      {message ? <div className="subscriptionPortalMessage">{message}</div> : null}
    </div>
  );
}
