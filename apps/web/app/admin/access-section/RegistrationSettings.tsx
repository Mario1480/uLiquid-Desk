"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPut } from "../../../lib/api";
import { AppIcon } from "../../components/AppIcon";

export default function RegistrationSettings() {
  const t = useTranslations("admin.accessSection");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet<{ enabled: boolean }>("/admin/settings/registration")
      .then((result) => { if (active) setEnabled(result.enabled); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  async function save() {
    if (enabled === null) return;
    setSaving(true);
    setError(false);
    setSaved(false);
    try {
      const result = await apiPut<{ enabled: boolean }>("/admin/settings/registration", { enabled });
      setEnabled(result.enabled);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DeskSurface dense><section className="card settingsSection">
      <div className="settingsSectionHeader">
        <h3 className="adminSubsectionTitle">{t("registrationTitle")}</h3>
      </div>
      {error ? <div className="settingsAlert settingsAlertError" role="alert">{t("registrationError")}</div> : null}
      {saved ? <div className="settingsAlert settingsAlertSuccess" role="status">{t("registrationSaved")}</div> : null}
      {enabled === null && !error ? <div className="settingsMutedText">{t("loading")}</div> : null}
      <div className="billingFeatureToggleList">
        <label className="billingFeatureToggle">
          <span>
            <strong><AppIcon name="users" /> {t("registrationEnabled")}</strong>
            <small>{t("registrationHint")}</small>
          </span>
          <DeskInput type="checkbox" checked={enabled ?? false} disabled={enabled === null || saving}
            onChange={(event) => { setEnabled(event.target.checked); setSaved(false); }} />
        </label>
      </div>
      <div className="adminInlineActions">
        <DeskButton className="btn btnPrimary" type="button" disabled={enabled === null || saving} onClick={() => void save()}>
          <AppIcon name="save" /> {saving ? t("saving") : t("saveSettings")}
        </DeskButton>
      </div>
    </section></DeskSurface>
  );
}
