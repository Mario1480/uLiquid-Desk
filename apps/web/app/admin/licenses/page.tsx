"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import AdminEmptyState from "../_components/AdminEmptyState";
import AdminFilterBar from "../_components/AdminFilterBar";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminPagination from "../_components/AdminPagination";
import AdminStatusBadge from "../_components/AdminStatusBadge";
import AdminTable from "../_components/AdminTable";
import { adminErrMsg, buildQuery, formatDateTime } from "../_components/admin-client";

export default function AdminLicensesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet(`/admin/licenses${buildQuery({ page, search, status })}`);
        if (!active) return;
        setData(next);
      } catch (loadError) {
        if (!active) return;
        setError(adminErrMsg(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [page, search, status]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader title="Licenses" description="Subscription-backed operational license inventory with verification state visibility." />
      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField"><span className="settingsFieldLabel">Search</span><input className="input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Email or license id" /></label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Status</span>
            <select className="input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
              <option value="">All</option>
              {data?.filterOptions?.status?.map((option: string) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </AdminFilterBar>
      {loading ? <div className="settingsMutedText">Loading licenses…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {data?.items?.length > 0 ? (
        <>
          <AdminTable columns={["Identifier", "Status", "Assigned User", "Workspace", "Plan", "Instance", "Last Verification", "Expires", "Created", "Verification"]}>
            {data.items.map((item: any) => (
              <tr key={item.id}>
                <td><strong>{item.licenseIdentifier}</strong></td>
                <td><AdminStatusBadge value={item.status} /></td>
                <td>{item.assignedUser?.email ?? "—"}</td>
                <td>{item.assignedWorkspace?.name ?? "—"}</td>
                <td>{item.plan}</td>
                <td>{item.instanceId ?? "—"}</td>
                <td>{formatDateTime(item.lastVerification)}</td>
                <td>{formatDateTime(item.expiresAt)}</td>
                <td>{formatDateTime(item.createdAt)}</td>
                <td><AdminStatusBadge value={item.verificationState} /></td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination page={data.pagination.page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
        </>
      ) : null}
      {!loading && data?.items?.length === 0 ? <AdminEmptyState title="No licenses found" /> : null}
    </div>
  );
}
