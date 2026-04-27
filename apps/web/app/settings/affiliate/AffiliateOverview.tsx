"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { isAddress, parseEther, type Hex } from "viem";
import { useAccount, useConnection, useSendTransaction } from "wagmi";
import { switchChain } from "wagmi/actions";
import { ApiError, apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { TARGET_CHAIN_ID, TARGET_CHAIN_NAME, wagmiConfig } from "../../../lib/web3/config";

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
  const chainMismatch = isConnected && connection.chainId !== TARGET_CHAIN_ID;

  async function loadOverview() {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<AffiliateOverviewResponse>("/settings/affiliate");
      setData(payload);
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

  async function runWalletAction(kind: "create" | "withdraw-hype" | "withdraw-usdc") {
    setActionBusy(kind);
    setError(null);
    try {
      if (kind === "create") {
        await apiPost("/settings/affiliate/payout-wallet/create", {});
      } else if (kind === "withdraw-hype") {
        await apiPost("/settings/affiliate/payout-wallet/withdraw-hype", {});
      } else {
        await apiPost("/settings/affiliate/payout-wallet/withdraw-usdc", {});
      }
      await loadOverview();
    } catch (actionError) {
      setError(errMsg(actionError));
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
      setCopyNotice(`Deposit tx submitted: ${String(txHash as Hex).slice(0, 10)}...`);
      window.setTimeout(() => setCopyNotice(null), 2400);
      await loadOverview();
    } catch (depositError) {
      setError(errMsg(depositError));
    } finally {
      setActionBusy(null);
    }
  }

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
              Copy payout wallet address
            </button>
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
              {actionBusy === "create" ? "Creating…" : "Create payout wallet"}
            </button>
          ) : null}
          {data?.payoutWallet?.address ? (
            <>
              <input
                className="input"
                value={depositHypeInput}
                onChange={(event) => setDepositHypeInput(event.target.value)}
                placeholder="Deposit HYPE"
                style={{ minWidth: 160 }}
              />
              <button
                className="btn btnPrimary"
                type="button"
                onClick={() => void depositHypeToPayoutWallet()}
                disabled={actionBusy !== null || isWalletPending}
              >
                {actionBusy === "deposit-hype" || isWalletPending ? "Depositing…" : "Deposit HYPE"}
              </button>
            </>
          ) : null}
          <button
            className="btn"
            type="button"
            onClick={() => void runWalletAction("withdraw-hype")}
            disabled={!data?.payoutWallet?.address || actionBusy !== null}
          >
            {actionBusy === "withdraw-hype" ? "Withdrawing…" : "Withdraw HYPE to linked wallet"}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void runWalletAction("withdraw-usdc")}
            disabled={!data?.payoutWallet?.address || actionBusy !== null}
          >
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
              </div>
            ))}
          </div>
        )}
      </section>
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
          <Link href={withLocalePath("/settings", locale)} className="btn">Back to settings</Link>
        </div>
      </div>
      {content}
    </div>
  );
}
