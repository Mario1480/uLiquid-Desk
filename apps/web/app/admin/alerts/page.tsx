"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
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
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");

  async function loadCurrent() {
    setLoading(true);
    setError(null);
    try {
      const next = await apiGet(`/admin/alerts${buildQuery({ page, search, severity, status })}`);
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
      await apiPost(`/admin/alerts/${id}/status`, { status: nextStatus });
      await loadCurrent();
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader title="Alerts" description="Platform-wide alert inbox with operational acknowledge and resolve actions." />
      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField"><span className="settingsFieldLabel">Search</span><input className="input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Title or message" /></label>
          <label className="settingsField"><span className="settingsFieldLabel">Severity</span><select className="input" value={severity} onChange={(event) => { setPage(1); setSeverity(event.target.value); }}><option value="">All</option>{data?.filterOptions?.severity?.map((option: string) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label className="settingsField"><span className="settingsFieldLabel">Status</span><select className="input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">All</option>{data?.filterOptions?.status?.map((option: string) => <option key={option} value={option}>{option}</option>)}</select></label>
        </div>
      </AdminFilterBar>
      {loading ? <div className="settingsMutedText">Loading alerts…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
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
