"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { apiGet } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import AdminEmptyState from "./_components/AdminEmptyState";
import AdminPageHeader from "./_components/AdminPageHeader";
import AdminStatsCard from "./_components/AdminStatsCard";
import AdminStatusBadge from "./_components/AdminStatusBadge";
import { adminErrMsg, formatDateTime } from "./_components/admin-client";

type OverviewResponse = {
  stats: Record<string, number>;
  systemHealth: {
    status: string;
    runners: { total: number; online: number; offline: number };
    alerts: { criticalOpen: number };
    bots: { running: number; errored: number };
  };
  latestCriticalAlerts: Array<{
    id: string;
    severity: string;
    status: string;
    type: string;
    message: string;
    createdAt: string | null;
    workspace: { id: string; name: string } | null;
    bot: { id: string; name: string } | null;
  }>;
  recentAuditEvents: Array<{
    id: string;
    action: string;
    targetType: string;
    targetLabel: string | null;
    createdAt: string | null;
    actor: { id: string; email: string } | null;
  }>;
  userGrowth: Array<{ date: string; count: number }>;
  licenseHealth: Record<string, number>;
  botsWithErrors: Array<{
    id: string;
    name: string;
    symbol: string;
    lastError: string | null;
    workspace: { id: string; name: string } | null;
  }>;
};

