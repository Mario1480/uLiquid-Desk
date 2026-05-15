"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../lib/api";
import { buildSiweMessage, fetchSiweNonce, linkSiweWallet, shortenWalletAddress, unlinkSiweWallet } from "../../lib/auth/siwe";
import { wagmiConfig } from "../../lib/web3/config";
import { LOCALE_COOKIE_NAME, withLocalePath, type AppLocale } from "../../i18n/config";
import {
  isProductFeatureAllowed,
  type ProductFeatureGateMap
} from "../../src/access/productFeatureGates";
import {
  formatTelegramLinkExpiry,
  type TelegramLinkStatus
} from "../../src/telegram/linking";
import { AppIcon } from "../components/AppIcon";
import { Notice, PageHeader } from "../components/ui";
import Web3Providers from "../components/Web3Providers";
import { AffiliateOverview } from "./affiliate/AffiliateOverview";
import { useAccount, useChainId } from "wagmi";
import { signMessage } from "wagmi/actions";

type MeResponse = {
  user: { id: string; email: string; walletAddress?: string | null };
  walletAddress?: string | null;
  isSuperadmin?: boolean;
  hasAdminBackendAccess?: boolean;
};

type SubscriptionFeatureResponse = {
  featureGates?: ProductFeatureGateMap;
};

type ExchangeAccountItem = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  signingAddress?: string | null;
  readAddress?: string | null;
  readAddressSource?: "wallet" | "account_or_vault" | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  marketDataExchangeAccountId?: string | null;
  marketDataExchange?: string | null;
  marketDataLabel?: string | null;
  futuresBudget?: {
    equity: number | null;
    availableMargin: number | null;
    marginCoin: string | null;
  } | null;
  lastSyncError?: {
    at: string | null;
    message: string | null;
  } | null;
  credentialsRotatedAt?: string | null;
  credentialsExpiresAt?: string | null;
  credentialsExpiresInDays?: number | null;
  credentialExpiryState?: "healthy" | "warning" | "expired" | null;
};

type ExchangeSyncResponse = {
  ok: boolean;
  message: string;
  syncedAt: string;
  pnlTodayUsd?: number | null;
  spotBudget?: {
    total: number | null;
    available: number | null;
    currency: string | null;
  } | null;
  futuresBudget?: {
    equity: number | null;
    availableMargin: number | null;
    marginCoin: string | null;
  };
};

type ExchangeOption = {
  value: string;
  label: string;
  enabled: boolean;
};

type SettingsAccordionKey =
  | "affiliate"
  | "exchange_settings"
  | "security"
  | "notifications"
  | "license_management"
  | "language"
  | "web3";

const SETTINGS_SECTION_QUERY_MAP: Record<string, SettingsAccordionKey> = {
  affiliate: "affiliate",
  exchange: "exchange_settings",
  exchange_settings: "exchange_settings",
  security: "security",
  notifications: "notifications",
  license: "license_management",
  license_management: "license_management",
  language: "language",
  web3: "web3"
};

type NotificationCalendarImpact = "low" | "medium" | "high";
type NotificationCalendarTimezoneMode = "device" | "manual";
const NOTIFICATION_IMPACT_ORDER: NotificationCalendarImpact[] = ["high", "medium", "low"];
const NOTIFICATION_CALENDAR_CURRENCIES = [
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

const NOTIFICATION_CALENDAR_TIMEZONES = listSupportedTimezones();

function resolveBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.trim().length > 0) return tz.trim();
  } catch {
    // ignore
  }
  return "UTC";
}

function normalizeNotificationImpacts(raw: unknown): NotificationCalendarImpact[] {
  if (!Array.isArray(raw)) return ["high"];
  const parsed = raw
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry): entry is NotificationCalendarImpact => (
      entry === "low" || entry === "medium" || entry === "high"
    ));
  if (parsed.length === 0) return ["high"];
  return NOTIFICATION_IMPACT_ORDER.filter((entry) => parsed.includes(entry));
}

function normalizeNotificationCurrencies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["USD"];
  const allowed = new Set<string>(NOTIFICATION_CALENDAR_CURRENCIES.map((entry) => entry.code));
  const parsed = raw
    .map((entry) => String(entry).trim().toUpperCase())
    .filter((entry) => allowed.has(entry))
    .filter((entry, index, list) => list.indexOf(entry) === index);
  return parsed.length > 0 ? parsed : ["USD"];
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function errMsgWithDetails(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = typeof e.payload === "object" && e.payload && "details" in e.payload
      ? String((e.payload as { details?: unknown }).details ?? "")
      : "";
    return detail ? `${e.message} — ${detail} (HTTP ${e.status})` : `${e.message} (HTTP ${e.status})`;
  }
  if (e && typeof e === "object" && "message" in e) return String((e as { message?: unknown }).message ?? e);
  return String(e);
}

