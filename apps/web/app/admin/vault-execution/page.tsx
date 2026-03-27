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
import AdminPageHeader from "../_components/AdminPageHeader";

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
  feeRatePct: number;
  updatedAt: string | null;
  onchainSyncStatus: "missing" | "pending" | "ready" | "drifted" | "invalid";
  onchainRecipient: string | null;
  onchainFeeRatePct: number | null;
  feeRateSyncStatus: "missing" | "pending" | "ready" | "drifted" | "invalid";
  lastSyncActionId: string | null;
  lastSyncTxHash: string | null;
};

type TreasuryConfigTxItem = {
  contractVersion?: string;
  txRequest: {
    to: string;
    data: string;
    value?: string | number | null;
    chainId: number;
  };
  action: {
    id: string;
  };
};

type TreasuryConfigTxResponse = {
  txRequest?: TreasuryConfigTxItem["txRequest"];
  action?: TreasuryConfigTxItem["action"];
  items?: TreasuryConfigTxItem[];
};

type VaultProfitShareSummary = {
  totalFeePaidUsd: number;
  totalOnchainPaidUsd: number;
  pendingLegacyAccrualUsd: number;
  feeRatePct: number;
  onchainFeeRatePct: number | null;
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

function createIdempotencyKey(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
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
  const [treasuryFeeRatePct, setTreasuryFeeRatePct] = useState("30");
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
      setTreasuryFeeRatePct(String(treasury.feeRatePct ?? 30));
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
        walletAddress: treasuryWalletAddress.trim() || null,
        feeRatePct: Number(treasuryFeeRatePct)
      });
      setTreasurySettings(payload);
      setTreasuryEnabled(Boolean(payload.enabled));
      setTreasuryWalletAddress(payload.walletAddress ?? "");
      setTreasuryFeeRatePct(String(payload.feeRatePct ?? 30));
      setNotice(t("messages.treasurySaved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setTreasurySaving(false);
    }
  }

  async function sendTreasuryConfigTx(kind: "recipient" | "fee_rate") {
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
      const built = await apiPost<TreasuryConfigTxResponse>("/admin/vault-profit-share/treasury-config-tx", {
        kind,
        actionKey: `admin:set-treasury:${kind}:${Date.now()}`
      });
      const items = Array.isArray(built.items) && built.items.length > 0
        ? built.items
        : (built.txRequest && built.action ? [{ txRequest: built.txRequest, action: built.action }] : []);
      if (!items.length) throw new Error("missing_treasury_config_tx_items");

      let lastTxHash: Hex | undefined;
      for (const item of items) {
        const txHash = await sendTransactionAsync({
          account: address as `0x${string}` | undefined,
          to: item.txRequest.to as `0x${string}`,
          data: item.txRequest.data as Hex,
          value: BigInt(String(item.txRequest.value ?? "0")),
          chainId: item.txRequest.chainId
        });
        await apiPost(`/vaults/onchain/actions/${encodeURIComponent(item.action.id)}/submit-tx`, {
          txHash,
          idempotencyKey: createIdempotencyKey(`admin-submit-onchain-tx:${item.action.id}`)
        });
        lastTxHash = txHash as Hex;
      }

      setLastTreasuryTxHash(lastTxHash);
      setNotice(t("messages.treasuryTxSubmitted"));
      await loadAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setTreasuryTxBusy(false);
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={[{ href: withLocalePath("/admin/grid-hyperliquid-pilot", locale), label: t("pilot.openOverview") }]}
      />

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}

      {error ? (
        <div className="card settingsSection settingsAlert settingsAlertError">{error}</div>
      ) : null}

      {notice ? (
        <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div>
      ) : null}

      {isSuperadmin ? (
        <>
        <section className="adminStatsGrid">
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">{t("sectionTitle")}</div>
            <div className="adminStatsValue adminStatsValueSmall">{t(`modes.${mode}.label`)}</div>
            <div className="adminStatsHint">{t("sourceLabel")}: {settings?.source ?? "env"}</div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">{t("providerLabel")}</div>
            <div className="adminStatsValue adminStatsValueSmall">{t(`providers.${provider}.label`)}</div>
            <div className="adminStatsHint">{t("providerSourceLabel")}: {settings?.providerSource ?? "env"}</div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">{t("pilotStatusLabel")}</div>
            <div className="adminStatsValue adminStatsValueSmall">{pilotEnabled ? t("enabledValue") : t("disabledValue")}</div>
            <div className="adminStatsHint">
              {parseListInput(pilotUserIdsInput).length} users · {parseListInput(pilotWorkspaceIdsInput).length} workspaces
            </div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">{t("treasury.syncStatusLabel")}</div>
            <div className="adminStatsValue adminStatsValueSmall">{treasurySettings?.onchainSyncStatus ?? "missing"}</div>
            <div className="adminStatsHint">{t("treasury.feeRateSyncStatusLabel")}: {treasurySettings?.feeRateSyncStatus ?? "missing"}</div>
          </div>
        </section>

        <section className="card settingsSection">
          <div className="settingsSectionHeader adminDetailSectionHeader">
            <h3 style={{ margin: 0 }}>{t("sectionTitle")}</h3>
            <div className="adminDetailSectionDescription">
              {t("sourceLabel")}: {settings?.source ?? "env"} · {t("lastUpdatedLabel")}: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
            </div>
          </div>

          <div className="adminChoiceGrid">
            {(["offchain_shadow", "onchain_simulated", "onchain_live"] as VaultExecutionMode[]).map((entry) => (
              <label
                key={entry}
                className={`adminChoiceCard ${mode === entry ? "adminChoiceCardActive" : ""}`.trim()}
              >
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

          <div className="adminDetailSectionDescription" style={{ marginTop: 16, marginBottom: 8 }}>
            {t("providerSourceLabel")}: {settings?.providerSource ?? "env"} · {t("providerLastUpdatedLabel")}: {settings?.providerUpdatedAt ? new Date(settings.providerUpdatedAt).toLocaleString() : t("never")}
          </div>

          <div className="adminChoiceGrid">
            {(["mock", "hyperliquid_demo", "hyperliquid"] as VaultExecutionProvider[]).map((entry) => (
              <label
                key={entry}
                className={`adminChoiceCard ${provider === entry ? "adminChoiceCardActive" : ""}`.trim()}
              >
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
            <div className="settingsSectionHeader adminDetailSectionHeader" style={{ marginBottom: 8 }}>
              <strong>{t("pilot.title")}</strong>
              <span className="adminDetailSectionDescription">
                {t("lastUpdatedLabel")}: {settings?.hyperliquidPilotUpdatedAt ? new Date(settings.hyperliquidPilotUpdatedAt).toLocaleString() : t("never")}
              </span>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 12 }}>{t("pilot.subtitle")}</div>
            <label className="inlineCheck" style={{ marginBottom: 12 }}>
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

          <div className="adminInlineActions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={loadDefault}>{t("loadDefault")}</button>
            <button className="btn btnPrimary" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? tCommon("saving") : t("save")}
            </button>
          </div>
        </section>

        <section className="card settingsSection">
          <div className="settingsSectionHeader adminDetailSectionHeader">
            <h3 style={{ margin: 0 }}>{t("treasury.title")}</h3>
            <div className="adminDetailSectionDescription">{t("treasury.subtitle")}</div>
          </div>

          <div className="settingsFormGrid">
            <label className="inlineCheck" style={{ marginTop: 26 }}>
              <input type="checkbox" checked={treasuryEnabled} onChange={(event) => setTreasuryEnabled(event.target.checked)} />
              <span>{t("treasury.enabledLabel")}</span>
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("treasury.walletLabel")}</span>
              <input
                className="input"
                value={treasuryWalletAddress}
                onChange={(event) => setTreasuryWalletAddress(event.target.value)}
                placeholder="0x..."
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{t("treasury.feeRateLabel")}</span>
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                step="1"
                value={treasuryFeeRatePct}
                onChange={(event) => setTreasuryFeeRatePct(event.target.value)}
              />
            </label>
          </div>

          <div className="adminMetricGrid" style={{ marginTop: 12 }}>
            <div className="adminMetricTile">
              <strong>{t("treasury.syncStatusLabel")}</strong>
              <div>{treasurySettings?.onchainSyncStatus ?? "missing"}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.savedWalletLabel")}</strong>
              <div>{shortAddress(treasurySettings?.walletAddress)}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.onchainWalletLabel")}</strong>
              <div>{shortAddress(treasurySettings?.onchainRecipient)}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.feeRateSyncStatusLabel")}</strong>
              <div>{treasurySettings?.feeRateSyncStatus ?? "missing"}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.savedFeeRateLabel")}</strong>
              <div>{treasurySettings ? `${treasurySettings.feeRatePct}%` : "-"}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.onchainFeeRateLabel")}</strong>
              <div>{treasurySettings?.onchainFeeRatePct != null ? `${treasurySettings.onchainFeeRatePct}%` : "-"}</div>
            </div>
            <div className="adminMetricTile">
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

          <div className="adminInlineActions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={() => void saveTreasury()} disabled={treasurySaving}>
              {treasurySaving ? tCommon("saving") : t("treasury.save")}
            </button>
            <button
              className="btn btnPrimary"
              type="button"
              onClick={() => void sendTreasuryConfigTx("recipient")}
              disabled={!treasurySettings?.walletAddress || !treasuryEnabled || treasuryTxBusy || isWalletPending}
            >
              {treasuryTxBusy || isWalletPending ? t("treasury.sendingTx") : t("treasury.sendRecipientTx")}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void sendTreasuryConfigTx("fee_rate")}
              disabled={!treasuryEnabled || treasuryTxBusy || isWalletPending}
            >
              {treasuryTxBusy || isWalletPending ? t("treasury.sendingTx") : t("treasury.sendFeeRateTx")}
            </button>
          </div>

          <div className="adminMetricGrid" style={{ marginTop: 16 }}>
            <div className="adminMetricTile">
              <strong>{t("treasury.totalFeePaid")}</strong>
              <div>{treasurySummary ? `${treasurySummary.totalFeePaidUsd.toFixed(2)} USD` : "-"}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.totalOnchainPaid")}</strong>
              <div>{treasurySummary ? `${treasurySummary.totalOnchainPaidUsd.toFixed(2)} USD` : "-"}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.pendingLegacy")}</strong>
              <div>{treasurySummary ? `${treasurySummary.pendingLegacyAccrualUsd.toFixed(2)} USD` : "-"}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.summaryFeeRateLabel")}</strong>
              <div>{treasurySummary ? `${treasurySummary.feeRatePct}%` : "-"}</div>
            </div>
            <div className="adminMetricTile">
              <strong>{t("treasury.summaryOnchainFeeRateLabel")}</strong>
              <div>{treasurySummary?.onchainFeeRatePct != null ? `${treasurySummary.onchainFeeRatePct}%` : "-"}</div>
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