export default function AdminOverviewPage() {
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewResponse | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet<OverviewResponse>("/admin/overview");
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
  }, []);

  const recentUserGrowth = (data?.userGrowth ?? []).slice(-12);
  const maxUserGrowth = Math.max(1, ...recentUserGrowth.map((point) => point.count));
  const totalRecentRegistrations = recentUserGrowth.reduce((sum, point) => sum + point.count, 0);
  const licenseHealthEntries = Object.entries(data?.licenseHealth ?? {});

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="Platform Admin"
        title="Platform Overview"
        description="High-signal platform status across users, workspaces, licenses, alerts, bots, and infrastructure."
        actions={[
          { href: withLocalePath("/admin/alerts", locale), label: "Open Alerts" },
          { href: withLocalePath("/admin/audit", locale), label: "Open Audit" }
        ]}
      />

      {loading ? <div className="settingsMutedText">Loading platform overview…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}

      {data ? (
        <>
          <section className="adminStatsGrid">
            <AdminStatsCard label="Total Users" value={data.stats.totalUsers ?? 0} />
            <AdminStatsCard label="Active Workspaces" value={data.stats.activeWorkspaces ?? 0} />
            <AdminStatsCard label="Active Licenses" value={data.stats.activeLicenses ?? 0} />
            <AdminStatsCard label="Expired Licenses" value={data.stats.expiredLicenses ?? 0} />
            <AdminStatsCard label="Running Bots" value={data.stats.runningBots ?? 0} />
            <AdminStatsCard label="Error Bots" value={data.stats.errorBots ?? 0} />
            <AdminStatsCard label="Critical Alerts" value={data.stats.openCriticalAlerts ?? 0} />
            <AdminStatsCard label="Online Runners" value={data.stats.onlineRunners ?? 0} />
            <AdminStatsCard label="Offline Runners" value={data.stats.offlineRunners ?? 0} />
          </section>

          <section className="adminOverviewTopGrid">
            <article className="settingsSection adminOverviewPanel">
              <div className="settingsSectionHeader">
                <h3 className="adminSectionTitle">System Health</h3>
              </div>
              <div className="adminOverviewHealthGrid">
                <div className="adminHealthStat">
                  <div className="settingsMutedText">Overall platform</div>
                  <div className="adminHealthStatValue">
                    <AdminStatusBadge value={data.systemHealth.status} />
                  </div>
                </div>
                <div className="adminHealthStat">
                  <div className="settingsMutedText">Runner availability</div>
                  <strong className="adminHealthStatValue">
                    {data.systemHealth.runners.online}/{data.systemHealth.runners.total} online
                  </strong>
                </div>
                <div className="adminHealthStat">
                  <div className="settingsMutedText">Critical alerts</div>
                  <strong className="adminHealthStatValue">{data.systemHealth.alerts.criticalOpen}</strong>
                </div>
                <div className="adminHealthStat">
                  <div className="settingsMutedText">Bots with errors</div>
                  <strong className="adminHealthStatValue">{data.systemHealth.bots.errored}</strong>
                </div>
              </div>
            </article>

            <article className="settingsSection adminOverviewPanel adminOverviewPanelWide">
              <div className="settingsSectionHeader">
                <h3 className="adminSectionTitle">User Growth</h3>
                <div className="adminSectionMeta">
                  Last {recentUserGrowth.length || 0} days • {totalRecentRegistrations} registrations
                </div>
              </div>
              <div className="adminTrendChart">
                {recentUserGrowth.map((point) => (
                  <div key={point.date} className="adminTrendColumn">
                    <div className="adminTrendBarTrack">
                      <div
                        className="adminTrendBarFill"
                        style={{ height: `${Math.max(10, Math.round((point.count / maxUserGrowth) * 100))}%` }}
                      />
                    </div>
                    <strong className="adminTrendValue">{point.count}</strong>
                    <span className="adminTrendLabel">{point.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="adminOverviewGrid">
            <article className="settingsSection adminOverviewPanel">
              <div className="settingsSectionHeader">
                <h3 className="adminSectionTitle">License Health</h3>
              </div>
              <div className="adminMetricGrid">
                {licenseHealthEntries.map(([key, value]) => (
                  <div key={key} className="adminMetricTile">
                    <span className="adminMetricLabel">{key.replace(/_/g, " ")}</span>
                    <strong className="adminMetricValue">{value}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="settingsSection adminOverviewPanel">
              <div className="settingsSectionHeader">
                <h3 className="adminSectionTitle">Latest Critical Alerts</h3>
                <Link className="btn" href={withLocalePath("/admin/alerts", locale)}>
                  View all
                </Link>
              </div>
              {data.latestCriticalAlerts.length > 0 ? (
                <div className="adminListStack">
                  {data.latestCriticalAlerts.map((alert) => (
                    <Link
                      key={alert.id}
                      href={withLocalePath("/admin/alerts", locale)}
                      className="adminListCard"
                    >
                      <div className="adminListCardTop">
                        <AdminStatusBadge value={alert.severity} />
                        <AdminStatusBadge value={alert.status} />
                      </div>
                      <strong>{alert.message}</strong>
                      <div className="settingsMutedText">
                        {alert.type} • {formatDateTime(alert.createdAt)} • {alert.workspace?.name ?? "No workspace"}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <AdminEmptyState title="No critical alerts" description="The backfilled and live alert stream is currently clear." />
              )}
            </article>

            <article className="settingsSection adminOverviewPanel">
              <div className="settingsSectionHeader">
                <h3 className="adminSectionTitle">Recent Audit Events</h3>
                <Link className="btn" href={withLocalePath("/admin/audit", locale)}>
                  View all
                </Link>
              </div>
              {data.recentAuditEvents.length > 0 ? (
                <div className="adminListStack">
                  {data.recentAuditEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={withLocalePath("/admin/audit", locale)}
                      className="adminListCard"
                    >
                      <strong>{event.action}</strong>
                      <div className="settingsMutedText">
                        {event.targetType} • {event.targetLabel ?? "—"} • {event.actor?.email ?? "Unknown actor"}
                      </div>
                      <div className="settingsMutedText">{formatDateTime(event.createdAt)}</div>
                    </Link>
                  ))}
                </div>
              ) : (
                <AdminEmptyState title="No admin audit entries yet" description="New platform-admin mutations will appear here." />
              )}
            </article>

            <article className="settingsSection adminOverviewPanel">
              <div className="settingsSectionHeader">
                <h3 className="adminSectionTitle">Bots With Errors</h3>
                <Link className="btn" href={withLocalePath("/admin/bots", locale)}>
                  Open bots
                </Link>
              </div>
              {data.botsWithErrors.length > 0 ? (
                <div className="adminListStack">
                  {data.botsWithErrors.map((bot) => (
                    <Link
                      key={bot.id}
                      href={withLocalePath("/admin/bots", locale)}
                      className="adminListCard"
                    >
                      <strong>{bot.name} • {bot.symbol}</strong>
                      <div className="settingsMutedText">{bot.workspace?.name ?? "No workspace"}</div>
                      <div className="settingsMutedText">{bot.lastError ?? "Unknown error"}</div>
                    </Link>
                  ))}
                </div>
              ) : (
                <AdminEmptyState title="No errored bots" description="No bots are currently flagged with runtime or status errors." />
              )}
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
