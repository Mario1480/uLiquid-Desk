"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskBadge } from "@/components/desk/DeskBadge";
import { apiGet } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";
import { AppIcon } from "../../../components/AppIcon";
import AdminPageHeader from "../../_components/AdminPageHeader";
import AdminFilterBar from "../../_components/AdminFilterBar";
import AdminPagination from "../../_components/AdminPagination";
import AdminTable from "../../_components/AdminTable";
import { buildQuery } from "../../_components/admin-client";
import { ORDER_STATUSES, formatBillingAmount, paymentEvidence, type AdminPaymentList } from "../../../../src/billing/adminPayments";
import PaymentDetails from "./PaymentDetails";

export default function AdminPaymentsPage() {
  const t = useTranslations("admin.payments");
  const locale = useLocale() as AppLocale;
  const [data, setData] = useState<AdminPaymentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState({ search: "", status: "", provider: "", from: "", to: "" });
  const [query, setQuery] = useState(filters);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void apiGet<AdminPaymentList>(`/admin/billing/orders${buildQuery({ ...query, page, pageSize: 25 })}`)
      .then(result => {
        if (!active) return;
        if (page > result.totalPages) { setPage(result.totalPages); return; }
        setData(result);
      })
      .catch(() => { if (active) { setData(null); setError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, page, revision]);

  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale) : "—";
  return <div className="adminPageStack adminPaymentsPage">
    <AdminPageHeader title={t("title")} description={t("description")} />
    <AdminFilterBar>
      <form onSubmit={event => { event.preventDefault(); if (invalidRange) return; setPage(1); setQuery({ ...filters }); }}>
        <div className="adminFilterGrid">
          <label className="settingsField"><span>{t("search")}</span><DeskInput className="input" value={filters.search} maxLength={160} placeholder={t("searchPlaceholder")} onChange={event => setFilters({ ...filters, search: event.target.value })} /></label>
          <label className="settingsField"><span>{t("orderStatus")}</span><DeskSelect className="input" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">{t("all")}</option>{ORDER_STATUSES.map(status => <option key={status} value={status}>{t(`status.${status}`)}</option>)}</DeskSelect></label>
          <label className="settingsField"><span>{t("provider")}</span><DeskSelect className="input" value={filters.provider} onChange={event => setFilters({ ...filters, provider: event.target.value })}><option value="">{t("all")}</option><option value="ARBITRUM_USDC">Arbitrum USDC</option><option value="CCPAYMENT">CCPayment</option></DeskSelect></label>
          <label className="settingsField"><span>{t("from")}</span><DeskInput className="input" type="date" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label>
          <label className="settingsField"><span>{t("to")}</span><DeskInput className="input" type="date" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label>
        </div>
        {invalidRange && <p role="alert">{t("invalidRange")}</p>}
        <div className="adminPaymentsActions">
          <DeskButton className="btn btnPrimary" type="submit" disabled={invalidRange}><AppIcon name="search" />{t("apply")}</DeskButton>
          <DeskButton className="btn" type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}><AppIcon name="refresh" />{t("refresh")}</DeskButton>
          <DeskButton className="btn" type="button" onClick={() => { const empty = { search: "", status: "", provider: "", from: "", to: "" }; setFilters(empty); setQuery(empty); setPage(1); }}>{t("reset")}</DeskButton>
          <span className="settingsMutedText" role="status">{loading ? t("loading") : data ? t("count", { count: data.total }) : ""}</span>
        </div>
      </form>
    </AdminFilterBar>
    {error && <p className="settingsError" role="alert">{t("loadError")}</p>}
    {selected && <PaymentDetails key={selected} id={selected} onClose={() => setSelected(null)} />}
    <AdminTable columns={[t("merchantOrderId"), t("user"), t("items"), t("amount"), t("orderStatus"), t("paymentStatus"), t("activation")]}
      loading={loading} loadingLabel={t("loading")} emptyMessage={!loading && !data?.items.length ? t(error ? "unavailable" : "empty") : undefined}>
      {data?.items.map(order => <tr key={order.id}>
        <td className="adminPaymentsIdentifier"><DeskButton className="btn adminPaymentsOrderButton" type="button" aria-expanded={selected === order.id} aria-controls={selected === order.id ? "payment-details" : undefined} aria-label={t("detailsFor", { id: order.merchantOrderId })} onClick={() => setSelected(order.id)}><AppIcon name="detail" />{order.merchantOrderId}</DeskButton><div className="settingsMutedText">{date(order.createdAt)}</div></td>
        <td><Link href={withLocalePath(`/admin/users/${encodeURIComponent(order.user.id)}`, locale)}>{order.user.email}</Link><div className="settingsMutedText adminPaymentsIdentifier">{order.user.id}</div></td>
        <td>{order.items.map(item => <div key={item.id}>{item.quantity} × {item.name}{item.catalogFallback && <span className="settingsMutedText"> · {t("catalogFallback")}</span>}</div>)}</td>
        <td>{formatBillingAmount(order.finalAmountCents ?? order.amountCents, order.currency, locale)}</td>
        <td><DeskBadge className={`billingStatusPill${order.status.toLowerCase()}`}>{t(`status.${order.status}`)}</DeskBadge></td>
        <td>{t(`payment.${paymentEvidence(order.payment)}`)}<div className="settingsMutedText adminPaymentsIdentifier">{order.paymentStatusRaw ?? "—"}</div></td>
        <td>{order.activation.term ? t(`term.${order.activation.term.status}`) : t(`evidence.${order.activation.evidence}`)}</td>
      </tr>)}
    </AdminTable>
    <AdminPagination page={page} totalPages={data?.totalPages ?? 1} onPageChange={setPage} disabled={loading || error}
      labels={{ previous: t("previous"), next: t("next"), page: t("page", { page, total: data?.totalPages ?? 1 }) }} />
  </div>;
}
