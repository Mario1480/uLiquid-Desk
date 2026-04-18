"use client";

import { useEffect, useState } from "react";
import AdminPageHeader from "../_components/AdminPageHeader";
import { ApiError, apiGet, apiPut } from "../../../lib/api";

type AffiliateProgramSettings = {
  enabled: boolean;
  platformFeeRatePct: number;
  defaultAffiliateFeeRatePct: number;
  updatedAt: string | null;
};

type AffiliateProgramSummary = {
  settings: AffiliateProgramSettings;
  profileCount: number;
  activeReferralCount: number;
  totalAffiliateAccruedUsd: number;
  totalAffiliatePaidUsd: number;
  totalAffiliateUnpaidUsd: number;
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

export default function AdminAffiliatePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<AffiliateProgramSummary | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [platformFeeRatePct, setPlatformFeeRatePct] = useState("5");
  const [defaultAffiliateFeeRatePct, setDefaultAffiliateFeeRatePct] = useState("10");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<AffiliateProgramSummary>("/admin/affiliate/summary");
      setSummary(payload);
      setEnabled(Boolean(payload.settings.enabled));
      setPlatformFeeRatePct(String(payload.settings.platformFeeRatePct));
      setDefaultAffiliateFeeRatePct(String(payload.settings.defaultAffiliateFeeRatePct));
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPut<AffiliateProgramSettings>("/admin/settings/affiliate-program", {
        enabled,
        platformFeeRatePct: Number(platformFeeRatePct),
        defaultAffiliateFeeRatePct: Number(defaultAffiliateFeeRatePct)
      });
      setEnabled(Boolean(payload.enabled));
      setPlatformFeeRatePct(String(payload.platformFeeRatePct));
      setDefaultAffiliateFeeRatePct(String(payload.defaultAffiliateFeeRatePct));
      setNotice("Affiliate program settings saved.");
      await load();
    } catch (saveError) {
      setError(errMsg(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settingsWrap">
      <AdminPageHeader
        eyebrow="Affiliate"
        title="Affiliate Program"
        description="Global affiliate fee configuration and current accrual footprint."
      />

      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}

      <section className="adminStatsGrid">
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Profiles</div>
          <div className="adminStatsValue">{summary?.profileCount ?? 0}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Active Referrals</div>
          <div className="adminStatsValue">{summary?.activeReferralCount ?? 0}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Accrued</div>
          <div className="adminStatsValue">${(summary?.totalAffiliateAccruedUsd ?? 0).toFixed(2)}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Unpaid</div>
          <div className="adminStatsValue">${(summary?.totalAffiliateUnpaidUsd ?? 0).toFixed(2)}</div>
        </div>
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>Program Settings</h3>
            <div className="settingsSectionMeta">Foundation slice only. Settlement and vault-fee integration follows in the next implementation step.</div>
          </div>
        </div>

        {loading ? <div className="settingsMutedText">Loading affiliate settings…</div> : null}

        <div className="settingsFormGrid">
          <label className="settingsField">
            <span className="settingsFieldLabel">Program Enabled</span>
            <select className="input" value={enabled ? "enabled" : "disabled"} onChange={(event) => setEnabled(event.target.value === "enabled")}>
              <option value="disabled">disabled</option>
              <option value="enabled">enabled</option>
            </select>
          </label>

          <label className="settingsField">
            <span className="settingsFieldLabel">Platform Fee %</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={platformFeeRatePct}
              onChange={(event) => setPlatformFeeRatePct(event.target.value)}
            />
          </label>

          <label className="settingsField">
            <span className="settingsFieldLabel">Default Affiliate Fee %</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={defaultAffiliateFeeRatePct}
              onChange={(event) => setDefaultAffiliateFeeRatePct(event.target.value)}
            />
          </label>
        </div>

        <div className="settingsActions">
          <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button className="btn" type="button" onClick={() => void load()} disabled={loading || saving}>
            Reload
          </button>
        </div>
      </section>
    </div>
  );
}