function normalizeWalletAddress(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function shortenAddress(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw || "-";
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function formatOptionalDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function SettingsPageContent() {
  const tMain = useTranslations("system.settingsMain");
  const tRisk = useTranslations("system.settingsRisk");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { address: connectedWalletAddress, isConnected: isWalletConnected } = useAccount();
  const connectedWalletChainId = useChainId();
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [hasAdminBackendAccess, setHasAdminBackendAccess] = useState(false);
  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverIpAddress, setServerIpAddress] = useState<string | null>(null);

  const [exchange, setExchange] = useState("bitget");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [marketDataExchangeAccountId, setMarketDataExchangeAccountId] = useState("");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editApiSecret, setEditApiSecret] = useState("");
  const [editPassphrase, setEditPassphrase] = useState("");
  const [editClearPassphrase, setEditClearPassphrase] = useState(false);
  const [editMarketDataExchangeAccountId, setEditMarketDataExchangeAccountId] = useState("");
  const [openSettingsSections, setOpenSettingsSections] = useState<Record<SettingsAccordionKey, boolean>>({
    affiliate: false,
    exchange_settings: false,
    security: false,
    notifications: false,
    license_management: false,
    language: false,
    web3: false
  });
  const [notificationSending, setNotificationSending] = useState(false);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);
  const [notificationChatId, setNotificationChatId] = useState("");
  const [notificationTokenConfigured, setNotificationTokenConfigured] = useState(false);
  const [notificationBotUsername, setNotificationBotUsername] = useState<string | null>(null);
  const [notificationLinkStatus, setNotificationLinkStatus] = useState<TelegramLinkStatus>({
    status: "not_connected",
    expiresAt: null,
    connectUrl: null,
    connectedChatId: null,
    telegramUsername: null,
    botUsername: null
  });
  const [notificationManualFallbackEnabled, setNotificationManualFallbackEnabled] = useState(true);
  const [notificationBrowserTimezone, setNotificationBrowserTimezone] = useState("UTC");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationLinking, setNotificationLinking] = useState(false);
  const [notificationRefreshingLink, setNotificationRefreshingLink] = useState(false);
  const [notificationUnlinking, setNotificationUnlinking] = useState(false);
  const [notificationDailyEnabled, setNotificationDailyEnabled] = useState(false);
  const [notificationDailyCurrencies, setNotificationDailyCurrencies] = useState<string[]>(["USD"]);
  const [notificationDailyImpacts, setNotificationDailyImpacts] = useState<NotificationCalendarImpact[]>(["high"]);
  const [notificationDailySendTimeLocal, setNotificationDailySendTimeLocal] = useState("08:00");
  const [notificationDailyTimezoneMode, setNotificationDailyTimezoneMode] =
    useState<NotificationCalendarTimezoneMode>("device");
  const [notificationDailyTimezoneInput, setNotificationDailyTimezoneInput] = useState("UTC");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [walletLinkStatus, setWalletLinkStatus] = useState<string | null>(null);
  const [walletLinkError, setWalletLinkError] = useState<string | null>(null);
  const [walletLinking, setWalletLinking] = useState(false);
  const [walletUnlinking, setWalletUnlinking] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetStatus, setResetStatus] = useState("");

  const effectiveNotificationDailyTimezone = notificationDailyTimezoneMode === "manual"
    ? (notificationDailyTimezoneInput.trim() || notificationBrowserTimezone)
    : notificationBrowserTimezone;
  const [resetError, setResetError] = useState("");
  const [resetDevCode, setResetDevCode] = useState<string | null>(null);
  const [securitySettingsLoading, setSecuritySettingsLoading] = useState(true);
  const [securitySettingsSaving, setSecuritySettingsSaving] = useState(false);
  const [securitySettingsMsg, setSecuritySettingsMsg] = useState<string | null>(null);
  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(true);
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState(60);
  const [otpEnabled, setOtpEnabled] = useState(true);
  const linkedWalletAddress = String(me?.walletAddress ?? "").trim();
  const normalizedLinkedWalletAddress = normalizeWalletAddress(linkedWalletAddress);
  const normalizedConnectedWalletAddress = normalizeWalletAddress(connectedWalletAddress);
  const walletLinkMissing = !normalizedLinkedWalletAddress;
  const walletLinkMismatch = Boolean(
    normalizedLinkedWalletAddress
    && normalizedConnectedWalletAddress
    && normalizedLinkedWalletAddress !== normalizedConnectedWalletAddress
  );
  const walletLinkReady = Boolean(normalizedLinkedWalletAddress) && !walletLinkMismatch;
  const walletActionBusy = walletLinking || walletUnlinking;

  function renderHyperliquidCredentialExpiry(account: ExchangeAccountItem) {
    if (account.exchange !== "hyperliquid" || !account.credentialExpiryState) return null;

    const expiryTone =
      account.credentialExpiryState === "expired"
        ? "#d14343"
        : account.credentialExpiryState === "warning"
          ? "#f59e0b"
          : undefined;
    const statusText =
      account.credentialExpiryState === "expired"
        ? tMain("exchange.apiRotationExpired", {
            days: Math.max(1, Math.abs(Number(account.credentialsExpiresInDays ?? 0)))
          })
        : account.credentialExpiryState === "warning"
          ? tMain("exchange.apiRotationDueSoon", {
              days: Math.max(0, Number(account.credentialsExpiresInDays ?? 0))
            })
          : tMain("exchange.apiRotationHealthy");

    return (
      <>
        <div className="settingsMutedText">
          {tMain("exchange.apiRotationLastRotated")}: {formatOptionalDateTime(account.credentialsRotatedAt)}
        </div>
        <div className="settingsMutedText">
          {tMain("exchange.apiRotationExpiresAt")}: {formatOptionalDateTime(account.credentialsExpiresAt)}
        </div>
        <div className="settingsMutedText" style={expiryTone ? { color: expiryTone } : undefined}>
          {tMain("exchange.apiRotationStatus")}: {statusText}
        </div>
      </>
    );
  }

  const licenseManagementEnabled = true;
  const passphraseRequired = exchange === "bitget";
  const hyperliquidMode = exchange === "hyperliquid";
  const mexcMode = exchange === "mexc";
  const binanceMode = exchange === "binance";
  const paperMode = exchange === "paper";
  const credentialsRequired = !paperMode;
  const marketDataAccounts = accounts.filter((item) => item.exchange !== "paper");
  const query = searchParams.toString();

  useEffect(() => {
    const requestedSection = SETTINGS_SECTION_QUERY_MAP[String(searchParams.get("section") ?? "").trim().toLowerCase()];
    if (!requestedSection) return;

    setOpenSettingsSections({
      affiliate: false,
      exchange_settings: false,
      security: false,
      notifications: false,
      license_management: false,
      language: false,
      web3: false,
      [requestedSection]: true
    });
  }, [searchParams]);

  function toggleSettingsSection(key: SettingsAccordionKey) {
    setOpenSettingsSections((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  }

  function switchLocalePath(targetLocale: AppLocale): string {
    const targetPath = withLocalePath(pathname, targetLocale);
    if (!query) return targetPath;
    return `${targetPath}?${query}`;
  }

  function handleLocaleSwitch(targetLocale: AppLocale) {
    if (targetLocale === locale) return;
    const targetPath = switchLocalePath(targetLocale);
    document.cookie = `${LOCALE_COOKIE_NAME}=${targetLocale}; path=/; max-age=31536000`;
    window.location.assign(targetPath);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [meRes, accountRes, exchangesRes, serverInfoRes, subscriptionRes] = await Promise.all([
        apiGet<MeResponse>("/auth/me"),
        apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts"),
        apiGet<{ options: ExchangeOption[] }>("/settings/exchange-options"),
        apiGet<{ serverIpAddress?: string | null }>("/settings/server-info"),
        apiGet<SubscriptionFeatureResponse>("/settings/subscription").catch(() => null)
      ]);
      setMe(meRes.user);
      if (!resetEmail && meRes.user?.email) {
        setResetEmail(meRes.user.email);
      }
      setIsSuperadmin(Boolean(meRes.isSuperadmin));
      setHasAdminBackendAccess(Boolean(meRes.isSuperadmin || meRes.hasAdminBackendAccess));
      setAccounts(accountRes.items ?? []);
      const dataAccounts = (accountRes.items ?? []).filter((item) => item.exchange !== "paper");
      if (!marketDataExchangeAccountId && dataAccounts.length > 0) {
        setMarketDataExchangeAccountId(dataAccounts[0].id);
      }
      const nextFeatureGates = subscriptionRes?.featureGates ?? {};
      const paperTradingEnabled = isProductFeatureAllowed(nextFeatureGates, "paper_trading");
      const allowedOptions = (exchangesRes.options ?? [])
        .filter((item) => item.enabled)
        .filter((item) => paperTradingEnabled || item.value !== "paper");
      setExchangeOptions(allowedOptions);
      setServerIpAddress(
        typeof serverInfoRes.serverIpAddress === "string" && serverInfoRes.serverIpAddress.trim()
          ? serverInfoRes.serverIpAddress.trim()
          : null
      );
      if (allowedOptions.length > 0 && !allowedOptions.some((item) => item.value === exchange)) {
        setExchange(allowedOptions[0].value);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setNotificationBrowserTimezone(resolveBrowserTimezone());
    void loadAll();
    void loadSecuritySettings();
    void loadNotificationConfig();
  }, []);

  useEffect(() => {
    if (!paperMode) return;
    if (marketDataAccounts.length === 0) {
      if (marketDataExchangeAccountId) setMarketDataExchangeAccountId("");
      return;
    }
    if (!marketDataAccounts.some((item) => item.id === marketDataExchangeAccountId)) {
      setMarketDataExchangeAccountId(marketDataAccounts[0].id);
    }
  }, [paperMode, marketDataAccounts, marketDataExchangeAccountId]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiPost("/exchange-accounts", {
        exchange,
        label,
        apiKey: paperMode ? undefined : apiKey,
        apiSecret: paperMode ? undefined : apiSecret,
        passphrase: paperMode ? undefined : passphrase || undefined,
        marketDataExchangeAccountId: paperMode ? marketDataExchangeAccountId || undefined : undefined
      });
      setLabel("");
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  function startEditingAccount(account: ExchangeAccountItem) {
    setEditingAccountId(account.id);
    setEditLabel(account.label);
    setEditApiKey("");
    setEditApiSecret("");
    setEditPassphrase("");
    setEditClearPassphrase(false);
    setEditMarketDataExchangeAccountId(account.marketDataExchangeAccountId ?? "");
    setError(null);
    setNotice(null);
  }

  function cancelEditingAccount() {
    setEditingAccountId(null);
    setEditLabel("");
    setEditApiKey("");
    setEditApiSecret("");
    setEditPassphrase("");
    setEditClearPassphrase(false);
    setEditMarketDataExchangeAccountId("");
  }

  async function saveAccount(account: ExchangeAccountItem) {
    setSavingEditId(account.id);
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/exchange-accounts/${account.id}`, {
        label: editLabel,
        apiKey: account.exchange === "paper" ? undefined : (editApiKey.trim() || undefined),
        apiSecret: account.exchange === "paper" ? undefined : (editApiSecret.trim() || undefined),
        passphrase: account.exchange === "paper" ? undefined : (editPassphrase.trim() || undefined),
        clearPassphrase: account.exchange === "paper" ? undefined : (editClearPassphrase && !editPassphrase.trim()),
        marketDataExchangeAccountId: account.exchange === "paper"
          ? (editMarketDataExchangeAccountId || undefined)
          : undefined
      });
      setNotice(tMain("exchange.accountUpdated"));
      cancelEditingAccount();
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSavingEditId(null);
    }
  }

  async function deleteAccount(id: string) {
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/exchange-accounts/${id}`);
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function syncAccount(id: string) {
    setError(null);
    setNotice(null);
    setSyncingId(id);
    try {
      const payload = await apiPost<ExchangeSyncResponse>(`/exchange-accounts/${id}/test-connection`);
      const parts = [
        "Sync successful",
        payload?.futuresBudget?.marginCoin ? `(${payload.futuresBudget.marginCoin})` : null,
        payload?.pnlTodayUsd !== null && payload?.pnlTodayUsd !== undefined
          ? `PnL ${payload.pnlTodayUsd}`
          : null,
        payload?.futuresBudget?.equity !== null && payload?.futuresBudget?.equity !== undefined
          ? `equity ${payload.futuresBudget.equity}`
          : null
      ].filter(Boolean);
      setNotice(parts.join(" "));
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSyncingId(null);
    }
  }

  async function loadNotificationConfig() {
    try {
      const data = await apiGet<{
        telegramChatId?: string | null;
        telegramBotConfigured?: boolean;
        telegramBotUsername?: string | null;
        telegramLink?: TelegramLinkStatus;
        telegramManualFallbackEnabled?: boolean;
        dailyEconomicCalendar?: {
          enabled?: boolean;
          currencies?: string[];
          impacts?: NotificationCalendarImpact[];
          sendTimeLocal?: string;
          timezoneMode?: NotificationCalendarTimezoneMode;
          timezone?: string;
        };
      }>("/settings/alerts");
      const resolvedBrowserTimezone = resolveBrowserTimezone();
      setNotificationChatId(data.telegramChatId ?? "");
      setNotificationTokenConfigured(Boolean(data.telegramBotConfigured));
      setNotificationBotUsername(data.telegramBotUsername ?? null);
      setNotificationLinkStatus(data.telegramLink ?? {
        status: "not_connected",
        expiresAt: null,
        connectUrl: null,
        connectedChatId: null,
        telegramUsername: null,
        botUsername: data.telegramBotUsername ?? null
      });
      setNotificationManualFallbackEnabled(data.telegramManualFallbackEnabled !== false);
      setNotificationDailyEnabled(Boolean(data.dailyEconomicCalendar?.enabled));
      setNotificationDailyCurrencies(normalizeNotificationCurrencies(data.dailyEconomicCalendar?.currencies));
      setNotificationDailyImpacts(normalizeNotificationImpacts(data.dailyEconomicCalendar?.impacts));
      setNotificationDailySendTimeLocal(
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
      setNotificationDailyTimezoneMode(loadedTimezoneMode);
      setNotificationDailyTimezoneInput(loadedTimezone || resolvedBrowserTimezone);
      setNotificationBrowserTimezone(resolvedBrowserTimezone);

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
      // ignore on initial render
    }
  }

  async function saveNotificationConfig() {
    setNotificationSaving(true);
    setNotificationMsg(null);
    try {
      const resolvedBrowserTimezone = resolveBrowserTimezone();
      const timezone = notificationDailyTimezoneMode === "manual"
        ? notificationDailyTimezoneInput.trim()
        : resolvedBrowserTimezone;
      const sendTimeLocal = /^([01]\d|2[0-3]):([0-5]\d)$/.test(notificationDailySendTimeLocal)
        ? notificationDailySendTimeLocal
        : "08:00";
      await apiPut("/settings/alerts", {
        telegramChatId: notificationChatId.trim() || null,
        dailyEconomicCalendar: {
          enabled: notificationDailyEnabled,
          currencies: normalizeNotificationCurrencies(notificationDailyCurrencies),
          impacts: normalizeNotificationImpacts(notificationDailyImpacts),
          sendTimeLocal,
          timezoneMode: notificationDailyTimezoneMode,
          timezone
        }
      });
      setNotificationDailySendTimeLocal(sendTimeLocal);
      setNotificationBrowserTimezone(resolvedBrowserTimezone);
      setNotificationDailyTimezoneInput(timezone || resolvedBrowserTimezone);
      setNotificationMsg("Saved.");
    } catch (e) {
      setNotificationMsg(errMsgWithDetails(e));
    } finally {
      setNotificationSaving(false);
    }
  }

  async function sendNotificationTest() {
    setNotificationSending(true);
    setNotificationMsg(null);
    try {
      await apiPost("/alerts/test");
      setNotificationMsg("Test alert sent to Telegram.");
    } catch (e) {
      setNotificationMsg(errMsgWithDetails(e));
    } finally {
      setNotificationSending(false);
    }
  }

  async function startNotificationLink() {
    setNotificationLinking(true);
    setNotificationMsg(null);
    try {
      const payload = await apiPost<TelegramLinkStatus>("/settings/alerts/telegram/link");
      setNotificationLinkStatus(payload);
      setNotificationBotUsername(payload.botUsername ?? notificationBotUsername);
      setNotificationMsg(tMain("notifications.messages.linkStarted"));
    } catch (e) {
      setNotificationMsg(errMsgWithDetails(e));
    } finally {
      setNotificationLinking(false);
    }
  }

  async function refreshNotificationLinkStatus() {
    setNotificationRefreshingLink(true);
    setNotificationMsg(null);
    try {
      const payload = await apiGet<TelegramLinkStatus>("/settings/alerts/telegram/link");
      const wasConnected = notificationLinkStatus.status === "connected";
      setNotificationLinkStatus(payload);
      setNotificationBotUsername(payload.botUsername ?? notificationBotUsername);
      if (!wasConnected && payload.status === "connected") {
        setNotificationMsg(tMain("notifications.messages.linked"));
      }
    } catch (e) {
      setNotificationMsg(errMsgWithDetails(e));
    } finally {
      setNotificationRefreshingLink(false);
    }
  }

  async function disconnectNotificationTelegram() {
    setNotificationUnlinking(true);
    setNotificationMsg(null);
    try {
      const payload = await apiDelete<TelegramLinkStatus>("/settings/alerts/telegram/link");
      setNotificationLinkStatus(payload);
      setNotificationChatId("");
      setNotificationMsg(tMain("notifications.messages.disconnected"));
    } catch (e) {
      setNotificationMsg(errMsgWithDetails(e));
    } finally {
      setNotificationUnlinking(false);
    }
  }

  function toggleNotificationCurrency(code: string) {
    setNotificationDailyCurrencies((current) => {
      if (current.includes(code)) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== code);
      }
      return normalizeNotificationCurrencies([...current, code]);
    });
  }

  function toggleNotificationImpact(value: NotificationCalendarImpact) {
    setNotificationDailyImpacts((current) => {
      if (current.includes(value)) {
        if (current.length <= 1) return current;
        return current.filter((entry) => entry !== value);
      }
      return normalizeNotificationImpacts([...current, value]);
    });
  }

  async function loadSecuritySettings() {
    setSecuritySettingsLoading(true);
    setSecuritySettingsMsg(null);
    try {
      const data = await apiGet<{
        autoLogoutEnabled?: boolean;
        autoLogoutMinutes?: number;
        reauthOtpEnabled?: boolean;
        isSuperadmin?: boolean;
      }>("/settings/security");
      setAutoLogoutEnabled(Boolean(data.autoLogoutEnabled));
      setAutoLogoutMinutes(Number(data.autoLogoutMinutes) || 60);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      if (typeof data.isSuperadmin === "boolean") {
        setIsSuperadmin(Boolean(data.isSuperadmin));
      }
    } catch (e) {
      setSecuritySettingsMsg(errMsg(e));
    } finally {
      setSecuritySettingsLoading(false);
    }
  }

  async function saveSecuritySettings() {
    setSecuritySettingsSaving(true);
    setSecuritySettingsMsg(null);
    const safeMinutes = Math.max(1, Math.min(1440, Math.floor(autoLogoutMinutes)));
    try {
      const payload: {
        autoLogoutEnabled: boolean;
        autoLogoutMinutes: number;
        reauthOtpEnabled: boolean;
      } = {
        autoLogoutEnabled,
        autoLogoutMinutes: safeMinutes,
        reauthOtpEnabled: otpEnabled
      };
      const data = await apiPut<{
        autoLogoutEnabled?: boolean;
        autoLogoutMinutes?: number;
        reauthOtpEnabled?: boolean;
        isSuperadmin?: boolean;
      }>("/settings/security", payload);
      setAutoLogoutEnabled(Boolean(data.autoLogoutEnabled));
      setAutoLogoutMinutes(Number(data.autoLogoutMinutes) || safeMinutes);
      setOtpEnabled(data.reauthOtpEnabled !== false);
      if (typeof data.isSuperadmin === "boolean") {
        setIsSuperadmin(Boolean(data.isSuperadmin));
      }
      setSecuritySettingsMsg(tMain("messages.saved"));
    } catch (e) {
      setSecuritySettingsMsg(errMsg(e));
    } finally {
      setSecuritySettingsSaving(false);
    }
  }

  async function savePassword() {
    setPasswordStatus(tMain("messages.saving"));
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordStatus("");
      setPasswordError(tMain("messages.passwordsDoNotMatch"));
      return;
    }
    try {
      await apiPost("/auth/change-password", {
        currentPassword,
        newPassword
      });
      setPasswordStatus(tMain("messages.updated"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      window.setTimeout(() => setPasswordStatus(""), 1200);
    } catch (e) {
      setPasswordStatus("");
      setPasswordError(errMsg(e));
    }
  }

  async function requestResetCode() {
    setResetStatus(tMain("messages.sendingCode"));
    setResetError("");
    setResetDevCode(null);
    try {
      const payload = await apiPost<{ devCode?: string; expiresInMinutes?: number }>(
        "/auth/password-reset/request",
        { email: resetEmail }
      );
      setResetStatus(
        tMain("messages.resetCodeSent", {
          expires: payload?.expiresInMinutes ? ` (${tMain("messages.validMinutes", { minutes: payload.expiresInMinutes })})` : ""
        })
      );
      if (payload?.devCode) setResetDevCode(payload.devCode);
    } catch (e) {
      setResetStatus("");
      setResetError(errMsg(e));
    }
  }

  async function confirmResetPassword() {
    setResetStatus(tMain("messages.updatingPassword"));
    setResetError("");
    if (resetNewPassword !== resetConfirmPassword) {
      setResetStatus("");
      setResetError(tMain("messages.newPasswordMismatch"));
      return;
    }
    try {
      await apiPost("/auth/password-reset/confirm", {
        email: resetEmail,
        code: resetCode,
        newPassword: resetNewPassword
      });
      setResetStatus(tMain("messages.passwordUpdated"));
      setResetCode("");
      setResetNewPassword("");
      setResetConfirmPassword("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setResetStatus("");
      setResetError(errMsg(e));
    }
  }

  function resolveSiweUiError(error: unknown): string {
    if (error instanceof ApiError) {
      const code = String(error.payload?.error ?? "").trim();
      if (code && tMain.has(`web3.wallet.errors.${code}`)) {
        return tMain(`web3.wallet.errors.${code}`);
      }
    }
    return errMsg(error);
  }

  async function linkConnectedWalletAction() {
    setWalletLinking(true);
    setWalletLinkError(null);
    setWalletLinkStatus(tMain("web3.wallet.statusLinking"));

    if (!isWalletConnected || !connectedWalletAddress) {
      setWalletLinking(false);
      setWalletLinkStatus(null);
      setWalletLinkError(tMain("web3.wallet.connectFirst"));
      return;
    }
    if (
      normalizedConnectedWalletAddress
      && normalizedLinkedWalletAddress
      && normalizedConnectedWalletAddress === normalizedLinkedWalletAddress
    ) {
      setWalletLinking(false);
      setWalletLinkStatus(tMain("web3.wallet.alreadyLinked"));
      setWalletLinkError(null);
      return;
    }

    try {
      const noncePayload = await fetchSiweNonce();
      const message = buildSiweMessage({
        domain: window.location.host,
        address: connectedWalletAddress,
        uri: window.location.origin,
        chainId: Number(connectedWalletChainId || 999),
        nonce: noncePayload.nonce,
        statement: tMain("web3.wallet.statement")
      });
      const signature = await signMessage(wagmiConfig, {
        account: connectedWalletAddress as `0x${string}`,
        message
      });
      const linked = await linkSiweWallet({ message, signature, address: connectedWalletAddress });

      const nextWallet = linked.walletAddress ?? connectedWalletAddress;
      setMe((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          walletAddress: nextWallet
        };
      });
      setWalletLinkStatus(
        tMain("web3.wallet.statusLinked", {
          wallet: shortenWalletAddress(nextWallet)
        })
      );
      setWalletLinkError(null);
      const meRes = await apiGet<MeResponse>("/auth/me");
      if (meRes.user) {
        setMe(meRes.user);
      }
    } catch (error) {
      setWalletLinkStatus(null);
      setWalletLinkError(resolveSiweUiError(error));
    } finally {
      setWalletLinking(false);
    }
  }

  async function unlinkLinkedWalletAction() {
    if (!normalizedLinkedWalletAddress) return;
    if (!window.confirm(tMain("web3.wallet.unlinkConfirm"))) return;

    setWalletUnlinking(true);
    setWalletLinkError(null);
    setWalletLinkStatus(tMain("web3.wallet.statusUnlinking"));

    try {
      await unlinkSiweWallet();
      setMe((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          walletAddress: null
        };
      });
      setWalletLinkStatus(tMain("web3.wallet.statusUnlinked"));
      setWalletLinkError(null);
    } catch (error) {
      setWalletLinkStatus(null);
      setWalletLinkError(resolveSiweUiError(error));
    } finally {
      setWalletUnlinking(false);
    }
  }

  return (
    <div className="settingsWrap">
      <PageHeader title={tMain("title")} description={tMain("subtitle")} />

      {error ? (
        <Notice tone="danger" className="card settingsAlert settingsAlertError">
          {error}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" className="card settingsAlert settingsAlertSuccess">
          {notice}
        </Notice>
      ) : null}

      <div className="settingsLandingGrouped">
        {isSuperadmin ? (
          <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupAdmin">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>Admin</h3>
              <div className="settingsSectionMeta">{tMain("admin.access")}</div>
            </div>
            <div className="settingsSectionMeta">
              {tMain("admin.description")}
	            </div>
	            <Link href="/admin" className="btn btnPrimary">
	              <AppIcon name="admin" />
	              {tMain("admin.openBackend")}
	            </Link>
          </section>
        ) : null}

        <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupAccount">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{tMain("account.title")}</h3>
            <div className="settingsSectionMeta">{tMain("account.profile")}</div>
          </div>
          {loading ? <div>{tCommon("loading")}</div> : <div>{me?.email ?? "-"}</div>}
          <div className="settingsAccordionDivider" style={{ marginTop: 12 }} />
          <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>
            {tMain("sections.accountSecurityTools")}
          </div>
          <div className="settingsAccordion">
            <div className={`settingsAccordionItem settingsAccordionItemAccess ${openSettingsSections.language ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("language")}
                aria-expanded={openSettingsSections.language}
              >
                <span>{tMain("sections.language")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.language ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.language ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("language.description")}
                  </div>
                  <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                    {tMain("language.current")}: <b>{locale.toUpperCase()}</b>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={`btn ${locale === "en" ? "btnPrimary" : ""}`}
                      onClick={() => handleLocaleSwitch("en")}
                    >
                      {tMain("language.english")}
                    </button>
                    <button
                      type="button"
                      className={`btn ${locale === "de" ? "btnPrimary" : ""}`}
                      onClick={() => handleLocaleSwitch("de")}
                    >
                      {tMain("language.german")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={`settingsAccordionItem settingsAccordionItemAccess ${openSettingsSections.security ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("security")}
                aria-expanded={openSettingsSections.security}
              >
                <span>{tMain("sections.security")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.security ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.security ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("security.description")}
                  </div>
                  <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>{tMain("security.passwordTitle")}</div>
                  <div className="settingsFormGrid">
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.currentPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.newPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.confirmPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </label>
	                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
	                      <button className="btn btnPrimary" type="button" onClick={savePassword} disabled={!currentPassword || !newPassword}>
	                        <AppIcon name="key" />
	                        {tMain("security.createPassword")}
	                      </button>
                      {passwordStatus ? <span className="settingsMutedText">{passwordStatus}</span> : null}
                    </div>
                    {passwordError ? <div style={{ color: "#ff6b6b", fontSize: 12 }}>{passwordError}</div> : null}
                  </div>

                  <div className="settingsAccordionDivider" />

                  <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>{tMain("security.sessionTitle")}</div>
                  <div className="settingsFormGrid">
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={autoLogoutEnabled}
                        onChange={(e) => setAutoLogoutEnabled(e.target.checked)}
                        disabled={securitySettingsLoading || securitySettingsSaving}
                      />
                      <span>{tMain("security.autoLogout")}</span>
                    </label>
                    <label className="settingsField" style={{ maxWidth: 260 }}>
                      <span className="settingsFieldLabel">{tMain("security.idleMinutes")}</span>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={1440}
                        value={Number.isFinite(autoLogoutMinutes) ? autoLogoutMinutes : 60}
                        onChange={(e) => setAutoLogoutMinutes(Number(e.target.value))}
                        disabled={!autoLogoutEnabled || securitySettingsLoading || securitySettingsSaving}
                      />
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={otpEnabled}
                        onChange={(e) => setOtpEnabled(e.target.checked)}
                        disabled={securitySettingsLoading || securitySettingsSaving}
                      />
                      <span>{tMain("security.requireOtp")}</span>
                    </label>
	                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
	                      <button className="btn btnPrimary" type="button" onClick={saveSecuritySettings} disabled={securitySettingsLoading || securitySettingsSaving}>
	                        <AppIcon name="save" />
	                        {securitySettingsSaving ? tCommon("saving") : tCommon("saveSettings")}
	                      </button>
	                      <button className="btn" type="button" onClick={loadSecuritySettings} disabled={securitySettingsLoading || securitySettingsSaving}>
	                        <AppIcon name="refresh" />
	                        {securitySettingsLoading ? tCommon("loading") : tCommon("reload")}
	                      </button>
                    </div>
                    {securitySettingsMsg ? <div className="settingsMutedText">{securitySettingsMsg}</div> : null}
                  </div>

                  <div className="settingsAccordionDivider" />

                  <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>{tMain("security.resetTitle")}</div>
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("security.resetDescription")}
                  </div>
                  <div className="settingsFormGrid">
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.accountEmail")}</span>
                      <input
                        className="input"
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder={tMain("security.emailPlaceholder")}
                      />
                    </label>
	                    <div>
	                      <button className="btn" type="button" onClick={requestResetCode} disabled={!resetEmail}>
	                        <AppIcon name="mail" />
	                        {tMain("security.sendResetCode")}
	                      </button>
                    </div>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.resetCode")}</span>
                      <input
                        className="input"
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value)}
                        maxLength={6}
                        placeholder={tMain("security.resetCodePlaceholder")}
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.newPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        minLength={8}
                      />
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("security.confirmPassword")}</span>
                      <input
                        className="input"
                        type="password"
                        value={resetConfirmPassword}
                        onChange={(e) => setResetConfirmPassword(e.target.value)}
                        minLength={8}
                      />
                    </label>
                    <div>
                      <button
                        className="btn btnPrimary"
                        type="button"
	                        onClick={confirmResetPassword}
	                        disabled={!resetEmail || resetCode.length !== 6 || resetNewPassword.length < 8}
	                      >
	                        <AppIcon name="key" />
	                        {tMain("security.resetPassword")}
	                      </button>
                    </div>
                    {resetStatus ? <div className="settingsMutedText">{resetStatus}</div> : null}
                    {resetDevCode ? (
                      <div style={{ fontSize: 12, color: "#facc15" }}>
                        {tMain("security.devResetCode")}: <b>{resetDevCode}</b>
                      </div>
                    ) : null}
                    {resetError ? <div style={{ color: "#ff6b6b", fontSize: 12 }}>{resetError}</div> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className={`settingsAccordionItem settingsAccordionItemIntegrations ${openSettingsSections.notifications ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("notifications")}
                aria-expanded={openSettingsSections.notifications}
              >
                <span>{tMain("sections.notifications")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.notifications ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.notifications ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("notifications.description")}
                  </div>
                  {notificationLinkStatus.connectUrl ? (
                    <a
                      className="btn"
                      href={notificationLinkStatus.connectUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ marginBottom: 8 }}
                    >
                      {tMain("notifications.openBot")}
                    </a>
                  ) : null}
                  {!notificationTokenConfigured ? (
                    <div style={{ color: "#fca5a5", marginBottom: 10, fontSize: 12 }}>
                      {tMain("notifications.tokenMissing")}
                    </div>
                  ) : null}
                  <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                    {tMain("notifications.botTokenManaged")}
                  </div>
                  <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                    <div className="settingsMutedText">
                      {tMain("notifications.statusLabel")}: <b>{tMain(`notifications.status.${notificationLinkStatus.status}`)}</b>
                    </div>
                    {notificationLinkStatus.connectedChatId ? (
                      <div className="settingsMutedText" style={{ fontSize: 12 }}>
                        {tMain("notifications.connectedChat")}: <b>{notificationLinkStatus.connectedChatId}</b>
                        {notificationLinkStatus.telegramUsername ? ` (@${notificationLinkStatus.telegramUsername})` : ""}
                      </div>
                    ) : null}
                    {notificationLinkStatus.status === "pending" ? (
                      <div className="settingsMutedText" style={{ fontSize: 12 }}>
                        {tMain("notifications.pendingHint", {
                          expiresAt: formatTelegramLinkExpiry(notificationLinkStatus.expiresAt) ?? "-"
                        })}
                      </div>
                    ) : (
                      <div className="settingsMutedText" style={{ fontSize: 12 }}>
                        {tMain("notifications.privateChatOnly")}
                      </div>
                    )}
                    {notificationBotUsername ? (
                      <div className="settingsMutedText" style={{ fontSize: 12 }}>
                        {tMain("notifications.botHandle", { username: `@${notificationBotUsername}` })}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn btnPrimary"
                        type="button"
	                        onClick={startNotificationLink}
	                        disabled={!notificationTokenConfigured || notificationLinking}
	                      >
	                        <AppIcon name="telegram" />
	                        {notificationLinking ? tCommon("saving") : tMain("notifications.connect")}
	                      </button>
	                      {notificationLinkStatus.connectUrl ? (
	                        <a className="btn" href={notificationLinkStatus.connectUrl} target="_blank" rel="noreferrer">
	                          <AppIcon name="external" />
	                          {tMain("notifications.openBot")}
	                        </a>
	                      ) : null}
                      <button
                        className="btn"
                        type="button"
	                        onClick={refreshNotificationLinkStatus}
	                        disabled={notificationRefreshingLink}
	                      >
	                        <AppIcon name="refresh" />
	                        {notificationRefreshingLink ? tCommon("loading") : tMain("notifications.refreshStatus")}
	                      </button>
                      {notificationLinkStatus.status === "connected" ? (
                        <button
                          className="btn"
                          type="button"
	                          onClick={disconnectNotificationTelegram}
	                          disabled={notificationUnlinking}
	                        >
	                          <AppIcon name="unlink" />
	                          {notificationUnlinking ? tCommon("saving") : tMain("notifications.disconnect")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {notificationManualFallbackEnabled ? (
                    <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                      {tMain("notifications.tipBefore")} <b>-100</b> {tMain("notifications.tipAfter")}
                    </div>
                  ) : null}
                  {notificationManualFallbackEnabled ? (
                    <label className="settingsField" style={{ marginBottom: 10 }}>
                      <span className="settingsFieldLabel">{tMain("notifications.chatIdFallback")}</span>
                      <input
                        className="input"
                        placeholder="123456789"
                        value={notificationChatId}
                        onChange={(e) => setNotificationChatId(e.target.value)}
                      />
                    </label>
                  ) : null}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10, display: "grid", gap: 10 }}>
                    <div style={{ fontWeight: 700 }}>{tMain("notifications.dailyCalendar.title")}</div>
                    <div className="settingsMutedText">
                      {tMain("notifications.dailyCalendar.description")}
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={notificationDailyEnabled}
                        onChange={(e) => setNotificationDailyEnabled(e.target.checked)}
                      />
                      <span>{tMain("notifications.dailyCalendar.enabledLabel")}</span>
                    </label>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("notifications.dailyCalendar.sendTimeLocal")}</span>
                      <input
                        type="time"
                        className="input"
                        value={notificationDailySendTimeLocal}
                        onChange={(e) => setNotificationDailySendTimeLocal(e.target.value)}
                      />
                    </label>
                    <div style={{ display: "grid", gap: 8 }}>
                      <span className="settingsFieldLabel">{tMain("notifications.dailyCalendar.timezone")}</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <input
                          type="radio"
                          name="notification-daily-timezone-mode"
                          checked={notificationDailyTimezoneMode === "device"}
                          onChange={() => setNotificationDailyTimezoneMode("device")}
                        />
                        <span>{tMain("notifications.dailyCalendar.timezoneAuto")}</span>
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <input
                          type="radio"
                          name="notification-daily-timezone-mode"
                          checked={notificationDailyTimezoneMode === "manual"}
                          onChange={() => {
                            setNotificationDailyTimezoneMode("manual");
                            setNotificationDailyTimezoneInput((current) => current.trim() || notificationBrowserTimezone);
                          }}
                        />
                        <span>{tMain("notifications.dailyCalendar.timezoneManual")}</span>
                      </label>
                      {notificationDailyTimezoneMode === "manual" ? (
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("notifications.dailyCalendar.timezone")}</span>
                          <input
                            className="input"
                            list="notification-daily-calendar-timezones"
                            placeholder={tMain("notifications.dailyCalendar.timezoneManualPlaceholder")}
                            value={notificationDailyTimezoneInput}
                            onChange={(e) => setNotificationDailyTimezoneInput(e.target.value)}
                          />
                          <datalist id="notification-daily-calendar-timezones">
                            {NOTIFICATION_CALENDAR_TIMEZONES.map((timezone) => (
                              <option key={timezone} value={timezone} />
                            ))}
                          </datalist>
                        </label>
                      ) : null}
                      <div className="settingsMutedText">
                        {tMain("notifications.dailyCalendar.timezoneDetected")}: <b>{effectiveNotificationDailyTimezone}</b>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span className="settingsFieldLabel">{tMain("notifications.dailyCalendar.currencies")}</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {NOTIFICATION_CALENDAR_CURRENCIES.map((entry) => {
                          const active = notificationDailyCurrencies.includes(entry.code);
                          return (
                            <button
                              key={entry.code}
                              type="button"
                              className="badge"
                              style={{ opacity: active ? 1 : 0.6, cursor: "pointer" }}
                              onClick={() => toggleNotificationCurrency(entry.code)}
                            >
                              {entry.flag} {entry.code}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span className="settingsFieldLabel">{tMain("notifications.dailyCalendar.impacts")}</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {NOTIFICATION_IMPACT_ORDER.map((impact) => {
                          const active = notificationDailyImpacts.includes(impact);
                          return (
                            <button
                              key={impact}
                              type="button"
                              className="badge"
                              style={{ opacity: active ? 1 : 0.6, cursor: "pointer" }}
                              onClick={() => toggleNotificationImpact(impact)}
                            >
                              {tMain(`notifications.dailyCalendar.impact.${impact}`)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
	                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
	                    <button className="btn btnPrimary" type="button" onClick={saveNotificationConfig} disabled={notificationSaving}>
	                      <AppIcon name="save" />
	                      {notificationSaving ? tCommon("saving") : tCommon("saveSettings")}
	                    </button>
	                    <button className="btn" type="button" onClick={sendNotificationTest} disabled={notificationSending}>
	                      <AppIcon name="send" />
	                      {notificationSending ? tMain("notifications.sending") : tMain("notifications.sendTest")}
	                    </button>
                  </div>
                  {notificationMsg ? <div className="settingsMutedText" style={{ marginTop: 8 }}>{notificationMsg}</div> : null}
                </div>
              ) : null}
            </div>

            <div className={`settingsAccordionItem settingsAccordionItemAccess ${openSettingsSections.license_management ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("license_management")}
                aria-expanded={openSettingsSections.license_management}
              >
                <span>{tMain("sections.licenseManagement")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.license_management ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.license_management ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("license.prepared")}
                  </div>
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("license.onceEnabled")}
                  </div>
                  <div className="settingsMutedText">
	                    {licenseManagementEnabled ? (
	                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
	                        <Link href={withLocalePath("/settings/subscription", locale)} className="btn btnPrimary">
	                          <AppIcon name="subscription" />
	                          {tMain("license.openLicense")}
	                        </Link>
	                        <Link href={withLocalePath("/settings/subscription/order", locale)} className="btn">
	                          <AppIcon name="billing" />
	                          {tMain("license.openOrder")}
	                        </Link>
                      </div>
                    ) : tMain("license.currentlyDisabled")}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupWeb3">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{tMain("web3.title")}</h3>
            <div className="settingsSectionMeta">{tMain("web3.access")}</div>
          </div>
          <div className="settingsAccordion">
            <div className={`settingsAccordionItem settingsAccordionItemIntegrations ${openSettingsSections.web3 ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("web3")}
                aria-expanded={openSettingsSections.web3}
              >
                <span>{tMain("web3.title")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.web3 ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.web3 ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    {tMain("web3.description")}
                  </div>
                  <div
                    className={`settingsWalletLinkCard ${walletLinkMissing ? "settingsWalletLinkCardWarn" : walletLinkMismatch ? "settingsWalletLinkCardMismatch" : "settingsWalletLinkCardReady"}`}
                  >
                    <div className="settingsWalletLinkHeader">
                      <div>
                        <div className="settingsInlineTitle">{tMain("web3.wallet.title")}</div>
                        <div className="settingsSectionMeta" style={{ marginBottom: 0 }}>
                          {tMain("web3.wallet.linkRecommended")}
                        </div>
                      </div>
                      <span className={`badge ${walletLinkMissing || walletLinkMismatch ? "badgeWarn" : "badgeOk"}`}>
                        {walletLinkMissing
                          ? tMain("web3.wallet.statusNotLinked")
                          : walletLinkMismatch
                            ? tMain("web3.wallet.statusMismatch")
                            : tMain("web3.wallet.statusReady")}
                      </span>
                    </div>
                    <div className="settingsWalletLinkGrid">
                      <div className="settingsWalletLinkTile">
                        <span className="settingsFieldLabel">{tMain("web3.wallet.current")}</span>
                        <strong>{linkedWalletAddress ? shortenWalletAddress(linkedWalletAddress) : tMain("web3.wallet.notLinked")}</strong>
                      </div>
                      <div className="settingsWalletLinkTile">
                        <span className="settingsFieldLabel">{tMain("web3.wallet.connected")}</span>
                        <strong>
                          {connectedWalletAddress
                            ? shortenWalletAddress(connectedWalletAddress)
                            : tMain("web3.wallet.notConnected")}
                        </strong>
                      </div>
                    </div>
                    <div className="settingsWalletLinkActions">
                      <button
                        className="btn btnPrimary"
                        type="button"
	                        onClick={linkConnectedWalletAction}
	                        disabled={walletActionBusy}
	                      >
	                        <AppIcon name="link" />
	                        {walletLinking ? tMain("web3.wallet.linking") : tMain("web3.wallet.linkButton")}
	                      </button>
                      {linkedWalletAddress ? (
                        <button
                          className="btn"
                          type="button"
	                          onClick={unlinkLinkedWalletAction}
	                          disabled={walletActionBusy}
	                        >
	                          <AppIcon name="unlink" />
	                          {walletUnlinking ? tMain("web3.wallet.unlinking") : tMain("web3.wallet.unlinkButton")}
	                        </button>
	                      ) : null}
	                      <Link href={withLocalePath("/wallet", locale)} className="btn">
	                        <AppIcon name="wallet" />
	                        {tMain("web3.wallet.openWalletDashboard")}
	                      </Link>
                    </div>
                    <div className="settingsMutedText">
                      {walletLinkMissing
                        ? tMain("web3.wallet.hintMissing")
                        : walletLinkMismatch
                          ? tMain("web3.wallet.hintMismatch")
                          : tMain("web3.wallet.hintReady")}
                    </div>
                    {linkedWalletAddress ? (
                      <div className="settingsMutedText">
                        {tMain("web3.wallet.unlinkHint")}
                      </div>
                    ) : null}
                    {walletLinkStatus ? <div className="settingsMutedText">{walletLinkStatus}</div> : null}
                    {walletLinkError ? <div className="settingsWalletLinkError">{walletLinkError}</div> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupAffiliate">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{tMain("sections.affiliateProfitshareSettings")}</h3>
          </div>
          <div className="settingsAccordion">
            <div className={`settingsAccordionItem settingsAccordionItemAffiliate ${openSettingsSections.affiliate ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("affiliate")}
                aria-expanded={openSettingsSections.affiliate}
              >
                <span>Affiliate</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.affiliate ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.affiliate ? (
                <div className="settingsAccordionBody">
                  <div className="settingsSectionMeta" style={{ marginBottom: 8 }}>
                    Referral code, accrued affiliate earnings and vault profit-share links.
                  </div>
                  <AffiliateOverview embedded />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupSettings">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{tMain("sections.cexTradingSettings")}</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
	              <div className="settingsSectionMeta">{tMain("sections.exchangeSettings")}</div>
	              <Link href={withLocalePath("/settings/risk", locale)} className="btn">
	                <AppIcon name="risk" />
	                {tRisk("title")}
	              </Link>
            </div>
          </div>
          <div className="settingsAccordion">
            <div className={`settingsAccordionItem settingsAccordionItemIntegrations ${openSettingsSections.exchange_settings ? "settingsAccordionItemOpen" : ""}`}>
              <button
                className="settingsAccordionTrigger"
                type="button"
                onClick={() => toggleSettingsSection("exchange_settings")}
                aria-expanded={openSettingsSections.exchange_settings}
              >
                <span>{tMain("sections.exchangeSettings")}</span>
                <span className={`settingsAccordionChevron ${openSettingsSections.exchange_settings ? "settingsAccordionChevronOpen" : ""}`}>▾</span>
              </button>
              {openSettingsSections.exchange_settings ? (
                <div className="settingsAccordionBody">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 8
                    }}
                  >
                    <div style={{ minWidth: 260, flex: "1 1 320px" }}>
                      <div className="settingsInlineTitle">{tMain("exchange.addTitle")}</div>
                      <div className="settingsMutedText">
                        {tMain("exchange.paperHint")}
                      </div>
                    </div>
                    <label className="settingsField" style={{ minWidth: 240, maxWidth: 340, marginLeft: "auto" }}>
                      <span className="settingsFieldLabel">{tMain("exchange.fields.serverIpAddress")}</span>
                      <input
                        className="input"
                        value={serverIpAddress ?? tMain("exchange.serverIpNotConfigured")}
                        readOnly
                      />
                      <span className="settingsMutedText">{tMain("exchange.serverIpHint")}</span>
                    </label>
                  </div>
                  <form onSubmit={createAccount} className="settingsFormGrid">
                    {exchangeOptions.length === 0 ? (
                      <div className="settingsMutedText">
                        {tMain("exchange.noEnabledExchange")}
                      </div>
                    ) : null}
                    <div className="settingsTwoColGrid">
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("exchange.fields.exchange")}</span>
                        <select className="input" value={exchange} onChange={(e) => setExchange(e.target.value)} required>
                          {exchangeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("exchange.fields.label")}</span>
                        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
                      </label>
                    </div>
                    {paperMode ? (
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("exchange.fields.marketDataAccount")}</span>
                        <select
                          className="input"
                          value={marketDataExchangeAccountId}
                          onChange={(e) => setMarketDataExchangeAccountId(e.target.value)}
                          required
                        >
                          <option value="" disabled>
                            {tMain("exchange.selectLiveCex")}
                          </option>
                          {marketDataAccounts.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} ({item.exchange.toUpperCase()})
                            </option>
                          ))}
                        </select>
                        {marketDataAccounts.length === 0 ? (
                          <span className="settingsMutedText">
                            {tMain("exchange.createLiveFirst")}
                          </span>
                        ) : null}
                      </label>
                    ) : (
                      <>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("exchange.fields.apiKey")}</span>
                          <input
                            className="input"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            required={credentialsRequired}
                          />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("exchange.fields.apiSecret")}</span>
                          <input
                            className="input"
                            value={apiSecret}
                            onChange={(e) => setApiSecret(e.target.value)}
                            required={credentialsRequired}
                          />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">
                            {hyperliquidMode
                              ? "Account / Vault Address (optional)"
                              : (passphraseRequired ? tMain("exchange.fields.passphraseRequired") : tMain("exchange.fields.passphraseOptional"))}
                          </span>
                          <input
                            className="input"
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                            required={passphraseRequired}
                          />
                        </label>
                        {mexcMode ? (
                          <div className="settingsMutedText">
                            MEXC Spot nutzt `apiKey` + `apiSecret`. Passphrase wird nicht benötigt.
                          </div>
                        ) : null}
                        {hyperliquidMode ? (
                          <div className="settingsMutedText">
                            {tMain("exchange.fields.hyperliquidPassphraseHint")}
                          </div>
                        ) : null}
                        {binanceMode ? (
                          <div className="settingsMutedText">
                            Binance nutzt API-Key und Secret für Spot- und USD-M-Perp-Sync. Schreibzugriffe bleiben serverseitig per Kill-Switch steuerbar.
                          </div>
                        ) : null}
                      </>
                    )}
                    <button
                      className="btn btnPrimary"
                      type="submit"
                      disabled={
                        saving ||
                        exchangeOptions.length === 0 ||
                        !exchange ||
                        !label ||
                        (paperMode
                          ? !marketDataExchangeAccountId
                          : (credentialsRequired && (!apiKey || !apiSecret || (passphraseRequired && !passphrase))))
	                      }
	                    >
	                      <AppIcon name="create" />
	                      {saving ? tCommon("saving") : tMain("exchange.addAccount")}
	                    </button>
                  </form>

                  <div className="settingsAccordionDivider" />

                  <div className="settingsInlineTitle" style={{ marginBottom: 8 }}>{tMain("exchange.existingAccounts")}</div>
                  {accounts.length === 0 ? (
                    <div className="settingsMutedText">{tMain("exchange.noAccounts")}</div>
                  ) : (
                    <div className="settingsAccountList">
                      {accounts.map((account) => (
                        <div key={account.id} className="card settingsAccountCard">
                          <div>
                            <div style={{ fontWeight: 700 }}>{account.label}</div>
                            <div className="settingsMutedText">
                              {account.exchange} · {account.apiKeyMasked}
                            </div>
                            {account.exchange === "hyperliquid" ? (
                              <>
                                <div className="settingsMutedText">
                                  HyperCore legacy read target: {shortenAddress(account.readAddress)}
                                  {account.readAddressSource === "account_or_vault" ? " (account/vault)" : account.readAddressSource === "wallet" ? " (wallet)" : ""}
                                </div>
                                <div className="settingsMutedText">
                                  Signing wallet: {shortenAddress(account.signingAddress)}
                                </div>
                                {renderHyperliquidCredentialExpiry(account)}
                              </>
                            ) : null}
                            {account.exchange === "paper" ? (
                              <div className="settingsMutedText">
                                {tMain("exchange.marketData")}: {account.marketDataLabel ?? account.marketDataExchangeAccountId ?? tMain("exchange.notConfigured")}
                                {account.marketDataExchange ? ` (${account.marketDataExchange.toUpperCase()})` : ""}
                              </div>
                            ) : null}
                            <div className="settingsMutedText">
                              {tMain("exchange.lastSync")}: {account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleString() : tMain("exchange.never")}
                            </div>
                            {account.futuresBudget ? (
                              <div className="settingsMutedText">
                                Futures: equity {account.futuresBudget.equity ?? "-"} · available {account.futuresBudget.availableMargin ?? "-"}
                                {account.futuresBudget.marginCoin ? ` ${account.futuresBudget.marginCoin}` : ""}
                              </div>
                            ) : null}
                            {account.lastSyncError?.message ? (
                              <div className="settingsMutedText" style={{ color: "#d14343" }}>
                                Sync error: {account.lastSyncError.message}
                              </div>
                            ) : null}
                            {editingAccountId === account.id ? (
                              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                                <label className="settingsField">
                                  <span className="settingsFieldLabel">{tMain("exchange.fields.label")}</span>
                                  <input
                                    className="input"
                                    value={editLabel}
                                    onChange={(e) => setEditLabel(e.target.value)}
                                  />
                                </label>
                                {account.exchange === "paper" ? (
                                  <label className="settingsField">
                                    <span className="settingsFieldLabel">{tMain("exchange.fields.marketDataAccount")}</span>
                                    <select
                                      className="input"
                                      value={editMarketDataExchangeAccountId}
                                      onChange={(e) => setEditMarketDataExchangeAccountId(e.target.value)}
                                    >
                                      <option value="" disabled>
                                        {tMain("exchange.selectLiveCex")}
                                      </option>
                                      {marketDataAccounts
                                        .filter((item) => item.id !== account.id)
                                        .map((item) => (
                                          <option key={item.id} value={item.id}>
                                            {item.label} ({item.exchange.toUpperCase()})
                                          </option>
                                        ))}
                                    </select>
                                  </label>
                                ) : (
                                  <>
                                    <label className="settingsField">
                                      <span className="settingsFieldLabel">{tMain("exchange.fields.apiKey")}</span>
                                      <input
                                        className="input"
                                        value={editApiKey}
                                        onChange={(e) => setEditApiKey(e.target.value)}
                                        placeholder={tMain("exchange.keepExistingCredentials")}
                                      />
                                    </label>
                                    <label className="settingsField">
                                      <span className="settingsFieldLabel">{tMain("exchange.fields.apiSecret")}</span>
                                      <input
                                        className="input"
                                        value={editApiSecret}
                                        onChange={(e) => setEditApiSecret(e.target.value)}
                                        placeholder={tMain("exchange.keepExistingCredentials")}
                                      />
                                    </label>
                                    <label className="settingsField">
                                      <span className="settingsFieldLabel">
                                        {account.exchange === "hyperliquid"
                                          ? "Account / Vault Address (optional)"
                                          : (account.exchange === "bitget"
                                              ? tMain("exchange.fields.passphraseRequired")
                                              : tMain("exchange.fields.passphraseOptional"))}
                                      </span>
                                      <input
                                        className="input"
                                        value={editPassphrase}
                                        onChange={(e) => {
                                          setEditPassphrase(e.target.value);
                                          if (e.target.value.trim()) setEditClearPassphrase(false);
                                        }}
                                        placeholder={tMain("exchange.keepExistingPassphrase")}
                                      />
                                    </label>
                                    {account.exchange !== "bitget" ? (
                                      <label className="settingsMutedText" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <input
                                          type="checkbox"
                                          checked={editClearPassphrase}
                                          onChange={(e) => setEditClearPassphrase(e.target.checked)}
                                          disabled={Boolean(editPassphrase.trim())}
                                        />
                                        <span>{tMain("exchange.clearPassphrase")}</span>
                                      </label>
                                    ) : null}
                                    {account.exchange === "hyperliquid" ? (
                                      <div className="settingsMutedText">
                                        {tMain("exchange.fields.hyperliquidPassphraseHint")}
                                      </div>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            ) : null}
                          </div>
                          <div className="settingsAccountActions">
                            {editingAccountId === account.id ? (
                              <>
                                <button
                                  className="btn btnPrimary"
                                  onClick={() => void saveAccount(account)}
                                  disabled={
                                    savingEditId === account.id ||
                                    !editLabel.trim() ||
                                    (account.exchange === "paper" && !editMarketDataExchangeAccountId)
                                  }
	                                >
	                                  <AppIcon name="save" />
	                                  {savingEditId === account.id ? tCommon("saving") : tMain("exchange.saveChanges")}
	                                </button>
	                                <button className="btn" onClick={cancelEditingAccount} disabled={savingEditId === account.id}>
	                                  <AppIcon name="cancel" />
	                                  {tMain("exchange.cancelEdit")}
	                                </button>
                              </>
	                            ) : (
	                              <button className="btn" onClick={() => startEditingAccount(account)}>
	                                <AppIcon name="edit" />
	                                {tMain("exchange.editAccount")}
	                              </button>
                            )}
                            <button
                              className="btn"
                              onClick={() => void syncAccount(account.id)}
	                              disabled={syncingId === account.id || editingAccountId === account.id}
	                            >
	                              <AppIcon name="refresh" />
	                              {syncingId === account.id ? tMain("exchange.syncing") : tMain("exchange.syncNow")}
	                            </button>
	                            <button className="btn" onClick={() => void deleteAccount(account.id)} disabled={editingAccountId === account.id}>
	                              <AppIcon name="delete" />
	                              {tMain("actions.delete")}
	                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>

    </div>
  );
}

export default function SettingsPage() {
  return (
    <Web3Providers>
      <SettingsPageContent />
    </Web3Providers>
  );
}
