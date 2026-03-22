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
      <AdminPageHeader title="System" description="Operational system summary plus links to legacy superadmin tools that are not yet absorbed into the new platform admin." />
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

          <AdminDetailSection title="Legacy Tools">
            <div className="adminLegacyLinkGrid">
              {(data.legacyLinks ?? []).map((href: string) => (
                <Link key={href} href={withLocalePath(href, locale)} className="adminLegacyLink">
                  {href.replace("/admin/legacy/", "")}
                </Link>
              ))}
            </div>
          </AdminDetailSection>
        </div>
      ) : null}
    </div>
  );
}
