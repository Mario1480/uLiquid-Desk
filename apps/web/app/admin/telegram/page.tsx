"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import AdminPageHeader from "../_components/AdminPageHeader";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminTelegramPage() {
  const t = useTranslations("admin.telegram");
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [telegramMasked, setTelegramMasked] = useState<string | null>(null);

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

      const telegramRes = await apiGet<any>("/admin/settings/telegram");
      setTelegramConfigured(Boolean(telegramRes.configured));
      setTelegramMasked(telegramRes.telegramBotTokenMasked ?? null);
      setTelegramChatId(telegramRes.telegramChatId ?? "");
      setTelegramToken("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function saveTelegram() {
    setError(null);
    setNotice(null);
    try {
      const payload = {
        telegramBotToken: telegramToken.trim() || null,
        telegramChatId: telegramChatId.trim() || null
      };
      const res = await apiPut<any>("/admin/settings/telegram", payload);
      setTelegramConfigured(Boolean(res.configured));
      setTelegramMasked(res.telegramBotTokenMasked ?? null);
      setTelegramToken("");
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function testTelegram() {
    setError(null);
    setNotice(null);
    try {
      await apiPost("/admin/settings/telegram/test");
      setNotice(t("messages.testSent"));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader title={t("title")} description={t("subtitle")} />

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
          <section className="adminStatsGrid">
            <div className="card adminStatsCard">
              <div className="adminStatsLabel">{t("configured")}</div>
              <div className="adminStatsValue adminStatsValueSmall">{telegramConfigured ? t("yes") : t("no")}</div>
              <div className="adminStatsHint">{t("sectionTitle")}</div>
            </div>
            <div className="card adminStatsCard">
              <div className="adminStatsLabel">{t("currentToken")}</div>
              <div className="adminStatsValue adminStatsValueSmall">{telegramMasked || "-"}</div>
              <div className="adminStatsHint">{t("botToken")}</div>
            </div>
            <div className="card adminStatsCard">
              <div className="adminStatsLabel">{t("chatId")}</div>
              <div className="adminStatsValue adminStatsValueSmall">{telegramChatId || "-"}</div>
              <div className="adminStatsHint">{t("sendTest")}</div>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader adminDetailSectionHeader">
              <h3 style={{ margin: 0 }}>{t("sectionTitle")}</h3>
              <div className="adminDetailSectionDescription">
                {t("configured")}: {telegramConfigured ? t("yes") : t("no")}
                {telegramMasked ? ` · ${t("currentToken")} ${telegramMasked}` : ""}
              </div>
            </div>
          <div className="settingsFormGrid">
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("botToken")}</span>
              <input
                className="input"
                placeholder={telegramMasked ?? "123456:ABC..."}
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("chatId")}</span>
              <input className="input" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} />
            </label>
          </div>
          <div className="adminInlineActions" style={{ marginTop: 14 }}>
            <button className="btn btnPrimary" onClick={() => void saveTelegram()}>
              {t("saveTelegram")}
            </button>
            <button className="btn" onClick={() => void testTelegram()}>
              {t("sendTest")}
            </button>
          </div>
        </section>
        </>
      ) : null}
    </div>
  );
}
