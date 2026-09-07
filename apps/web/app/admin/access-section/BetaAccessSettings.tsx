"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { apiGet, apiPost, apiPut } from "../../../lib/api";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskButton } from "@/components/desk/DeskButton";
import { DeskSwitch } from "@/components/desk/DeskSwitch";
import { DeskBadge } from "@/components/desk/DeskBadge";
import { DeskTable } from "@/components/desk/DeskTable";
import { AppIcon } from "../../components/AppIcon";
import AdminConfirmDialog from "../_components/AdminConfirmDialog";

type Item = { id: string; email: string; motivation: string; status: string; mailStatus: string; createdAt: string; provisionedAt: string | null; tokens: { expiresAt: string }[] };
type Data = { enabled: boolean; configured: boolean; items: Item[]; total: number; page: number };
export default function BetaAccessSettings() {
  const t = useTranslations("auth.beta"); const locale = useLocale();
  const [data, setData] = useState<Data | null>(null); const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const [action, setAction] = useState<{ item: Item; name: string } | null>(null);
  const load = useCallback(async () => { setError(false); try { setData(await apiGet<Data>(`/admin/beta-access?page=${page}`)); } catch { setError(true); } }, [page]);
  useEffect(() => { void load(); }, [load]);
  async function toggle(enabled: boolean) {
    setBusy(true); setError(false);
    try { await apiPut("/admin/beta-access/settings", { enabled }); await load(); } catch { setError(true); } finally { setBusy(false); }
  }
  async function perform() {
    if (!action) return; setBusy(true); setError(false);
    try { await apiPost(`/admin/beta-access/${action.item.id}/action`, { action: action.name }); setAction(null); await load(); } catch { setError(true); } finally { setBusy(false); }
  }
  return <DeskSurface dense><section className="card settingsSection">
    <h3>{t("adminTitle")} {data ? <DeskBadge>{data.total}</DeskBadge> : null}</h3>
    {error ? <p role="alert">{t("error")}</p> : null}
    {!data && !error ? <p role="status">{t("loading")}</p> : null}
    {data ? <>
      <label className="billingFeatureToggle"><span>{t("acceptApplications")}</span><DeskSwitch checked={data.enabled} disabled={busy || (!data.enabled && !data.configured)} onCheckedChange={value => void toggle(value)} /></label>
      {!data.configured ? <p role="status">{t("notConfigured")}</p> : null}
      <DeskButton className="btn" type="button" disabled={busy} onClick={() => void load()}><AppIcon name="refresh" />{t("refresh")}</DeskButton>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}><DeskTable>
        <thead><tr><th>{t("email")}</th><th>{t("motivation")}</th><th>{t("status")}</th><th>{t("mail")}</th><th>{t("actions")}</th></tr></thead>
        <tbody>{data.items.map(item => <tr key={item.id}>
          <td style={{ overflowWrap: "anywhere" }}>{item.email}<br /><small>{new Date(item.createdAt).toLocaleDateString(locale)}</small></td>
          <td style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 180, maxWidth: 380 }}>{item.motivation}</td>
          <td><DeskBadge>{t(`states.${item.status}`)}</DeskBadge>{item.status === "COMPLETED" && !item.provisionedAt ? <small>{t("provisioning")}</small> : null}{item.tokens[0] ? <small>{t("expires")}: {new Date(item.tokens[0].expiresAt).toLocaleString(locale)}</small> : null}</td>
          <td>{t(`mailStates.${item.mailStatus}`)}</td>
          <td><div className="adminInlineActions">{(item.status === "PENDING" || item.status === "DEFERRED" ? ["approve", "defer", "reject", "delete"] : item.status === "INVITED" ? ["resend", "revoke", "delete"] : item.status === "COMPLETED" ? [] : ["delete"]).map(name => <DeskButton key={name} type="button" className={name === "approve" ? "btn btnPrimary" : "btn"} disabled={busy} onClick={() => setAction({ item, name })}><AppIcon name={name === "approve" ? "check" : name === "resend" ? "refresh" : "settings"} />{t(`actionsLabel.${name}`)}</DeskButton>)}</div></td>
        </tr>)}</tbody>
      </DeskTable></div>
      {data.items.length === 0 ? <p>{t("empty")}</p> : null}
      <div className="adminInlineActions"><DeskButton className="btn" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}><AppIcon name="back" />{t("previous")}</DeskButton><DeskButton className="btn" disabled={busy || (page + 1) * 30 >= data.total} onClick={() => setPage(p => p + 1)}><AppIcon name="detail" />{t("next")}</DeskButton></div>
    </> : null}
    <AdminConfirmDialog open={action !== null} title={action ? t(`actionsLabel.${action.name}`) : t("actions")} description={action ? `${action.item.email} — ${t("confirmAction")}` : ""} confirmLabel={t("confirm")} cancelLabel={t("cancel")} loading={busy} tone={action?.name === "approve" || action?.name === "resend" ? "primary" : "danger"} onCancel={() => { if (!busy) setAction(null); }} onConfirm={() => void perform()} />
  </section></DeskSurface>;
}
