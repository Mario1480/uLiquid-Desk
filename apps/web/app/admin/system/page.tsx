"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { apiGet } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import AdminDetailSection from "../_components/AdminDetailSection";
import AdminPageHeader from "../_components/AdminPageHeader";
import { adminErrMsg, formatDateTime } from "../_components/admin-client";

export default function AdminSystemPage() {
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const systemGroups = [
    {
      title: "Access & Maintenance",
      description: "Maintenance mode, access limits, and platform visibility controls.",
      links: [{ href: "/admin/system/access", label: "Open access controls" }]
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
        { href: "/admin/system/integrations/server-info", label: "Server Info" }
      ]
    },
    {
      title: "AI & Prediction Controls",
      description: "Prompt templates, AI tracing, indicators, prediction defaults, and strategy tooling.",
      links: [
        { href: "/admin/system/ai/prompts", label: "Prompts" },
        { href: "/admin/system/ai/trace", label: "Trace" },
        { href: "/admin/system/ai/indicator-settings", label: "Indicators" },
        { href: "/admin/system/ai/prediction-defaults", label: "Prediction Defaults" },
        { href: "/admin/system/ai/prediction-refresh", label: "Prediction Refresh" },
        { href: "/admin/system/ai/strategies", label: "Strategies" },
        { href: "/admin/system/ai/grid-templates", label: "Grid Templates" }
      ]
    },
    {
      title: "Vault & Execution Controls",
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
        const next = await apiGet("/admin/system");
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
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {data ? (
        <div className="adminDetailGrid">
          <AdminDetailSection title="Current Summary">
            <div className="adminKeyValueList">
              <div className="adminKeyValueRow"><span>Maintenance</span><strong>{data.maintenance?.enabled ? "enabled" : "disabled"}</strong></div>
              <div className="adminKeyValueRow"><span>Maintenance Message</span><strong>{data.maintenance?.message ?? "—"}</strong></div>
              <div className="adminKeyValueRow"><span>Server IP</span><strong>{data.serverInfo?.serverIpAddress ?? "—"}</strong></div>
              <div className="adminKeyValueRow"><span>Server Info Updated</span><strong>{formatDateTime(data.serverInfo?.updatedAt)}</strong></div>
              <div className="adminKeyValueRow"><span>Billing Enabled</span><strong>{data.billing?.billingEnabled ? "yes" : "no"}</strong></div>
              <div className="adminKeyValueRow"><span>Webhook Enabled</span><strong>{data.billing?.billingWebhookEnabled ? "yes" : "no"}</strong></div>
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
