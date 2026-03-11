"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

type VaultExecutionMode = "offchain_shadow" | "onchain_simulated" | "onchain_live";
type VaultExecutionProvider = "mock" | "hyperliquid_demo" | "hyperliquid";
type GridHyperliquidPilotSettings = {
  enabled: boolean;
  allowedUserIds: string[];
  allowedWorkspaceIds: string[];
  updatedAt?: string | null;
};

type HypervaultsExecutionAccountState = {
  enabled: boolean;
  configured: boolean;
  valid: boolean;
  status: "missing" | "disabled" | "invalid" | "ready";
  apiKeyMasked: string | null;
  vaultAddressMasked: string | null;
  updatedAt: string | null;
  credentialSource: "global_admin";
  globalExecutionAccountId: string | null;
};

type VaultExecutionModeResponse = {
  mode: VaultExecutionMode;
  source: "db" | "env";
  updatedAt: string | null;
  provider: VaultExecutionProvider;
  providerSource: "db" | "env";
  providerUpdatedAt: string | null;
  defaults: { mode: VaultExecutionMode; provider: VaultExecutionProvider };
  availableModes: VaultExecutionMode[];
  availableProviders: VaultExecutionProvider[];
  hypervaultsExecutionAccount: HypervaultsExecutionAccountState;
  hyperliquidPilot: GridHyperliquidPilotSettings;
  hyperliquidPilotUpdatedAt: string | null;
};

function parseListInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function AdminVaultExecutionPage() {
  const t = useTranslations("admin.vaultExecution");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<VaultExecutionModeResponse | null>(null);
  const [mode, setMode] = useState<VaultExecutionMode>("offchain_shadow");
  const [provider, setProvider] = useState<VaultExecutionProvider>("mock");
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [globalApiKey, setGlobalApiKey] = useState("");
  const [globalApiSecret, setGlobalApiSecret] = useState("");
  const [globalVaultAddress, setGlobalVaultAddress] = useState("");
  const [pilotEnabled, setPilotEnabled] = useState(false);
  const [pilotUserIdsInput, setPilotUserIdsInput] = useState("");
  const [pilotWorkspaceIdsInput, setPilotWorkspaceIdsInput] = useState("");

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
      const payload = await apiGet<VaultExecutionModeResponse>("/admin/settings/vault-execution-mode");
      setSettings(payload);
      setMode(payload.mode);
      setProvider(payload.provider);
      setGlobalEnabled(Boolean(payload.hypervaultsExecutionAccount?.enabled));
      setGlobalApiKey("");
      setGlobalApiSecret("");
      setGlobalVaultAddress("");
      setPilotEnabled(Boolean(payload.hyperliquidPilot?.enabled));
      setPilotUserIdsInput((payload.hyperliquidPilot?.allowedUserIds ?? []).join("\n"));
      setPilotWorkspaceIdsInput((payload.hyperliquidPilot?.allowedWorkspaceIds ?? []).join("\n"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut<HypervaultsExecutionAccountState>("/admin/settings/hypervaults-execution-account", {
        enabled: globalEnabled,
        apiKey: globalApiKey.trim() ? globalApiKey.trim() : undefined,
        apiSecret: globalApiSecret.trim() ? globalApiSecret.trim() : undefined,
        vaultAddress: globalVaultAddress.trim() ? globalVaultAddress.trim() : null,
        clearVaultAddress: !globalVaultAddress.trim()
      });
      const payload = await apiPut<VaultExecutionModeResponse>("/admin/settings/vault-execution-mode", {
        mode,
        provider,
        hyperliquidPilot: {
          enabled: pilotEnabled,
          allowedUserIds: parseListInput(pilotUserIdsInput),
          allowedWorkspaceIds: parseListInput(pilotWorkspaceIdsInput)
        }
      });
      setSettings(payload);
      setMode(payload.mode);
      setProvider(payload.provider);
      setGlobalEnabled(Boolean(payload.hypervaultsExecutionAccount?.enabled));
      setGlobalApiKey("");
      setGlobalApiSecret("");
      setGlobalVaultAddress("");
      setPilotEnabled(Boolean(payload.hyperliquidPilot?.enabled));
      setPilotUserIdsInput((payload.hyperliquidPilot?.allowedUserIds ?? []).join("\n"));
      setPilotWorkspaceIdsInput((payload.hyperliquidPilot?.allowedWorkspaceIds ?? []).join("\n"));
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  function loadDefault() {
    if (!settings?.defaults?.mode || !settings?.defaults?.provider) return;
    setMode(settings.defaults.mode);
    setProvider(settings.defaults.provider);
    setGlobalEnabled(Boolean(settings.hypervaultsExecutionAccount?.enabled));
    setGlobalApiKey("");
    setGlobalApiSecret("");
    setGlobalVaultAddress("");
    setPilotEnabled(false);
    setPilotUserIdsInput("");
    setPilotWorkspaceIdsInput("");
    setNotice(t("messages.defaultLoaded"));
  }

  async function disableGlobalAccount() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiDelete<HypervaultsExecutionAccountState>("/admin/settings/hypervaults-execution-account");
      await loadAll();
      setNotice(t("messages.globalDisabled"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">{t("subtitle")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link className="btn" href={withLocalePath("/admin/grid-hyperliquid-pilot", locale)}>
          {t("pilot.openOverview")}
        </Link>
      </div>

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}

      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">{error}</div>
      ) : null}

      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div>
      ) : null}

      {isSuperadmin ? (
        <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{t("sectionTitle")}</h3>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            {t("sourceLabel")}: {settings?.source ?? "env"} · {t("lastUpdatedLabel")}: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {(["offchain_shadow", "onchain_simulated", "onchain_live"] as VaultExecutionMode[]).map((entry) => (
              <label key={entry} style={{ display: "grid", gap: 3, padding: 10, border: "1px solid var(--line)", borderRadius: 10 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="radio"
                    checked={mode === entry}
                    onChange={() => setMode(entry)}
                  />
                  <strong>{t(`modes.${entry}.label`)}</strong>
                </span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{t(`modes.${entry}.hint`)}</span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 16, marginBottom: 8, fontSize: 12, color: "var(--muted)" }}>
            {t("providerSourceLabel")}: {settings?.providerSource ?? "env"} · {t("providerLastUpdatedLabel")}: {settings?.providerUpdatedAt ? new Date(settings.providerUpdatedAt).toLocaleString() : t("never")}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {(["mock", "hyperliquid_demo", "hyperliquid"] as VaultExecutionProvider[]).map((entry) => (
              <label key={entry} style={{ display: "grid", gap: 3, padding: 10, border: "1px solid var(--line)", borderRadius: 10 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="radio"
                    checked={provider === entry}
                    onChange={() => setProvider(entry)}
                  />
                  <strong>{t(`providers.${entry}.label`)}</strong>
                </span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{t(`providers.${entry}.hint`)}</span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <strong>{t("globalAccount.title")}</strong>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("lastUpdatedLabel")}: {settings?.hypervaultsExecutionAccount?.updatedAt ? new Date(settings.hypervaultsExecutionAccount.updatedAt).toLocaleString() : t("never")}
              </span>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 12 }}>{t("globalAccount.subtitle")}</div>
            <div className="settingsMutedText" style={{ marginBottom: 12 }}>
              {t("globalAccount.statusLabel")}: {settings?.hypervaultsExecutionAccount?.status ?? "missing"}
              {settings?.hypervaultsExecutionAccount?.apiKeyMasked ? ` · ${t("globalAccount.walletLabel")}: ${settings.hypervaultsExecutionAccount.apiKeyMasked}` : ""}
              {settings?.hypervaultsExecutionAccount?.vaultAddressMasked ? ` · ${t("globalAccount.vaultLabel")}: ${settings.hypervaultsExecutionAccount.vaultAddressMasked}` : ""}
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input type="checkbox" checked={globalEnabled} onChange={(event) => setGlobalEnabled(event.target.checked)} />
              <span>{t("globalAccount.enabledLabel")}</span>
            </label>
            <div className="settingsFormGrid">
              <label>
                {t("globalAccount.apiKey")}
                <input
                  className="input"
                  type="text"
                  value={globalApiKey}
                  onChange={(event) => setGlobalApiKey(event.target.value)}
                  placeholder={t("globalAccount.apiKeyPlaceholder")}
                />
              </label>
              <label>
                {t("globalAccount.apiSecret")}
                <input
                  className="input"
                  type="password"
                  value={globalApiSecret}
                  onChange={(event) => setGlobalApiSecret(event.target.value)}
                  placeholder={t("globalAccount.apiSecretPlaceholder")}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                {t("globalAccount.vaultAddress")}
                <input
                  className="input"
                  type="text"
                  value={globalVaultAddress}
                  onChange={(event) => setGlobalVaultAddress(event.target.value)}
                  placeholder={t("globalAccount.vaultAddressPlaceholder")}
                />
              </label>
            </div>
          </div>

          <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <strong>{t("pilot.title")}</strong>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("lastUpdatedLabel")}: {settings?.hyperliquidPilotUpdatedAt ? new Date(settings.hyperliquidPilotUpdatedAt).toLocaleString() : t("never")}
              </span>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 12 }}>{t("pilot.subtitle")}</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input type="checkbox" checked={pilotEnabled} onChange={(event) => setPilotEnabled(event.target.checked)} />
              <span>{t("pilot.enabledLabel")}</span>
            </label>
            <div className="settingsFormGrid">
              <label>
                {t("pilot.allowedUserIds")}
                <textarea
                  className="input"
                  rows={5}
                  value={pilotUserIdsInput}
                  onChange={(event) => setPilotUserIdsInput(event.target.value)}
                  placeholder={t("pilot.listPlaceholder")}
                />
              </label>
              <label>
                {t("pilot.allowedWorkspaceIds")}
                <textarea
                  className="input"
                  rows={5}
                  value={pilotWorkspaceIdsInput}
                  onChange={(event) => setPilotWorkspaceIdsInput(event.target.value)}
                  placeholder={t("pilot.listPlaceholder")}
                />
              </label>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={loadDefault}>{t("loadDefault")}</button>
            <button className="btn" type="button" onClick={() => void disableGlobalAccount()} disabled={saving}>
              {t("globalAccount.disable")}
            </button>
            <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? tCommon("saving") : t("save")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
