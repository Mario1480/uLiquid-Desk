"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import type { AppLocale } from "../../../i18n/config";
import {
  formatTelegramLinkExpiry,
  type TelegramLinkStatus
} from "../../../src/telegram/linking";
import AdminConfirmDialog from "../../admin/_components/AdminConfirmDialog";
import { AppIcon } from "../../components/AppIcon";

type CalendarImpact = "low" | "medium" | "high";
type CalendarTimezoneMode = "device" | "manual";
type SubscriptionNotificationChannel = "email" | "telegram" | "both";

type SubscriptionNotificationSettings = {
  channel: SubscriptionNotificationChannel;
  locale: AppLocale;
  source?: "stored" | "default";
  emailAvailable?: boolean;
  telegramAvailable?: boolean;
};

type MobilePushToken = {
  id: string;
  platform: string;
  environment: string;
  bundleId: string;
  deviceId: string | null;
  appVersion: string | null;
  enabled: boolean;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
};

type MobilePushStatus = {
  enabled: boolean;
  apnsConfigured: boolean;
  environment: "sandbox" | "production";
  bundleId: string | null;
  tokens: MobilePushToken[];
};

const IMPACT_ORDER: CalendarImpact[] = ["high", "medium", "low"];
const CALENDAR_CURRENCIES = [
  { code: "USD", flag: "🇺🇸" },
  { code: "EUR", flag: "🇪🇺" },
  { code: "GBP", flag: "🇬🇧" },
  { code: "JPY", flag: "🇯🇵" },
  { code: "CHF", flag: "🇨🇭" },
  { code: "CAD", flag: "🇨🇦" },
  { code: "AUD", flag: "🇦🇺" },
  { code: "NZD", flag: "🇳🇿" },
  { code: "CNY", flag: "🇨🇳" }
] as const;

function listSupportedTimezones(): string[] {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  try {
    const values = intlWithSupportedValues.supportedValuesOf?.("timeZone") ?? [];
    return values.length > 0 ? values : ["UTC"];
  } catch {
    return ["UTC"];
  }
}

const CALENDAR_TIMEZONES = listSupportedTimezones();

function resolveBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.trim().length > 0) return tz.trim();
  } catch {
    // ignore
  }
  return "UTC";
}

function normalizeImpacts(raw: unknown): CalendarImpact[] {
  if (!Array.isArray(raw)) return ["high"];
  const parsed = raw
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry): entry is CalendarImpact => (
      entry === "low" || entry === "medium" || entry === "high"
    ));
  if (parsed.length === 0) return ["high"];
  return IMPACT_ORDER.filter((entry) => parsed.includes(entry));
}

function normalizeCurrencies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["USD"];
  const allowed = new Set<string>(CALENDAR_CURRENCIES.map((entry) => entry.code));
  const parsed = raw
    .map((entry) => String(entry).trim().toUpperCase())
    .filter((entry) => allowed.has(entry))
    .filter((entry, index, list) => list.indexOf(entry) === index);
  return parsed.length > 0 ? parsed : ["USD"];
}

