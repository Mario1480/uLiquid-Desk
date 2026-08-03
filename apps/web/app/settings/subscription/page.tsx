"use client";

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

type AiCreditSummary = {
  available: string;
  reserved: string;
  usedToday: string;
  usedThisMonth: string;
  dailyLimit: string | null;
  monthlyLimit: string | null;
  maxRunCredits: string | null;
  warningLevel: "none" | "low_20" | "low_10" | "exhausted";
  topups: Array<{ id: string; code: string; name: string; priceCents: number; aiCredits: string }>;
};

type AiCreditUsageItem = {
  id: string;
  scope: string;
  status: string;
  modelClass: string | null;
  chargedCredits: string;
  modelCallCount: number;
  createdAt: string;
};

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
        apiGet<{ items: AiCreditUsageItem[] }>("/api/billing/ai-credits/usage?limit=20")
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
      setAiUsage(aiUsageResult.status === "fulfilled" ? aiUsageResult.value.items : []);
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

  return (
    <div className="subscriptionPortalWrap">

      <div className="subscriptionPortalHeader">
        <p className="subscriptionPortalEyebrow">{t("portalEyebrow")}</p>
        <h2>{t("license.title")}</h2>
        <p className="subscriptionPortalMuted">{t("license.subtitle")}</p>
      </div>

      {loading ? (
        <div className="card subscriptionPortalLoading">{tCommon("loading")}</div>
      ) : model ? (
        <>
          <div className="subscriptionPortalGrid">
            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardHead">
                <div className="subscriptionCardTitle">{t("license.cards.status")}</div>
                <span className={`subscriptionStatusBadge ${model.status === "active" ? "subscriptionStatusBadgeActive" : model.status === "grace" ? "subscriptionStatusBadgeGrace" : "subscriptionStatusBadgeInactive"}`}>
                  {model.status === "active"
                    ? t("license.states.active")
                    : model.status === "grace"
                      ? t("license.states.grace")
                      : t("license.states.inactive")}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.plan")}</span>
                <b>{model.plan === "pro" ? t("license.plans.pro") : t("license.plans.free")}</b>
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
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.account")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.email")}</span>
                <span>{model.account.email ?? "-"}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.userId")}</span>
                <span className="subscriptionMono">{model.account.userId ?? "-"}</span>
              </div>
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.limits")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.bots")}</span>
                <span>
                  {model.limits.bots.running}/{model.limits.bots.maxRunning} {t("license.running")}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.predictionsAi")}</span>
                <span>
                  {model.limits.predictionsAi.running}/
                  {model.limits.predictionsAi.maxRunning ?? t("license.unlimited")} {t("license.running")}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.predictionsComposite")}</span>
                <span>
                  {model.limits.predictionsComposite.running}/
                  {model.limits.predictionsComposite.maxRunning ?? t("license.unlimited")} {t("license.running")}
                </span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.exchanges")}</span>
                <span>{model.limits.exchanges.join(", ") || "-"}</span>
              </div>
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.features")}</div>
              <div className="subscriptionFeatureWrap">
                <span className={`subscriptionFeatureBadge ${model.features.proPlan ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.proPlan")}
                </span>
                <span className={`subscriptionFeatureBadge ${model.features.aiBillingEnabled ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.aiBilling")}
                </span>
                <span className={`subscriptionFeatureBadge ${model.features.addonsAvailable ? "subscriptionFeatureBadgeOn" : ""}`}>
                  {t("license.features.capacityTopup")}
                </span>
              </div>
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.aiWallet")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiBalance")}</span>
                <span>{aiCredits?.available ?? model.ai.balance}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiReserved")}</span>
                <span>{aiCredits?.reserved ?? "0"}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiMonthlyIncluded")}</span>
                <span>{model.ai.monthlyIncluded}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiUsedLifetime")}</span>
                <span>{model.ai.usedLifetime}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiUsedToday")}</span>
                <span>{aiCredits?.usedToday ?? "0"}</span>
              </div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.aiUsedMonth")}</span>
                <span>{aiCredits?.usedThisMonth ?? "0"}</span>
              </div>
            </div>

            <div className="card subscriptionPortalCard">
              <div className="subscriptionCardTitle">{t("license.cards.instance")}</div>
              <div className="subscriptionPortalFieldRow">
                <span>{t("license.labels.serverIp")}</span>
                <span>{model.instance.serverIpAddress ?? "-"}</span>
	              </div>
	              <Link href={withLocalePath("/settings/subscription/order", locale)} className="btn btnPrimary subscriptionPortalCardAction">
	                <AppIcon name="billing" />
	                {t("license.openOrderPage")}
	              </Link>
            </div>
          </div>

          {aiCredits && aiCredits.warningLevel !== "none" ? (
            <div className="subscriptionPortalWarn">
              {t(`credits.warnings.${aiCredits.warningLevel}`)}
            </div>
          ) : null}

          <div className="card subscriptionPortalUpgradeCard">
            <div>
              <div className="subscriptionCardTitle">{t("credits.limitsTitle")}</div>
              <div className="subscriptionPortalMuted">{t("credits.limitsDescription")}</div>
            </div>
            <div className="subscriptionCreditLimitFields">
              <label>
                <span>{t("credits.dailyLimit")}</span>
                <input className="input" inputMode="numeric" pattern="[0-9]*" value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value.replace(/\D/g, ""))} placeholder={t("credits.noLimit")} />
              </label>
              <label>
                <span>{t("credits.monthlyLimit")}</span>
                <input className="input" inputMode="numeric" pattern="[0-9]*" value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value.replace(/\D/g, ""))} placeholder={t("credits.noLimit")} />
              </label>
              <label>
                <span>{t("credits.maxRun")}</span>
                <input className="input" inputMode="numeric" pattern="[0-9]*" value={maxRunCredits} onChange={(event) => setMaxRunCredits(event.target.value.replace(/\D/g, ""))} placeholder={t("credits.noLimit")} />
              </label>
              <button className="btn btnPrimary" type="button" disabled={savingCreditLimits} onClick={() => void saveCreditLimits()}>
                <AppIcon name="save" />
                {savingCreditLimits ? t("credits.saving") : t("credits.saveLimits")}
              </button>
            </div>
          </div>

          <div className="card subscriptionPortalOrdersCard">
            <div className="subscriptionCardHead">
              <div>
                <div className="subscriptionCardTitle">{t("credits.usageTitle")}</div>
                <div className="subscriptionPortalMuted">{t("credits.usageDescription")}</div>
              </div>
              <Link href={withLocalePath("/settings/subscription/order", locale)} className="btn">
                <AppIcon name="billing" />
                {t("credits.buyTopup")}
              </Link>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table subscriptionOrdersTable">
                <thead>
                  <tr>
                    <th>{t("credits.createdAt")}</th>
                    <th>{t("credits.scope")}</th>
                    <th>{t("credits.analysisClass")}</th>
                    <th>{t("credits.calls")}</th>
                    <th>{t("credits.charged")}</th>
                    <th>{t("credits.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiUsage.map((item) => (
                    <tr key={item.id}>
                      <td>{formatMaybeDate(item.createdAt, locale)}</td>
                      <td>{item.scope}</td>
                      <td>{item.modelClass ?? "-"}</td>
                      <td>{item.modelCallCount}</td>
                      <td>{item.chargedCredits}</td>
                      <td>{item.status}</td>
                    </tr>
                  ))}
                  {aiUsage.length === 0 ? (
                    <tr><td colSpan={6} className="subscriptionPortalMuted">{t("credits.usageEmpty")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card subscriptionPortalOrdersCard">
	            <div className="subscriptionCardHead">
	              <div className="subscriptionCardTitle">{t("orders.title")}</div>
	              <button className="btn" type="button" onClick={() => void load()}>
	                <AppIcon name="refresh" />
	                {t("orders.refresh")}
	              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table subscriptionOrdersTable">
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
                        <span className={`subscriptionStatusPill subscriptionStatusPill${order.status}`}>
                          {t(`orders.statuses.${orderStatusKey(order.status)}`)}
                        </span>
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
              </table>
            </div>
          </div>

          <div className="card subscriptionPortalUpgradeCard">
            <div>
              <div className="subscriptionCardTitle">{t("license.upgradeTitle")}</div>
              <div className="subscriptionPortalMuted">{t("license.upgradeDescription")}</div>
	            </div>
	            <Link href={withLocalePath("/settings/subscription/order", locale)} className="btn btnPrimary">
	              <AppIcon name="billing" />
	              {t("license.openOrderPage")}
	            </Link>
          </div>
        </>
      ) : (
        <div className="card subscriptionPortalLoading">{t("messages.noData")}</div>
      )}

      {message ? <div className="subscriptionPortalMessage">{message}</div> : null}
    </div>
  );
}
