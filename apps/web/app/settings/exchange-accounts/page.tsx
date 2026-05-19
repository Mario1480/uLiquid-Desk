"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import {
  isProductFeatureAllowed,
  type ProductFeatureGateMap
} from "../../../src/access/productFeatureGates";
import AdminConfirmDialog from "../../admin/_components/AdminConfirmDialog";
import { AppIcon } from "../../components/AppIcon";
import { Notice, PageHeader } from "../../components/ui";

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

type ExchangeOption = {
  value: string;
  label: string;
  enabled: boolean;
};

type ExchangeSyncResponse = {
  ok: boolean;
  message?: string;
  pnlTodayUsd?: number | null;
  futuresBudget?: {
    equity: number | null;
    availableMargin: number | null;
    marginCoin: string | null;
  } | null;
};

type SubscriptionFeatureResponse = {
  featureGates?: ProductFeatureGateMap;
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatMoney(value: number | null | undefined, currency = "USDT"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function exchangeLabel(option: ExchangeOption | undefined, fallback: string): string {
  return option?.label ?? fallback.toUpperCase();
}

export default function ExchangeAccountsPage() {
  const t = useTranslations("settings.exchangeAccounts");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);
  const [serverIpAddress, setServerIpAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const marketDataAccounts = useMemo(
    () => accounts.filter((item) => item.exchange !== "paper"),
    [accounts]
  );
  const paperMode = exchange === "paper";
  const passphraseRequired = exchange === "bitget";
  const credentialsRequired = !paperMode;

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [accountRes, exchangesRes, serverInfoRes, subscriptionRes] = await Promise.all([
        apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts"),
        apiGet<{ options: ExchangeOption[] }>("/settings/exchange-options"),
        apiGet<{ serverIpAddress?: string | null }>("/settings/server-info"),
        apiGet<SubscriptionFeatureResponse>("/settings/subscription").catch(() => null)
      ]);

      const nextAccounts = accountRes.items ?? [];
      const nextFeatureGates = subscriptionRes?.featureGates ?? {};
      const paperTradingEnabled = isProductFeatureAllowed(nextFeatureGates, "paper_trading");
      const allowedOptions = (exchangesRes.options ?? [])
        .filter((item) => item.enabled)
        .filter((item) => paperTradingEnabled || item.value !== "paper");

      setAccounts(nextAccounts);
      setExchangeOptions(allowedOptions);
      const dataAccounts = nextAccounts.filter((item) => item.exchange !== "paper");
      if (!marketDataExchangeAccountId && dataAccounts.length > 0) {
        setMarketDataExchangeAccountId(dataAccounts[0].id);
      }
      setServerIpAddress(
        typeof serverInfoRes.serverIpAddress === "string" && serverInfoRes.serverIpAddress.trim()
          ? serverInfoRes.serverIpAddress.trim()
          : null
      );
      if (allowedOptions.length > 0 && !allowedOptions.some((item) => item.value === exchange)) {
        setExchange(allowedOptions[0].value);
      }
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
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

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
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
      setNotice(t("messages.created"));
      await loadAll();
    } catch (createError) {
      setError(errMsg(createError));
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
        apiKey: account.exchange === "paper" ? undefined : editApiKey.trim() || undefined,
        apiSecret: account.exchange === "paper" ? undefined : editApiSecret.trim() || undefined,
        passphrase: account.exchange === "paper" ? undefined : editPassphrase.trim() || undefined,
        clearPassphrase: account.exchange === "paper" ? undefined : editClearPassphrase && !editPassphrase.trim(),
        marketDataExchangeAccountId: account.exchange === "paper"
          ? editMarketDataExchangeAccountId || undefined
          : undefined
      });
      setNotice(t("messages.updated"));
      cancelEditingAccount();
      await loadAll();
    } catch (saveError) {
      setError(errMsg(saveError));
    } finally {
      setSavingEditId(null);
    }
  }

  async function deleteAccount(id: string) {
    setDeletingId(id);
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/exchange-accounts/${id}`);
      setDeleteId(null);
      setNotice(t("messages.deleted"));
      await loadAll();
    } catch (deleteError) {
      setError(errMsg(deleteError));
    } finally {
      setDeletingId(null);
    }
  }

  async function syncAccount(id: string) {
    setError(null);
    setNotice(null);
    setSyncingId(id);
    try {
      const payload = await apiPost<ExchangeSyncResponse>(`/exchange-accounts/${id}/test-connection`);
      const parts = [
        payload?.message || t("messages.syncSuccessful"),
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
    } catch (syncError) {
      setError(errMsg(syncError));
    } finally {
      setSyncingId(null);
    }
  }

  function renderCredentialStatus(account: ExchangeAccountItem) {
    if (account.exchange !== "hyperliquid" || !account.credentialExpiryState) return null;
    const tone = account.credentialExpiryState === "expired"
      ? "uiStatusBadge-danger"
      : account.credentialExpiryState === "warning"
        ? "uiStatusBadge-warning"
        : "uiStatusBadge-success";
    return (
      <span className={`badge ${tone}`}>
        {t(`credential.${account.credentialExpiryState}`)}
      </span>
    );
  }

  return (
    <div className="settingsWrap">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={(
          <>
            <Link className="btn" href={withLocalePath("/settings", locale)}>
              <AppIcon name="back" />
              {tCommon("backToSettings")}
            </Link>
            <button className="btn" type="button" onClick={() => void loadAll()} disabled={loading}>
              <AppIcon name="refresh" />
              {loading ? tCommon("loading") : tCommon("reload")}
            </button>
          </>
        )}
      />

      {error ? <Notice tone="danger" className="card settingsAlert settingsAlertError">{error}</Notice> : null}
      {notice ? <Notice tone="success" className="card settingsAlert settingsAlertSuccess">{notice}</Notice> : null}

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>{t("create.title")}</h3>
            <div className="settingsMutedText">{t("create.description")}</div>
          </div>
          {serverIpAddress ? <span className="badge">{t("serverIp", { ip: serverIpAddress })}</span> : null}
        </div>

        <form className="settingsFormGrid" onSubmit={createAccount}>
          <div className="settingsTwoColGrid">
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("fields.exchange")}</span>
              <select className="input" value={exchange} onChange={(event) => setExchange(event.target.value)}>
                {exchangeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("fields.label")}</span>
              <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("fields.labelPlaceholder")} />
            </label>
            {paperMode ? (
              <label className="settingsField">
                <span className="settingsFieldLabel">{t("fields.marketDataAccount")}</span>
                <select
                  className="input"
                  value={marketDataExchangeAccountId}
                  onChange={(event) => setMarketDataExchangeAccountId(event.target.value)}
                  disabled={marketDataAccounts.length === 0}
                >
                  {marketDataAccounts.length === 0 ? <option value="">{t("fields.noMarketDataAccounts")}</option> : null}
                  {marketDataAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label} ({account.exchange.toUpperCase()})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{exchange === "hyperliquid" ? t("fields.walletAddress") : t("fields.apiKey")}</span>
                  <input className="input" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{exchange === "hyperliquid" ? t("fields.privateKey") : t("fields.apiSecret")}</span>
                  <input className="input" type="password" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} autoComplete="new-password" />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{passphraseRequired ? t("fields.passphraseRequired") : t("fields.passphraseOptional")}</span>
                  <input className="input" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" />
                </label>
              </>
            )}
          </div>

          <div className="settingsWalletLinkActions">
            <button
              className="btn btnPrimary"
              type="submit"
              disabled={saving || !label.trim() || (credentialsRequired && (!apiKey.trim() || !apiSecret.trim())) || (passphraseRequired && !passphrase.trim()) || (paperMode && !marketDataExchangeAccountId)}
            >
              <AppIcon name="create" />
              {saving ? tCommon("saving") : t("create.submit")}
            </button>
            <Link className="btn" href={withLocalePath("/settings/risk", locale)}>
              <AppIcon name="risk" />
              {t("create.riskLink")}
            </Link>
          </div>
        </form>
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>{t("list.title")}</h3>
            <div className="settingsMutedText">{t("list.description")}</div>
          </div>
          <span className="badge">{t("list.count", { count: accounts.length })}</span>
        </div>

        {loading ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : accounts.length === 0 ? (
          <div className="uiEmptyState">{t("list.empty")}</div>
        ) : (
          <div className="settingsAccountList">
            {accounts.map((account) => {
              const option = exchangeOptions.find((item) => item.value === account.exchange);
              const isEditing = editingAccountId === account.id;
              const marginCoin = account.futuresBudget?.marginCoin ?? (account.exchange === "hyperliquid" ? "USDC" : "USDT");
              return (
                <div className="card settingsAccountCard" key={account.id}>
                  <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{account.label}</strong>
                      <span className="badge">{exchangeLabel(option, account.exchange)}</span>
                      {renderCredentialStatus(account)}
                    </div>
                    <div className="settingsMutedText">
                      {t("fields.apiKey")}: {account.apiKeyMasked || "****"} · {t("list.lastUsed")}: {formatDateTime(account.lastUsedAt)}
                    </div>
                    {account.marketDataLabel ? (
                      <div className="settingsMutedText">
                        {t("fields.marketDataAccount")}: {account.marketDataLabel} ({account.marketDataExchange?.toUpperCase()})
                      </div>
                    ) : null}
                    {account.signingAddress ? (
                      <div className="settingsMutedText">
                        {t("fields.walletAddress")}: {account.signingAddress}
                      </div>
                    ) : null}
                    {account.futuresBudget ? (
                      <div className="settingsMutedText">
                        {t("list.equity")}: {formatMoney(account.futuresBudget.equity, marginCoin)} · {t("list.available")}: {formatMoney(account.futuresBudget.availableMargin, marginCoin)}
                      </div>
                    ) : null}
                    {account.lastSyncError?.message ? (
                      <div className="settingsWalletLinkError">
                        {t("list.lastSyncError")}: {account.lastSyncError.message}
                      </div>
                    ) : null}

                    {isEditing ? (
                      <div className="settingsFormGrid">
                        <div className="settingsTwoColGrid">
                          <label className="settingsField">
                            <span className="settingsFieldLabel">{t("fields.label")}</span>
                            <input className="input" value={editLabel} onChange={(event) => setEditLabel(event.target.value)} />
                          </label>
                          {account.exchange === "paper" ? (
                            <label className="settingsField">
                              <span className="settingsFieldLabel">{t("fields.marketDataAccount")}</span>
                              <select className="input" value={editMarketDataExchangeAccountId} onChange={(event) => setEditMarketDataExchangeAccountId(event.target.value)}>
                                {marketDataAccounts.map((marketDataAccount) => (
                                  <option key={marketDataAccount.id} value={marketDataAccount.id}>
                                    {marketDataAccount.label} ({marketDataAccount.exchange.toUpperCase()})
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <>
                              <label className="settingsField">
                                <span className="settingsFieldLabel">{account.exchange === "hyperliquid" ? t("fields.walletAddress") : t("fields.apiKey")}</span>
                                <input className="input" value={editApiKey} onChange={(event) => setEditApiKey(event.target.value)} placeholder={t("fields.keepCurrent")} />
                              </label>
                              <label className="settingsField">
                                <span className="settingsFieldLabel">{account.exchange === "hyperliquid" ? t("fields.privateKey") : t("fields.apiSecret")}</span>
                                <input className="input" type="password" value={editApiSecret} onChange={(event) => setEditApiSecret(event.target.value)} placeholder={t("fields.keepCurrent")} />
                              </label>
                              <label className="settingsField">
                                <span className="settingsFieldLabel">{t("fields.passphraseOptional")}</span>
                                <input className="input" type="password" value={editPassphrase} onChange={(event) => setEditPassphrase(event.target.value)} placeholder={t("fields.keepCurrent")} />
                              </label>
                              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="checkbox" checked={editClearPassphrase} onChange={(event) => setEditClearPassphrase(event.target.checked)} disabled={Boolean(editPassphrase.trim())} />
                                <span>{t("fields.clearPassphrase")}</span>
                              </label>
                            </>
                          )}
                        </div>
                        <div className="settingsWalletLinkActions">
                          <button className="btn btnPrimary" type="button" onClick={() => void saveAccount(account)} disabled={savingEditId === account.id || !editLabel.trim()}>
                            <AppIcon name="save" />
                            {savingEditId === account.id ? tCommon("saving") : tCommon("saveSettings")}
                          </button>
                          <button className="btn" type="button" onClick={cancelEditingAccount} disabled={savingEditId === account.id}>
                            <AppIcon name="cancel" />
                            {t("actions.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="settingsAccountActions">
                    <button className="btn" type="button" onClick={() => void syncAccount(account.id)} disabled={syncingId === account.id}>
                      <AppIcon name="refresh" />
                      {syncingId === account.id ? t("actions.testing") : t("actions.test")}
                    </button>
                    <button className="btn" type="button" onClick={() => startEditingAccount(account)}>
                      <AppIcon name="edit" />
                      {t("actions.edit")}
                    </button>
                    <button className="btn btnStop" type="button" onClick={() => setDeleteId(account.id)} disabled={deletingId === account.id}>
                      <AppIcon name="delete" />
                      {deletingId === account.id ? tCommon("deleting") : t("actions.delete")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AdminConfirmDialog
        open={Boolean(deleteId)}
        title={t("confirm.deleteTitle")}
        description={t("confirm.deleteDescription")}
        confirmLabel={t("actions.delete")}
        loading={Boolean(deleteId && deletingId === deleteId)}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) void deleteAccount(deleteId);
        }}
      />
    </div>
  );
}
