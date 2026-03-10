"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type VaultSafetyResponse = {
  haltNewOrders: boolean;
  closeOnlyAllUserIds: string[];
  reason: string | null;
  updatedByUserId: string | null;
  updatedAt: string | null;
  source: "db" | "default";
};

type CloseOnlyAllResponse = {
  ok: true;
  safety: VaultSafetyResponse;
  result: {
    userId: string;
    scanned: number;
    updated: number;
    failed: Array<{ botVaultId: string; reason: string }>;
  };
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function parseUserIds(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

export default function AdminVaultSafetyPage() {
  const t = useTranslations("admin.vaultSafety");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<VaultSafetyResponse | null>(null);
  const [haltNewOrders, setHaltNewOrders] = useState(false);
  const [closeOnlyUsersInput, setCloseOnlyUsersInput] = useState("");
  const [reason, setReason] = useState("");
  const [closeOnlyTargetUserId, setCloseOnlyTargetUserId] = useState("");
  const [lastCloseOnlyResult, setLastCloseOnlyResult] = useState<CloseOnlyAllResponse["result"] | null>(null);

  const parsedCloseOnlyUsers = useMemo(() => parseUserIds(closeOnlyUsersInput), [closeOnlyUsersInput]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsAdmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsAdmin(true);
      const payload = await apiGet<VaultSafetyResponse>("/admin/settings/vault-safety");
      setSettings(payload);
      setHaltNewOrders(payload.haltNewOrders);
      setCloseOnlyUsersInput(payload.closeOnlyAllUserIds.join("\n"));
      setReason(payload.reason ?? "");
      setLastCloseOnlyResult(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPut<VaultSafetyResponse>("/admin/settings/vault-safety", {
        haltNewOrders,
        closeOnlyAllUserIds: parsedCloseOnlyUsers,
        reason: reason.trim() || undefined
      });
      setSettings(payload);
      setHaltNewOrders(payload.haltNewOrders);
      setCloseOnlyUsersInput(payload.closeOnlyAllUserIds.join("\n"));
      setReason(payload.reason ?? "");
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function triggerCloseOnlyAll() {
    const userId = closeOnlyTargetUserId.trim();
    if (!userId) {
      setError(t("messages.userIdRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPost<CloseOnlyAllResponse>(`/admin/users/${encodeURIComponent(userId)}/vaults/close-only-all`, {
        reason: reason.trim() || "admin_close_only_all",
        idempotencyKey: `admin-close-only-all:${userId}:${Date.now()}`
      });
      setSettings(payload.safety);
      setHaltNewOrders(payload.safety.haltNewOrders);
      setCloseOnlyUsersInput(payload.safety.closeOnlyAllUserIds.join("\n"));
      setReason(payload.safety.reason ?? "");
      setLastCloseOnlyResult(payload.result);
      setNotice(t("messages.closeOnlyTriggered"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">{t("subtitle")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link className="btn" href={withLocalePath("/admin", locale)}>
          {tCommon("backToAdmin")}
        </Link>
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}

      {isAdmin ? (
        <>
          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("sectionTitle")}</h3>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {t("sourceLabel")}: {settings?.source ?? "default"} · {t("lastUpdatedLabel")}: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={haltNewOrders}
                onChange={(event) => setHaltNewOrders(event.target.checked)}
              />
              <span>{t("haltNewOrdersLabel")}</span>
            </label>

            <div className="settingsFormGrid">
              <label>
                {t("closeOnlyUsersLabel")}
                <textarea
                  className="input"
                  rows={6}
                  value={closeOnlyUsersInput}
                  onChange={(event) => setCloseOnlyUsersInput(event.target.value)}
                  placeholder={t("userListPlaceholder")}
                />
              </label>
              <label>
                {t("reasonLabel")}
                <textarea
                  className="input"
                  rows={6}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("reasonPlaceholder")}
                />
              </label>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
                {saving ? tCommon("saving") : t("save")}
              </button>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("closeOnlyAllTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 12 }}>
              {t("closeOnlyAllHint")}
            </div>

            <div className="settingsFormGrid">
              <label>
                {t("targetUserIdLabel")}
                <input
                  className="input"
                  value={closeOnlyTargetUserId}
                  onChange={(event) => setCloseOnlyTargetUserId(event.target.value)}
                  placeholder={t("targetUserIdPlaceholder")}
                />
              </label>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={() => void triggerCloseOnlyAll()} disabled={saving}>
                {saving ? tCommon("saving") : t("triggerCloseOnlyAll")}
              </button>
            </div>

            {lastCloseOnlyResult ? (
              <div style={{ marginTop: 14, fontSize: 13 }}>
                <strong>{t("lastResultTitle")}</strong>
                <div>{t("resultScanned", { count: lastCloseOnlyResult.scanned })}</div>
                <div>{t("resultUpdated", { count: lastCloseOnlyResult.updated })}</div>
                <div>{t("resultFailed", { count: lastCloseOnlyResult.failed.length })}</div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
