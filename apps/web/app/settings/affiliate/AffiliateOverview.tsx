"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { isAddress, parseEther, type Hex } from "viem";
import { useAccount, useConnection, useSendTransaction } from "wagmi";
import { switchChain } from "wagmi/actions";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { TARGET_CHAIN_ID, TARGET_CHAIN_NAME, wagmiConfig } from "../../../lib/web3/config";
import { AppIcon } from "../../components/AppIcon";
import { HyperEvmAddressLink } from "../../../components/wallet/ExplorerLinks";

type AffiliateOverviewResponse = {
  profile: {
    code: string;
    status: string;
  };
  program: {
    enabled: boolean;
    platformFeeRatePct: number;
    defaultAffiliateFeeRatePct: number;
  };
  effectiveFeeRatePct: number;
  rateSource: "admin_override" | "self_selected" | "program_default";
  selfSelectedFeeRatePct: number | null;
  selfSelectedFeeRateUpdatedAt: string | null;
  maxSelfSelectedFeeRatePct: number;
  override: {
    feeRatePct: number;
    reason: string | null;
    updatedAt: string | null;
  } | null;
  referredBy: {
    email: string;
    code: string | null;
    source: string | null;
    assignedAt: string | null;
  } | null;
  stats: {
    referredUsers: number;
    activeReferredUsers: number;
    totalAffiliateAccruedUsd: number;
    paidAffiliateUsd: number;
    unpaidAffiliateUsd: number;
  };
  latestAccruals: Array<{
    id: string;
    status: string;
    affiliateAmountUsd: number;
    affiliateFeeRatePct: number;
    accruedAt: string | null;
    referredUser: { email: string } | null;
    botVault: { gridInstanceId: string | null; vaultAddress: string | null } | null;
  }>;
  payoutWallet: {
    address: string | null;
    version: number;
    secretRef: string | null;
    hypeBalance: string | null;
    usdcBalance: string | null;
    updatedAt: string | null;
    stale: boolean;
  } | null;
  referralPath: string;
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

type AffiliateOverviewProps = {
  embedded?: boolean;
};

type PayoutWalletModal = "deposit-hype" | "withdraw-hype" | "withdraw-usdc";

function shortAddress(value: string | null | undefined): string {
  if (!value) return "—";
  const normalized = String(value).trim();
  if (normalized.length <= 12) return normalized || "—";
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function shortTxHash(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "submitted";
  return `${normalized.slice(0, 10)}...`;
}

export function AffiliateOverview({ embedded = false }: AffiliateOverviewProps) {
  const locale = useLocale() as AppLocale;
  const { address, isConnected } = useAccount();
  const connection = useConnection();
  const { sendTransactionAsync, isPending: isWalletPending } = useSendTransaction();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AffiliateOverviewResponse | null>(null);
  const [origin, setOrigin] = useState("");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [depositHypeInput, setDepositHypeInput] = useState("");
  const [withdrawHypeInput, setWithdrawHypeInput] = useState("");
  const [withdrawUsdcInput, setWithdrawUsdcInput] = useState("");
  const [profitshareRateInput, setProfitshareRateInput] = useState("10");
  const [activePayoutModal, setActivePayoutModal] = useState<PayoutWalletModal | null>(null);
  const chainMismatch = isConnected && connection.chainId !== TARGET_CHAIN_ID;

  async function loadOverview() {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<AffiliateOverviewResponse>("/settings/affiliate");
      setData(payload);
      setProfitshareRateInput(String(payload.selfSelectedFeeRatePct ?? payload.effectiveFeeRatePct ?? payload.program.defaultAffiliateFeeRatePct));
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    void loadOverview();
  }, []);

  const referralLink = useMemo(() => {
    if (!data?.referralPath) return "";
    return `${origin}${withLocalePath(data.referralPath, locale)}`;
  }, [data?.referralPath, locale, origin]);

  async function copyReferralLink() {
    if (!referralLink || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(referralLink);
    setCopyNotice("Referral link copied.");
    window.setTimeout(() => setCopyNotice(null), 1800);
  }

  async function copyPayoutWalletAddress() {
    const payoutAddress = String(data?.payoutWallet?.address ?? "").trim();
    if (!payoutAddress || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(payoutAddress);
    setCopyNotice("Payout wallet address copied.");
    window.setTimeout(() => setCopyNotice(null), 1800);
  }

  function openPayoutModal(kind: PayoutWalletModal) {
    setError(null);
    setCopyNotice(null);
    setActivePayoutModal(kind);
  }

  async function runWalletAction(kind: "create") {
    setActionBusy(kind);
    setError(null);
    try {
      if (kind === "create") {
        await apiPost("/settings/affiliate/payout-wallet/create", {});
      }
      await loadOverview();
    } catch (actionError) {
      setError(errMsg(actionError));
    } finally {
      setActionBusy(null);
    }
  }

  async function saveProfitshareRate() {
    const maxRate = data?.maxSelfSelectedFeeRatePct ?? 25;
    const feeRatePct = Number(profitshareRateInput);
    if (!Number.isFinite(feeRatePct) || feeRatePct < 0 || feeRatePct > maxRate) {
      setError(`Enter a profitshare rate from 0 to ${maxRate}.`);
      return;
    }
    setActionBusy("profitshare-rate");
    setError(null);
    setCopyNotice(null);
    try {
      const payload = await apiPut<AffiliateOverviewResponse>("/settings/affiliate/profitshare-rate", {
        feeRatePct
      });
      setData(payload);
      setProfitshareRateInput(String(payload.selfSelectedFeeRatePct ?? payload.effectiveFeeRatePct));
      setCopyNotice("Profitshare rate saved.");
      window.setTimeout(() => setCopyNotice(null), 1800);
    } catch (rateError) {
      setError(errMsg(rateError));
    } finally {
      setActionBusy(null);
    }
  }

  async function depositHypeToPayoutWallet() {
    const payoutAddress = String(data?.payoutWallet?.address ?? "").trim();
    if (!isConnected || !address) {
      setError("Connect a wallet first to deposit HYPE.");
      return;
    }
    if (!payoutAddress || !isAddress(payoutAddress)) {
      setError("Create a valid payout wallet first.");
      return;
    }
    const amountHype = Number(depositHypeInput);
    if (!Number.isFinite(amountHype) || amountHype <= 0) {
      setError("Enter a positive HYPE amount.");
      return;
    }

    setActionBusy("deposit-hype");
    setError(null);
    try {
      if (chainMismatch) {
        await switchChain(wagmiConfig, { chainId: TARGET_CHAIN_ID });
      }
      const txHash = await sendTransactionAsync({
        account: address as `0x${string}` | undefined,
        to: payoutAddress as `0x${string}`,
        value: parseEther(String(amountHype)),
        chainId: TARGET_CHAIN_ID
      });
      setDepositHypeInput("");
      setActivePayoutModal(null);
      setCopyNotice(`Deposit tx submitted: ${shortTxHash(txHash as Hex)}`);
      window.setTimeout(() => setCopyNotice(null), 2400);
      await loadOverview();
    } catch (depositError) {
      setError(errMsg(depositError));
    } finally {
      setActionBusy(null);
    }
  }

  async function withdrawFromPayoutWallet(kind: "withdraw-hype" | "withdraw-usdc") {
    const inputValue = kind === "withdraw-hype" ? withdrawHypeInput.trim() : withdrawUsdcInput.trim();
    const parsedAmount = inputValue ? Number(inputValue) : null;
    if (inputValue && (!Number.isFinite(parsedAmount) || Number(parsedAmount) <= 0)) {
      setError(kind === "withdraw-hype" ? "Enter a positive HYPE amount." : "Enter a positive USDC amount.");
      return;
    }

    setActionBusy(kind);
    setError(null);
    try {
      const result = kind === "withdraw-hype"
        ? await apiPost<{ txHash?: string }>("/settings/affiliate/payout-wallet/withdraw-hype", {
            amountHype: parsedAmount ?? undefined
          })
        : await apiPost<{ txHash?: string }>("/settings/affiliate/payout-wallet/withdraw-usdc", {
            amountUsdc: parsedAmount ?? undefined
          });
      if (kind === "withdraw-hype") {
        setWithdrawHypeInput("");
      } else {
        setWithdrawUsdcInput("");
      }
      setActivePayoutModal(null);
      setCopyNotice(`Withdraw tx submitted: ${shortTxHash(result.txHash)}`);
      window.setTimeout(() => setCopyNotice(null), 2400);
      await loadOverview();
    } catch (withdrawError) {
      setError(errMsg(withdrawError));
    } finally {
      setActionBusy(null);
    }
  }

  const maxSelfSelectedRate = data?.maxSelfSelectedFeeRatePct ?? 25;
  const parsedProfitshareRate = Number(profitshareRateInput);
  const selectedProfitshareRate = Number.isFinite(parsedProfitshareRate)
    ? Math.min(maxSelfSelectedRate, Math.max(0, parsedProfitshareRate))
    : (data?.effectiveFeeRatePct ?? 0);
  const platformProfitshareRate = data?.program.platformFeeRatePct ?? 5;
  const newVaultTotalProfitsharePct = platformProfitshareRate + selectedProfitshareRate;
  const rateSourceLabel =
    data?.rateSource === "admin_override"
      ? "admin override"
      : data?.rateSource === "self_selected"
        ? "self selected"
        : "program default";

  const content = (
    <>
      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {copyNotice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{copyNotice}</div> : null}

      <section className="adminStatsGrid">
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Referral Code</div>
          <div className="adminStatsValue adminStatsValueSmall">{data?.profile.code ?? "—"}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Affiliate Fee %</div>
          <div className="adminStatsValue">{(data?.effectiveFeeRatePct ?? 0).toFixed(2)}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Referred Users</div>
          <div className="adminStatsValue">{data?.stats.referredUsers ?? 0}</div>
        </div>
        <div className="card adminStatsCard">
          <div className="adminStatsLabel">Unpaid</div>
          <div className="adminStatsValue">${(data?.stats.unpaidAffiliateUsd ?? 0).toFixed(2)}</div>
        </div>
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>Profitshare Rate</h3>
            <div className="settingsSectionMeta">New V4 vaults lock 5% platform plus your selected affiliate share.</div>
          </div>
        </div>
        <div className="settingsFormGrid">
          <label className="settingsField">
            <span className="settingsFieldLabel">Affiliate Profitshare %</span>
            <input
              className="input"
              type="number"
              min={0}
              max={maxSelfSelectedRate}
              step="0.01"
              value={profitshareRateInput}
              onChange={(event) => setProfitshareRateInput(event.target.value)}
            />
          </label>
          <label className="settingsField">
            <span className="settingsFieldLabel">Adjust</span>
            <input
              type="range"
              min={0}
              max={maxSelfSelectedRate}
              step="0.25"
              value={selectedProfitshareRate}
              onChange={(event) => setProfitshareRateInput(event.target.value)}
            />
          </label>
        </div>
        <div className="adminStatsGrid" style={{ marginTop: 12 }}>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">Platform</div>
            <div className="adminStatsValue">{platformProfitshareRate.toFixed(2)}%</div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">Affiliate</div>
            <div className="adminStatsValue">{selectedProfitshareRate.toFixed(2)}%</div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">Total</div>
            <div className="adminStatsValue">{newVaultTotalProfitsharePct.toFixed(2)}%</div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">Source</div>
            <div className="adminStatsValue adminStatsValueSmall">{rateSourceLabel}</div>
          </div>
        </div>
        <div className="settingsActions" style={{ marginTop: 12 }}>
	          <button
	            className="btn btnPrimary"
	            type="button"
	            onClick={() => void saveProfitshareRate()}
	            disabled={actionBusy !== null || loading}
	          >
	            <AppIcon name="save" />
	            {actionBusy === "profitshare-rate" ? "Saving…" : "Save profitshare"}
	          </button>
          <button
            className="btn"
            type="button"
	            onClick={() => setProfitshareRateInput(String(data?.selfSelectedFeeRatePct ?? data?.effectiveFeeRatePct ?? 10))}
	            disabled={actionBusy !== null || loading}
	          >
	            <AppIcon name="reset" />
	            Reset
	          </button>
        </div>
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>Referral Link</h3>
            <div className="settingsSectionMeta">Registration capture is wired to the `ref` query parameter.</div>
          </div>
        </div>
        {loading ? <div className="settingsMutedText">Loading affiliate dashboard…</div> : null}
        <div className="settingsField">
          <span className="settingsFieldLabel">Link</span>
          <input className="input" readOnly value={referralLink} placeholder="Referral link will appear here" />
        </div>
	        <div className="settingsActions">
	          <button className="btn btnPrimary" type="button" onClick={() => void copyReferralLink()} disabled={!referralLink}>
	            <AppIcon name="copy" />
	            Copy link
	          </button>
        </div>
        {data?.referredBy ? (
          <div className="settingsMutedText">
            You are referred by {data.referredBy.email} since {formatDateTime(data.referredBy.assignedAt)}.
          </div>
        ) : null}
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>Payout Wallet</h3>
            <div className="settingsSectionMeta">Managed wallet for onchain affiliate payouts. Deposit HYPE for gas and USDC if you want to move funds manually.</div>
          </div>
        </div>
        <div className="settingsField">
          <span className="settingsFieldLabel">Address</span>
          <input className="input" readOnly value={data?.payoutWallet?.address ?? ""} placeholder="Create payout wallet to receive V4 affiliate payouts" />
        </div>
	        {data?.payoutWallet?.address ? (
	          <div className="settingsActions" style={{ marginTop: 12 }}>
	            <button className="btn" type="button" onClick={() => void copyPayoutWalletAddress()}>
	              <AppIcon name="copy" />
	              Copy payout wallet address
	            </button>
              <HyperEvmAddressLink address={data.payoutWallet.address} />
          </div>
        ) : null}
        <div className="adminStatsGrid" style={{ marginTop: 12 }}>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">Version</div>
            <div className="adminStatsValue">{data?.payoutWallet?.version ?? 0}</div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">HYPE</div>
            <div className="adminStatsValue adminStatsValueSmall">{data?.payoutWallet?.hypeBalance ?? "—"}</div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">USDC</div>
            <div className="adminStatsValue adminStatsValueSmall">{data?.payoutWallet?.usdcBalance ?? "—"}</div>
          </div>
          <div className="card adminStatsCard">
            <div className="adminStatsLabel">Updated</div>
            <div className="adminStatsValue adminStatsValueSmall">{formatDateTime(data?.payoutWallet?.updatedAt ?? null)}</div>
          </div>
        </div>
        <div className="settingsActions" style={{ marginTop: 12 }}>
          {!data?.payoutWallet?.address ? (
            <button
              className="btn btnPrimary"
              type="button"
	              onClick={() => void runWalletAction("create")}
	              disabled={actionBusy !== null}
	            >
	              <AppIcon name="wallet" />
	              {actionBusy === "create" ? "Creating…" : "Create payout wallet"}
	            </button>
          ) : null}
          {data?.payoutWallet?.address ? (
            <button
              className="btn btnPrimary"
              type="button"
	              onClick={() => openPayoutModal("deposit-hype")}
	              disabled={actionBusy !== null || isWalletPending}
	            >
	              <AppIcon name="deposit" />
	              {actionBusy === "deposit-hype" || isWalletPending ? "Depositing…" : "Deposit HYPE"}
	            </button>
          ) : null}
          <button
            className="btn"
            type="button"
	            onClick={() => openPayoutModal("withdraw-hype")}
	            disabled={!data?.payoutWallet?.address || actionBusy !== null}
	          >
	            <AppIcon name="withdraw" />
	            {actionBusy === "withdraw-hype" ? "Withdrawing…" : "Withdraw HYPE to linked wallet"}
	          </button>
          <button
            className="btn"
            type="button"
	            onClick={() => openPayoutModal("withdraw-usdc")}
	            disabled={!data?.payoutWallet?.address || actionBusy !== null}
	          >
	            <AppIcon name="withdraw" />
	            {actionBusy === "withdraw-usdc" ? "Withdrawing…" : "Withdraw USDC to linked wallet"}
          </button>
        </div>
        <div className="settingsMutedText" style={{ marginTop: 10 }}>
          New V4 affiliate payouts use this wallet when configured. Existing V4 vaults keep the recipient that was locked at deploy time.
        </div>
        {data?.payoutWallet?.address ? (
          <div className="settingsMutedText" style={{ marginTop: 6 }}>
            Deposit sends native HYPE on {TARGET_CHAIN_NAME} from your connected wallet to the payout wallet. USDC can be sent manually to the copied address if needed.
          </div>
        ) : null}
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 style={{ margin: 0 }}>Latest Accruals</h3>
            <div className="settingsSectionMeta">This stays empty until real profit-share events create affiliate accruals.</div>
          </div>
        </div>
        {!data || data.latestAccruals.length === 0 ? (
          <div className="settingsMutedText">No affiliate accruals yet.</div>
        ) : (
          <div className="adminListStack">
            {data.latestAccruals.map((item) => (
              <div key={item.id} className="adminListCard">
                <div className="adminListCardTop">
                  <strong>${item.affiliateAmountUsd.toFixed(2)}</strong>
                  <span className="settingsMutedText">{item.status}</span>
                </div>
                <div className="settingsMutedText">
                  {item.referredUser?.email ?? "Unknown user"} • {item.affiliateFeeRatePct.toFixed(2)}% • {formatDateTime(item.accruedAt)}
                </div>
                <div className="settingsMutedText">
                  Vault {item.botVault?.gridInstanceId ?? item.botVault?.vaultAddress ?? "—"}
                </div>
                {item.botVault?.vaultAddress ? (
                  <div className="settingsActions" style={{ marginTop: 8 }}>
                    <HyperEvmAddressLink address={item.botVault.vaultAddress} label="View vault" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {activePayoutModal ? (
        <div className="fundingModalOverlay" role="presentation" onClick={() => setActivePayoutModal(null)}>
          <div
            className="fundingModalCard"
            role="dialog"
            aria-modal="true"
            aria-label={
              activePayoutModal === "deposit-hype"
                ? "Deposit HYPE"
                : activePayoutModal === "withdraw-hype"
                  ? "Withdraw HYPE"
                  : "Withdraw USDC"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="walletSectionHeader fundingModalHeader fundingModalHeaderCompact">
              <div>
                <h3 className="walletSectionTitle" style={{ margin: 0 }}>
                  {activePayoutModal === "deposit-hype"
                    ? "Deposit HYPE"
                    : activePayoutModal === "withdraw-hype"
                      ? "Withdraw HYPE"
                      : "Withdraw USDC"}
                </h3>
                <div className="walletMutedText">Payout wallet funding and withdrawals.</div>
              </div>
              <button
                type="button"
                className="fundingModalCloseButton"
                aria-label="Close modal"
                onClick={() => setActivePayoutModal(null)}
              >
                <AppIcon name="close" />
              </button>
            </div>
            <div className="fundingModalBody">
              <section className="card walletCard fundingModalSection">
                <div className="walletSectionIntro fundingModalTitleBlock">
                  <div className="fundingModalDirectionPill">
                    {activePayoutModal === "deposit-hype"
                      ? `${shortAddress(address)} -> ${shortAddress(data?.payoutWallet?.address)}`
                      : `${shortAddress(data?.payoutWallet?.address)} -> linked wallet`}
                  </div>
                  <div className="fundingModalAmountMeta">
                    <span>{activePayoutModal === "withdraw-usdc" ? "USDC balance" : "HYPE balance"}</span>
                    <strong>
                      {activePayoutModal === "withdraw-usdc"
                        ? `${data?.payoutWallet?.usdcBalance ?? "—"} USDC`
                        : `${data?.payoutWallet?.hypeBalance ?? "—"} HYPE`}
                    </strong>
                  </div>
                </div>
                <div className="walletAmountRow fundingAmountActionRow fundingModalAmountRow fundingModalAmountField">
                  <input
                    className="input walletAmountInput"
                    value={
                      activePayoutModal === "deposit-hype"
                        ? depositHypeInput
                        : activePayoutModal === "withdraw-hype"
                          ? withdrawHypeInput
                          : withdrawUsdcInput
                    }
                    onChange={(event) => {
                      if (activePayoutModal === "deposit-hype") {
                        setDepositHypeInput(event.target.value);
                      } else if (activePayoutModal === "withdraw-hype") {
                        setWithdrawHypeInput(event.target.value);
                      } else {
                        setWithdrawUsdcInput(event.target.value);
                      }
                    }}
                    placeholder={
                      activePayoutModal === "deposit-hype"
                        ? "Amount HYPE"
                        : activePayoutModal === "withdraw-hype"
                          ? "Amount HYPE (empty = max after gas reserve)"
                          : "Amount USDC (empty = full balance)"
                    }
                  />
                </div>
                <div className="walletMutedText">
                  {activePayoutModal === "deposit-hype"
                    ? `Deposit sends native HYPE on ${TARGET_CHAIN_NAME} from your connected wallet to the payout wallet.`
                    : "Withdraw sends funds from the payout wallet to your linked wallet address."}
                </div>
                {error ? (
                  <div className="walletNotice walletNoticeError" style={{ marginTop: 12 }}>
                    {error}
                  </div>
                ) : null}
                {copyNotice ? (
                  <div className="walletNotice" style={{ marginTop: 12 }}>
                    {copyNotice}
                  </div>
                ) : null}
	                <div className="walletActionRow fundingModalPrimaryActionRow">
	                  <button type="button" className="btn" onClick={() => setActivePayoutModal(null)}>
	                    <AppIcon name="cancel" />
	                    Cancel
	                  </button>
                  <button
                    type="button"
                    className="btn btnPrimary"
                    onClick={() => void (activePayoutModal === "deposit-hype"
                      ? depositHypeToPayoutWallet()
                      : withdrawFromPayoutWallet(activePayoutModal))}
                    disabled={
                      !data?.payoutWallet?.address ||
                      actionBusy !== null ||
                      (activePayoutModal === "deposit-hype" && isWalletPending)
	                    }
	                  >
	                    <AppIcon name={activePayoutModal === "deposit-hype" ? "deposit" : "withdraw"} />
	                    {activePayoutModal === "deposit-hype"
                      ? (actionBusy === "deposit-hype" || isWalletPending ? "Depositing…" : "Deposit HYPE")
                      : activePayoutModal === "withdraw-hype"
                        ? (actionBusy === "withdraw-hype" ? "Withdrawing…" : "Withdraw HYPE")
                        : (actionBusy === "withdraw-usdc" ? "Withdrawing…" : "Withdraw USDC")}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div style={{ display: "grid", gap: 14 }}>{content}</div>;
  }

  return (
    <div className="settingsWrap" style={{ maxWidth: 1100 }}>
      <div className="card settingsSection">
        <div className="settingsSectionHeader">
	          <div>
	            <h2 style={{ margin: 0 }}>Affiliate</h2>
	            <div className="settingsSectionMeta">Referral code, accrued earnings and latest affiliate events.</div>
	          </div>
	          <Link href={withLocalePath("/settings", locale)} className="btn">
	            <AppIcon name="back" />
	            Back to settings
	          </Link>
	        </div>
      </div>
      {content}
    </div>
  );
}
