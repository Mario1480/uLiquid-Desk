"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import AdminConfirmDialog from "../../admin/_components/AdminConfirmDialog";
import { AppIcon } from "../../components/AppIcon";

type SettingsSession = {
  id: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  expiresAt: string | null;
  isCurrent: boolean;
  expired?: boolean;
};

export default function UsersPage() {
  const t = useTranslations("settings.users");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdStatus, setPwdStatus] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetDevCode, setResetDevCode] = useState<string | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [securityMsg, setSecurityMsg] = useState<string | null>(null);
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(true);
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState(60);
  const [otpEnabled, setOtpEnabled] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [sessions, setSessions] = useState<SettingsSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionActionBusy, setSessionActionBusy] = useState<string | null>(null);
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);
  const [confirmRevokeOthers, setConfirmRevokeOthers] = useState(false);

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  function formatDateTime(value: string | null | undefined): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  }

  async function loadSecuritySettings() {
    setSecurityLoading(true);
    setSecurityMsg(null);
    try {
      const [data, me] = await Promise.all([
        apiGet<any>("/settings/security"),
        apiGet<any>("/auth/me")
      ]);
      setAutoLogoutEnabled(Boolean(data.autoLogoutEnabled));
      setAutoLogoutMinutes(Number(data.autoLogoutMinutes) || 60);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      setIsSuperadmin(Boolean(data.isSuperadmin));
      const emailFromMe = typeof me?.email === "string"
        ? me.email
        : typeof me?.user?.email === "string"
          ? me.user.email
          : "";
      if (emailFromMe) setResetEmail(emailFromMe);
    } catch (e) {
      setSecurityMsg(errMsg(e));
    } finally {
      setSecurityLoading(false);
    }
  }

  async function loadSessions() {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const payload = await apiGet<{ items?: SettingsSession[] }>("/settings/sessions");
      setSessions(payload.items ?? []);
    } catch (e) {
      setSessionsError(errMsg(e));
    } finally {
      setSessionsLoading(false);
    }
  }

  async function saveSecuritySettings() {
    setSecuritySaving(true);
    setSecurityMsg(null);
    const safeMinutes = Math.max(1, Math.min(1440, Math.floor(autoLogoutMinutes)));
    try {
      const payload: any = {
        autoLogoutEnabled,
        autoLogoutMinutes: safeMinutes
      };
      if (isSuperadmin) {
        payload.reauthOtpEnabled = otpEnabled;
      }
      const data = await apiPut<any>("/settings/security", payload);
      setAutoLogoutEnabled(Boolean(data.autoLogoutEnabled));
      setAutoLogoutMinutes(Number(data.autoLogoutMinutes) || safeMinutes);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      setIsSuperadmin(Boolean(data.isSuperadmin));
      setSecurityMsg(t("messages.saved"));
    } catch (e) {
      setSecurityMsg(errMsg(e));
    } finally {
      setSecuritySaving(false);
    }
  }

  useEffect(() => {
    loadSecuritySettings();
    loadSessions();
  }, []);

  async function revokeSession(sessionId: string) {
    setSessionActionBusy(sessionId);
    setSessionsError("");
    try {
      await apiDelete<{ ok: boolean }>(`/settings/sessions/${encodeURIComponent(sessionId)}`);
      setConfirmSessionId(null);
      await loadSessions();
    } catch (e) {
      setSessionsError(errMsg(e));
    } finally {
      setSessionActionBusy(null);
    }
  }

  async function revokeOtherSessions() {
    setSessionActionBusy("others");
    setSessionsError("");
    try {
      await apiDelete<{ ok: boolean; deletedCount: number }>("/settings/sessions?scope=others");
      setConfirmRevokeOthers(false);
      await loadSessions();
    } catch (e) {
      setSessionsError(errMsg(e));
    } finally {
      setSessionActionBusy(null);
    }
  }

  async function savePassword() {
    setPwdStatus(tCommon("saving"));
    setPwdError("");
    if (newPassword !== confirmPassword) {
      setPwdStatus("");
      setPwdError(t("messages.passwordMismatch"));
      return;
    }
    try {
      await apiPost("/auth/change-password", {
        currentPassword,
        newPassword
      });
      setPwdStatus(t("messages.updated"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPwdStatus(""), 1200);
    } catch (e) {
      setPwdStatus("");
      setPwdError(errMsg(e));
    }
  }

  async function requestResetCode() {
    setResetStatus(t("messages.sendingCode"));
    setResetError("");
    setResetDevCode(null);
    try {
      const payload = await apiPost<{ devCode?: string; expiresInMinutes?: number }>(
        "/auth/password-reset/request",
        { email: resetEmail }
      );
      setResetStatus(
        t("messages.resetCodeSent", {
          expires: payload?.expiresInMinutes ? ` (${t("messages.validFor", { minutes: payload.expiresInMinutes })})` : ""
        })
      );
      if (payload?.devCode) setResetDevCode(payload.devCode);
    } catch (e) {
      setResetStatus("");
      setResetError(errMsg(e));
    }
  }

  async function confirmResetPassword() {
    setResetStatus(t("messages.updatingPassword"));
    setResetError("");
    if (resetNewPassword !== resetConfirmPassword) {
      setResetStatus("");
      setResetError(t("messages.newPasswordMismatch"));
      return;
    }
    try {
      await apiPost("/auth/password-reset/confirm", {
        email: resetEmail,
        code: resetCode,
        newPassword: resetNewPassword
      });
      setResetStatus(t("messages.passwordUpdated"));
      setResetCode("");
      setResetNewPassword("");
      setResetConfirmPassword("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setResetStatus("");
      setResetError(errMsg(e));
    }
  }

  return (
    <div className="settingsWrap" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <DeskSurface><div className="card settingsSection" style={{ marginTop: 14 }}>
        <div className="settingsSectionHeader">
          <div style={{ fontWeight: 700 }}>{t("password.title")}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {t("password.description")}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            {t("password.current")}
            <DeskInput
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("password.new")}
            <DeskInput
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("password.confirm")}
            <DeskInput
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
	          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
	            <DeskButton className="btn btnPrimary" onClick={savePassword} disabled={!currentPassword || !newPassword}>
	              <AppIcon name="key" />
	              {t("password.submit")}
	            </DeskButton>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{pwdStatus}</span>
          </div>
          {pwdError ? <div style={{ fontSize: 12, color: "#ff6b6b" }}>{pwdError}</div> : null}
        </div>
      </div></DeskSurface>

      <DeskSurface><div className="card settingsSection" style={{ marginTop: 14 }}>
        <div className="settingsSectionHeader">
          <div style={{ fontWeight: 700 }}>{t("security.title")}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {t("security.description")}
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 10, maxWidth: 360 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <DeskInput
              type="checkbox"
              checked={autoLogoutEnabled}
              onChange={(e) => setAutoLogoutEnabled(e.target.checked)}
              disabled={securityLoading || securitySaving}
            />
            <span>{t("security.autoLogout")}</span>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("security.idleMinutes")}</span>
            <DeskInput
              className="input"
              type="number"
              min={1}
              max={1440}
              value={Number.isFinite(autoLogoutMinutes) ? autoLogoutMinutes : 60}
              onChange={(e) => setAutoLogoutMinutes(Number(e.target.value))}
              disabled={!autoLogoutEnabled || securityLoading || securitySaving}
            />
          </label>
          {isSuperadmin ? (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <DeskInput
                type="checkbox"
                checked={otpEnabled}
                onChange={(e) => setOtpEnabled(e.target.checked)}
                disabled={securityLoading || securitySaving}
              />
              <span>{t("security.otp")}</span>
            </label>
          ) : null}
        </div>
	        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
	          <DeskButton className="btn btnPrimary" onClick={saveSecuritySettings} disabled={securityLoading || securitySaving}>
	            <AppIcon name="save" />
	            {securitySaving ? tCommon("saving") : tCommon("saveSettings")}
	          </DeskButton>
	          <DeskButton className="btn" onClick={loadSecuritySettings} disabled={securityLoading || securitySaving}>
	            <AppIcon name="refresh" />
	            {securityLoading ? tCommon("loading") : tCommon("reload")}
	          </DeskButton>
        </div>
        {securityMsg ? (
          <div style={{ marginTop: 10, color: "var(--muted)" }}>{securityMsg}</div>
        ) : null}
      </div></DeskSurface>

      <DeskSurface><div className="card settingsSection" style={{ marginTop: 14 }}>
        <div className="settingsSectionHeader">
          <div>
            <div style={{ fontWeight: 700 }}>{t("sessions.title")}</div>
            <div className="settingsMutedText">{t("sessions.description")}</div>
          </div>
          <div className="settingsWalletLinkActions">
            <DeskButton className="btn" type="button" onClick={() => void loadSessions()} disabled={sessionsLoading || Boolean(sessionActionBusy)}>
              <AppIcon name="refresh" />
              {sessionsLoading ? tCommon("loading") : tCommon("reload")}
            </DeskButton>
            <DeskButton
              className="btn btnStop"
              type="button"
              onClick={() => setConfirmRevokeOthers(true)}
              disabled={sessionsLoading || sessions.filter((session) => !session.isCurrent).length === 0 || Boolean(sessionActionBusy)}
            >
              <AppIcon name="unlink" />
              {t("sessions.revokeOthers")}
            </DeskButton>
          </div>
        </div>
        {sessionsError ? <div className="settingsAlert settingsAlertError">{sessionsError}</div> : null}
        {sessionsLoading ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : sessions.length === 0 ? (
          <div className="settingsMutedText">{t("sessions.empty")}</div>
        ) : (
          <div className="settingsAccountList">
            {sessions.map((session) => (
              <DeskSurface><div className="card settingsAccountCard" key={session.id}>
                <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{session.isCurrent ? t("sessions.current") : t("sessions.other")}</strong>
                    {session.expired ? <span className="badge">{t("sessions.expired")}</span> : null}
                  </div>
                  <div className="settingsMutedText">
                    {t("sessions.lastActive")}: {formatDateTime(session.lastActiveAt)}
                  </div>
                  <div className="settingsMutedText">
                    {t("sessions.created")}: {formatDateTime(session.createdAt)} · {t("sessions.expires")}: {formatDateTime(session.expiresAt)}
                  </div>
                </div>
                <div className="settingsAccountActions">
                  <DeskButton
                    className="btn btnStop"
                    type="button"
                    onClick={() => setConfirmSessionId(session.id)}
                    disabled={session.isCurrent || sessionActionBusy === session.id}
                    title={session.isCurrent ? t("sessions.currentHint") : undefined}
                  >
                    <AppIcon name="delete" />
                    {sessionActionBusy === session.id ? tCommon("deleting") : t("sessions.revoke")}
                  </DeskButton>
                </div>
              </div></DeskSurface>
            ))}
          </div>
        )}
      </div></DeskSurface>

      <DeskSurface><div className="card settingsSection" style={{ marginTop: 14 }}>
        <div className="settingsSectionHeader">
          <div style={{ fontWeight: 700 }}>{t("reset.title")}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {t("reset.description")}
        </div>
        <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
          <label style={{ fontSize: 13 }}>
            {t("reset.email")}
            <DeskInput
              className="input"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder={t("reset.emailPlaceholder")}
            />
          </label>
	          <div>
	            <DeskButton className="btn" onClick={() => void requestResetCode()} disabled={!resetEmail}>
	              <AppIcon name="mail" />
	              {t("reset.sendCode")}
	            </DeskButton>
          </div>
          <label style={{ fontSize: 13 }}>
            {t("reset.code")}
            <DeskInput
              className="input"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value)}
              maxLength={6}
              placeholder={t("reset.codePlaceholder")}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("reset.newPassword")}
            <DeskInput
              className="input"
              type="password"
              value={resetNewPassword}
              onChange={(e) => setResetNewPassword(e.target.value)}
              minLength={8}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("reset.confirmPassword")}
            <DeskInput
              className="input"
              type="password"
              value={resetConfirmPassword}
              onChange={(e) => setResetConfirmPassword(e.target.value)}
              minLength={8}
            />
          </label>
          <div>
            <DeskButton
              className="btn btnPrimary"
	              onClick={() => void confirmResetPassword()}
	              disabled={!resetEmail || resetCode.length !== 6 || resetNewPassword.length < 8}
	            >
	              <AppIcon name="key" />
	              {t("reset.submit")}
	            </DeskButton>
          </div>
          {resetStatus ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{resetStatus}</div> : null}
          {resetDevCode ? (
            <div style={{ fontSize: 12, color: "#facc15" }}>
              {t("reset.devCode")} <b>{resetDevCode}</b>
            </div>
          ) : null}
          {resetError ? <div style={{ fontSize: 12, color: "#ff6b6b" }}>{resetError}</div> : null}
        </div>
      </div></DeskSurface>

      {error ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 8 }}>{error}</div> : null}
      <AdminConfirmDialog
        open={Boolean(confirmSessionId)}
        title={t("sessions.confirmRevokeTitle")}
        description={t("sessions.confirmRevokeDescription")}
        confirmLabel={t("sessions.revoke")}
        loading={Boolean(confirmSessionId && sessionActionBusy === confirmSessionId)}
        onCancel={() => setConfirmSessionId(null)}
        onConfirm={() => {
          if (confirmSessionId) void revokeSession(confirmSessionId);
        }}
      />
      <AdminConfirmDialog
        open={confirmRevokeOthers}
        title={t("sessions.confirmRevokeOthersTitle")}
        description={t("sessions.confirmRevokeOthersDescription")}
        confirmLabel={t("sessions.revokeOthers")}
        loading={sessionActionBusy === "others"}
        onCancel={() => setConfirmRevokeOthers(false)}
        onConfirm={() => void revokeOtherSessions()}
      />
    </div>
  );
}
