"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Hex } from "viem";
import { useAccount, useConnection, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { switchChain } from "wagmi/actions";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { TARGET_CHAIN_ID, TARGET_CHAIN_NAME, wagmiConfig } from "../../../lib/web3/config";

type VaultExecutionMode = "offchain_shadow" | "onchain_simulated" | "onchain_live";
type VaultExecutionProvider = "mock" | "hyperliquid_demo" | "hyperliquid";
type GridHyperliquidPilotSettings = {
  enabled: boolean;
  allowedUserIds: string[];
  allowedWorkspaceIds: string[];
  updatedAt?: string | null;
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
  hyperliquidPilot: GridHyperliquidPilotSettings;
  hyperliquidPilotUpdatedAt: string | null;
};

type VaultProfitShareTreasurySettings = {
  enabled: boolean;
  walletAddress: string | null;
  updatedAt: string | null;
  onchainSyncStatus: "missing" | "pending" | "ready" | "drifted" | "invalid";
  onchainRecipient: string | null;
  lastSyncActionId: string | null;
  lastSyncTxHash: string | null;
};

type VaultProfitShareSummary = {
  totalFeePaidUsd: number;
  totalOnchainPaidUsd: number;
  pendingLegacyAccrualUsd: number;
};

type VaultProfitSharePayoutItem = {
  id: string;
  botVaultId: string;
  userId: string | null;
  gridInstanceId: string | null;
  feeAmountUsd: number;
  profitBaseUsd: number;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
};

function shortAddress(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "n/a";
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

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
  const { address, isConnected } = useAccount();
  const connection = useConnection();
  const { sendTransactionAsync, isPending: isWalletPending } = useSendTransaction();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [treasurySaving, setTreasurySaving] = useState(false);
  const [treasuryTxBusy, setTreasuryTxBusy] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<VaultExecutionModeResponse | null>(null);
  const [mode, setMode] = useState<VaultExecutionMode>("offchain_shadow");
  const [provider, setProvider] = useState<VaultExecutionProvider>("mock");
  const [pilotEnabled, setPilotEnabled] = useState(false);
  const [pilotUserIdsInput, setPilotUserIdsInput] = useState("");
  const [pilotWorkspaceIdsInput, setPilotWorkspaceIdsInput] = useState("");
  const [treasurySettings, setTreasurySettings] = useState<VaultProfitShareTreasurySettings | null>(null);
  const [treasuryEnabled, setTreasuryEnabled] = useState(false);
  const [treasuryWalletAddress, setTreasuryWalletAddress] = useState("");
  const [treasurySummary, setTreasurySummary] = useState<VaultProfitShareSummary | null>(null);
  const [treasuryPayouts, setTreasuryPayouts] = useState<VaultProfitSharePayoutItem[]>([]);
  const [lastTreasuryTxHash, setLastTreasuryTxHash] = useState<Hex | undefined>(undefined);

  const treasuryReceipt = useWaitForTransactionReceipt({
    hash: lastTreasuryTxHash,
    query: {
      enabled: Boolean(lastTreasuryTxHash)
    }
  });

  const chainMismatch = isConnected && connection.chainId !== TARGET_CHAIN_ID;

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
      const [payload, treasury, summary, payouts] = await Promise.all([
        apiGet<VaultExecutionModeResponse>("/admin/settings/vault-execution-mode"),
        apiGet<VaultProfitShareTreasurySettings>("/admin/settings/vault-profit-share-treasury"),
        apiGet<VaultProfitShareSummary>("/admin/vault-profit-share/summary"),
        apiGet<{ items: VaultProfitSharePayoutItem[] }>("/admin/vault-profit-share/payouts")
      ]);
      setSettings(payload);
      setMode(payload.mode);
      setProvider(payload.provider);
      setPilotEnabled(Boolean(payload.hyperliquidPilot?.enabled));
      setPilotUserIdsInput((payload.hyperliquidPilot?.allowedUserIds ?? []).join("\n"));
      setPilotWorkspaceIdsInput((payload.hyperliquidPilot?.allowedWorkspaceIds ?? []).join("\n"));
      setTreasurySettings(treasury);
      setTreasuryEnabled(Boolean(treasury.enabled));
      setTreasuryWalletAddress(treasury.walletAddress ?? "");
      setTreasurySummary(summary);
      setTreasuryPayouts(Array.isArray(payouts.items) ? payouts.items : []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!treasuryReceipt.isSuccess) return;
    setNotice(t("messages.treasuryTxConfirmed"));
    void loadAll();
  }, [treasuryReceipt.isSuccess, t]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
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
    setPilotEnabled(false);
    setPilotUserIdsInput("");
    setPilotWorkspaceIdsInput("");
    setNotice(t("messages.defaultLoaded"));
  }

  async function saveTreasury() {
    setTreasurySaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPut<VaultProfitShareTreasurySettings>("/admin/settings/vault-profit-share-treasury", {
        enabled: treasuryEnabled,
        walletAddress: treasuryWalletAddress.trim() || null
      });
      setTreasurySettings(payload);
      setTreasuryEnabled(Boolean(payload.enabled));
      setTreasuryWalletAddress(payload.walletAddress ?? "");
      setNotice(t("messages.treasurySaved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setTreasurySaving(false);
    }
  }

  async function sendTreasuryConfigTx() {
    if (!isConnected) {
      setError(t("messages.walletConnectRequired"));
      return;
    }
    if (chainMismatch) {
      await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
    }

    setTreasuryTxBusy(true);
    setError(null);
    setNotice(null);
    try {
      const built = await apiPost<any>("/admin/vault-profit-share/treasury-config-tx", {
        actionKey: `admin:set-treasury:${Date.now()}`
      });
      const txHash = await sendTransactionAsync({
        account: address as `0x${string}` | undefined,
        to: built.txRequest.to as `0x${string}`,
        data: built.txRequest.data as Hex,
        value: BigInt(String(built.txRequest.value ?? "0")),
        chainId: built.txRequest.chainId
      });
      await apiPost(`/vaults/onchain/actions/${encodeURIComponent(built.action.id)}/submit-tx`, {
        txHash
      });
      setLastTreasuryTxHash(txHash as Hex);
      setNotice(t("messages.treasuryTxSubmitted"));
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setTreasuryTxBusy(false);
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
        <>
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
            <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? tCommon("saving") : t("save")}
            </button>
          </div>
        </section>

        <section className="card settingsSection">
          <div className="settingsSectionHeader">
            <h3 style={{ margin: 0 }}>{t("treasury.title")}</h3>
          </div>
          <div className="settingsMutedText" style={{ marginBottom: 12 }}>{t("treasury.subtitle")}</div>

          <div className="settingsFormGrid">
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={treasuryEnabled} onChange={(event) => setTreasuryEnabled(event.target.checked)} />
              <span>{t("treasury.enabledLabel")}</span>
            </label>
            <label>
              {t("treasury.walletLabel")}
              <input
                className="input"
                value={treasuryWalletAddress}
                onChange={(event) => setTreasuryWalletAddress(event.target.value)}
                placeholder="0x..."
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 12 }}>
            <div className="card" style={{ padding: 10 }}>
              <strong>{t("treasury.syncStatusLabel")}</strong>
              <div>{treasurySettings?.onchainSyncStatus ?? "missing"}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <strong>{t("treasury.savedWalletLabel")}</strong>
              <div>{shortAddress(treasurySettings?.walletAddress)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <strong>{t("treasury.onchainWalletLabel")}</strong>
              <div>{shortAddress(treasurySettings?.onchainRecipient)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <strong>{t("treasury.lastTxLabel")}</strong>
              <div>{shortAddress(treasurySettings?.lastSyncTxHash)}</div>
            </div>
          </div>

          <div className="settingsMutedText" style={{ marginTop: 10 }}>
            {t("treasury.walletHint", {
              chain: TARGET_CHAIN_NAME,
              wallet: shortAddress(address ?? null)
            })}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => void saveTreasury()} disabled={treasurySaving}>
              {treasurySaving ? tCommon("saving") : t("treasury.save")}
            </button>
            <button
              className="btn btnPrimary"
              type="button"
              onClick={() => void sendTreasuryConfigTx()}
              disabled={!treasurySettings?.walletAddress || !treasuryEnabled || treasuryTxBusy || isWalletPending}
            >
              {treasuryTxBusy || isWalletPending ? t("treasury.sendingTx") : t("treasury.sendTx")}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 16 }}>
            <div className="card" style={{ padding: 10 }}>
              <strong>{t("treasury.totalFeePaid")}</strong>
              <div>{treasurySummary ? `${treasurySummary.totalFeePaidUsd.toFixed(2)} USD` : "-"}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <strong>{t("treasury.totalOnchainPaid")}</strong>
              <div>{treasurySummary ? `${treasurySummary.totalOnchainPaidUsd.toFixed(2)} USD` : "-"}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <strong>{t("treasury.pendingLegacy")}</strong>
              <div>{treasurySummary ? `${treasurySummary.pendingLegacyAccrualUsd.toFixed(2)} USD` : "-"}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <strong>{t("treasury.payoutsTitle")}</strong>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {treasuryPayouts.slice(0, 8).map((item) => (
                <div key={item.id} className="card" style={{ padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong>{`${item.feeAmountUsd.toFixed(2)} USD`}</strong>
                    <span className="settingsMutedText">{item.createdAt ? new Date(item.createdAt).toLocaleString() : t("never")}</span>
                  </div>
                  <div className="settingsMutedText" style={{ marginTop: 4 }}>
                    {t("treasury.payoutMeta", {
                      botVaultId: item.botVaultId,
                      recipient: shortAddress(String(item.metadata?.treasuryRecipient ?? treasurySettings?.onchainRecipient ?? ""))
                    })}
                  </div>
                </div>
              ))}
              {treasuryPayouts.length === 0 ? <div className="settingsMutedText">{t("treasury.noPayouts")}</div> : null}
            </div>
          </div>
        </section>
        </>
      ) : null}
    </div>
  );
}