export default function NotificationsPage() {
  const t = useTranslations("settings.notifications");
  const tCommon = useTranslations("settings.common");
  const currentLocale = useLocale() as AppLocale;
  const [browserTimezone, setBrowserTimezone] = useState("UTC");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [chatId, setChatId] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<TelegramLinkStatus>({
    status: "not_connected",
    expiresAt: null,
    connectUrl: null,
    connectedChatId: null,
    telegramUsername: null,
    botUsername: null
  });
  const [manualFallbackEnabled, setManualFallbackEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [refreshingLink, setRefreshingLink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [dailyCurrencies, setDailyCurrencies] = useState<string[]>(["USD"]);
  const [dailyImpacts, setDailyImpacts] = useState<CalendarImpact[]>(["high"]);
  const [dailySendTimeLocal, setDailySendTimeLocal] = useState("08:00");
  const [dailyTimezoneMode, setDailyTimezoneMode] = useState<CalendarTimezoneMode>("device");
  const [dailyTimezoneInput, setDailyTimezoneInput] = useState("UTC");
  const [mobilePush, setMobilePush] = useState<MobilePushStatus | null>(null);
  const [revokingPushId, setRevokingPushId] = useState<string | null>(null);
  const [confirmPushRevokeId, setConfirmPushRevokeId] = useState<string | null>(null);
  const [subscriptionChannel, setSubscriptionChannel] = useState<SubscriptionNotificationChannel>("email");
  const [subscriptionLocale, setSubscriptionLocale] = useState<AppLocale>(currentLocale);
  const [subscriptionNotificationSource, setSubscriptionNotificationSource] = useState<"stored" | "default">("default");
  const [subscriptionEmailAvailable, setSubscriptionEmailAvailable] = useState(false);
  const [subscriptionTelegramAvailable, setSubscriptionTelegramAvailable] = useState(false);

  const effectiveDailyTimezone = dailyTimezoneMode === "manual"
    ? (dailyTimezoneInput.trim() || browserTimezone)
    : browserTimezone;

  function subscriptionChannelIsAvailable(channel: SubscriptionNotificationChannel): boolean {
    if (channel === "email") return subscriptionEmailAvailable;
    if (channel === "telegram") return subscriptionTelegramAvailable;
    return subscriptionEmailAvailable && subscriptionTelegramAvailable;
  }

  function errMsg(e: any): string {
    if (e instanceof ApiError) {
      const detail = e.payload?.details ? ` — ${e.payload.details}` : "";
      return `${e.message}${detail} (HTTP ${e.status})`;
    }
    return e?.message ? String(e.message) : String(e);
  }

  async function sendTest() {
    setSending(true);
    setMsg(null);
    try {
      await apiPost("/alerts/test");
      setMsg(t("messages.testSent"));
    } catch (e) {
      const message = errMsg(e);
      setMsg(message.includes("telegram_not_configured") ? message : message);
    } finally {
      setSending(false);
    }
  }

  async function loadConfig() {
    try {
      const [data, pushStatus, subscriptionNotifications] = await Promise.all([
        apiGet<{
        telegramChatId?: string | null;
        telegramBotConfigured?: boolean;
        telegramBotUsername?: string | null;
        telegramLink?: TelegramLinkStatus;
        telegramManualFallbackEnabled?: boolean;
        dailyEconomicCalendar?: {
          enabled?: boolean;
          currencies?: string[];
          impacts?: CalendarImpact[];
          sendTimeLocal?: string;
          timezoneMode?: CalendarTimezoneMode;
            timezone?: string;
          };
        }>("/settings/alerts"),
        apiGet<MobilePushStatus>("/settings/mobile-push").catch(() => null),
        apiGet<SubscriptionNotificationSettings>(
          `/settings/subscription/notifications?locale=${encodeURIComponent(currentLocale)}`
        ).catch(() => undefined)
      ]);
      const resolvedBrowserTimezone = resolveBrowserTimezone();
      setChatId(data.telegramChatId ?? "");
      setTokenConfigured(Boolean(data.telegramBotConfigured));
      setBotUsername(data.telegramBotUsername ?? null);
      setLinkStatus(data.telegramLink ?? {
        status: "not_connected",
        expiresAt: null,
        connectUrl: null,
        connectedChatId: null,
        telegramUsername: null,
        botUsername: data.telegramBotUsername ?? null
      });
      setManualFallbackEnabled(data.telegramManualFallbackEnabled !== false);
      setDailyEnabled(Boolean(data.dailyEconomicCalendar?.enabled));
      setDailyCurrencies(normalizeCurrencies(data.dailyEconomicCalendar?.currencies));
      setDailyImpacts(normalizeImpacts(data.dailyEconomicCalendar?.impacts));
      setDailySendTimeLocal(
        typeof data.dailyEconomicCalendar?.sendTimeLocal === "string"
          ? data.dailyEconomicCalendar.sendTimeLocal
          : "08:00"
      );
      const loadedTimezoneMode = data.dailyEconomicCalendar?.timezoneMode === "manual"
        ? "manual"
        : "device";
      const loadedTimezone = typeof data.dailyEconomicCalendar?.timezone === "string"
        ? data.dailyEconomicCalendar.timezone.trim()
        : "";
      setDailyTimezoneMode(loadedTimezoneMode);
      setDailyTimezoneInput(loadedTimezone || resolvedBrowserTimezone);
      setBrowserTimezone(resolvedBrowserTimezone);
      setMobilePush(pushStatus);
      const loadedChannel = subscriptionNotifications?.channel;
      const resolvedChannel: SubscriptionNotificationChannel =
        loadedChannel === "email" || loadedChannel === "telegram" || loadedChannel === "both"
          ? loadedChannel
          : data.telegramLink?.status === "connected"
            ? "telegram"
            : "email";
      setSubscriptionChannel(resolvedChannel);
      setSubscriptionLocale(
        subscriptionNotifications?.source === "stored"
          ? subscriptionNotifications.locale
          : currentLocale
      );
      setSubscriptionNotificationSource(subscriptionNotifications?.source === "stored" ? "stored" : "default");
      const emailAvailable = Boolean(subscriptionNotifications?.emailAvailable);
      const telegramAvailable = Boolean(
        subscriptionNotifications?.telegramAvailable
        ?? (data.telegramLink?.status === "connected")
      );
      setSubscriptionEmailAvailable(emailAvailable);
      setSubscriptionTelegramAvailable(telegramAvailable);

      if (
        subscriptionNotifications
        && subscriptionNotifications.source !== "stored"
        && (resolvedChannel === "email"
          ? emailAvailable
          : resolvedChannel === "telegram"
            ? telegramAvailable
            : emailAvailable && telegramAvailable)
      ) {
        void apiPut<SubscriptionNotificationSettings>("/settings/subscription/notifications", {
          channel: resolvedChannel,
          locale: currentLocale
        }).then(() => setSubscriptionNotificationSource("stored")).catch(() => {
          // Keep the resolved default in the UI when background preference sync fails.
        });
      }

      if (loadedTimezoneMode === "device" && loadedTimezone !== resolvedBrowserTimezone) {
        void apiPut("/settings/alerts", {
          dailyEconomicCalendar: {
            timezoneMode: "device",
            timezone: resolvedBrowserTimezone
          }
        }).catch(() => {
          // ignore silent sync failures
        });
      }
    } catch {
      // ignore
    }
  }

  async function saveConfig() {
    setSaving(true);
    setMsg(null);
    try {
      const resolvedBrowserTimezone = resolveBrowserTimezone();
      const timezone = dailyTimezoneMode === "manual"
        ? dailyTimezoneInput.trim()
        : resolvedBrowserTimezone;
      const sendTimeLocal = /^([01]\d|2[0-3]):([0-5]\d)$/.test(dailySendTimeLocal)
        ? dailySendTimeLocal
        : "08:00";
      await apiPut("/settings/alerts", {
        telegramChatId: chatId.trim() || null,
        dailyEconomicCalendar: {
          enabled: dailyEnabled,
          currencies: normalizeCurrencies(dailyCurrencies),
          impacts: normalizeImpacts(dailyImpacts),
          sendTimeLocal,
          timezoneMode: dailyTimezoneMode,
          timezone
        }
      });
      if (subscriptionChannelIsAvailable(subscriptionChannel)) {
        const savedSubscriptionNotifications = await apiPut<SubscriptionNotificationSettings>(
          "/settings/subscription/notifications",
          {
            channel: subscriptionChannel,
            locale: subscriptionLocale
          }
        );
        setSubscriptionNotificationSource("stored");
        setSubscriptionEmailAvailable(Boolean(savedSubscriptionNotifications.emailAvailable));
        setSubscriptionTelegramAvailable(Boolean(savedSubscriptionNotifications.telegramAvailable));
      }
      setDailySendTimeLocal(sendTimeLocal);
      setBrowserTimezone(resolvedBrowserTimezone);
      setDailyTimezoneInput(timezone || resolvedBrowserTimezone);
      setMsg(t("messages.saved"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function startTelegramLink() {
    setLinking(true);
    setMsg(null);
    try {
      const payload = await apiPost<TelegramLinkStatus>("/settings/alerts/telegram/link");
      setLinkStatus(payload);
      setBotUsername(payload.botUsername ?? botUsername);
      setMsg(t("messages.linkStarted"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLinking(false);
    }
  }

  async function refreshTelegramLinkStatus() {
    setRefreshingLink(true);
    setMsg(null);
    try {
      const payload = await apiGet<TelegramLinkStatus>("/settings/alerts/telegram/link");
      const wasConnected = linkStatus.status === "connected";
      setLinkStatus(payload);
      setBotUsername(payload.botUsername ?? botUsername);
      setSubscriptionTelegramAvailable(payload.status === "connected");
      if (!wasConnected && payload.status === "connected") {
        setMsg(t("messages.linked"));
      }
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setRefreshingLink(false);
    }
  }

  async function disconnectTelegram() {
    setUnlinking(true);
    setMsg(null);
    try {
      const payload = await apiDelete<TelegramLinkStatus>("/settings/alerts/telegram/link");
      setLinkStatus(payload);
      setChatId("");
      setSubscriptionTelegramAvailable(false);
      setMsg(t("messages.disconnected"));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setUnlinking(false);
    }
  }

  async function revokeMobilePushToken(tokenId: string) {
    setRevokingPushId(tokenId);
    setMsg(null);
    try {
      await apiDelete(`/settings/mobile-push/${encodeURIComponent(tokenId)}`);
      setConfirmPushRevokeId(null);
      setMsg(t("mobilePush.messages.revoked"));
      await loadConfig();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setRevokingPushId(null);
    }
  }

  useEffect(() => {
    setBrowserTimezone(resolveBrowserTimezone());
    void loadConfig();
  }, []);

  function toggleCurrency(code: string) {
    setDailyCurrencies((current) => {
      if (current.includes(code)) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== code);
      }
      return normalizeCurrencies([...current, code]);
    });
  }

  function toggleImpact(value: CalendarImpact) {
    setDailyImpacts((current) => {
      if (current.includes(value)) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== value);
      }
      return normalizeImpacts([...current, value]);
    });
  }

  return (
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="card settingsSection" style={{ fontSize: 13 }}>
        <div className="settingsSectionHeader">
          <div style={{ fontWeight: 700 }}>{t("telegram.title")}</div>
          {linkStatus.connectUrl ? (
            <a
              className="btn"
              href={linkStatus.connectUrl}
              target="_blank"
              rel="noreferrer"
	            >
	              <AppIcon name="external" />
	              {t("telegram.openBot")}
	            </a>
          ) : null}
        </div>
        <div style={{ color: "var(--muted)", marginBottom: 10 }}>
          {t("telegram.description")}
        </div>
        {!tokenConfigured ? (
          <div style={{ color: "#fca5a5", marginBottom: 10, fontSize: 12 }}>
            {t("telegram.tokenMissing")}
          </div>
        ) : null}
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          <div style={{ color: "var(--muted)" }}>
            {t("telegram.statusLabel")}: <b>{t(`telegram.status.${linkStatus.status}`)}</b>
          </div>
          {linkStatus.connectedChatId ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {t("telegram.connectedChat")}: <b>{linkStatus.connectedChatId}</b>
              {linkStatus.telegramUsername ? ` (@${linkStatus.telegramUsername})` : ""}
            </div>
          ) : null}
          {linkStatus.status === "pending" ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {t("telegram.pendingHint", {
                expiresAt: formatTelegramLinkExpiry(linkStatus.expiresAt) ?? "-"
              })}
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {t("telegram.privateChatOnly")}
            </div>
          )}
          {botUsername ? (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {t("telegram.botHandle", { username: `@${botUsername}` })}
            </div>
          ) : null}
	          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
	            <button className="btn btnPrimary" type="button" onClick={startTelegramLink} disabled={!tokenConfigured || linking}>
	              <AppIcon name="telegram" />
	              {linking ? tCommon("saving") : t("telegram.connect")}
	            </button>
	            {linkStatus.connectUrl ? (
	              <a className="btn" href={linkStatus.connectUrl} target="_blank" rel="noreferrer">
	                <AppIcon name="external" />
	                {t("telegram.openBot")}
	              </a>
	            ) : null}
	            <button className="btn" type="button" onClick={refreshTelegramLinkStatus} disabled={refreshingLink}>
	              <AppIcon name="refresh" />
	              {refreshingLink ? tCommon("loading") : t("telegram.refreshStatus")}
	            </button>
	            {linkStatus.status === "connected" ? (
	              <button className="btn" type="button" onClick={disconnectTelegram} disabled={unlinking}>
	                <AppIcon name="unlink" />
	                {unlinking ? tCommon("saving") : t("telegram.disconnect")}
	              </button>
            ) : null}
          </div>
        </div>
        {manualFallbackEnabled ? (
          <div style={{ color: "var(--muted)", marginBottom: 10 }}>
            {t.rich("telegram.tip", {
              strong: (chunks) => <b>{chunks}</b>
            })}
          </div>
        ) : null}
        <div className="subscriptionReminderSettings">
          <div className="settingsSectionHeader">
            <div>
              <div className="settingsInlineTitle">{t("subscriptionReminders.title")}</div>
              <div className="settingsMutedText">{t("subscriptionReminders.description")}</div>
            </div>
            <span className="uiStatusBadge uiStatusBadge-info">
              <AppIcon name="alerts" />
              {t(`subscriptionReminders.source.${subscriptionNotificationSource}`)}
            </span>
          </div>
          <div className="subscriptionReminderChoiceGrid">
            {(["email", "telegram", "both"] as SubscriptionNotificationChannel[]).map((channel) => {
              const unavailable = channel === "email"
                ? !subscriptionEmailAvailable
                : channel === "telegram"
                  ? !subscriptionTelegramAvailable
                  : !subscriptionEmailAvailable || !subscriptionTelegramAvailable;
              return (
                <label className="subscriptionReminderChoice" key={channel} aria-disabled={unavailable}>
                  <input
                    type="radio"
                    name="subscription-notification-channel"
                    checked={subscriptionChannel === channel}
                    disabled={unavailable}
                    onChange={() => setSubscriptionChannel(channel)}
                  />
                  <span>
                    <strong>{t(`subscriptionReminders.channel.${channel}.label`)}</strong>
                    <small>{t(`subscriptionReminders.channel.${channel}.hint`)}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <label className="adminFormField">
            <span className="adminFormFieldLabel">{t("subscriptionReminders.language")}</span>
            <select
              className="input"
              value={subscriptionLocale}
              onChange={(event) => setSubscriptionLocale(event.target.value === "en" ? "en" : "de")}
            >
              <option value="de">{t("subscriptionReminders.languages.de")}</option>
              <option value="en">{t("subscriptionReminders.languages.en")}</option>
            </select>
          </label>
          {subscriptionChannel !== "email" && linkStatus.status !== "connected" ? (
            <div className="uiNotice uiNotice-warning">{t("subscriptionReminders.telegramFallback")}</div>
          ) : null}
          {!subscriptionEmailAvailable || !subscriptionTelegramAvailable ? (
            <div className="uiNotice uiNotice-info">{t("subscriptionReminders.unavailableHint")}</div>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          {manualFallbackEnabled ? (
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("telegram.chatIdFallback")}</span>
              <input
                className="input"
                placeholder="123456789"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
              />
            </label>
          ) : null}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>{t("dailyCalendar.title")}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {t("dailyCalendar.description")}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={dailyEnabled}
                onChange={(e) => setDailyEnabled(e.target.checked)}
              />
              <span>{t("dailyCalendar.enabledLabel")}</span>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("dailyCalendar.sendTimeLocal")}</span>
              <input
                type="time"
                className="input"
                value={dailySendTimeLocal}
                onChange={(e) => setDailySendTimeLocal(e.target.value)}
              />
            </label>
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("dailyCalendar.timezone")}</span>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="radio"
                  name="daily-timezone-mode"
                  checked={dailyTimezoneMode === "device"}
                  onChange={() => setDailyTimezoneMode("device")}
                />
                <span>{t("dailyCalendar.timezoneAuto")}</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="radio"
                  name="daily-timezone-mode"
                  checked={dailyTimezoneMode === "manual"}
                  onChange={() => {
                    setDailyTimezoneMode("manual");
                    setDailyTimezoneInput((current) => current.trim() || browserTimezone);
                  }}
                />
                <span>{t("dailyCalendar.timezoneManual")}</span>
              </label>
              {dailyTimezoneMode === "manual" ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("dailyCalendar.timezone")}</span>
                  <input
                    className="input"
                    list="daily-calendar-timezones"
                    placeholder={t("dailyCalendar.timezoneManualPlaceholder")}
                    value={dailyTimezoneInput}
                    onChange={(e) => setDailyTimezoneInput(e.target.value)}
                  />
                  <datalist id="daily-calendar-timezones">
                    {CALENDAR_TIMEZONES.map((timezone) => (
                      <option key={timezone} value={timezone} />
                    ))}
                  </datalist>
                </label>
              ) : null}
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("dailyCalendar.timezoneDetected")}: <b>{effectiveDailyTimezone}</b>
              </div>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("dailyCalendar.currencies")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {CALENDAR_CURRENCIES.map((entry) => {
                  const active = dailyCurrencies.includes(entry.code);
                  return (
                    <button
                      key={entry.code}
                      type="button"
                      className="badge"
                      style={{ opacity: active ? 1 : 0.6, cursor: "pointer" }}
                      onClick={() => toggleCurrency(entry.code)}
                    >
                      {entry.flag} {entry.code}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("dailyCalendar.impacts")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {IMPACT_ORDER.map((impact) => {
                  const active = dailyImpacts.includes(impact);
                  return (
                    <button
                      key={impact}
                      type="button"
                      className="badge"
                      style={{ opacity: active ? 1 : 0.6, cursor: "pointer" }}
                      onClick={() => toggleImpact(impact)}
                    >
                      {t(`dailyCalendar.impact.${impact}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "grid", gap: 10, marginBottom: 10 }}>
          <div className="settingsSectionHeader">
            <div>
              <div style={{ fontWeight: 700 }}>{t("mobilePush.title")}</div>
              <div className="settingsMutedText">{t("mobilePush.description")}</div>
            </div>
            <span className="badge">
              <AppIcon name="mobile" />
              {mobilePush?.enabled ? t("mobilePush.enabled") : t("mobilePush.disabled")}
            </span>
          </div>
          <div className="settingsHubSummary settingsTradingDefaultsSummary">
            <div className="miniMetric">
              <span>{t("mobilePush.apns")}</span>
              <b>{mobilePush?.apnsConfigured ? t("mobilePush.configured") : t("mobilePush.missing")}</b>
            </div>
            <div className="miniMetric">
              <span>{t("mobilePush.environment")}</span>
              <b>{mobilePush?.environment ?? "-"}</b>
            </div>
            <div className="miniMetric">
              <span>{t("mobilePush.bundle")}</span>
              <b>{mobilePush?.bundleId ?? "-"}</b>
            </div>
            <div className="miniMetric">
              <span>{t("mobilePush.devices")}</span>
              <b>{mobilePush?.tokens.filter((token) => token.enabled && !token.revokedAt).length ?? 0}</b>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {(mobilePush?.tokens ?? []).length > 0 ? (
              mobilePush?.tokens.map((token) => (
                <div key={token.id} className="settingsWalletLinkCard">
                  <div className="settingsWalletLinkHeader">
                    <div>
                      <div className="settingsInlineTitle">
                        {token.deviceId || t("mobilePush.unknownDevice")}
                      </div>
                      <div className="settingsMutedText">
                        {token.platform.toUpperCase()} · {token.environment} · {token.appVersion ?? "-"} · {t("mobilePush.lastSeen", { value: token.lastSeenAt ? new Date(token.lastSeenAt).toLocaleString() : "-" })}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="badge">{token.enabled && !token.revokedAt ? t("mobilePush.active") : t("mobilePush.revoked")}</span>
                      {token.enabled && !token.revokedAt ? (
                        <button
                          className="btn btnStop"
                          type="button"
                          onClick={() => setConfirmPushRevokeId(token.id)}
                          disabled={revokingPushId === token.id}
                        >
                          <AppIcon name="delete" />
                          {revokingPushId === token.id ? tCommon("deleting") : t("mobilePush.revoke")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="settingsMutedText">{t("mobilePush.empty")}</div>
            )}
          </div>
        </div>
	        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
	          <button className="btn btnPrimary" onClick={saveConfig} disabled={saving}>
	            <AppIcon name="save" />
	            {saving ? tCommon("saving") : tCommon("saveSettings")}
	          </button>
	          <button className="btn" onClick={sendTest} disabled={sending}>
	            <AppIcon name="send" />
	            {sending ? t("messages.sending") : t("messages.sendTest")}
	          </button>
        </div>
        {msg ? (
          <div style={{ marginTop: 10, color: "var(--muted)" }}>{msg}</div>
        ) : null}
      </div>
      <AdminConfirmDialog
        open={Boolean(confirmPushRevokeId)}
        title={t("mobilePush.confirmTitle")}
        description={t("mobilePush.confirmDescription")}
        confirmLabel={t("mobilePush.confirmAction")}
        cancelLabel={t("mobilePush.confirmCancel")}
        tone="danger"
        loading={Boolean(revokingPushId)}
        onCancel={() => setConfirmPushRevokeId(null)}
        onConfirm={() => {
          if (confirmPushRevokeId) void revokeMobilePushToken(confirmPushRevokeId);
        }}
      />
    </div>
  );
}
