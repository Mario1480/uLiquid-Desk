"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type ExchangeOption = {
  value: string;
  label: string;
  enabled: boolean;
};

type VenueHealthSummaryResponse = {
  updatedAt: string;
  counts: {
    clean: number;
    warning: number;
    blocked: number;
    unknown: number;
  };
  items: Array<{
    venue: string;
    label: string;
    health: "clean" | "warning" | "blocked" | "unknown";
    allowed: boolean;
    runtimeEnabled: boolean;
    connectorKind: string;
    accountCount: number;
    activeAccountCount: number;
    syncErrorCount: number;
    lastUsedAt: string | null;
    latestSyncErrorAt: string | null;
    latestSyncErrorMessage: string | null;
    capabilities: {
      supportsPerpExecution: boolean;
      supportsPositionReads: boolean;
      supportsBalanceReads: boolean;
      supportsOrderEditing: boolean;
      supportsPositionTpSl: boolean;
      supportsPositionClose: boolean;
      supportsGridExecution: boolean;
      supportsVaultExecution: boolean;
      supportsTransfers: boolean;
    };
  }>;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "n/a" : parsed.toLocaleString();
}

function healthTone(value: "clean" | "warning" | "blocked" | "unknown"): CSSProperties {
  if (value === "clean") {
    return { color: "#166534", background: "rgba(34, 197, 94, 0.14)", borderColor: "rgba(34, 197, 94, 0.28)" };
  }
  if (value === "warning") {
    return { color: "#92400e", background: "rgba(245, 158, 11, 0.14)", borderColor: "rgba(245, 158, 11, 0.28)" };
  }
  if (value === "blocked") {
    return { color: "#991b1b", background: "rgba(239, 68, 68, 0.14)", borderColor: "rgba(239, 68, 68, 0.28)" };
  }
  return { color: "var(--muted)", background: "rgba(148, 163, 184, 0.12)", borderColor: "rgba(148, 163, 184, 0.22)" };
}

export default function AdminExchangesPage() {
  const t = useTranslations("admin.exchanges");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);
  const [venueSummary, setVenueSummary] = useState<VenueHealthSummaryResponse | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsSuperadmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsSuperadmin(true);

      const [exchangesRes, venueSummaryRes] = await Promise.all([
        apiGet<{ options: ExchangeOption[] }>("/admin/settings/exchanges"),
        apiGet<VenueHealthSummaryResponse>("/admin/venue-health/summary")
      ]);
      setExchangeOptions(exchangesRes.options ?? []);
      setVenueSummary(venueSummaryRes);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveExchanges() {
    setError(null);
    setNotice(null);
    try {
      const allowed = exchangeOptions.filter((item) => item.enabled).map((item) => item.value);
      const res = await apiPut<{ options: ExchangeOption[] }>("/admin/settings/exchanges", { allowed });
      setExchangeOptions(res.options ?? []);
      setNotice(t("messages.saved"));
      void loadAll();
    } catch (e) {
      setError(errMsg(e));
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
        <button className="btn" type="button" onClick={() => void loadAll()} disabled={loading}>
          {loading ? t("loading") : t("refresh")}
        </button>
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">
          {notice}
        </div>
      ) : null}

      {isSuperadmin ? (
        <>
          {venueSummary ? (
            <section className="card settingsSection">
              <div className="settingsSectionHeader">
                <h3 style={{ margin: 0 }}>{t("healthTitle")}</h3>
              </div>
              <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                {t("healthUpdated", { updatedAt: fmtDate(venueSummary.updatedAt) })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 10 }}>
                <div className="card" style={{ padding: 10 }}><strong>{t("healthCards.clean")}</strong><div>{venueSummary.counts.clean}</div></div>
                <div className="card" style={{ padding: 10 }}><strong>{t("healthCards.warning")}</strong><div>{venueSummary.counts.warning}</div></div>
                <div className="card" style={{ padding: 10 }}><strong>{t("healthCards.blocked")}</strong><div>{venueSummary.counts.blocked}</div></div>
                <div className="card" style={{ padding: 10 }}><strong>{t("healthCards.unknown")}</strong><div>{venueSummary.counts.unknown}</div></div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {venueSummary.items.map((item) => (
                  <div key={item.venue} className="card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div>
                        <strong>{item.label}</strong>
                        <div className="settingsMutedText" style={{ marginTop: 4 }}>
                          {t("healthMeta", {
                            connectorKind: item.connectorKind,
                            accounts: String(item.accountCount),
                            active: String(item.activeAccountCount),
                            syncErrors: String(item.syncErrorCount)
                          })}
                        </div>
                      </div>
                      <span
                        style={{
                          ...healthTone(item.health),
                          borderWidth: 1,
                          borderStyle: "solid",
                          borderRadius: 999,
                          padding: "4px 10px",
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase"
                        }}
                      >
                        {t(`healthStatus.${item.health}`)}
                      </span>
                    </div>

                    <div className="settingsMutedText" style={{ marginTop: 8 }}>
                      {t("healthFlags", {
                        allowed: item.allowed ? t("yes") : t("no"),
                        runtimeEnabled: item.runtimeEnabled ? t("yes") : t("no"),
                        lastUsedAt: fmtDate(item.lastUsedAt)
                      })}
                    </div>

                    {item.latestSyncErrorMessage ? (
                      <div className="settingsMutedText" style={{ marginTop: 6, color: "var(--danger, #b91c1c)" }}>
                        {t("healthError", {
                          at: fmtDate(item.latestSyncErrorAt),
                          error: item.latestSyncErrorMessage
                        })}
                      </div>
                    ) : null}

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                      {Object.entries(item.capabilities).map(([key, value]) => (
                        <span
                          key={`${item.venue}-${key}`}
                          style={{
                            borderRadius: 999,
                            padding: "4px 8px",
                            fontSize: 12,
                            border: "1px solid var(--color-border-default)",
                            background: value ? "rgba(34, 197, 94, 0.1)" : "rgba(148, 163, 184, 0.12)",
                            color: value ? "#166534" : "var(--muted)"
                          }}
                        >
                          {t(`capabilities.${key}`)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("sectionTitle")}</h3>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {t("description")}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {exchangeOptions.map((option, idx) => (
                <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={option.enabled}
                    onChange={(e) =>
                      setExchangeOptions((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, enabled: e.target.checked } : item))
                      )
                    }
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btnPrimary" onClick={() => void saveExchanges()}>
                {t("save")}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
