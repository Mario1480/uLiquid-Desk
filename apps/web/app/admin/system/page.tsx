"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { apiGet } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { AppIcon, type AppIconName } from "../../components/AppIcon";
import AdminDetailSection from "../_components/AdminDetailSection";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";
import { adminErrMsg, formatDateTime } from "../_components/admin-client";

type RuntimeSystemStatus = {
  sampledAt: string;
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  hostUptimeSeconds: number;
  cpu: {
    cores: number;
    loadAverage1m: number;
    loadAverage5m: number;
    loadAverage15m: number;
    loadPercent1m: number | null;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number | null;
  };
  process: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
};

type AdminSystemResponse = {
  maintenance: {
    enabled: boolean;
    message: string | null;
  } | null;
  serverInfo: {
    serverIpAddress: string | null;
    updatedAt: string | null;
    source: string;
  } | null;
  billing: {
    billingEnabled: boolean;
    updatedAt: string | null;
    source: string;
  } | null;
  vpsStatus?: RuntimeSystemStatus | null;
};

function iconForSystemLink(href: string): AppIconName {
  if (href.includes("api-keys")) return "key";
  if (href.includes("exchanges")) return "exchange";
  if (href.includes("server-info")) return "server";
  if (href.includes("telegram")) return "telegram";
  if (href.includes("smtp")) return "mail";
  if (href.includes("grid-template")) return "grid";
  if (href.includes("bots")) return "bots";
  if (href.includes("prediction")) return "predictions";
  if (href.includes("strategies")) return "strategies";
  if (href.includes("vaults")) return "vaults";
  if (href.includes("ai")) return "ai";
  if (href.includes("access")) return "shield";
  return "open";
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex <= 1 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatCpuLoad(status: RuntimeSystemStatus | null | undefined): string {
  if (!status) return "—";
  return `${status.cpu.loadAverage1m.toFixed(2)} / ${status.cpu.cores} cores (${formatPercent(status.cpu.loadPercent1m)})`;
}

function formatMemoryUsage(status: RuntimeSystemStatus | null | undefined): string {
  if (!status) return "—";
  return `${formatBytes(status.memory.usedBytes)} / ${formatBytes(status.memory.totalBytes)} (${formatPercent(status.memory.usedPercent)})`;
}

export default function AdminSystemPage() {
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminSystemResponse | null>(null);
  const systemGroups = [
    {
      title: "Access & Maintenance",
      description: "Maintenance mode, access limits, and platform visibility controls.",
      links: [{ href: "/admin/system/access", label: "Open access controls" }]
    },
    {
      title: "AI & Prediction",
      description: "AI prompts, traces, indicators, default prediction behavior, and refresh operations.",
      links: [
        { href: "/admin/system/ai/prompts", label: "Prompts" },
        { href: "/admin/system/ai/trace", label: "Trace" },
        { href: "/admin/system/ai/indicator-settings", label: "Indicators" },
        { href: "/admin/system/ai/prediction-defaults", label: "Prediction Defaults" },
        { href: "/admin/system/ai/prediction-refresh", label: "Prediction Refresh" }
      ]
    },
    {
      title: "Bots, Grid & Strategies",
      description: "Operational bot inventory, grid templates, and direct strategy editors without an extra strategy landing page.",
      links: [
        { href: "/admin/bots", label: "Normal Bots" },
        { href: "/admin/system/bots/grid-templates", label: "Grid Bots" },
        { href: "/admin/system/bots/strategies/local", label: "Local Strategies" },
        { href: "/admin/system/bots/strategies/ai", label: "AI Strategies" },
        { href: "/admin/system/bots/strategies/builder", label: "Strategy Builder" },
        { href: "/admin/system/bots/strategies/ai-generator", label: "AI Generator" }
      ]
    },
    {
      title: "Notifications",
      description: "SMTP and Telegram delivery settings for platform alerts and operational messaging.",
      links: [
        { href: "/admin/system/notifications/smtp", label: "SMTP" },
        { href: "/admin/system/notifications/telegram", label: "Telegram" }
      ]
    },
    {
      title: "Integrations & Secrets",
      description: "API keys, exchange configuration, and server environment metadata.",
      links: [
        { href: "/admin/system/integrations/api-keys", label: "API Keys" },
        { href: "/admin/system/integrations/exchanges", label: "Exchanges" },
        { href: "/admin/system/integrations/server-info", label: "Server Info" },
        { href: "/admin/system/ui-components", label: "Ein UI Components" }
      ]
    },
    {
      title: "Vault & Execution",
      description: "Vault execution mode, pilot access, safety controls, and operational health views.",
      links: [
        { href: "/admin/system/vaults/execution", label: "Execution" },
        { href: "/admin/system/vaults/operations", label: "Operations" },
        { href: "/admin/system/vaults/safety", label: "Safety" },
        { href: "/admin/system/vaults/grid-hyperliquid-pilot", label: "Pilot" }
      ]
    }
  ];

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await apiGet<AdminSystemResponse>("/admin/system");
        if (!active) return;
        setData(next);
      } catch (loadError) {
        if (!active) return;
        setError(adminErrMsg(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="Platform Controls"
        title="System"
        description="Platform configuration, integrations, AI controls, and vault operations are now grouped here under the strict superadmin admin shell."
      />
      {loading ? <div className="settingsMutedText">Loading system state…</div> : null}
      {error ? <AdminNotice tone="danger">{error}</AdminNotice> : null}
      {data ? (
        <div className="adminDetailGrid">
          <AdminDetailSection title="Current Summary">
            <div className="adminKeyValueList">
              <div className="adminKeyValueRow"><span>Maintenance</span><strong>{data.maintenance?.enabled ? "enabled" : "disabled"}</strong></div>
              <div className="adminKeyValueRow"><span>Maintenance Message</span><strong>{data.maintenance?.message ?? "—"}</strong></div>
              <div className="adminKeyValueRow"><span>Server IP</span><strong>{data.serverInfo?.serverIpAddress ?? "—"}</strong></div>
              <div className="adminKeyValueRow"><span>Server Info Updated</span><strong>{formatDateTime(data.serverInfo?.updatedAt)}</strong></div>
              <div className="adminKeyValueRow"><span>Billing Enabled</span><strong>{data.billing?.billingEnabled ? "yes" : "no"}</strong></div>
            </div>
            <div className="adminSystemSummaryGrid">
              <div className="adminSystemSummaryTile">
                <span>VPS Host</span>
                <strong>{data.vpsStatus?.hostname ?? "—"}</strong>
                <small>{data.vpsStatus ? `${data.vpsStatus.platform}/${data.vpsStatus.arch} · ${data.vpsStatus.nodeVersion}` : "—"}</small>
              </div>
              <div className="adminSystemSummaryTile">
                <span>CPU Load</span>
                <strong>{formatCpuLoad(data.vpsStatus)}</strong>
                <small>
                  5m {data.vpsStatus?.cpu.loadAverage5m.toFixed(2) ?? "—"} · 15m {data.vpsStatus?.cpu.loadAverage15m.toFixed(2) ?? "—"}
                </small>
              </div>
              <div className="adminSystemSummaryTile">
                <span>RAM Usage</span>
                <strong>{formatMemoryUsage(data.vpsStatus)}</strong>
                <small>Free {formatBytes(data.vpsStatus?.memory.freeBytes)}</small>
              </div>
              <div className="adminSystemSummaryTile">
                <span>Runtime</span>
                <strong>Host {formatDuration(data.vpsStatus?.hostUptimeSeconds)}</strong>
                <small>API {formatDuration(data.vpsStatus?.process.uptimeSeconds)} · RSS {formatBytes(data.vpsStatus?.process.rssBytes)}</small>
              </div>
            </div>
          </AdminDetailSection>

          <AdminDetailSection title="Integrated Control Areas">
            <div className="adminSystemGroupGrid">
              {systemGroups.map((group) => (
                <div key={group.title} className="adminSystemGroupCard">
                  <strong>{group.title}</strong>
                  <div className="settingsMutedText">{group.description}</div>
                  <div className="adminInlineActions">
                    {group.links.map((item) => (
                      <Link key={item.href} href={withLocalePath(item.href, locale)} className="btn">
                        <AppIcon name={iconForSystemLink(item.href)} />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </AdminDetailSection>
        </div>
      ) : null}
    </div>
  );
}
