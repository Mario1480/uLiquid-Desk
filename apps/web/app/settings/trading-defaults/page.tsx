"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { AppIcon } from "../../components/AppIcon";
import { Notice, PageHeader } from "../../components/ui";

type ExchangeAccountItem = {
  id: string;
  exchange: string;
  label: string;
  supportsSpotManual?: boolean;
  supportsPerpManual?: boolean;
};

type TradingSettings = {
  exchangeAccountId: string | null;
  symbol: string | null;
  timeframe: string | null;
  marketType: "spot" | "perp";
  marginMode: "isolated" | "cross" | null;
  leverage: number | null;
  quoteCurrency: string | null;
  timezone: string | null;
};

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
const QUOTE_CURRENCIES = ["USDT", "USDC", "USD"] as const;

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

const TIMEZONES = listSupportedTimezones();

function resolveBrowserTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) return timezone;
  } catch {
    // ignore
  }
  return "UTC";
}

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

function defaultSettings(): TradingSettings {
  return {
    exchangeAccountId: null,
    symbol: "BTCUSDT",
    timeframe: "15m",
    marketType: "perp",
    marginMode: "cross",
    leverage: 10,
    quoteCurrency: "USDC",
    timezone: resolveBrowserTimezone()
  };
}

export default function TradingDefaultsPage() {
  const t = useTranslations("settings.tradingDefaults");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [settings, setSettings] = useState<TradingSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === settings.exchangeAccountId) ?? null,
    [accounts, settings.exchangeAccountId]
  );

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [accountPayload, savedSettings] = await Promise.all([
        apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts?purpose=execution"),
        apiGet<TradingSettings>("/api/trading/settings")
      ]);
      const rows = accountPayload.items ?? [];
      setAccounts(rows);
      setSettings({
        ...defaultSettings(),
        ...savedSettings,
        exchangeAccountId: savedSettings.exchangeAccountId ?? rows[0]?.id ?? null,
        symbol: savedSettings.symbol ?? "BTCUSDT",
        timeframe: savedSettings.timeframe ?? "15m",
        marginMode: savedSettings.marginMode ?? "cross",
        leverage: savedSettings.leverage ?? 10,
        quoteCurrency: savedSettings.quoteCurrency ?? (savedSettings.marketType === "perp" ? "USDC" : "USDT"),
        timezone: savedSettings.timezone ?? resolveBrowserTimezone()
      });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        exchangeAccountId: settings.exchangeAccountId || null,
        symbol: settings.symbol?.trim() || null,
        timeframe: settings.timeframe || null,
        marketType: settings.marketType,
        marginMode: settings.marginMode,
        leverage: settings.leverage,
        quoteCurrency: settings.quoteCurrency?.trim().toUpperCase() || null,
        timezone: settings.timezone?.trim() || null
      };
      const saved = await apiPost<TradingSettings>("/api/trading/settings", payload);
      setSettings({
        ...settings,
        ...saved,
        leverage: saved.leverage ?? settings.leverage,
        quoteCurrency: saved.quoteCurrency ?? settings.quoteCurrency,
        timezone: saved.timezone ?? settings.timezone
      });
      setNotice(t("messages.saved"));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  return (
    <div className="settingsWrap">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={(
          <Link className="btn" href={withLocalePath("/settings", locale)}>
            <AppIcon name="back" />
            {tCommon("backToSettings")}
          </Link>
        )}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <div className="settingsInlineTitle">{t("form.title")}</div>
            <div className="settingsMutedText">{t("form.description")}</div>
          </div>
          <button className="btn" type="button" onClick={loadAll} disabled={loading}>
            <AppIcon name="refresh" />
            {tCommon("reload")}
          </button>
        </div>

        {loading ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : (
          <div className="settingsFormGrid">
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("fields.exchangeAccount")}</span>
              <select
                className="input"
                value={settings.exchangeAccountId ?? ""}
                onChange={(event) => setSettings((current) => ({ ...current, exchangeAccountId: event.target.value || null }))}
              >
                <option value="">{t("fields.noDefault")}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.exchange.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>

            <div className="settingsFormGrid settingsTradingDefaultsGrid">
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("fields.marketType")}</span>
                <select
                  className="input"
                  value={settings.marketType}
                  onChange={(event) => setSettings((current) => ({ ...current, marketType: event.target.value === "spot" ? "spot" : "perp" }))}
                >
                  <option value="perp">{t("marketTypes.perp")}</option>
                  <option value="spot">{t("marketTypes.spot")}</option>
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("fields.marginMode")}</span>
                <select
                  className="input"
                  value={settings.marginMode ?? ""}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    marginMode: event.target.value === "isolated" || event.target.value === "cross" ? event.target.value : null
                  }))}
                >
                  <option value="">{t("fields.noDefault")}</option>
                  <option value="cross">{t("marginModes.cross")}</option>
                  <option value="isolated">{t("marginModes.isolated")}</option>
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("fields.leverage")}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={125}
                  value={settings.leverage ?? ""}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    leverage: event.target.value ? Number(event.target.value) : null
                  }))}
                />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("fields.quoteCurrency")}</span>
                <select
                  className="input"
                  value={settings.quoteCurrency ?? ""}
                  onChange={(event) => setSettings((current) => ({ ...current, quoteCurrency: event.target.value || null }))}
                >
                  <option value="">{t("fields.noDefault")}</option>
                  {QUOTE_CURRENCIES.map((quote) => (
                    <option key={quote} value={quote}>{quote}</option>
                  ))}
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("fields.symbol")}</span>
                <input
                  className="input"
                  value={settings.symbol ?? ""}
                  onChange={(event) => setSettings((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
                  placeholder="BTCUSDT"
                />
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("fields.timeframe")}</span>
                <select
                  className="input"
                  value={settings.timeframe ?? ""}
                  onChange={(event) => setSettings((current) => ({ ...current, timeframe: event.target.value || null }))}
                >
                  <option value="">{t("fields.noDefault")}</option>
                  {TIMEFRAMES.map((timeframe) => (
                    <option key={timeframe} value={timeframe}>{timeframe}</option>
                  ))}
                </select>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("fields.timezone")}</span>
                <input
                  className="input"
                  list="settings-trading-timezones"
                  value={settings.timezone ?? ""}
                  onChange={(event) => setSettings((current) => ({ ...current, timezone: event.target.value }))}
                  placeholder={resolveBrowserTimezone()}
                />
                <datalist id="settings-trading-timezones">
                  {TIMEZONES.map((timezone) => (
                    <option key={timezone} value={timezone} />
                  ))}
                </datalist>
              </label>
            </div>

            <div className="settingsWalletLinkCard">
              <div className="settingsWalletLinkHeader">
                <div>
                  <div className="settingsInlineTitle">{t("preview.title")}</div>
                  <div className="settingsMutedText">
                    {selectedAccount
                      ? t("preview.account", { label: selectedAccount.label, exchange: selectedAccount.exchange.toUpperCase() })
                      : t("preview.noAccount")}
                  </div>
                </div>
                <span className="badge">{settings.marketType.toUpperCase()}</span>
              </div>
              <div className="settingsHubSummary settingsTradingDefaultsSummary">
                <div className="miniMetric">
                  <span>{t("preview.symbol")}</span>
                  <b>{settings.symbol || "-"}</b>
                </div>
                <div className="miniMetric">
                  <span>{t("preview.margin")}</span>
                  <b>{settings.marginMode ?? "-"}</b>
                </div>
                <div className="miniMetric">
                  <span>{t("preview.leverage")}</span>
                  <b>{settings.leverage ? `${settings.leverage}x` : "-"}</b>
                </div>
                <div className="miniMetric">
                  <span>{t("preview.quote")}</span>
                  <b>{settings.quoteCurrency ?? "-"}</b>
                </div>
              </div>
            </div>

            <div className="settingsHubInlineActions">
              <button className="btn btnPrimary" type="button" onClick={save} disabled={saving}>
                <AppIcon name="save" />
                {saving ? tCommon("saving") : tCommon("saveSettings")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
