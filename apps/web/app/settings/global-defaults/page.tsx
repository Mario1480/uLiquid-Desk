"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTextarea } from "@/components/desk/DeskTextarea";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { AppIcon } from "../../components/AppIcon";

type GlobalSetting = {
  key: string;
  value: unknown;
};

export default function GlobalDefaultsPage() {
  const t = useTranslations("settings.globalDefaults");
  const tAdminCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [me, setMe] = useState<any>(null);
  const [settings, setSettings] = useState<GlobalSetting[]>([]);
  const [key, setKey] = useState("default");
  const [value, setValue] = useState("{}");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function errMsg(e: any): string {
    if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
    return e?.message ? String(e.message) : String(e);
  }

  async function load() {
    try {
      const meRes = await apiGet<any>("/auth/me");
      setMe(meRes);
      const data = await apiGet<any[]>("/global-settings");
      setSettings(data);
      if (data.length) {
        setKey(data[0].key);
        setValue(JSON.stringify(data[0].value ?? {}, null, 2));
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setStatus(t("saving"));
    setError("");
    try {
      const parsed = JSON.parse(value || "{}");
      const res = await apiPut<GlobalSetting>(`/global-settings/${encodeURIComponent(key)}`, { value: parsed });
      setStatus(t("saved"));
      setTimeout(() => setStatus(""), 1200);
      setSettings((prev) => {
        const next = prev.filter((s) => s.key !== res.key);
        return [...next, res];
      });
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  const allowed = Boolean(me?.isSuperadmin);

  return (
    <div style={{ maxWidth: 980 }}>
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      {!allowed ? (
        <DeskSurface><div className="card" style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>
          {t("superadminOnly")}
        </div></DeskSurface>
      ) : (
        <DeskSurface><div className="card" style={{ padding: 12 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 13 }}>
              {t("key")}
              <DeskInput className="input" value={key} onChange={(e) => setKey(e.target.value)} />
            </label>
            <label style={{ fontSize: 13 }}>
              {t("jsonValue")}
              <DeskTextarea
                className="input"
                style={{ minHeight: 160 }}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
	            <DeskButton className="btn btnPrimary" onClick={save}>
	              <AppIcon name="save" />
	              {t("save")}
	            </DeskButton>
            {status ? <div style={{ fontSize: 12, opacity: 0.7 }}>{status}</div> : null}
          </div>
        </div></DeskSurface>
      )}
      {error ? <div style={{ fontSize: 12, color: "#ff6b6b", marginTop: 10 }}>{error}</div> : null}
    </div>
  );
}
