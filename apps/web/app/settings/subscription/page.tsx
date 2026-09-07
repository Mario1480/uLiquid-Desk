"use client";
import { DeskBadge } from "@/components/desk/DeskBadge";
import { DeskLink } from "@/components/desk/DeskLink";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTable } from "@/components/desk/DeskTable";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPatch } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { AppIcon } from "../../components/AppIcon";
import {
  buildLicensePageModel,
  centsToCurrency,
  type BillingOrder,
  type BillingOrderStatus,
  type AuthMePayload,
  type ServerInfoPayload,
  type SubscriptionPayload
} from "../../../src/billing/subscriptionViewModel";
import {
  formatAiCreditAmount,
  isKnownAiCreditUsageScope,
  type AiCreditSummary,
  type AiCreditUsageItem,
  type AiCreditUsagePage
} from "../../../src/billing/aiCredits";

function formatMaybeDate(value: string | null, locale: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale);
}

function formatApiError(error: unknown): string {
  if (error instanceof ApiError) return String(error.payload?.message ?? error.payload?.error ?? error.message);
  return error instanceof Error ? error.message : String(error);
}

function formatOrderPackageLabel(order: BillingOrder): string {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items
      .map((item) => `${item.package?.name ?? "-"} x${item.quantity}`)
      .join(", ");
  }
  return order.package?.name ?? "-";
}

function renderOrderPackageCell(order: BillingOrder) {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return (
      <div className="subscriptionOrderPackageCell">
        {order.items.map((item) => (
          <div key={item.id} className="subscriptionOrderPackageLine">
            {item.package?.name ?? "-"} x{item.quantity}
          </div>
        ))}
      </div>
    );
  }
  return <span>{formatOrderPackageLabel(order)}</span>;
}

function orderStatusKey(status: BillingOrderStatus): string {
  return status === "review_required" ? "reviewRequired" : status;
}

function getOrderExplorerUrl(order: BillingOrder): string | null {
  if (order.onchainPayment?.explorerUrl) return order.onchainPayment.explorerUrl;
  if (order.explorerUrl) return order.explorerUrl;
  return order.onchainPayment?.txHash
    ? `https://arbiscan.io/tx/${order.onchainPayment.txHash}`
    : null;
}

