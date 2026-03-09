"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type PilotSummaryResponse = {
  settings: {
    enabled: boolean;
    allowedUserIds: string[];
    allowedWorkspaceIds: string[];
    updatedAt?: string | null;
  };
  counts: {
    configuredUsers: number;
    resolvedUsers: number;
    configuredWorkspaces: number;
    resolvedWorkspaces: number;
    hyperliquidDemoVaults: number;
    hyperliquidDemoGridBots: number;
    activeHyperliquidDemoGridBots: number;
    issueCount: number;
  };
  recentEvents: Array<{
    id: string;
    kind: string;
    createdAt: string;
    provider?: string | null;
    action?: string | null;
    result?: string | null;
    reason?: string | null;
    botVaultId?: string | null;
    gridInstanceId?: string | null;
    botId?: string | null;
    executionStatus?: string | null;
    gridState?: string | null;
    templateName?: string | null;
    symbol?: string | null;
    userEmail?: string | null;
    providerSelectionReason?: string | null;
    pilotScope?: string | null;
    message?: string | null;
  }>;
  updatedAt: string;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminGridHyperliquidPilotPage() {
  const t = useTranslations("admin.gridHyperliquidPilot");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PilotSummaryResponse | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const payload = await apiGet<PilotSummaryResponse>("/admin/grid-hyperliquid-pilot");
        setData(payload);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  return (
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">{t("subtitle")}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link className="btn" href={withLocalePath("/admin/vault-execution", locale)}>
          {t("backToVaultExecution")}
        </Link>
      </div>

      {loading ? <div className="settingsMutedText">{tCommon("loading")}</div> : null}
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}

      {data ? (
        <>
          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("statusTitle")}</h3>
              <div className="settingsSectionMeta">
                {t("updatedAt")}: {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : t("never")}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div className="card" style={{ padding: 10 }}>
                <strong>{t("enabled")}</strong>
                <div>{data.settings.enabled ? t("enabledYes") : t("enabledNo")}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{t("allowlistedUsers")}</strong>
                <div>{data.counts.resolvedUsers} / {data.counts.configuredUsers}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{t("allowlistedWorkspaces")}</strong>
                <div>{data.counts.resolvedWorkspaces} / {data.counts.configuredWorkspaces}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{t("demoGridBots")}</strong>
                <div>{data.counts.hyperliquidDemoGridBots}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{t("demoGridBotsActive")}</strong>
                <div>{data.counts.activeHyperliquidDemoGridBots}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{t("demoVaults")}</strong>
                <div>{data.counts.hyperliquidDemoVaults}</div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{t("issues")}</strong>
                <div>{data.counts.issueCount}</div>
              </div>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("recentEventsTitle")}</h3>
            </div>
            {data.recentEvents.length === 0 ? (
              <div className="settingsMutedText">{t("noRecentEvents")}</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {data.recentEvents.map((event) => (
                  <div key={event.id} className="card" style={{ padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <strong>{event.kind}</strong>
                      <span className="settingsMutedText">{new Date(event.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="settingsMutedText" style={{ marginTop: 6 }}>
                      {event.templateName ?? t("unknownTemplate")} · {event.symbol ?? "n/a"} · {event.provider ?? "n/a"}
                    </div>
                    <div className="settingsMutedText" style={{ marginTop: 6 }}>
                      {t("eventLine", {
                        action: event.action ?? "n/a",
                        result: event.result ?? "n/a",
                        status: event.executionStatus ?? "n/a",
                        gridState: event.gridState ?? "n/a"
                      })}
                    </div>
                    <div className="settingsMutedText" style={{ marginTop: 6 }}>
                      {t("selectionLine", {
                        reason: event.providerSelectionReason ?? "n/a",
                        scope: event.pilotScope ?? "n/a",
                        user: event.userEmail ?? "n/a"
                      })}
                    </div>
                    {event.message ? (
                      <div style={{ marginTop: 8 }}>{event.message}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
