"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { apiGet } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";
import AdminDetailSection from "../../_components/AdminDetailSection";
import AdminEmptyState from "../../_components/AdminEmptyState";
import AdminPageHeader from "../../_components/AdminPageHeader";
import AdminStatusBadge from "../../_components/AdminStatusBadge";
import { adminErrMsg, formatDateTime } from "../../_components/admin-client";

export default function AdminWorkspaceDetailPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = typeof params.id === "string" ? params.id : "";
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false);
      setError("Missing workspace id.");
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet(`/admin/workspaces/${workspaceId}`);
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
  }, [workspaceId]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        title={data?.name ?? "Workspace Detail"}
        description="Members, bots, license, alerts, and audit history for one workspace."
        actions={[{ href: withLocalePath("/admin/workspaces", locale), label: "Back to workspaces" }]}
      />
      {loading ? <div className="settingsMutedText">Loading workspace detail…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}

      {data ? (
        <>
          <section className="adminStatsGrid">
            <div className="card adminStatsCard"><div className="adminStatsLabel">Owner</div><div className="adminStatsValue adminStatsValueSmall">{data.owner?.email ?? "—"}</div></div>
            <div className="card adminStatsCard"><div className="adminStatsLabel">Members</div><div className="adminStatsValue">{data.usage?.membersCount ?? 0}</div></div>
            <div className="card adminStatsCard"><div className="adminStatsLabel">Bots</div><div className="adminStatsValue">{data.usage?.botsCount ?? 0}</div></div>
            <div className="card adminStatsCard"><div className="adminStatsLabel">Running Bots</div><div className="adminStatsValue">{data.usage?.runningBots ?? 0}</div></div>
          </section>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Members" description="Current workspace members, assigned roles and membership health.">
              {data.members?.length > 0 ? (
                <div className="adminKeyValueList">
                  {data.members.map((member: any) => (
                    <div key={member.id} className="adminKeyValueRow adminKeyValueRowWrap">
                      <span>
                        <strong>{member.user?.email ?? "Unknown user"}</strong>
                        <div className="settingsMutedText">{member.role?.name ?? "No role"} • {formatDateTime(member.createdAt)}</div>
                      </span>
                      <AdminStatusBadge value={member.status} />
                    </div>
                  ))}
                </div>
              ) : <AdminEmptyState title="No members" />}
            </AdminDetailSection>

            <AdminDetailSection title="License" description="Workspace entitlement snapshot including allowed strategy families and AI model scope.">
              {data.license ? (
                <div className="adminKeyValueList">
                  <div className="adminKeyValueRow"><span>Plan</span><strong>{data.license.plan}</strong></div>
                  <div className="adminKeyValueRow"><span>Allowed Strategy Kinds</span><strong>{(data.license.allowedStrategyKinds ?? []).join(", ") || "—"}</strong></div>
                  <div className="adminKeyValueRow"><span>AI Models</span><strong>{(data.license.aiAllowedModels ?? []).join(", ") || "—"}</strong></div>
                </div>
              ) : <AdminEmptyState title="No workspace entitlement" />}
            </AdminDetailSection>
          </div>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Bots" description="Bots currently linked to this workspace, including owner context and runtime status.">
              {data.bots?.length > 0 ? (
                <div className="adminListStack">
                  {data.bots.map((bot: any) => (
                    <div key={bot.id} className="adminListCard">
                      <div className="adminListCardTop">
                        <strong>{bot.name} • {bot.symbol}</strong>
                        <AdminStatusBadge value={bot.status} />
                      </div>
                      <div className="settingsMutedText">{bot.exchange} • {bot.user?.email ?? "No owner"}</div>
                    </div>
                  ))}
                </div>
              ) : <AdminEmptyState title="No bots" />}
            </AdminDetailSection>

            <AdminDetailSection title="Recent Alerts" description="Latest incidents and warnings emitted from this workspace and its attached bots.">
              {data.recentAlerts?.length > 0 ? (
                <div className="adminListStack">
                  {data.recentAlerts.map((alert: any) => (
                    <div key={alert.id} className="adminListCard">
                      <div className="adminListCardTop">
                        <AdminStatusBadge value={alert.severity} />
                        <AdminStatusBadge value={alert.status} />
                      </div>
                      <strong>{alert.message}</strong>
                      <div className="settingsMutedText">{formatDateTime(alert.createdAt)}</div>
                    </div>
                  ))}
                </div>
              ) : <AdminEmptyState title="No recent alerts" />}
            </AdminDetailSection>
          </div>
        </>
      ) : null}
    </div>
  );
}
