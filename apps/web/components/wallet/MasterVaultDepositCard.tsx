"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { erc20Abi, formatUnits, isAddress, parseUnits } from "viem";
import type { Address } from "viem";
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { switchChain } from "wagmi/actions";
import { TARGET_CHAIN, wagmiConfig } from "../../lib/web3/config";
import { openWeb3Modal } from "../../lib/web3/modal";
import { formatToken } from "../../lib/wallet/format";
import { getMasterVaultAdapter } from "../../lib/wallet/masterVaultAdapter";
import type { WalletFeatureConfig } from "../../lib/wallet/types";

type PendingAction = "approve" | "deposit" | "withdraw";

type MasterVaultSummarySnapshot = {
  withdrawableBalance?: number | null;
  freeBalance?: number | null;
};

function normalizeErrorMessage(
  error: unknown,
  action: PendingAction,
  t: ReturnType<typeof useTranslations<"wallet.deposit">>
): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.toLowerCase();
  if (normalized.includes("rejected") || normalized.includes("denied")) {
    if (action === "approve") return t("approvalRejected");
    return action === "withdraw" ? t("withdrawRejected") : t("depositRejected");
  }
  if (normalized.includes("insufficient funds")) return t("insufficientGas");
  if (normalized.includes("revert") || normalized.includes("execution reverted")) {
    if (action === "approve") return t("approvalReverted");
    return action === "withdraw" ? t("withdrawReverted") : t("depositReverted");
  }
  return raw || t("transactionFailed");
}

