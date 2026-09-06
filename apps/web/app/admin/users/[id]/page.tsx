"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { apiDelete, apiGet, apiPut } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";
import AdminActionButton from "../../_components/AdminActionButton";
import AdminConfirmDialog from "../../_components/AdminConfirmDialog";
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
  commercialPlan: { plan: string; planValidUntil: string | null };
  manualPlanOverride: {
    plan: "pro" | "premium";
    validUntil: string;
    reason: string;
    active: boolean;
  } | null;
  effectivePlan: { plan: string; planValidUntil: string | null };
  legalAcknowledgements: Array<{
    id: string;
    version: string;
    textHash: string;
    acceptedAt: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string | null;
  }>;
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

type UserAffiliateDetailResponse = {
  user: {
    id: string;
    email: string;
    createdAt: string | null;
  };
  profile: {
    code: string;
    status: string;
  };
  program: {
    enabled: boolean;
    platformFeeRatePct: number;
    defaultAffiliateFeeRatePct: number;
  };
  effectiveFeeRatePct: number;
  rateSource: "admin_override" | "self_selected" | "program_default";
  selfSelectedFeeRatePct: number | null;
  maxSelfSelectedFeeRatePct: number;
  override: {
    feeRatePct: number;
    reason: string | null;
    updatedAt: string | null;
  } | null;
  referredBy: {
    email: string;
    code: string | null;
    source: string | null;
    assignedAt: string | null;
  } | null;
  stats: {
    referredUsers: number;
    activeReferredUsers: number;
    totalAffiliateAccruedUsd: number;
    paidAffiliateUsd: number;
    unpaidAffiliateUsd: number;
  };
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [nextPassword, setNextPassword] = useState("");
  const [affiliate, setAffiliate] = useState<UserAffiliateDetailResponse | null>(null);
  const [affiliateDraftFeeRatePct, setAffiliateDraftFeeRatePct] = useState("");
  const [affiliateDraftReason, setAffiliateDraftReason] = useState("");
  const [submittingAffiliate, setSubmittingAffiliate] = useState(false);
  const [planDraft, setPlanDraft] = useState<"pro" | "premium">("pro");
  const [planValidUntil, setPlanValidUntil] = useState("");
  const [planReason, setPlanReason] = useState("");
  const [submittingPlan, setSubmittingPlan] = useState(false);
  const [confirmPlanRevokeOpen, setConfirmPlanRevokeOpen] = useState(false);

  function addMonthsDateValue(months: number): string {
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return date.toISOString().slice(0, 10);
  }

  function applyPlanDraft(next: UserDetailResponse) {
    const current = next.manualPlanOverride;
    setPlanDraft(current?.plan ?? "pro");
    setPlanReason(current?.reason ?? "");
    setPlanValidUntil(current?.validUntil ? current.validUntil.slice(0, 10) : addMonthsDateValue(1));
  }

  async function loadUser() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [next, nextAffiliate] = await Promise.all([
        apiGet<UserDetailResponse>(`/admin/users/${userId}`),
        apiGet<UserAffiliateDetailResponse>(`/admin/users/${userId}/affiliate`)
      ]);
      setData(next);
      applyPlanDraft(next);
      setAffiliate(nextAffiliate);
      setAffiliateDraftFeeRatePct(nextAffiliate.override ? String(nextAffiliate.override.feeRatePct) : "");
      setAffiliateDraftReason(nextAffiliate.override?.reason ?? "");
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
        const [next, nextAffiliate] = await Promise.all([
          apiGet<UserDetailResponse>(`/admin/users/${userId}`),
          apiGet<UserAffiliateDetailResponse>(`/admin/users/${userId}/affiliate`)
        ]);
        if (!active) return;
        setData(next);
        applyPlanDraft(next);
        setAffiliate(nextAffiliate);
        setAffiliateDraftFeeRatePct(nextAffiliate.override ? String(nextAffiliate.override.feeRatePct) : "");
        setAffiliateDraftReason(nextAffiliate.override?.reason ?? "");
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

  async function savePlanOverride(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !planReason.trim() || !planValidUntil) return;
    setSubmittingPlan(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/admin/users/${data.id}/plan-override`, {
        plan: planDraft,
        validUntil: new Date(`${planValidUntil}T23:59:59.999Z`).toISOString(),
        reason: planReason.trim()
      });
      setNotice(`${planDraft === "premium" ? "Premium" : "Pro"} override saved.`);
      await loadUser();
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    } finally {
      setSubmittingPlan(false);
    }
  }

  async function revokePlanOverride() {
    if (!data || !planReason.trim()) return;
    setConfirmPlanRevokeOpen(false);
    setSubmittingPlan(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/admin/users/${data.id}/plan-override`, {
        plan: null,
        reason: planReason.trim()
      });
      setNotice("Manual plan override revoked; the commercial plan is effective again.");
      await loadUser();
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    } finally {
      setSubmittingPlan(false);
    }
  }

  async function handleDeleteUser() {
    if (!data || data.isSuperadmin) return;
    setConfirmDeleteOpen(false);
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

  async function saveAffiliateOverride() {
    if (!data) return;
    setSubmittingAffiliate(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPut<UserAffiliateDetailResponse>(`/admin/users/${data.id}/affiliate`, {
        feeRatePct: affiliateDraftFeeRatePct.trim() ? Number(affiliateDraftFeeRatePct) : null,
        reason: affiliateDraftReason.trim() || null
      });
      setAffiliate(payload);
      setAffiliateDraftFeeRatePct(payload.override ? String(payload.override.feeRatePct) : "");
      setAffiliateDraftReason(payload.override?.reason ?? "");
      setNotice("Affiliate override updated.");
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    } finally {
      setSubmittingAffiliate(false);
    }
  }

  async function clearAffiliateOverride() {
    if (!data) return;
    setSubmittingAffiliate(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPut<UserAffiliateDetailResponse>(`/admin/users/${data.id}/affiliate`, {
        feeRatePct: null,
        reason: null
      });
      setAffiliate(payload);
      setAffiliateDraftFeeRatePct("");
      setAffiliateDraftReason("");
      setNotice("Affiliate override cleared.");
    } catch (mutationError) {
      setError(adminErrMsg(mutationError));
    } finally {
      setSubmittingAffiliate(false);
    }
  }

  const latestLegalAcknowledgement = data?.legalAcknowledgements?.[0] ?? null;

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="User Operations"
        title={data ? data.email : "User Detail"}
        description="Operational detail view for memberships, bot footprint, licenses, alerts, and audit history."
        actions={[{ href: withLocalePath("/admin/users", locale), label: "Back to users" }]}
      />

      {loading ? <div className="settingsMutedText">Loading user detail…</div> : null}
      {error ? <DeskSurface dense><div className="card settingsSection settingsAlert settingsAlertError">{error}</div></DeskSurface> : null}
      {notice ? <DeskSurface dense><div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div></DeskSurface> : null}

      {data ? (
        <>
          <section className="adminStatsGrid">
            <DeskSurface dense><div className="card adminStatsCard">
              <div className="adminStatsLabel">Account Status</div>
              <AdminStatusBadge value={data.status} />
            </div></DeskSurface>
            <DeskSurface dense><div className="card adminStatsCard">
              <div className="adminStatsLabel">Last Login</div>
              <div className="adminStatsValue adminStatsValueSmall">{formatDateTime(data.lastLoginAt)}</div>
            </div></DeskSurface>
            <DeskSurface dense><div className="card adminStatsCard">
              <div className="adminStatsLabel">Last Active</div>
              <div className="adminStatsValue adminStatsValueSmall">{formatDateTime(data.lastActiveAt)}</div>
            </div></DeskSurface>
            <DeskSurface dense><div className="card adminStatsCard">
              <div className="adminStatsLabel">Created</div>
              <div className="adminStatsValue adminStatsValueSmall">{formatDateTime(data.createdAt)}</div>
            </div></DeskSurface>
            <DeskSurface dense><div className="card adminStatsCard">
              <div className="adminStatsLabel">Backend Admin Access</div>
              <div className="adminStatsValue adminStatsValueSmall">
                {data.isSuperadmin ? "implicit via superadmin" : data.hasAdminBackendAccess ? "enabled" : "disabled"}
              </div>
            </div></DeskSurface>
          </section>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Legal Acknowledgement" description="Versioned Risk & Non-Custody Notice acceptance captured during registration.">
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow">
                  <span>Status</span>
                  <AdminStatusBadge value={latestLegalAcknowledgement ? "accepted" : "missing"} />
                </div>
                {latestLegalAcknowledgement ? (
                  <>
                    <div className="adminKeyValueRow"><span>Version</span><strong>{latestLegalAcknowledgement.version}</strong></div>
                    <div className="adminKeyValueRow"><span>Accepted At</span><strong>{formatDateTime(latestLegalAcknowledgement.acceptedAt)}</strong></div>
                    <div className="adminKeyValueRow"><span>IP Address</span><strong>{latestLegalAcknowledgement.ipAddress ?? "—"}</strong></div>
                    <div className="adminKeyValueRow adminKeyValueRowWrap">
                      <span>Text Hash</span>
                      <strong className="adminKeyValueValue">{latestLegalAcknowledgement.textHash}</strong>
                    </div>
                    <div className="adminKeyValueRow adminKeyValueRowWrap">
                      <span>User Agent</span>
                      <strong className="adminKeyValueValue">{latestLegalAcknowledgement.userAgent ?? "—"}</strong>
                    </div>
                  </>
                ) : (
                  <div className="settingsMutedText">No legal acknowledgement has been recorded for this account yet.</div>
                )}
              </div>
            </AdminDetailSection>

            <AdminDetailSection title="Affiliate" description="Referral identity, effective rate and optional override for new referral-based vaults.">
              {affiliate ? (
                <div className="adminListStack">
                  <div className="adminKeyValueList">
                    <div className="adminKeyValueRow"><span>Referral Code</span><strong>{affiliate.profile.code}</strong></div>
                    <div className="adminKeyValueRow"><span>Program Enabled</span><strong>{affiliate.program.enabled ? "enabled" : "disabled"}</strong></div>
                    <div className="adminKeyValueRow"><span>Default Affiliate %</span><strong>{affiliate.program.defaultAffiliateFeeRatePct.toFixed(2)}%</strong></div>
                    <div className="adminKeyValueRow"><span>Self Selected %</span><strong>{affiliate.selfSelectedFeeRatePct != null ? `${affiliate.selfSelectedFeeRatePct.toFixed(2)}%` : "—"}</strong></div>
                    <div className="adminKeyValueRow"><span>Effective Affiliate %</span><strong>{affiliate.effectiveFeeRatePct.toFixed(2)}%</strong></div>
                    <div className="adminKeyValueRow"><span>Rate Source</span><strong>{affiliate.rateSource}</strong></div>
                    <div className="adminKeyValueRow"><span>Referred Users</span><strong>{affiliate.stats.referredUsers}</strong></div>
                    <div className="adminKeyValueRow"><span>Unpaid</span><strong>${affiliate.stats.unpaidAffiliateUsd.toFixed(2)}</strong></div>
                    <div className="adminKeyValueRow"><span>Referred By</span><strong>{affiliate.referredBy?.email ?? "—"}</strong></div>
                  </div>

                  <form
                    className="adminInlineForm"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveAffiliateOverride();
                    }}
                  >
                    <label className="settingsField">
                      <span className="settingsFieldLabel">Override Affiliate Fee %</span>
                      <DeskInput
                        className="input"
                        type="number"
                        min={0}
                        max={affiliate.maxSelfSelectedFeeRatePct}
                        step="0.01"
                        value={affiliateDraftFeeRatePct}
                        onChange={(event) => setAffiliateDraftFeeRatePct(event.target.value)}
                        placeholder="Leave empty to use default"
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">Reason</span>
                      <DeskInput
                        className="input"
                        value={affiliateDraftReason}
                        onChange={(event) => setAffiliateDraftReason(event.target.value)}
                        placeholder="Optional admin note"
                      />
                    </label>
                    <div className="adminInlineActions">
                      <DeskButton type="submit" className="btn btnPrimary" disabled={submittingAffiliate}>
                        {submittingAffiliate ? "Saving…" : "Save override"}
                      </DeskButton>
                      <DeskButton type="button" className="btn" onClick={() => void clearAffiliateOverride()} disabled={submittingAffiliate}>
                        Clear override
                      </DeskButton>
                    </div>
                  </form>
                </div>
              ) : (
                <AdminEmptyState title="No affiliate data" />
              )}
            </AdminDetailSection>

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
              <div className="adminListStack">
                <div className="adminKeyValueList">
                  <div className="adminKeyValueRow"><span>Commercial Plan</span><strong>{data.commercialPlan.plan}</strong></div>
                  <div className="adminKeyValueRow"><span>Manual Override</span><strong>{data.manualPlanOverride?.active ? data.manualPlanOverride.plan : "—"}</strong></div>
                  <div className="adminKeyValueRow"><span>Effective Plan</span><AdminStatusBadge value={data.effectivePlan.plan} /></div>
                  <div className="adminKeyValueRow"><span>Override Valid Until</span><strong>{formatDateTime(data.manualPlanOverride?.validUntil ?? null)}</strong></div>
                  {data.license ? (
                    <>
                      <div className="adminKeyValueRow"><span>Status</span><AdminStatusBadge value={data.license.derivedStatus} /></div>
                      <div className="adminKeyValueRow"><span>Commercial Valid Until</span><strong>{formatDateTime(data.license.proValidUntil)}</strong></div>
                      <div className="adminKeyValueRow"><span>Verification</span><strong>{data.license.operational?.verificationStatus ?? "unknown"}</strong></div>
                      <div className="adminKeyValueRow"><span>Instance ID</span><strong>{data.license.operational?.instanceId ?? "—"}</strong></div>
                      {data.license.operational?.verificationError ? (
                        <div className="settingsAlert settingsAlertError">{data.license.operational.verificationError}</div>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <form className="adminInlineForm" onSubmit={savePlanOverride}>
                  <div className="adminFilterGrid">
                    <label className="settingsField">
                      <span className="settingsFieldLabel">Manual plan</span>
                      <DeskSelect className="input" value={planDraft} onChange={(event) => setPlanDraft(event.target.value as "pro" | "premium")}>
                        <option value="pro">Pro</option>
                        <option value="premium">Premium</option>
                      </DeskSelect>
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">Valid until</span>
                      <DeskInput className="input" type="date" min={new Date().toISOString().slice(0, 10)} value={planValidUntil} onChange={(event) => setPlanValidUntil(event.target.value)} />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">Reason (required)</span>
                      <DeskInput className="input" value={planReason} onChange={(event) => setPlanReason(event.target.value)} placeholder="Reason for manual access" />
                    </label>
                  </div>
                  <div className="adminInlineActions">
                    {[1, 3, 12].map((months) => (
                      <DeskButton className="btn" type="button" key={months} onClick={() => setPlanValidUntil(addMonthsDateValue(months))}>
                        {months} month{months === 1 ? "" : "s"}
                      </DeskButton>
                    ))}
                    <AdminActionButton icon="save" variant="primary" type="submit" disabled={!planReason.trim() || !planValidUntil} loading={submittingPlan} loadingLabel="Saving...">
                      Save override
                    </AdminActionButton>
                    {data.manualPlanOverride?.active ? (
                      <AdminActionButton icon="remove" variant="danger" type="button" disabled={!planReason.trim()} onClick={() => setConfirmPlanRevokeOpen(true)}>
                        Revoke override
                      </AdminActionButton>
                    ) : null}
                  </div>
                </form>
              </div>
            </AdminDetailSection>
          </div>

          <div className="adminDetailGrid">
            <AdminDetailSection title="Admin Actions" description="High-impact account interventions. Use these carefully because they take effect immediately.">
              <div className="adminListStack">
                <form className="adminInlineForm" onSubmit={handlePasswordReset}>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">Reset Password</span>
                    <DeskInput className="input" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="Enter a new temporary password" />
                  </label>
                  <div className="adminInlineActions">
                    <AdminActionButton icon="key" type="button" onClick={generateTemporaryPassword}>
                      Generate temp password
                    </AdminActionButton>
                    <AdminActionButton icon="reset" variant="primary" type="submit" disabled={nextPassword.trim().length < 8} loading={submittingPassword} loadingLabel="Updating...">
                      Reset password
                    </AdminActionButton>
                  </div>
                </form>

                {!data.isSuperadmin ? (
                  <div className="adminInlineActions">
                    <AdminActionButton icon={data.hasAdminBackendAccess ? "disable" : "shield"} type="button" onClick={handleAdminAccessToggle} loading={submittingAccess} loadingLabel="Saving...">
                      {data.hasAdminBackendAccess ? "Revoke backend admin access" : "Grant backend admin access"}
                    </AdminActionButton>
                    <AdminActionButton icon="delete" variant="danger" type="button" onClick={() => setConfirmDeleteOpen(true)} loading={submittingDelete} loadingLabel="Deleting...">
                      Delete user
                    </AdminActionButton>
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
      <AdminConfirmDialog
        open={confirmDeleteOpen}
        title="Delete user"
        description={data ? `Delete ${data.email}? This cannot be undone.` : ""}
        confirmLabel="Delete user"
        loading={submittingDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void handleDeleteUser()}
      />
      <AdminConfirmDialog
        open={confirmPlanRevokeOpen}
        title="Revoke manual plan override"
        description="The user immediately falls back to the active commercial plan, or Free when no paid plan exists."
        confirmLabel="Revoke override"
        loading={submittingPlan}
        onCancel={() => setConfirmPlanRevokeOpen(false)}
        onConfirm={() => void revokePlanOverride()}
      />
    </div>
  );
}
