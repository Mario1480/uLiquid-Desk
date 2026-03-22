"use client";

import Link from "next/link";
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

type UserDetailResponse = {
  id: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  memberships: Array<{
    id: string;
    status: string;
    role: { id: string; name: string } | null;
    workspace: { id: string; name: string } | null;
    createdAt: string | null;
  }>;
  botSummary: {
    total: number;
    items: Array<{
      id: string;
      name: string;
      symbol: string;
      exchange: string;
      status: string;
      workspace: { id: string; name: string } | null;
      runnerId: string | null;
      lastHeartbeatAt: string | null;
      lastError: string | null;
    }>;
  };
  license: {
    effectivePlan: string;
    status: string;
    derivedStatus: string;
    proValidUntil: string | null;
    operational: {
      instanceId: string | null;
      verificationStatus: string;
      lastVerifiedAt: string | null;
      verificationError: string | null;
    } | null;
    history: Array<{
      id: string;
      merchantOrderId: string;
      status: string;
      amountCents: number;
      currency: string;
      package: { code: string; name: string } | null;
      createdAt: string | null;
      paidAt: string | null;
    }>;
  } | null;
  recentAlerts: Array<{
    id: string;
    severity: string;
    status: string;
    type: string;
    message: string;
    createdAt: string | null;
    workspace: { id: string; name: string } | null;
    bot: { id: string; name: string } | null;
  }>;
  recentAdminAuditEvents: Array<{
    id: string;
    action: string;
    targetType: string;
    targetLabel: string | null;
    createdAt: string | null;
    actor: { id: string; email: string } | null;
  }>;
  workspaceAuditEvents: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string | null;
    workspace: { id: string; name: string } | null;
  }>;
};

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = typeof params.id === "string" ? params.id : "";
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UserDetailResponse | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setError("Missing user id.");
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet<UserDetailResponse>(`/admin/users/${userId}`);
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
  }, [userId]);

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        title={data ? data.email : "User Detail"}
        description="Operational detail view for memberships, bot footprint, licenses, alerts, and audit history."
        actions={[{ href: withLocalePath("/admin/users", locale), label: "Back to users" }]}
      />

      {loading ? <div className="settingsMutedText">Loading user detail…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}

      {data ? (
        <>
          <section className="adminStatsGrid">
            <div className="card adminStatsCard">
              <div className="adminStatsLabel">Account Status</div>
              <AdminStatusBadge value={data.status} />
            </div>
            <div className="card adminStatsCard">
              <div className="adminStatsLabel">Last Login</div>
              <div className="adminStatsValue adminStatsValueSmall">{formatDateTime(data.lastLoginAt)}</div>
            </div>
            <div className="card adminStatsCard">
              <div className="adminStatsLabel">Last Active</div>
              <div className="adminStatsValue adminStatsValueSmall">{formatDateTime(data.lastActiveAt)}</div>
            </div>
            <div className="card adminStatsCard">
              <div className="adminStatsLabel">Created</div>
              <div className="adminStatsValue adminStatsValueSmall">{formatDateTime(data.createdAt)}</div>
            </div>
          </section>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Memberships">
              {data.memberships.length > 0 ? (
                <div className="adminKeyValueList">
                  {data.memberships.map((membership) => (
                    <div key={membership.id} className="adminKeyValueRow adminKeyValueRowWrap">
                      <span>
                        <strong>{membership.workspace?.name ?? "Unknown workspace"}</strong>
                        <div className="settingsMutedText">
                          {membership.role?.name ?? "No role"} • {formatDateTime(membership.createdAt)}
                        </div>
                      </span>
                      <AdminStatusBadge value={membership.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <AdminEmptyState title="No memberships" />
              )}
            </AdminDetailSection>

            <AdminDetailSection title="License">
              {data.license ? (
                <div className="adminKeyValueList">
                  <div className="adminKeyValueRow"><span>Plan</span><strong>{data.license.effectivePlan}</strong></div>
                  <div className="adminKeyValueRow"><span>Status</span><AdminStatusBadge value={data.license.derivedStatus} /></div>
                  <div className="adminKeyValueRow"><span>Valid Until</span><strong>{formatDateTime(data.license.proValidUntil)}</strong></div>
                  <div className="adminKeyValueRow"><span>Verification</span><strong>{data.license.operational?.verificationStatus ?? "unknown"}</strong></div>
                  <div className="adminKeyValueRow"><span>Instance ID</span><strong>{data.license.operational?.instanceId ?? "—"}</strong></div>
                  {data.license.operational?.verificationError ? (
                    <div className="settingsAlert settingsAlertError">{data.license.operational.verificationError}</div>
                  ) : null}
                </div>
              ) : (
                <AdminEmptyState title="No license data" description="This user does not currently have a subscription record." />
              )}
            </AdminDetailSection>
          </div>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Bots">
              {data.botSummary.items.length > 0 ? (
                <div className="adminListStack">
                  {data.botSummary.items.map((bot) => (
                    <Link key={bot.id} href={withLocalePath("/admin/bots", locale)} className="adminListCard">
                      <div className="adminListCardTop">
                        <strong>{bot.name} • {bot.symbol}</strong>
                        <AdminStatusBadge value={bot.status} />
                      </div>
                      <div className="settingsMutedText">
                        {bot.exchange} • {bot.workspace?.name ?? "No workspace"} • runner {bot.runnerId ?? "—"}
                      </div>
                      <div className="settingsMutedText">{bot.lastError ?? "No current runtime error"}</div>
                    </Link>
                  ))}
                </div>
              ) : (
                <AdminEmptyState title="No bots" />
              )}
            </AdminDetailSection>

            <AdminDetailSection title="Recent Alerts">
              {data.recentAlerts.length > 0 ? (
                <div className="adminListStack">
                  {data.recentAlerts.map((alert) => (
                    <Link key={alert.id} href={withLocalePath("/admin/alerts", locale)} className="adminListCard">
                      <div className="adminListCardTop">
                        <AdminStatusBadge value={alert.severity} />
                        <AdminStatusBadge value={alert.status} />
                      </div>
                      <strong>{alert.message}</strong>
                      <div className="settingsMutedText">
                        {alert.type} • {alert.workspace?.name ?? "No workspace"} • {formatDateTime(alert.createdAt)}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <AdminEmptyState title="No recent alerts" />
              )}
            </AdminDetailSection>
          </div>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Admin Audit">
              {data.recentAdminAuditEvents.length > 0 ? (
                <div className="adminListStack">
                  {data.recentAdminAuditEvents.map((event) => (
                    <Link key={event.id} href={withLocalePath("/admin/audit", locale)} className="adminListCard">
                      <strong>{event.action}</strong>
                      <div className="settingsMutedText">
                        {event.targetType} • {event.targetLabel ?? "—"} • {event.actor?.email ?? "Unknown actor"}
                      </div>
                      <div className="settingsMutedText">{formatDateTime(event.createdAt)}</div>
                    </Link>
                  ))}
                </div>
              ) : (
                <AdminEmptyState title="No admin audit yet" />
              )}
            </AdminDetailSection>

            <AdminDetailSection title="Workspace Audit">
              {data.workspaceAuditEvents.length > 0 ? (
                <div className="adminListStack">
                  {data.workspaceAuditEvents.map((event) => (
                    <div key={event.id} className="adminListCard">
                      <strong>{event.action}</strong>
                      <div className="settingsMutedText">
                        {event.entityType} • {event.workspace?.name ?? "Unknown workspace"}
                      </div>
                      <div className="settingsMutedText">{formatDateTime(event.createdAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <AdminEmptyState title="No workspace audit events" />
              )}
            </AdminDetailSection>
          </div>
        </>
      ) : null}
    </div>
  );
}
