"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "../../../lib/api";
import AdminEmptyState from "../_components/AdminEmptyState";
import AdminFilterBar from "../_components/AdminFilterBar";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminPagination from "../_components/AdminPagination";
import AdminStatusBadge from "../_components/AdminStatusBadge";
import AdminTable from "../_components/AdminTable";
import { adminErrMsg, buildQuery, formatDateTime } from "../_components/admin-client";

type WorkspacesResponse = {
  items: Array<{
    id: string;
    name: string;
    owner: { id: string; email: string } | null;
    membersCount: number;
    botsCount: number;
    licenseStatus: string;
    plan: string;
    lastActiveAt: string | null;
    createdAt: string | null;
    status: string;
  }>;
  pagination: { page: number; totalPages: number };
};

export default function AdminWorkspacesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WorkspacesResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [licenseStatus, setLicenseStatus] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet<WorkspacesResponse>(
          `/admin/workspaces${buildQuery({ page, search, status, licenseStatus })}`
        );
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
  }, [licenseStatus, page, search, status]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        title="Workspaces"
        description="Cross-workspace operational inventory with owner, activity, bot footprint, and license summary."
      />

      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField">
            <span className="settingsFieldLabel">Search</span>
            <input className="input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Workspace name" />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Status</span>
            <select className="input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
              <option value="">All</option>
              <option value="active">active</option>
              <option value="idle">idle</option>
            </select>
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">License</span>
            <select className="input" value={licenseStatus} onChange={(event) => { setPage(1); setLicenseStatus(event.target.value); }}>
              <option value="">All</option>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </label>
        </div>
      </AdminFilterBar>

      {loading ? <div className="settingsMutedText">Loading workspaces…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}

      {data && data.items.length > 0 ? (
        <>
          <AdminTable columns={["Workspace", "Owner", "Members", "Bots", "License", "Plan", "Last Active", "Created", "Status"]}>
            {data.items.map((workspace) => (
              <tr key={workspace.id} className="adminTableRowInteractive" onClick={() => router.push(`/admin/workspaces/${workspace.id}`)}>
                <td><strong>{workspace.name}</strong></td>
                <td>{workspace.owner?.email ?? "—"}</td>
                <td>{workspace.membersCount}</td>
                <td>{workspace.botsCount}</td>
                <td><AdminStatusBadge value={workspace.licenseStatus} /></td>
                <td>{workspace.plan}</td>
                <td>{formatDateTime(workspace.lastActiveAt)}</td>
                <td>{formatDateTime(workspace.createdAt)}</td>
                <td><AdminStatusBadge value={workspace.status} /></td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination page={data.pagination.page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
        </>
      ) : null}

      {!loading && data && data.items.length === 0 ? (
        <AdminEmptyState title="No workspaces found" description="Try broadening the current filters." />
      ) : null}
    </div>
  );
}
