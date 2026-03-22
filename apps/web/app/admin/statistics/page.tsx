"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../../lib/api";
import AdminEmptyState from "../_components/AdminEmptyState";
import AdminFilterBar from "../_components/AdminFilterBar";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminStatsCard from "../_components/AdminStatsCard";
import { adminErrMsg } from "../_components/admin-client";

export default function AdminStatisticsPage() {
  const [period, setPeriod] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet(`/admin/statistics?period=${encodeURIComponent(period)}`);
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
  }, [period]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader title="Statistics" description="Growth, usage, alert, license, and runner trend summaries." />
      <AdminFilterBar>
        <div className="adminFilterGrid">
          <label className="settingsField">
            <span className="settingsFieldLabel">Time Window</span>
            <select className="input" value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
              <option value="90d">90d</option>
              <option value="all">all</option>
            </select>
          </label>
        </div>
      </AdminFilterBar>
      {loading ? <div className="settingsMutedText">Loading statistics…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {data ? (
        <>
          <section className="adminStatsGrid">
            <AdminStatsCard label="Registrations" value={data.kpis?.registrations ?? 0} />
            <AdminStatsCard label="Workspaces Created" value={data.kpis?.workspacesCreated ?? 0} />
            <AdminStatsCard label="Total Bots" value={data.kpis?.totalBots ?? 0} />
            <AdminStatsCard label="Total Alerts" value={data.kpis?.totalAlerts ?? 0} />
          </section>
          <section className="adminOverviewGrid">
            <article className="card settingsSection">
              <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>Registrations Over Time</h3></div>
              <div className="adminMiniChart">{(data.registrationsOverTime ?? []).map((point: any) => <div key={point.date} className="adminMiniChartRow"><span>{point.date}</span><strong>{point.count}</strong></div>)}</div>
            </article>
            <article className="card settingsSection">
              <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>Workspaces Over Time</h3></div>
              <div className="adminMiniChart">{(data.workspacesOverTime ?? []).map((point: any) => <div key={point.date} className="adminMiniChartRow"><span>{point.date}</span><strong>{point.count}</strong></div>)}</div>
            </article>
            <article className="card settingsSection">
              <div className="settingsSectionHeader"><h3 style={{ margin: 0 }}>Runner Uptime Summary</h3></div>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>Total</span><strong>{data.runnerUptimeSummary?.total ?? 0}</strong></div>
                <div className="adminKeyValueRow"><span>Online</span><strong>{data.runnerUptimeSummary?.online ?? 0}</strong></div>
                <div className="adminKeyValueRow"><span>Offline</span><strong>{data.runnerUptimeSummary?.offline ?? 0}</strong></div>
              </div>
            </article>
          </section>
        </>
      ) : null}
      {!loading && !data ? <AdminEmptyState title="No statistics available" /> : null}
    </div>
  );
}
