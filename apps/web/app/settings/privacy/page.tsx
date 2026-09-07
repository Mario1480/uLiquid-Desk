"use client";
import { DeskLink } from "@/components/desk/DeskLink";
import { DeskBadge } from "@/components/desk/DeskBadge";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import AdminConfirmDialog from "../../admin/_components/AdminConfirmDialog";
import { AppIcon } from "../../components/AppIcon";
import { Notice, PageHeader } from "../../components/ui";

type MeResponse = {
  user?: {
    email?: string | null;
  };
};

type AccountDeletionBlocker = {
  code: string;
  count: number;
};

type AccountDeletionSummary = {
  canDelete: boolean;
  superadminBlocked?: boolean;
  blockers: AccountDeletionBlocker[];
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

export default function PrivacySettingsPage() {
  const t = useTranslations("settings.privacy");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [email, setEmail] = useState("");
  const [summary, setSummary] = useState<AccountDeletionSummary | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const confirmationReady = useMemo(
    () => confirmEmail.trim().toLowerCase() === email.trim().toLowerCase() && confirmText.trim() === "DELETE",
    [confirmEmail, confirmText, email]
  );

  function blockerMessage(blocker: AccountDeletionBlocker): string {
    if (blocker.code === "running_bots") return t("delete.blockers.running_bots", { count: blocker.count });
    if (blocker.code === "active_grid_bots") return t("delete.blockers.active_grid_bots", { count: blocker.count });
    if (blocker.code === "active_bot_vaults") return t("delete.blockers.active_bot_vaults", { count: blocker.count });
    if (blocker.code === "funded_bot_vaults") return t("delete.blockers.funded_bot_vaults", { count: blocker.count });
    if (blocker.code === "funded_funding_vaults") return t("delete.blockers.funded_funding_vaults", { count: blocker.count });
    return `${blocker.code}: ${blocker.count}`;
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [me, deletion] = await Promise.all([
        apiGet<MeResponse>("/auth/me"),
        apiGet<AccountDeletionSummary>("/settings/account-deletion")
      ]);
      setEmail(me.user?.email ?? "");
      setSummary(deletion);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await apiPost<{ ok: boolean; deletedAt: string }>("/settings/account/delete", {
        confirmEmail: confirmEmail.trim(),
        confirmText: confirmText.trim()
      });
      setNotice(t("delete.messages.deleted"));
      window.location.href = withLocalePath("/login", locale);
    } catch (err) {
      setError(errMsg(err));
      setConfirmOpen(false);
      await loadAll();
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  return (
    <div className="settingsWrap">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={(
          <DeskLink className="btn" href={withLocalePath("/settings", locale)}>
            <AppIcon name="back" />
            {tCommon("backToSettings")}
          </DeskLink>
        )}
      />

      {error ? (
        <Notice tone="danger" dismissible onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Notice>
      ) : null}

      <DeskSurface><section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <div className="settingsInlineTitle">{t("export.title")}</div>
            <div className="settingsMutedText">{t("export.description")}</div>
          </div>
          <DeskBadge className="badge">
            <AppIcon name="download" />
            {t("export.status")}
          </DeskBadge>
        </div>
        <div className="settingsMutedText">{t("export.meta")}</div>
      </section></DeskSurface>

      <DeskSurface><section className="card settingsSection settingsDangerSection">
        <div className="settingsSectionHeader">
          <div>
            <div className="settingsInlineTitle">{t("delete.title")}</div>
            <div className="settingsMutedText">{t("delete.description")}</div>
          </div>
          <DeskButton className="btn" type="button" onClick={loadAll} disabled={loading}>
            <AppIcon name="refresh" />
            {tCommon("reload")}
          </DeskButton>
        </div>

        {loading ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : (
          <div className="settingsFormGrid">
            {summary?.superadminBlocked ? (
              <Notice tone="warning">{t("delete.superadminBlocked")}</Notice>
            ) : null}

            {(summary?.blockers ?? []).length > 0 ? (
              <Notice tone="warning">
                <div className="settingsInlineTitle">{t("delete.blockedTitle")}</div>
                <div className="settingsMutedText">{t("delete.blockedDescription")}</div>
                <ul className="settingsBlockerList">
                  {summary?.blockers.map((blocker) => (
                    <li key={blocker.code}>
                      {blockerMessage(blocker)}
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : (
              <Notice tone="danger">{t("delete.readyNotice")}</Notice>
            )}

            <div className="settingsFormGrid settingsTwoColGrid">
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("delete.confirmEmail")}</span>
                <DeskInput
                  className="input"
                  value={confirmEmail}
                  onChange={(event) => setConfirmEmail(event.target.value)}
                  placeholder={email || "email@example.com"}
                  autoComplete="off"
                />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("delete.confirmText")}</span>
                <DeskInput
                  className="input"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </label>
            </div>

            <div className="settingsHubInlineActions">
              <DeskButton
                className="btn btnStop"
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={!summary?.canDelete || Boolean(summary?.superadminBlocked) || !confirmationReady || deleting}
              >
                <AppIcon name="delete" />
                {deleting ? t("delete.deleting") : t("delete.action")}
              </DeskButton>
            </div>
          </div>
        )}
      </section></DeskSurface>

      <AdminConfirmDialog
        open={confirmOpen}
        title={t("delete.confirmDialogTitle")}
        description={t("delete.confirmDialogDescription")}
        confirmLabel={t("delete.confirmDialogAction")}
        cancelLabel={t("delete.confirmDialogCancel")}
        tone="danger"
        loading={deleting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void deleteAccount()}
      />
    </div>
  );
}
