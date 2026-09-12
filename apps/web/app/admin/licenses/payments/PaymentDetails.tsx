"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskButton } from "@/components/desk/DeskButton";
import { apiGet } from "../../../../lib/api";
import { AppIcon } from "../../../components/AppIcon";
import { formatBillingAmount, formatBillingToken, paymentEvidence, subscriptionSyncEvidence, type AdminPaymentDetail } from "../../../../src/billing/adminPayments";

export default function PaymentDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations("admin.payments");
  const locale = useLocale();
  const [data, setData] = useState<AdminPaymentDetail | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    panel.current?.focus();
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setData(null); setError(false);
    void apiGet<AdminPaymentDetail>(`/admin/billing/orders/${encodeURIComponent(id)}`)
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [id, revision]);
  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale) : "—";
  const field = (label: string, value: ReactNode) => <div><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
  const payment = data?.payment;
  const term = data?.activation.term;
  const sync = data?.activation.subscriptionSync;
  return <DeskSurface dense><section ref={panel} tabIndex={-1} id="payment-details" aria-labelledby="payment-details-title" className="settingsSection adminPaymentsDetails">
    <div className="adminPaymentsActions"><h2 id="payment-details-title">{t("details")}</h2>
      <DeskButton className="btn" type="button" onClick={() => setRevision(value => value + 1)}><AppIcon name="refresh" />{t("refresh")}</DeskButton>
      <DeskButton className="btn" type="button" onClick={onClose}><AppIcon name="close" />{t("close")}</DeskButton>
    </div>
    {error ? <p role="alert">{t("detailError")}</p> : !data ? <p role="status">{t("loading")}</p> : <>
      <dl className="adminPaymentsFields">
        {field(t("merchantOrderId"), data.merchantOrderId)}{field(t("orderId"), data.id)}
        {field(t("user"), data.user.email)}
        {field(t("provider"), data.provider)}{field(t("orderStatus"), t(`status.${data.status}`))}
        {field(t("orderedAt"), date(data.createdAt))}{field(t("updatedAt"), date(data.updatedAt))}
        {field(t("paidAt"), date(data.paidAt))}{field(t("expiresAt"), date(data.expiresAt))}
        {field(t("amount"), formatBillingAmount(data.finalAmountCents ?? data.amountCents, data.currency, locale))}
        {field(t("baseAmount"), data.baseAmountCents == null ? "—" : formatBillingAmount(data.baseAmountCents, data.currency, locale))}
        {field(t("discount"), data.discountAmountCents == null ? "—" : formatBillingAmount(data.discountAmountCents, data.currency, locale))}
      </dl>
      <h3>{t("items")}</h3>
      <ul className="adminPaymentsItems">{data.items.map(item => <li key={item.id}>
        <strong>{item.quantity} × {item.name}</strong> · {t(item.kind === "PLAN" ? "plan" : "addon")} · {item.code}
        <div>{t("unitPrice")}: {formatBillingAmount(item.unitPriceCents, item.currency, locale)} · {t("lineAmount")}: {formatBillingAmount(item.finalAmountCents ?? item.lineAmountCents, item.currency, locale)}</div>
        {item.catalogFallback && <div className="settingsMutedText">{t("catalogFallbackDetail")}</div>}
      </li>)}</ul>
      <h3>{t("paymentStatus")}</h3>
      <dl className="adminPaymentsFields">
        {field(t("paymentStatus"), t(`payment.${paymentEvidence(data.payment)}`))}
        {field(t("providerStatus"), data.paymentStatusRaw)}
        {payment && <>
          {field(t("transaction"), payment.explorerUrl ? <a href={payment.explorerUrl} target="_blank" rel="noopener noreferrer">{payment.txHash} <AppIcon name="external" /></a> : payment.txHash)}
          {field(t("chain"), payment.chainId)}
          {field(t("tokenAmount"), formatBillingToken(payment.expectedAmountRaw, payment.tokenDecimals))}
          {field(t("token"), payment.tokenAddress)}{field(t("sender"), payment.expectedSenderAddress)}
          {field(t("treasury"), payment.treasuryAddress)}{field(t("treasuryRevision"), payment.treasuryConfigRevision)}
          {field(t("confirmations"), payment.confirmations)}{field(t("verifiedAt"), date(payment.verifiedAt))}
          {field(t("block"), payment.blockNumber)}{field(t("blockHash"), payment.blockHash)}
          {field(t("attempts"), payment.verificationAttempts)}{field(t("lastChecked"), date(payment.lastCheckedAt))}
          {field(t("nextRetry"), date(payment.nextRetryAt))}{field(t("discoveredAt"), date(payment.discoveredAt))}
        </>}
      </dl>
      <p className="settingsMutedText">{t("verificationNote")}</p>
      <h3>{t("activation")}</h3>
      <dl className="adminPaymentsFields">
        {field(t("activation"), t(`evidence.${data.activation.evidence}`))}
        {term && <>
          {field(t("termId"), term.id)}{field(t("plan"), term.plan)}{field(t("termStatus"), t(`term.${term.status}`))}
          {field(t("startsAt"), date(term.startsAt))}{field(t("endsAt"), date(term.endsAt))}
          {field(t("graceEndsAt"), date(term.graceEndsAt))}{field(t("activatedAt"), date(term.activatedAt))}
        </>}
        {field(t("capacityGrants"), data.activation.capacityGrantCount)}{field(t("creditEntries"), data.activation.creditEntryCount)}
        {field(t("subscriptionSync"), t(`sync.${subscriptionSyncEvidence(sync ?? null)}`))}
        {sync && <>{field(t("syncedAt"), date(sync.entitlementSyncedAt))}{field(t("syncAttempts"), sync.entitlementSyncAttempts)}</>}
      </dl>
      <p className="settingsMutedText">{t("activationNote")}</p>
      <h3>{t("capacityGrants")}</h3>
      {data.capacityGrants.length ? <ul className="adminPaymentsItems">{data.capacityGrants.map(grant => <li key={grant.id}>
        {t("grantValues", { bots: grant.deltaRunningBots, ai: grant.deltaRunningPredictionsAi, composite: grant.deltaRunningPredictionsComposite })}
        <div>{t("plan")}: {grant.planScope ?? "—"} · {t("expiresAt")}: {date(grant.validUntil)} · {t("createdAt")}: {date(grant.createdAt)}</div>
      </li>)}</ul> : <p>{t("noneRecorded")}</p>}
      <h3>{t("creditEntries")}</h3>
      {data.creditEntries.length ? <ul className="adminPaymentsItems">{data.creditEntries.map(entry => <li key={entry.id}>
        {entry.deltaCredits} · {entry.reason} · {date(entry.createdAt)}
      </li>)}</ul> : <p>{t("noneRecorded")}</p>}
      {(data.activation.creditEntryCount > data.creditEntries.length || data.activation.capacityGrantCount > data.capacityGrants.length) && <p>{t("truncated")}</p>}
    </>}
  </section></DeskSurface>;
}