export default function SubscriptionPage() {
  const t = useTranslations("settings.subscription");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [payload, setPayload] = useState<SubscriptionPayload | null>(null);
  const [me, setMe] = useState<AuthMePayload | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfoPayload | null>(null);
  const [aiCredits, setAiCredits] = useState<AiCreditSummary | null>(null);
  const [aiUsage, setAiUsage] = useState<AiCreditUsageItem[]>([]);
  const [aiUsagePage, setAiUsagePage] = useState<AiCreditUsagePage["page"]>({ hasMore: false, nextCursor: null });
  const [aiUsageLoadingMore, setAiUsageLoadingMore] = useState(false);
  const [dailyLimit, setDailyLimit] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [maxRunCredits, setMaxRunCredits] = useState("");
  const [savingCreditLimits, setSavingCreditLimits] = useState(false);

  const model = useMemo(
    () => buildLicensePageModel(payload, me, serverInfo),
    [payload, me, serverInfo]
  );

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const [subscriptionResult, meResult, serverInfoResult, aiCreditsResult, aiUsageResult] = await Promise.allSettled([
        apiGet<SubscriptionPayload>("/settings/subscription"),
        apiGet<AuthMePayload>("/auth/me"),
        apiGet<ServerInfoPayload>("/settings/server-info"),
        apiGet<AiCreditSummary>("/api/billing/ai-credits"),
        apiGet<AiCreditUsagePage>("/api/billing/ai-credits/usage?limit=25")
      ]);

      if (subscriptionResult.status === "fulfilled") {
        setPayload(subscriptionResult.value);
      } else {
        setPayload(null);
        const reason = subscriptionResult.reason;
        if (reason instanceof ApiError) {
          setMessage(reason.message);
        } else {
          setMessage(String(reason));
        }
      }

      if (meResult.status === "fulfilled") {
        setMe(meResult.value);
      } else {
        setMe(null);
      }

      if (serverInfoResult.status === "fulfilled") {
        setServerInfo(serverInfoResult.value);
      } else {
        setServerInfo(null);
      }
      if (aiCreditsResult.status === "fulfilled") {
        setAiCredits(aiCreditsResult.value);
        setDailyLimit(aiCreditsResult.value.dailyLimit ?? "");
        setMonthlyLimit(aiCreditsResult.value.monthlyLimit ?? "");
        setMaxRunCredits(aiCreditsResult.value.maxRunCredits ?? "");
      } else {
        setAiCredits(null);
      }
      if (aiUsageResult.status === "fulfilled") {
        setAiUsage(aiUsageResult.value.items);
        setAiUsagePage(aiUsageResult.value.page);
      } else {
        setAiUsage([]);
        setAiUsagePage({ hasMore: false, nextCursor: null });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveCreditLimits() {
    setSavingCreditLimits(true);
    setMessage(null);
    try {
      await apiPatch("/api/billing/ai-credits/limits", {
        dailyLimitCredits: dailyLimit.trim() || null,
        monthlyLimitCredits: monthlyLimit.trim() || null,
        maxRunCredits: maxRunCredits.trim() || null
      });
      await load();
      setMessage(t("credits.limitsSaved"));
    } catch (error) {
      setMessage(formatApiError(error));
    } finally {
      setSavingCreditLimits(false);
    }
  }

  async function loadMoreAiUsage() {
    if (!aiUsagePage.hasMore || !aiUsagePage.nextCursor || aiUsageLoadingMore) return;
    setAiUsageLoadingMore(true);
    setMessage(null);
    try {
      const next = await apiGet<AiCreditUsagePage>(`/api/billing/ai-credits/usage?limit=25&cursor=${encodeURIComponent(aiUsagePage.nextCursor)}`);
      setAiUsage((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        return [...current, ...next.items.filter((item) => !knownIds.has(item.id))];
      });
      setAiUsagePage(next.page);
    } catch (error) {
      setMessage(formatApiError(error));
    } finally {
      setAiUsageLoadingMore(false);
    }
  }

  function aiUsageScopeLabel(scope: string): string {
    if (isKnownAiCreditUsageScope(scope)) return t(`credits.scopes.${scope}`);
    return scope.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function aiUsageStatusLabel(status: string): string {
    const normalized = status.toLowerCase();
    if (["completed", "failed", "running", "reconciliation_required"].includes(normalized)) {
      return t(`credits.statuses.${normalized}`);
    }
    return status;
  }

  function aiUsageModelClassLabel(modelClass: string | null): string {
    if (!modelClass) return "-";
    if (["utility", "standard", "analysis", "deep"].includes(modelClass)) {
      return t(`credits.analysisClasses.${modelClass}`);
    }
    return modelClass;
  }

  function aiReservationStatusLabel(status: string): string {
    const normalized = status.toLowerCase();
    if (["active", "settled", "released", "expired", "reconciliation_required"].includes(normalized)) {
      return t(`credits.reservationStatuses.${normalized}`);
    }
    return status;
  }

  return (
    <div className="subscriptionPortalWrap">

      <div className="subscriptionPortalHeader">
        <p className="subscriptionPortalEyebrow">{t("portalEyebrow")}</p>
        <h2>{t("license.title")}</h2>
        <p className="subscriptionPortalMuted">{t("license.subtitle")}</p>
      </div>

      {loading ? (
        <DeskSurface><div className="card subscriptionPortalLoading">{tCommon("loading")}</div></DeskSurface>
      ) : model ? (
        <>
          <section className="subscriptionPricingSection" aria-labelledby="subscription-pricing-title">
            <div className="subscriptionPricingHeading">
              <div>
                <p className="subscriptionPortalEyebrow">{t("pricing.eyebrow")}</p>
                <h3 id="subscription-pricing-title">{t("pricing.title")}</h3>
              </div>
              <p className="subscriptionPortalMuted">{t("pricing.description")}</p>
            </div>
            <div className="subscriptionPricingGrid">
              {(payload?.planCatalog ?? []).map((plan) => {
                const current = plan.plan === model.plan;
                const planRank = plan.plan === "premium" ? 2 : plan.plan === "pro" ? 1 : 0;
                const currentRank = model.plan === "premium" ? 2 : model.plan === "pro" ? 1 : 0;
                const premiumUpgrade = model.plan === "pro" && plan.plan === "premium"
                  ? payload?.upgradePreview ?? null
                  : null;
                const canOpenCheckout = Boolean(
                  payload?.billingEnabled
                  && plan.purchasable
                  && !current
                  && planRank > currentRank
                  && (plan.plan !== "premium" || model.plan !== "pro" || premiumUpgrade)
                );
                return (
                  <DeskSurface><article key={plan.code} className={`card subscriptionPricingCard ${plan.plan === "premium" ? "subscriptionPricingCardPremium" : ""}`}>
                    <div className="subscriptionPricingCardHead">
                      <div>
                        <span className="subscriptionPricingPlan">{t(`license.plans.${plan.plan}`)}</span>
                        <p>{plan.description}</p>
                      </div>
                      {current ? <DeskBadge className="badge">{t("pricing.current")}</DeskBadge> : null}
                    </div>
                    <div className="subscriptionPricingPrice">
                      <strong>{centsToCurrency(plan.priceCents)}</strong>
                      <span>{plan.priceCents === 0 ? t("pricing.forever") : t("pricing.perMonth")}</span>
                    </div>
                    <div className="subscriptionPricingFacts">
                      <span>{t("pricing.botSlots", { count: plan.maxRunningBots })}</span>
                      <span>{t("pricing.aiSchedules", { count: plan.maxRunningPredictionsAi })}</span>
                      <span>{t("pricing.compositeSchedules", { count: plan.maxRunningPredictionsComposite })}</span>
                      <span>{t("pricing.aiCredits", { count: plan.monthlyAiCredits })}</span>
                      <span>{plan.maxExchangeAccounts === null ? t("pricing.exchangeUnlimited") : t("pricing.exchangeLimit", { count: plan.maxExchangeAccounts })}</span>
                    </div>
                    {premiumUpgrade ? (
                      <div className="subscriptionPricingUpgradeNote">
                        {t("pricing.immediateDifference", {
                          amount: centsToCurrency(premiumUpgrade.differenceCents),
                          endsAt: new Date(premiumUpgrade.sourceTermEndsAt).toLocaleDateString(locale)
                        })}
                      </div>
                    ) : null}
                    {canOpenCheckout ? (
                      <DeskLink href={`${withLocalePath("/settings/subscription/order", locale)}?plan=${encodeURIComponent(plan.plan)}`} className="btn btnPrimary subscriptionPricingAction">
                        <AppIcon name="billing" />
                        {plan.plan === "premium" ? t("pricing.upgradePremium") : t("pricing.upgradePro")}
                      </DeskLink>
                    ) : current ? (
                      <span className="subscriptionPricingUnavailable">{t("pricing.activePlan")}</span>
                    ) : (
                      <span className="subscriptionPricingUnavailable">
                        {plan.plan === "premium" && model.plan === "pro" && !premiumUpgrade
                          ? t("pricing.manualReview")
                          : planRank < currentRank
                            ? t("pricing.lowerPlan")
                          : t("pricing.notPurchasable")}
                      </span>
                    )}
                  </article></DeskSurface>
                );
              })}
            </div>
          </section>

          <div className="subscriptionPortalGrid">
            <DeskSurface><div className="card subscriptionPortalCard">
              <div className="subscriptionCardHead">
                <div className="subscriptionCardTitle">{t("license.cards.status")}</div>
                <DeskBadge className={`subscriptionStatusBadge ${model.status === "active" ? "subscriptionStatusBadgeActive" : model.status === "grace" ? "subscriptionStatusBadgeGrace" : "subscriptionStatusBadgeInactive"}`}>
                  {model.status === "active"
                    ? t("license.states.active")
                    : model.status === "grace"
                      ? t("license.states.grace")
                      : t("license.states.inactive")}
                </DeskBadge>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.plan")}</span>
                <b>{t(`license.plans.${model.plan}`)}</b>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.validUntil")}</span>
                <span>{formatMaybeDate(model.proValidUntil, locale)}</span>
              </div>
              {model.graceEndsAt ? (
                <div className="subscriptionPortalFieldRow">
                  <span>{t("license.labels.graceEndsAt")}</span>
                  <span>{formatMaybeDate(model.graceEndsAt, locale)}</span>
                </div>
              ) : null}
              {model.scheduledTerm ? (
                <div className="subscriptionTermPreview">
                  <div className="subscriptionOrderIncludedTitle">{t("license.nextTerm.title")}</div>
                  <div className="subscriptionPortalFieldRow">
                    <span>{t("license.nextTerm.startsAt")}</span>
                    <span>{formatMaybeDate(model.scheduledTerm.startsAt, locale)}</span>
                  </div>
                  <div className="subscriptionPortalFieldRow">
                    <span>{t("license.nextTerm.endsAt")}</span>
                    <span>{formatMaybeDate(model.scheduledTerm.endsAt, locale)}</span>
                  </div>
                </div>
              ) : null}
              {model.fallbackReason ? (
                <div className="subscriptionPortalWarn">
                  {t("license.fallbackMode", { reason: model.fallbackReason })}
                </div>
              ) : null}
            </div></DeskSurface>

            <DeskSurface><div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.account")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.email")}</span>
                <span>{model.account.email ?? "-"}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.userId")}</span>
                <span className="subscriptionMono">{model.account.userId ?? "-"}</span>
              </div>
            </div></DeskSurface>

            <DeskSurface><div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.limits")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.bots")}</span>
                <span className="subscriptionQuotaValue">
                  <strong>{model.limits.bots.running}/{model.limits.bots.maxRunning} {t("license.running")}</strong>
                  {payload?.quotaBreakdown ? <small>{t("license.quotaBreakdown", { base: payload.quotaBreakdown.base.runningBots, addon: payload.quotaBreakdown.addon.runningBots })}</small> : null}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.predictionsAi")}</span>
                <span className="subscriptionQuotaValue">
                  <strong>{model.limits.predictionsAi.running}/{model.limits.predictionsAi.maxRunning ?? t("license.unlimited")} {t("license.running")}</strong>
                  {payload?.quotaBreakdown ? <small>{t("license.quotaBreakdown", { base: payload.quotaBreakdown.base.runningPredictionsAi ?? t("license.unlimited"), addon: payload.quotaBreakdown.addon.runningPredictionsAi })}</small> : null}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.predictionsComposite")}</span>
                <span className="subscriptionQuotaValue">
                  <strong>{model.limits.predictionsComposite.running}/{model.limits.predictionsComposite.maxRunning ?? t("license.unlimited")} {t("license.running")}</strong>
                  {payload?.quotaBreakdown ? <small>{t("license.quotaBreakdown", { base: payload.quotaBreakdown.base.runningPredictionsComposite ?? t("license.unlimited"), addon: payload.quotaBreakdown.addon.runningPredictionsComposite })}</small> : null}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.exchangeAccounts")}</span>
                <span className="subscriptionQuotaValue">
                  <strong>{payload?.exchangeAccounts?.used ?? 0}/{payload?.exchangeAccounts?.max ?? t("license.unlimited")}</strong>
                  <small>{t("license.paperExcluded")}</small>
                </span>
              </div>
            </div></DeskSurface>

            <DeskSurface><div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.features")}</div>
              <div className="subscriptionFeatureWrap">
                <DeskBadge className={`subscriptionFeatureBadge ${model.features.proPlan ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.proPlan")}
                </DeskBadge>
                <DeskBadge className={`subscriptionFeatureBadge ${model.features.premiumPlan ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.premiumPlan")}
                </DeskBadge>
                <DeskBadge className={`subscriptionFeatureBadge ${model.features.aiBillingEnabled ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.aiBilling")}
                </DeskBadge>
                <DeskBadge className={`subscriptionFeatureBadge ${model.features.addonsAvailable ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.capacityTopup")}
                </DeskBadge>
              </div>
            </div></DeskSurface>

            <DeskSurface><div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.aiWallet")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiBalance")}</span>
                <span>{aiCredits ? formatAiCreditAmount(aiCredits.available, locale) : model.ai.balance}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiReserved")}</span>
                <span>{aiCredits ? formatAiCreditAmount(aiCredits.reserved, locale) : "0"}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiMonthlyIncluded")}</span>
                <span>{model.ai.monthlyIncluded}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiUsedLifetime")}</span>
                <span>{aiCredits ? formatAiCreditAmount(aiCredits.usedLifetime, locale) : model.ai.usedLifetime}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiUsedToday")}</span>
                <span>{aiCredits ? formatAiCreditAmount(aiCredits.usedToday, locale) : "0"}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiUsedMonth")}</span>
                <span>{aiCredits ? formatAiCreditAmount(aiCredits.usedThisMonth, locale) : "0"}</span>
              </div>
            </div></DeskSurface>

            <DeskSurface><div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.instance")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.serverIp")}</span>
                <span>{model.instance.serverIpAddress ?? "-"}</span>
	              </div>
	              <DeskLink href={withLocalePath("/settings/subscription/order", locale)} className="btn btnPrimary subscriptionPortalCardAction">
	                <AppIcon name="billing" />
	                {t("license.openOrderPage")}
	              </DeskLink>
            </div></DeskSurface>
          </div>

          {aiCredits && aiCredits.warningLevel !== "none" ? (
            <div className="subscriptionPortalWarn">
              {t(`credits.warnings.${aiCredits.warningLevel}`)}
            </div>
          ) : null}

          <DeskSurface><div className="card subscriptionPortalUpgradeCard">
            <div>
              <div className="subscriptionCardTitle">{t("credits.limitsTitle")}</div>
              <div className="subscriptionPortalMuted">{t("credits.limitsDescription")}</div>
            </div>
            <div className="subscriptionCreditLimitFields">
              <label>
                <span>{t("credits.dailyLimit")}</span>
                <DeskInput className="input" inputMode="numeric" pattern="[0-9]*" value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value.replace(/\D/g, ""))} placeholder={t("credits.noLimit")} />
              </label>
              <label>
                <span>{t("credits.monthlyLimit")}</span>
                <DeskInput className="input" inputMode="numeric" pattern="[0-9]*" value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value.replace(/\D/g, ""))} placeholder={t("credits.noLimit")} />
              </label>
              <label>
                <span>{t("credits.maxRun")}</span>
                <DeskInput className="input" inputMode="numeric" pattern="[0-9]*" value={maxRunCredits} onChange={(event) => setMaxRunCredits(event.target.value.replace(/\D/g, ""))} placeholder={t("credits.noLimit")} />
              </label>
              <DeskButton className="btn btnPrimary" type="button" disabled={savingCreditLimits} onClick={() => void saveCreditLimits()}>
                <AppIcon name="save" />
                {savingCreditLimits ? t("credits.saving") : t("credits.saveLimits")}
              </DeskButton>
            </div>
          </div></DeskSurface>

          <DeskSurface><div className="card subscriptionPortalOrdersCard">
            <div className="subscriptionCardHead">
              <div>
                <div className="subscriptionCardTitle">{t("credits.usageTitle")}</div>
                <div className="subscriptionPortalMuted">{t("credits.usageDescription")}</div>
              </div>
              <DeskLink href={withLocalePath("/settings/subscription/order", locale)} className="btn">
                <AppIcon name="billing" />
                {t("credits.buyTopup")}
              </DeskLink>
            </div>
            <div className="subscriptionTableScroll">
              <DeskTable className="table subscriptionOrdersTable subscriptionAiUsageTable">
                <thead>
                  <tr>
                    <th>{t("credits.createdAt")}</th>
                    <th>{t("credits.action")}</th>
                    <th>{t("credits.model")}</th>
                    <th>{t("credits.usage")}</th>
                    <th>{t("credits.charged")}</th>
                    <th>{t("credits.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiUsage.map((item) => (
                    <tr key={item.id}>
                      <td>{formatMaybeDate(item.createdAt, locale)}</td>
                      <td>
                        <strong className="subscriptionAiUsageAction">{aiUsageScopeLabel(item.scope)}</strong>
                      </td>
                      <td>
                        <span>{aiUsageModelClassLabel(item.modelClass)}</span>
                      </td>
                      <td>
                        <span>{t("credits.callCount", { count: item.modelCallCount })}</span>
                      </td>
                      <td>
                        <strong className="subscriptionAiUsageCredits">{formatAiCreditAmount(item.chargedCredits, locale)}</strong>
                        {item.reservation && item.reservation.status !== "SETTLED" ? (
                          <span className="subscriptionAiUsageMeta">
                            {t("credits.reservation", {
                              count: formatAiCreditAmount(item.reservation.reservedCredits, locale),
                              status: aiReservationStatusLabel(item.reservation.status)
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`subscriptionAiUsageStatus subscriptionAiUsageStatus-${item.status.toLowerCase()}`}>
                          {aiUsageStatusLabel(item.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {aiUsage.length === 0 ? (
                    <tr><td colSpan={6} className="subscriptionPortalMuted">{t("credits.usageEmpty")}</td></tr>
                  ) : null}
                </tbody>
              </DeskTable>
            </div>
            <div className="subscriptionAiUsageFooter">
              <span className="subscriptionPortalMuted">{t("credits.loadedCount", { count: aiUsage.length })}</span>
              {aiUsagePage.hasMore ? (
                <DeskButton className="btn" type="button" disabled={aiUsageLoadingMore} onClick={() => void loadMoreAiUsage()}>
                  <AppIcon name="chevronDown" />
                  {aiUsageLoadingMore ? t("credits.loadingMore") : t("credits.loadMore")}
                </DeskButton>
              ) : aiUsage.length > 0 ? (
                <span className="subscriptionPortalMuted">{t("credits.historyComplete")}</span>
              ) : null}
            </div>
          </div></DeskSurface>

          <DeskSurface><div className="card subscriptionPortalOrdersCard">
	            <div className="subscriptionCardHead">
	              <div className="subscriptionCardTitle">{t("orders.title")}</div>
	              <DeskButton className="btn" type="button" onClick={() => void load()}>
	                <AppIcon name="refresh" />
	                {t("orders.refresh")}
	              </DeskButton>
            </div>
            <div style={{ overflowX: "auto" }}>
              <DeskTable className="table subscriptionOrdersTable">
                <thead>
                  <tr>
                    <th>{t("orders.createdAt")}</th>
                    <th>{t("orders.package")}</th>
                    <th>{t("orders.amount")}</th>
                    <th>{t("orders.status")}</th>
                    <th>{t("orders.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {model.orders.map((order) => (
                    <tr key={order.id}>
                      <td>{formatMaybeDate(order.createdAt, locale)}</td>
                      <td>{renderOrderPackageCell(order)}</td>
                      <td>{centsToCurrency(order.amountCents, order.currency)}</td>
                      <td>
                        <DeskBadge className={`subscriptionStatusPill subscriptionStatusPill${order.status}`}>
                          {t(`orders.statuses.${orderStatusKey(order.status)}`)}
                        </DeskBadge>
                      </td>
                      <td>
                        {(order.status === "pending"
                          || order.status === "confirming"
                          || order.status === "review_required") && order.onchainPayment ? (
                          <Link href={`${withLocalePath("/settings/subscription/order", locale)}?order=${encodeURIComponent(order.id)}`}>
                            {order.status === "review_required"
                              ? t("orders.reviewPayment")
                              : t("orders.continuePayment")}
                          </Link>
                        ) : order.onchainPayment?.txHash && getOrderExplorerUrl(order) ? (
                          <a href={getOrderExplorerUrl(order) ?? "#"} target="_blank" rel="noreferrer">
                            {t("orders.viewTransaction")}
                          </a>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                  {model.orders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="subscriptionPortalMuted">{t("orders.empty")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </DeskTable>
            </div>
          </div></DeskSurface>

          <DeskSurface><div className="card subscriptionPortalUpgradeCard">
            <div>
              <div className="subscriptionCardTitle">{t("license.upgradeTitle")}</div>
              <div className="subscriptionPortalMuted">{t("license.upgradeDescription")}</div>
	            </div>
	            <DeskLink href={withLocalePath("/settings/subscription/order", locale)} className="btn btnPrimary">
	              <AppIcon name="billing" />
	              {t("license.openOrderPage")}
	            </DeskLink>
          </div></DeskSurface>
        </>
      ) : (
        <DeskSurface><div className="card subscriptionPortalLoading">{t("messages.noData")}</div></DeskSurface>
      )}

      {message ? <div className="subscriptionPortalMessage">{message}</div> : null}
    </div>
  );
}
