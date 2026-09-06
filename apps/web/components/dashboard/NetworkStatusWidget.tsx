"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";
import { apiGet } from "../../lib/api";

type ServiceStatus = "operational" | "degraded" | "unavailable";
type NetworkStatusItem = {
  id: "hyperliquid" | "hyperEvm" | "arbitrum" | "binanceSpot" | "binancePerp";
  status: ServiceStatus;
  latencyMs: number | null;
  blockNumber: number | null;
};
type NetworkStatusResponse = {
  items: NetworkStatusItem[];
  checkedAt: string;
  degraded: boolean;
};

function badgeClass(status: ServiceStatus): string {
  if (status === "operational") return "uiStatusBadge uiStatusBadge-success";
  if (status === "degraded") return "uiStatusBadge uiStatusBadge-warning";
  return "uiStatusBadge uiStatusBadge-danger";
}

type ExchangeAccountStatus = {
  status: "connected" | "degraded" | "disconnected";
};

export default function NetworkStatusWidget({ accounts }: { accounts: ExchangeAccountStatus[] }) {
  const t = useTranslations("dashboard.networkStatus");
  const locale = useLocale();
  const [response, setResponse] = useState<NetworkStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      setResponse(await apiGet<NetworkStatusResponse>("/dashboard/network-status"));
      setError(false);
    } catch {
      setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const connectedExchangeStatus: ServiceStatus = accounts.some((account) => account.status === "disconnected")
      ? "unavailable"
      : accounts.some((account) => account.status === "degraded")
        ? "degraded"
        : "operational";

  return (
    <DeskSurface><div className="card dashboardInsightCard dashboardNetworkStatusCard dashboardWidgetCardFill">
      <div className="dashboardCompactWidgetHead">
        <div>
          <div className="dashboardCompactWidgetTitle">{t("title")}</div>
          <div className="dashboardCompactWidgetSubtitle">{t("subtitle")}</div>
        </div>
        <DeskButton type="button" className="btn" onClick={() => void load()} disabled={loading}>
          <AppIcon name="refresh" />
          {t("refresh")}
        </DeskButton>
      </div>

      {loading && !response ? <div className="dashboardCompactWidgetState">{t("loading")}</div> : null}
      {!loading && !response ? <div className="dashboardCompactWidgetState">{t("unavailable")}</div> : null}
      {response ? (
        <div className="dashboardNetworkStatusList dashboardWidgetScrollArea">
          {response.items.map((item) => (
            <div key={item.id} className="dashboardNetworkStatusRow">
              <span className={`dashboardNetworkStatusPulse dashboardNetworkStatusPulse-${item.status}`} />
              <div className="dashboardNetworkStatusIdentity">
                <strong>{t(`services.${item.id}`)}</strong>
                <span>
                  {item.blockNumber !== null
                    ? t("block", { value: new Intl.NumberFormat(locale).format(item.blockNumber) })
                    : t("marketData")}
                </span>
              </div>
              <div className="dashboardNetworkStatusMeta">
                <span className={badgeClass(item.status)}>{t(`status.${item.status}`)}</span>
                <small>{item.latencyMs === null ? "—" : `${item.latencyMs} ms`}</small>
              </div>
            </div>
          ))}
          {accounts.length > 0 ? (
            <div className="dashboardNetworkStatusRow">
              <span className={`dashboardNetworkStatusPulse dashboardNetworkStatusPulse-${connectedExchangeStatus}`} />
              <div className="dashboardNetworkStatusIdentity">
                <strong>{t("services.connectedExchanges")}</strong>
                <span>{t("accounts", { count: accounts.length })}</span>
              </div>
              <div className="dashboardNetworkStatusMeta">
                <span className={badgeClass(connectedExchangeStatus)}>{t(`status.${connectedExchangeStatus}`)}</span>
                <small>{t("syncedStatus")}</small>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="dashboardCompactWidgetFooter">
        <span>{t("readOnly")}</span>
        {response?.degraded || (accounts.length > 0 && connectedExchangeStatus !== "operational") || error
          ? <span className="dashboardWidgetInlineError">{t("degraded")}</span>
          : null}
        {response?.checkedAt ? (
          <span>{t("checked", { time: new Date(response.checkedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}</span>
        ) : null}
      </div>
    </div></DeskSurface>
  );
}
