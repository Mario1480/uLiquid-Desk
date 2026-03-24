"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { apiDelete, apiGet, apiPut } from "../../../../lib/api";
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
  hasAdminBackendAccess: boolean;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<UserDetailResponse | null>(null);
  const [submittingPassword, setSubmittingPassword] = useState(false);
  const [submittingAccess, setSubmittingAccess] = useState(false);
  const [submittingDelete, setSubmittingDelete] = useState(false);
  const [nextPassword, setNextPassword] = useState("");

  async function loadUser() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await apiGet<UserDetailResponse>(`/admin/users/${userId}`);
      setData(next);
    } catch (loadError) {
      setError(adminErrMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

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

  function generateTemporaryPassword() {
    const random = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now().toString(36).slice(-4);
    setNextPassword(`uLiq-${random}-${stamp}`);
  }

  async function handlePasswordReset(event: React.FormEvent) {
    event.preventDefault();
    if (!data || nextPassword.trim().length < 8) return;
    setSubmittingPassword(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/admin/users/${data.id}/password`, {
        password: nextPassword.trim()
      });
      setNotice("Password reset completed and active sessions were revoked.");
      setNextPassword("");
      await loadUser();
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    } finally {
      setSubmittingPassword(false);
    }
  }

  async function handleAdminAccessToggle() {
    if (!data || data.isSuperadmin) return;
    setSubmittingAccess(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/admin/users/${data.id}/admin-access`, {
        enabled: !data.hasAdminBackendAccess
      });
      setNotice(data.hasAdminBackendAccess ? "Backend admin access revoked." : "Backend admin access granted.");
      await loadUser();
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    } finally {
      setSubmittingAccess(false);
    }
  }

  async function handleDeleteUser() {
    if (!data || data.isSuperadmin) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${data.email}? This cannot be undone.`)) return;
    setSubmittingDelete(true);
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/admin/users/${data.id}`);
      window.location.href = withLocalePath("/admin/users", locale);
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
      setSubmittingDelete(false);
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="User Operations"
        title={data ? data.email : "User Detail"}
        description="Operational detail view for memberships, bot footprint, licenses, alerts, and audit history."
        actions={[{ href: withLocalePath("/admin/users", locale), label: "Back to users" }]}
      />

      {loading ? <div className="settingsMutedText">Loading user detail…</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}

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
            <div className="card adminStatsCard">
              <div className="adminStatsLabel">Backend Admin Access</div>
              <div className="adminStatsValue adminStatsValueSmall">
                {data.isSuperadmin ? "implicit via superadmin" : data.hasAdminBackendAccess ? "enabled" : "disabled"}
              </div>
            </div>
          </section>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Memberships" description="Workspace access, assigned role and membership state for this user.">
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

            <AdminDetailSection title="License" description="Effective plan, operational verification state and current subscription posture.">
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
            <AdminDetailSection title="Admin Actions" description="High-impact account interventions. Use these carefully because they take effect immediately.">
              <div className="adminListStack">
                <form className="adminInlineForm" onSubmit={handlePasswordReset}>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Reset Password</span>
                    <input className="input" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="Enter a new temporary password" />
                  </label>
                  <div className="adminInlineActions">
                    <button type="button" className="btn" onClick={generateTemporaryPassword}>
                      Generate temp password
                    </button>
                    <button type="submit" className="btn btnPrimary" disabled={submittingPassword || nextPassword.trim().length < 8}>
                      {submittingPassword ? "Updating…" : "Reset password"}
                    </button>
                  </div>
                </form>

                {!data.isSuperadmin ? (
                  <div className="adminInlineActions">
                    <button type="button" className="btn" onClick={handleAdminAccessToggle} disabled={submittingAccess}>
                      {submittingAccess ? "Saving…" : data.hasAdminBackendAccess ? "Revoke backend admin access" : "Grant backend admin access"}
                    </button>
                    <button type="button" className="btn" onClick={handleDeleteUser} disabled={submittingDelete}>
                      {submittingDelete ? "Deleting…" : "Delete user"}
                    </button>
                  </div>
                ) : (
                  <div className="settingsMutedText">Superadmin accounts cannot be deleted or have backend admin access toggled here.</div>
                )}
              </div>
            </AdminDetailSection>

            <AdminDetailSection title="Account Flags" description="Platform-level access flags and immutable account state markers.">
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>Superadmin</span><AdminStatusBadge value={data.isSuperadmin ? "active" : "inactive"} /></div>
                <div className="adminKeyValueRow"><span>Backend Admin Access</span><AdminStatusBadge value={data.hasAdminBackendAccess ? "active" : "inactive"} /></div>
                <div className="adminKeyValueRow"><span>Last Updated</span><strong>{formatDateTime(data.updatedAt)}</strong></div>
              </div>
            </AdminDetailSection>
          </div>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Bots" description="Current bot footprint across workspaces, runners and runtime error state.">
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

            <AdminDetailSection title="Recent Alerts" description="Latest operational alerts tied to this user, their bots or their workspaces.">
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
            <AdminDetailSection title="Admin Audit" description="Recent backend-facing operator actions performed on or around this account.">
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

            <AdminDetailSection title="Workspace Audit" description="Recent workspace-level events associated with memberships, entities and configuration changes.">
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
