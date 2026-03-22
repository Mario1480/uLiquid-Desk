"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import AdminEmptyState from "../_components/AdminEmptyState";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminPagination from "../_components/AdminPagination";
import AdminStatusBadge from "../_components/AdminStatusBadge";
import AdminTable from "../_components/AdminTable";
import { adminErrMsg, buildQuery, formatDateTime } from "../_components/admin-client";

export default function AdminRunnersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet(`/admin/runners${buildQuery({ page })}`);
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
  }, [page]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader title="Runners" description="Infrastructure health view with heartbeat-derived status and bot assignment counts." />
      {loading ? <div className="settingsMutedText">Loading runners…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {data?.items?.length > 0 ? (
        <>
          <AdminTable columns={["Runner", "Status", "Last Heartbeat", "Assigned Bots", "Error Count", "Version", "Region", "Host"]}>
            {data.items.map((item: any) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><div className="settingsMutedText">{item.id}</div></td>
                <td><AdminStatusBadge value={item.status} /></td>
                <td>{formatDateTime(item.lastHeartbeatAt)}</td>
                <td>{item.assignedBotsCount}</td>
                <td>{item.errorCount}</td>
                <td>{item.version ?? "—"}</td>
                <td>{item.region ?? "—"}</td>
                <td>{item.host ?? "—"}</td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination page={data.pagination.page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
        </>
      ) : null}
      {!loading && data?.items?.length === 0 ? <AdminEmptyState title="No runners found" /> : null}
    </div>
  );
}