export default function MasterVaultDepositCard({
  config,
  onSuccess,
  disabledReason,
  disabledHintOverride,
  masterVault
}: {
  config: WalletFeatureConfig;
  onSuccess?: () => void | Promise<void>;
  disabledReason?: string | null;
  disabledHintOverride?: string | null;
  masterVault?: MasterVaultSummarySnapshot | null;
}) {
  const t = useTranslations("wallet.deposit");
  const tCommon = useTranslations("wallet.common");
  const { address, isConnected, chainId } = useAccount();
  const [amount, setAmount] = useState("100");
  const [withdrawAmount, setWithdrawAmount] = useState("50");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"default" | "error" | "success">("default");
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const { writeContractAsync } = useWriteContract();

  const adapter = getMasterVaultAdapter(config);
  const connectedAddress = isAddress(address ?? "") ? (address as Address) : null;
  const amountAtomic = useMemo(() => {
    try {
      const normalized = amount.trim();
      if (!normalized) return null;
      return parseUnits(normalized, config.usdc.decimals);
    } catch {
      return null;
    }
  }, [amount, config.usdc.decimals]);
  const withdrawAmountAtomic = useMemo(() => {
    try {
      const normalized = withdrawAmount.trim();
      if (!normalized) return null;
      return parseUnits(normalized, config.usdc.decimals);
    } catch {
      return null;
    }
  }, [config.usdc.decimals, withdrawAmount]);
  const spender = adapter.getAllowanceTarget(config);

  const usdcBalanceQuery = useReadContract({
    address: isAddress(config.usdc.address ?? "") ? (config.usdc.address as Address) : undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    chainId: config.chain.id,
    query: {
      enabled: Boolean(isConnected && connectedAddress && isAddress(config.usdc.address ?? ""))
    }
  });

  const allowanceQuery = useReadContract({
    address: isAddress(config.usdc.address ?? "") ? (config.usdc.address as Address) : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && spender ? [connectedAddress, spender] : undefined,
    chainId: config.chain.id,
    query: {
      enabled: Boolean(isConnected && connectedAddress && spender && isAddress(config.usdc.address ?? ""))
    }
  });

  const hypeBalanceQuery = useBalance({
    address: connectedAddress ?? undefined,
    chainId: config.chain.id,
    query: {
      enabled: Boolean(connectedAddress)
    }
  });

  const receipt = useWaitForTransactionReceipt({
    hash: pendingHash,
    chainId: config.chain.id,
    query: {
      enabled: Boolean(pendingHash)
    }
  });

  useEffect(() => {
    if (!receipt.isSuccess || !pendingAction) return;

    const successMessage =
      pendingAction === "approve"
        ? t("approvalConfirmed")
        : pendingAction === "withdraw"
          ? t("withdrawConfirmed")
          : t("depositConfirmed");
    setFeedback(successMessage);
    setFeedbackTone("success");
    setPendingAction(null);
    setPendingHash(undefined);
    void Promise.all([usdcBalanceQuery.refetch(), allowanceQuery.refetch(), hypeBalanceQuery.refetch()]);
    void onSuccess?.();
  }, [allowanceQuery, hypeBalanceQuery, onSuccess, pendingAction, receipt.isSuccess, t, usdcBalanceQuery]);

  useEffect(() => {
    if (!receipt.isError || !pendingAction) return;
    setFeedback(normalizeErrorMessage(receipt.error, pendingAction, t));
    setFeedbackTone("error");
    setPendingAction(null);
    setPendingHash(undefined);
  }, [pendingAction, receipt.error, receipt.isError, t]);

  const zero = BigInt(0);
  const chainMismatch = isConnected && chainId !== config.chain.id;
  const usdcBalance = (usdcBalanceQuery.data as bigint | undefined) ?? zero;
  const allowance = (allowanceQuery.data as bigint | undefined) ?? zero;
  const hypeBalance = hypeBalanceQuery.data?.value ?? zero;
  const freeBalanceAtomic = useMemo(() => {
    const value = Number(masterVault?.freeBalance ?? 0);
    if (!Number.isFinite(value) || value <= 0) return zero;
    return parseUnits(String(value), config.usdc.decimals);
  }, [config.usdc.decimals, masterVault?.freeBalance]);
  const withdrawableBalanceAtomic = useMemo(() => {
    const value = Number(masterVault?.withdrawableBalance ?? 0);
    if (!Number.isFinite(value) || value <= 0) return zero;
    return parseUnits(String(value), config.usdc.decimals);
  }, [config.usdc.decimals, masterVault?.withdrawableBalance]);
  const requiresApproval = Boolean(amountAtomic && amountAtomic > zero && allowance < amountAtomic);
  const insufficientUsdc = Boolean(amountAtomic && amountAtomic > usdcBalance);
  const insufficientGas = Boolean(isConnected && hypeBalance <= zero);
  const insufficientWithdrawable = Boolean(withdrawAmountAtomic && withdrawAmountAtomic > withdrawableBalanceAtomic);
  const isBusy =
    pendingAction !== null
    || receipt.isLoading
    || usdcBalanceQuery.isLoading
    || allowanceQuery.isLoading;

  async function handleConnect() {
    await openWeb3Modal({ view: "Connect" });
  }

  async function handleSwitchChain() {
    await switchChain(wagmiConfig, { chainId: config.chain.id });
  }

  async function handleWrite(action: PendingAction) {
    setFeedback(null);

    if (!connectedAddress) {
      await handleConnect();
      return;
    }
    if (chainMismatch) {
      await handleSwitchChain();
      return;
    }

    const selectedAmount = action === "withdraw" ? withdrawAmountAtomic : amountAtomic;

    if (!selectedAmount || selectedAmount <= zero) {
      setFeedback(action === "withdraw" ? t("positiveWithdrawAmount") : t("positiveAmount"));
      setFeedbackTone("error");
      return;
    }
    if (action !== "withdraw" && insufficientUsdc) {
      setFeedback(t("insufficientUsdc"));
      setFeedbackTone("error");
      return;
    }
    if (action === "withdraw" && insufficientWithdrawable) {
      setFeedback(t("insufficientWithdrawable"));
      setFeedbackTone("error");
      return;
    }
    if (insufficientGas) {
      setFeedback(t("insufficientGas"));
      setFeedbackTone("error");
      return;
    }

    try {
      setPendingAction(action);
      setFeedback(
        action === "approve"
          ? t("waitingApproval")
          : action === "withdraw"
            ? t("waitingWithdraw")
            : t("waitingDeposit")
      );
      setFeedbackTone("default");

      let hash: `0x${string}`;
      if (action === "approve") {
        hash = await writeContractAsync({
          address: config.usdc.address as Address,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender as Address, selectedAmount],
          chainId: config.chain.id,
          chain: TARGET_CHAIN,
          account: connectedAddress
        });
      } else if (action === "deposit") {
        const built = adapter.buildDepositCall(config, connectedAddress, selectedAmount);
        if ("reason" in built) {
          throw new Error(built.reason);
        }
        hash = await writeContractAsync({
          ...built.call,
          chainId: config.chain.id,
          chain: TARGET_CHAIN,
          account: connectedAddress
        });
      } else {
        const built = adapter.buildWithdrawCall(config, connectedAddress, selectedAmount);
        if ("reason" in built) {
          throw new Error(built.reason);
        }
        hash = await writeContractAsync({
          ...built.call,
          chainId: config.chain.id,
          chain: TARGET_CHAIN,
          account: connectedAddress
        });
      }

      setPendingHash(hash);
    } catch (error) {
      setPendingAction(null);
      setPendingHash(undefined);
      setFeedback(normalizeErrorMessage(error, action, t));
      setFeedbackTone("error");
    }
  }

  const configDisabled = !config.masterVault.writeEnabled || Boolean(disabledReason);

  return (
    <section className="card walletCard walletDepositCard">
      <div className="walletSectionHeader">
        <div className="walletSectionIntro">
          <h3 className="walletSectionTitle">{t("title")}</h3>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
        <span className={`badge ${configDisabled ? "badgeWarn" : "badgeOk"}`}>
          {configDisabled ? tCommon("readOnly") : adapter.label}
        </span>
      </div>

      <div className="walletInfoGrid" style={{ marginBottom: 12 }}>
        <div className="walletInfoTile">
          <span className="walletLabel">{t("usdcBalance")}</span>
          <strong>{formatToken(formatUnits(usdcBalance, config.usdc.decimals), 4)} USDC</strong>
        </div>
        <div className="walletInfoTile">
          <span className="walletLabel">{t("allowance")}</span>
          <strong>{formatToken(formatUnits(allowance, config.usdc.decimals), 4)} USDC</strong>
        </div>
        <div className="walletInfoTile">
          <span className="walletLabel">{t("gasBalance")}</span>
          <strong>{formatToken(formatUnits(hypeBalance, 18), 4)} HYPE</strong>
        </div>
        <div className="walletInfoTile">
          <span className="walletLabel">{t("freeBalance")}</span>
          <strong>{formatToken(formatUnits(freeBalanceAtomic, config.usdc.decimals), 4)} USDC</strong>
        </div>
        <div className="walletInfoTile">
          <span className="walletLabel">{t("withdrawableBalance")}</span>
          <strong>{formatToken(formatUnits(withdrawableBalanceAtomic, config.usdc.decimals), 4)} USDC</strong>
        </div>
      </div>

      <div className="walletFieldGroup">
        <label className="walletLabel" htmlFor="master-vault-amount">{t("amount")}</label>
        <div className="walletActionRow">
          <input
            id="master-vault-amount"
            className="input walletAmountInput"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={isBusy}
          />
          {!isConnected ? (
            <button type="button" className="btn btnPrimary" onClick={() => void handleConnect()}>
              {t("connectWallet")}
            </button>
          ) : chainMismatch ? (
            <button type="button" className="btn btnPrimary" onClick={() => void handleSwitchChain()}>
              {t("switchToChain", { chain: config.chain.name })}
            </button>
          ) : requiresApproval ? (
            <button
              type="button"
              className="btn btnPrimary"
              disabled={isBusy || configDisabled || !spender}
              onClick={() => void handleWrite("approve")}
            >
              {pendingAction === "approve" ? t("approving") : t("approve")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btnPrimary"
              disabled={isBusy || configDisabled}
              onClick={() => void handleWrite("deposit")}
            >
              {pendingAction === "deposit" ? t("depositing") : t("deposit")}
            </button>
          )}
        </div>
      </div>

      <div className="walletFieldGroup">
        <label className="walletLabel" htmlFor="master-vault-withdraw-amount">{t("withdrawAmount")}</label>
        <div className="walletActionRow">
          <input
            id="master-vault-withdraw-amount"
            className="input walletAmountInput"
            type="number"
            min="0"
            step="0.01"
            value={withdrawAmount}
            onChange={(event) => setWithdrawAmount(event.target.value)}
            disabled={isBusy}
          />
          <button
            type="button"
            className="btn"
            onClick={() => setWithdrawAmount(formatUnits(withdrawableBalanceAtomic, config.usdc.decimals))}
            disabled={isBusy}
          >
            {t("maxWithdraw")}
          </button>
          {!isConnected ? (
            <button type="button" className="btn btnPrimary" onClick={() => void handleConnect()}>
              {t("connectWallet")}
            </button>
          ) : chainMismatch ? (
            <button type="button" className="btn btnPrimary" onClick={() => void handleSwitchChain()}>
              {t("switchToChain", { chain: config.chain.name })}
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={isBusy || configDisabled}
              onClick={() => void handleWrite("withdraw")}
            >
              {pendingAction === "withdraw" ? t("withdrawing") : t("withdraw")}
            </button>
          )}
        </div>
      </div>

      {feedback ? (
        <div className={`walletNotice ${feedbackTone === "error" ? "walletNoticeError" : feedbackTone === "success" ? "walletNoticeSuccess" : ""}`}>
          {feedback}
        </div>
      ) : null}

      {config.masterVault.errors.length > 0 ? (
        <div className="walletMutedText">
          {t("configIssues", { issues: config.masterVault.errors.join(", ") })}
        </div>
      ) : null}
      {disabledReason ? (
        <div className="walletNotice walletNoticeError">{disabledReason}</div>
      ) : null}
      {configDisabled ? (
        <div className="walletMutedText">{disabledHintOverride || t("disabledHint")}</div>
      ) : null}
    </section>
  );
}
