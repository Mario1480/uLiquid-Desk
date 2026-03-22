"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import AdminEmptyState from "../_components/AdminEmptyState";
import AdminFilterBar from "../_components/AdminFilterBar";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminPagination from "../_components/AdminPagination";
import AdminTable from "../_components/AdminTable";
import { adminErrMsg, buildQuery, formatDateTime } from "../_components/admin-client";

export default function AdminAuditPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet(`/admin/audit${buildQuery({ page, search })}`);
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
  }, [page, search]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader title="Audit" description="Global platform admin audit trail for privileged operations and alert state changes." />
      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField"><span className="settingsFieldLabel">Search</span><input className="input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Action or target" /></label>
        </div>
      </AdminFilterBar>
      {loading ? <div className="settingsMutedText">Loading audit events…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {data?.items?.length > 0 ? (
        <>
          <AdminTable columns={["Timestamp", "Actor", "Action", "Target Type", "Target", "Workspace", "Metadata"]}>
            {data.items.map((item: any) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.timestamp)}</td>
                <td>{item.actor?.email ?? "—"}</td>
                <td>{item.action}</td>
                <td>{item.targetType}</td>
                <td>{item.targetLabel ?? item.targetId ?? "—"}</td>
                <td>{item.workspace?.name ?? "—"}</td>
                <td><pre className="adminMetadataPreview">{JSON.stringify(item.metadataPreview ?? {}, null, 2)}</pre></td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination page={data.pagination.page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
        </>
      ) : null}
      {!loading && data?.items?.length === 0 ? <AdminEmptyState title="No audit events yet" /> : null}
    </div>
  );
}
