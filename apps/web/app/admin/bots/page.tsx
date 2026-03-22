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

export default function AdminBotsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [exchange, setExchange] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet(`/admin/bots${buildQuery({ page, search, status, exchange })}`);
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
  }, [exchange, page, search, status]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader title="Bots" description="Cross-platform bot operations table with workspace, owner, runner, and error visibility." />
      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField"><span className="settingsFieldLabel">Search</span><input className="input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Bot name or symbol" /></label>
          <label className="settingsField"><span className="settingsFieldLabel">Status</span><input className="input" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} placeholder="running, error…" /></label>
          <label className="settingsField"><span className="settingsFieldLabel">Exchange</span><input className="input" value={exchange} onChange={(event) => { setPage(1); setExchange(event.target.value); }} placeholder="bitget, binance…" /></label>
        </div>
      </AdminFilterBar>
      {loading ? <div className="settingsMutedText">Loading bots…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {data?.items?.length > 0 ? (
        <>
          <AdminTable columns={["Bot", "Workspace", "Owner", "Exchange", "Symbol", "Strategy", "Status", "Runner", "Last Heartbeat", "Last Error", "Created"]}>
            {data.items.map((item: any) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.workspace?.name ?? "—"}</td>
                <td>{item.owner?.email ?? "—"}</td>
                <td>{item.exchange}</td>
                <td>{item.symbol}</td>
                <td>{item.strategyType}</td>
                <td><AdminStatusBadge value={item.status} /></td>
                <td>{item.runnerId ?? "—"}</td>
                <td>{formatDateTime(item.lastHeartbeatAt)}</td>
                <td>{item.lastError ?? "—"}</td>
                <td>{formatDateTime(item.createdAt)}</td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination page={data.pagination.page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
        </>
      ) : null}
      {!loading && data?.items?.length === 0 ? <AdminEmptyState title="No bots found" /> : null}
    </div>
  );
}
