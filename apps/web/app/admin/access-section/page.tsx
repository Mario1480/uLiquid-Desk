"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { AppIcon, type AppIconName } from "../../components/AppIcon";
import AdminPageHeader from "../_components/AdminPageHeader";
import RegistrationSettings from "./RegistrationSettings";
import {
  DEFAULT_ACCESS_SECTION_MAINTENANCE,
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionAdminResponse,
  type AccessSectionVisibility
} from "../../../src/access/accessSection";

const VISIBILITY_ITEMS: Array<{ key: keyof AccessSectionVisibility; icon: AppIconName }> = [
  { key: "tradingDesk", icon: "trading" },
  { key: "bots", icon: "bots" },
  { key: "gridBots", icon: "grid" },
  { key: "agentChat", icon: "ai" },
  { key: "predictionsDashboard", icon: "predictions" },
  { key: "strategy", icon: "strategies" },
  { key: "marketIntelligence", icon: "performance" },
  { key: "economicCalendar", icon: "calendar" },
  { key: "news", icon: "news" },
  { key: "accounts", icon: "accounts" },
  { key: "uliq", icon: "billing" },
  { key: "walletFunding", icon: "wallet" },
  { key: "vaults", icon: "vaults" }
];

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

export default function AdminAccessSectionPage() {
  const t = useTranslations("admin.accessSection");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [canManageRegistration, setCanManageRegistration] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<AccessSectionAdminResponse | null>(null);
  const [visibility, setVisibility] = useState<AccessSectionVisibility>(DEFAULT_ACCESS_SECTION_VISIBILITY);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(
    DEFAULT_ACCESS_SECTION_MAINTENANCE.enabled
  );

  function applyResponse(payload: AccessSectionAdminResponse) {
    setSettings(payload);
    setVisibility(payload.visibility);
    setMaintenanceEnabled(Boolean(payload.maintenance?.enabled));
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      setCanManageRegistration(Boolean(me?.isSuperadmin));
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsSuperadmin(true);
      const payload = await apiGet<AccessSectionAdminResponse>("/admin/settings/access-section");
      applyResponse(payload);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function loadDefaults() {
    if (!settings) return;
    setVisibility(settings.defaults.visibility);
    setMaintenanceEnabled(Boolean(settings.defaults.maintenance?.enabled));
    setNotice(t("messages.defaultsLoaded"));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPut<AccessSectionAdminResponse>("/admin/settings/access-section", {
        visibility,
        maintenance: {
          enabled: maintenanceEnabled
        }
      });
      applyResponse(payload);
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader eyebrow="System" title={t("title")} description={t("subtitle")} />
      {canManageRegistration ? <RegistrationSettings /> : null}

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <DeskSurface dense><div className="card settingsSection settingsAlert settingsAlertError">{error}</div></DeskSurface>
      ) : null}
      {notice ? (
        <DeskSurface dense><div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div></DeskSurface>
      ) : null}

      {isSuperadmin ? (
        <DeskSurface dense><section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 className="adminSubsectionTitle">{t("sectionTitle")}</h3>
            <div className="settingsSectionMeta">
              {t("sourceLabel")}: {settings?.source ?? "default"} · {t("lastUpdatedLabel")}:{" "}
              {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
            </div>
          </div>

          <div className="billingFeatureToggleList">
            <label className="billingFeatureToggle">
              <span>
                <strong><AppIcon name="settings" /> {t("maintenanceTitle")}</strong>
                <small>{t("maintenanceHint")}</small>
              </span>
              <DeskInput
                type="checkbox"
                checked={maintenanceEnabled}
                onChange={(event) => setMaintenanceEnabled(event.target.checked)}
                aria-label={t("maintenanceEnabledLabel")}
              />
            </label>
          </div>

          <div className="settingsSectionHeader">
            <h4 className="adminSubsectionTitle">{t("visibilityTitle")}</h4>
          </div>
          <div className="billingFeatureToggleList">
            {VISIBILITY_ITEMS.map((item) => (
              <label className="billingFeatureToggle" key={item.key}>
                <span>
                  <strong><AppIcon name={item.icon} /> {t(`visibility.${item.key}` as any)}</strong>
                </span>
                <DeskInput
                  type="checkbox"
                  checked={visibility[item.key]}
                  onChange={(event) => setVisibility((prev) => ({
                    ...prev,
                    [item.key]: event.target.checked
                  }))}
                />
              </label>
            ))}
          </div>

          <div className="adminInlineActions">
            <DeskButton className="btn" type="button" onClick={loadDefaults}>
              <AppIcon name="restore" />
              {t("loadDefaults")}
            </DeskButton>
            <DeskButton
              className="btn btnPrimary"
              type="button"
              onClick={() => void save()}
              disabled={saving}
            >
              <AppIcon name="save" />
              {saving ? t("saving") : t("saveSettings")}
            </DeskButton>
          </div>
        </section></DeskSurface>
      ) : null}
    </div>
  );
}
