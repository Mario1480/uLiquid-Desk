"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ApiError, apiGet } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type AffiliateOverviewResponse = {
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
  latestAccruals: Array<{
    id: string;
    status: string;
    affiliateAmountUsd: number;
    affiliateFeeRatePct: number;
    accruedAt: string | null;
    referredUser: { email: string } | null;
    botVault: { gridInstanceId: string | null; vaultAddress: string | null } | null;
  }>;
  referralPath: string;
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function SettingsAffiliatePage() {
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AffiliateOverviewResponse | null>(null);
  const [origin, setOrigin] = useState("");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const payload = await apiGet<AffiliateOverviewResponse>("/settings/affiliate");
        setData(payload);
      } catch (loadError) {
        setError(errMsg(loadError));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const referralLink = useMemo(() => {
    if (!data?.referralPath) return "";
    return `${origin}${withLocalePath(data.referralPath, locale)}`;
  }, [data?.referralPath, locale, origin]);

  async function copyReferralLink() {
    if (!referralLink || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(referralLink);
    setCopyNotice("Referral link copied.");
    window.setTimeout(() => setCopyNotice(null), 1800);
  }

  return (
    <div className="settingsWrap" style={{ maxWidth: 1100 }}>
      <div className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h2 style={{ margin: 0 }}>Affiliate</h2>
            <div className="settingsSectionMeta">Referral code, accrued earnings and latest affiliate events.</div>
          </div>
          <Link href={withLocalePath("/settings", locale)} className="btn">Back to settings</Link>
        </div>
      </div>

      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {copyNotice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{copyNotice}</div> : null}

      <section className="adminStatsGrid">
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Referral Code</div>
          <div className="adminStatsValue adminStatsValueSmall">{data?.profile.code ?? "—"}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Affiliate Fee %</div>
          <div className="adminStatsValue">{(data?.effectiveFeeRatePct ?? 0).toFixed(2)}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Referred Users</div>
          <div className="adminStatsValue">{data?.stats.referredUsers ?? 0}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Unpaid</div>
          <div className="adminStatsValue">${(data?.stats.unpaidAffiliateUsd ?? 0).toFixed(2)}</div>
        </div>
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>Referral Link</h3>
            <div className="settingsSectionMeta">Registration capture is wired to the `ref` query parameter.</div>
          </div>
        </div>
        {loading ? <div className="settingsMutedText">Loading affiliate dashboard…</div> : null}
        <div className="settingsField">
          <span className="settingsFieldLabel">Link</span>
          <input className="input" readOnly value={referralLink} placeholder="Referral link will appear here" />
        </div>
        <div className="settingsActions">
          <button className="btn btnPrimary" type="button" onClick={() => void copyReferralLink()} disabled={!referralLink}>
            Copy link
          </button>
        </div>
        {data?.referredBy ? (
          <div className="settingsMutedText">
            You are referred by {data.referredBy.email} since {formatDateTime(data.referredBy.assignedAt)}.
          </div>
        ) : null}
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>Latest Accruals</h3>
            <div className="settingsSectionMeta">This stays empty until real profit-share events create affiliate accruals.</div>
          </div>
        </div>
        {!data || data.latestAccruals.length === 0 ? (
          <div className="settingsMutedText">No affiliate accruals yet.</div>
        ) : (
          <div className="adminListStack">
            {data.latestAccruals.map((item) => (
              <div key={item.id} className="adminListCard">
                <div className="adminListCardTop">
                  <strong>${item.affiliateAmountUsd.toFixed(2)}</strong>
                  <span className="settingsMutedText">{item.status}</span>
                </div>
                <div className="settingsMutedText">
                  {item.referredUser?.email ?? "Unknown user"} • {item.affiliateFeeRatePct.toFixed(2)}% • {formatDateTime(item.accruedAt)}
                </div>
                <div className="settingsMutedText">
                  Vault {item.botVault?.gridInstanceId ?? item.botVault?.vaultAddress ?? "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
