"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../../lib/api";
import AdminEmptyState from "../_components/AdminEmptyState";
import AdminFilterBar from "../_components/AdminFilterBar";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminPagination from "../_components/AdminPagination";
import AdminStatusBadge from "../_components/AdminStatusBadge";
import AdminTable from "../_components/AdminTable";
import { adminErrMsg, buildQuery, formatDateTime } from "../_components/admin-client";

export default function AdminAlertsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [savingRetention, setSavingRetention] = useState(false);
  const [actionLoading, setActionLoading] = useState<"" | "delete-all" | "delete-old">("");

  async function loadCurrent(nextPage = page) {
    setLoading(true);
    setError(null);
    try {
      const next = await apiGet(`/admin/alerts${buildQuery({ page: nextPage, search, severity, status })}`);
      setData(next);
    } catch (loadError) {
      setError(adminErrMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCurrent();
  }, [page, search, severity, status]);

  async function updateStatus(id: string, nextStatus: "acknowledged" | "resolved") {
    try {
      setNotice(null);
      await apiPost(`/admin/alerts/${id}/status`, { status: nextStatus });
      await loadCurrent();
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    }
  }

  async function updateRetention(autoDeleteOlderThan30Days: boolean) {
    setSavingRetention(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut("/admin/alerts/retention", { autoDeleteOlderThan30Days });
      setNotice(
        autoDeleteOlderThan30Days
          ? "Auto-delete for alerts older than 30 days is enabled."
          : "Auto-delete for alerts older than 30 days is disabled."
      );
      await loadCurrent(1);
      setPage(1);
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    } finally {
      setSavingRetention(false);
    }
  }

  async function deleteAlerts(scope: "all" | "older_than_30_days") {
    const confirmMessage = scope === "all"
      ? "Delete all platform alerts? This cannot be undone."
      : "Delete all platform alerts older than 30 days?";
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) return;

    setActionLoading(scope === "all" ? "delete-all" : "delete-old");
    setError(null);
    setNotice(null);
    try {
      const result = await apiPost<{ deletedCount?: number }>("/admin/alerts/delete", { scope });
      const deletedCount = Number(result?.deletedCount ?? 0);
      setNotice(
        scope === "all"
          ? `Deleted ${deletedCount} alert${deletedCount === 1 ? "" : "s"}.`
          : `Deleted ${deletedCount} alert${deletedCount === 1 ? "" : "s"} older than 30 days.`
      );
      await loadCurrent(1);
      setPage(1);
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    } finally {
      setActionLoading("");
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader title="Alerts" description="Platform-wide alert inbox with operational acknowledge and resolve actions." />
      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>Retention & Cleanup</h3>
            <div className="settingsSectionMeta">Manage platform alert retention and bulk cleanup.</div>
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={Boolean(data?.retention?.autoDeleteOlderThan30Days)}
            onChange={(event) => void updateRetention(event.target.checked)}
            disabled={savingRetention}
          />
          <span>Automatically delete alerts older than 30 days.</span>
        </label>
        <div className="settingsMutedText" style={{ marginBottom: 12 }}>
          Older resolved and historical alerts can otherwise grow indefinitely. Last updated: {formatDateTime(data?.retention?.updatedAt)}
        </div>
        <div className="adminInlineActions">
          <button className="btn" disabled={actionLoading !== ""} onClick={() => void deleteAlerts("older_than_30_days")}>
            {actionLoading === "delete-old" ? "Deleting…" : "Delete older than 30 days"}
          </button>
          <button className="btn btnDanger" disabled={actionLoading !== ""} onClick={() => void deleteAlerts("all")}>
            {actionLoading === "delete-all" ? "Deleting…" : "Delete all alerts"}
          </button>
        </div>
      </section>
      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField"><span className="settingsFieldLabel">Search</span><input className="input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Title or message" /></label>
          <label className="settingsField"><span className="settingsFieldLabel">Severity</span><select className="input" value={severity} onChange={(event) => { setPage(1); setSeverity(event.target.value); }}><option value="">All</option>{data?.filterOptions?.severity?.map((option: string) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label className="settingsField"><span className="settingsFieldLabel">Status</span><select className="input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">All</option>{data?.filterOptions?.status?.map((option: string) => <option key={option} value={option}>{option}</option>)}</select></label>
        </div>
      </AdminFilterBar>
      {loading ? <div className="settingsMutedText">Loading alerts…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}
      {data?.items?.length > 0 ? (
        <>
          <AdminTable columns={["Severity", "Status", "Type", "Source", "User", "Workspace", "Bot", "Runner", "Message", "Created", "Actions"]}>
            {data.items.map((item: any) => (
              <tr key={item.id}>
                <td><AdminStatusBadge value={item.severity} /></td>
                <td><AdminStatusBadge value={item.status} /></td>
                <td>{item.type}</td>
                <td>{item.source}</td>
                <td>{item.user?.email ?? "—"}</td>
                <td>{item.workspace?.name ?? "—"}</td>
                <td>{item.bot?.name ?? "—"}</td>
                <td>{item.runner?.name ?? "—"}</td>
                <td>{item.message}</td>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>
                  <div className="adminInlineActions">
                    {item.status === "open" ? <button className="btn" onClick={() => void updateStatus(item.id, "acknowledged")}>Acknowledge</button> : null}
                    {item.status !== "resolved" ? <button className="btn" onClick={() => void updateStatus(item.id, "resolved")}>Resolve</button> : null}
                  </div>
                </td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination page={data.pagination.page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
        </>
      ) : null}
      {!loading && data?.items?.length === 0 ? <AdminEmptyState title="No alerts found" /> : null}
    </div>
  );
}
