"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { erc20Abi, formatUnits, isAddress } from "viem";
import type { Address } from "viem";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient
} from "wagmi";
import { apiGet } from "../../lib/api";
import {
  BridgeExecutionState,
  FundingBridgeError,
  createFundingBridgeClient,
  validateBridgeDeposit,
  validateBridgeWithdraw
} from "../../lib/funding/bridgeClient";
import type { FundingBalance, FundingFeatureConfig, WalletFundingOverview } from "../../lib/funding/types";
import { buildExplorerTxUrl, formatToken, shortAddress } from "../../lib/wallet/format";

function createLiveBalance(symbol: string, decimals: number, value: bigint | undefined): FundingBalance | null {
  if (value === undefined) return null;
  return {
    symbol,
    decimals,
    raw: value.toString(),
    formatted: formatUnits(value, decimals),
    state: value > BigInt(0) ? "available" : "zero",
    available: true,
    reason: null
  };
}

function displayBalance(balance: FundingBalance | null | undefined, maxDecimals = 4): string {
  if (!balance) return "—";
  if (!balance.available || balance.formatted === null) return "—";
  return `${formatToken(balance.formatted, maxDecimals)} ${balance.symbol}`;
}

function feedbackClass(state: BridgeExecutionState): string {
  if (state.phase === "error") return "walletNotice walletNoticeError";
  if (state.phase === "confirmed") return "walletNotice walletNoticeSuccess";
  return "walletNotice";
}

function networkBadgeClass(isCorrectChain: boolean): string {
  return isCorrectChain ? "badgeOk" : "badgeWarn";
}

function routeBadgeClass(status: WalletFundingOverview["bridge"]["deposit"]["status"]): string {
  if (status === "ready") return "badgeOk";
  if (status === "warning") return "badgeWarn";
  return "badgeDanger";
}

function routeStatusLabel(
  t: ReturnType<typeof useTranslations>,
  status: WalletFundingOverview["bridge"]["deposit"]["status"]
): string {
  if (status === "ready") return t("routeReady");
  if (status === "warning") return t("routeAttention");
  return t("routeBlocked");
}

function phaseStepClass(current: BridgeExecutionState["phase"], step: "signature" | "pending" | "complete"): string {
  if (current === "error") return "";
  if (step === "signature") {
    return current === "awaiting_signature" || current === "pending" || current === "confirmed" ? "isActive" : "";
  }
  if (step === "pending") {
    return current === "pending" || current === "confirmed" ? "isActive" : "";
  }
  return current === "confirmed" ? "isActive" : "";
}

function modalFeedbackClass(state: BridgeExecutionState, presentation: "card" | "modal"): string {
  if (presentation !== "modal") return feedbackClass(state);
  if (state.phase === "error") return "walletNotice walletNoticeError";
  return "walletNotice fundingModalFeedback";
}

async function copyToClipboard(value: string | null | undefined): Promise<boolean> {
  const normalized = String(value ?? "").trim();
  if (!normalized || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(normalized);
    return true;
  } catch {
    return false;
  }
}

export default function ArbitrumHyperCoreBridgeSection({
  config,
  presentation = "card",
  initialFlow = "deposit"
}: {
  config: FundingFeatureConfig;
  presentation?: "card" | "modal";
  initialFlow?: "deposit" | "withdraw";
}) {
  const t = useTranslations("funding.bridge");
  const tCommon = useTranslations("funding.common");
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const arbitrumPublicClient = usePublicClient({ chainId: config.arbitrum.chainId });
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeFlow] = useState<"deposit" | "withdraw">(initialFlow);
  const [depositState, setDepositState] = useState<BridgeExecutionState>({ phase: "idle" });
  const [withdrawState, setWithdrawState] = useState<BridgeExecutionState>({ phase: "idle" });

  useEffect(() => {
    if (!destinationAddress && address) {
      setDestinationAddress(address);
    }
  }, [address, destinationAddress]);

  const overviewQuery = useQuery({
    queryKey: ["funding-overview", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletFundingOverview>(`/funding/${address}/overview`)
  });

  const connectedAddress = isAddress(address ?? "") ? (address as Address) : undefined;
  const arbitrumEth = useBalance({
    address: connectedAddress,
    chainId: config.arbitrum.chainId,
    query: {
      enabled: Boolean(connectedAddress)
    }
  });
  const arbitrumUsdc = useReadContract({
    address: isAddress(config.arbitrum.usdcAddress ?? "") ? (config.arbitrum.usdcAddress as Address) : undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    chainId: config.arbitrum.chainId,
    query: {
      enabled: Boolean(connectedAddress && isAddress(config.arbitrum.usdcAddress ?? ""))
    }
  });

  const liveArbitrumEth = createLiveBalance("ETH", 18, arbitrumEth.data?.value);
  const liveArbitrumUsdc = createLiveBalance(
    "USDC",
    config.arbitrum.usdcDecimals,
    arbitrumUsdc.data as bigint | undefined
  );

  const overview = useMemo(() => {
    if (!overviewQuery.data) return null;
    return {
      ...overviewQuery.data,
      arbitrum: {
        ...overviewQuery.data.arbitrum,
        eth: liveArbitrumEth ?? overviewQuery.data.arbitrum.eth,
        usdc: liveArbitrumUsdc ?? overviewQuery.data.arbitrum.usdc
      }
    };
  }, [liveArbitrumEth, liveArbitrumUsdc, overviewQuery.data]);

  const isCorrectArbitrumChain = chainId === config.arbitrum.chainId;
  const bridgeClient = useMemo(() => createFundingBridgeClient(), []);
  const depositRouteStatus = overview?.bridge.deposit.status ?? "blocked";
  const withdrawRouteStatus = overview?.bridge.withdraw.status ?? "blocked";
  const depositHints = useMemo(() => {
    if (!overview) return [];
    const hints = [...overview.bridge.deposit.missingRequirements];
    if (!isCorrectArbitrumChain) hints.unshift(t("wrongChainHint"));
    return hints;
  }, [isCorrectArbitrumChain, overview, t]);
  const withdrawHints = useMemo(() => {
    if (!overview) return [];
    const hints = [...overview.bridge.withdraw.missingRequirements];
    if (!isCorrectArbitrumChain) hints.unshift(t("wrongChainHint"));
    return hints;
  }, [isCorrectArbitrumChain, overview, t]);

  async function refreshBridgeOverview() {
    if (!address) return null;
    await queryClient.invalidateQueries({
      queryKey: ["funding-overview", address]
    });
    return queryClient.fetchQuery({
      queryKey: ["funding-overview", address],
      queryFn: () => apiGet<WalletFundingOverview>(`/funding/${address}/overview`)
    });
  }

  async function pollUntil(params: {
    attempts: number;
    delayMs: number;
    predicate: (payload: WalletFundingOverview) => boolean;
  }): Promise<boolean> {
    for (let index = 0; index < params.attempts; index += 1) {
      const payload = await refreshBridgeOverview();
      if (payload && params.predicate(payload)) return true;
      await new Promise((resolve) => window.setTimeout(resolve, params.delayMs));
    }
    return false;
  }

  async function handleCopy(key: string, value: string | null | undefined) {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1400);
  }

  async function handleSwitchToArbitrum(target: "deposit" | "withdraw") {
    if (!switchChainAsync) return;
    try {
      await switchChainAsync({ chainId: config.arbitrum.chainId });
    } catch (error) {
      const nextState = {
        phase: "error",
        code: "switch_chain_failed",
        message: String((error as Error)?.message ?? t("errors.switchToArbitrum"))
      } satisfies BridgeExecutionState;
      if (target === "withdraw") {
        setWithdrawState(nextState);
        return;
      }
      setDepositState(nextState);
    }
  }

  async function handleDeposit() {
    if (!isConnected || !connectedAddress || !walletClient || !arbitrumPublicClient || !overview) return;

    try {
      validateBridgeDeposit({
        amount: depositAmount,
        minDepositUsdc: config.bridge.minDepositUsdc,
        sourceBalanceRaw: overview.arbitrum.usdc.raw,
        sourceBalanceAvailable: overview.arbitrum.usdc.available,
        gasBalanceRaw: overview.arbitrum.eth.raw,
        gasAvailable: overview.arbitrum.eth.available,
        connectedChainId: chainId,
        expectedChainId: config.arbitrum.chainId
      });

      if (!config.arbitrum.usdcAddress || !config.bridge.depositContractAddress) {
        throw new FundingBridgeError("bridge_metadata_missing", t("errors.bridgeUnavailable"));
      }

      const beforeCreditedRaw = BigInt(overview.bridge.creditedBalance.raw ?? "0");

      setDepositState({
        phase: "awaiting_signature",
        message: t("deposit.awaitingSignature")
      });

      const result = await bridgeClient.submitDeposit({
        amount: depositAmount,
        walletClient,
        publicClient: arbitrumPublicClient,
        address: connectedAddress,
        usdcAddress: config.arbitrum.usdcAddress as Address,
        bridgeContractAddress: config.bridge.depositContractAddress as Address
      });

      setDepositState({
        phase: "pending",
        txHash: result.txHash,
        message: t("deposit.pending")
      });

      const bridged = await pollUntil({
        attempts: 12,
        delayMs: 5000,
        predicate: (payload) => BigInt(payload.bridge.creditedBalance.raw ?? "0") > beforeCreditedRaw
      });

      setDepositState({
        phase: bridged ? "confirmed" : "pending",
        txHash: result.txHash,
        message: bridged ? t("deposit.confirmed") : t("deposit.stillPending")
      });
    } catch (error) {
      const message = error instanceof FundingBridgeError
        ? error.message
        : String((error as Error)?.message ?? t("errors.depositFailed"));
      setDepositState({
        phase: "error",
        code: error instanceof FundingBridgeError ? error.code : "deposit_failed",
        message
      });
    }
  }

  async function handleWithdraw() {
    if (!isConnected || !connectedAddress || !walletClient || !overview) return;

    try {
      const validated = validateBridgeWithdraw({
        amount: withdrawAmount,
        feeUsdc: config.bridge.withdrawFeeUsdc,
        sourceBalanceRaw: overview.bridge.creditedBalance.raw,
        sourceBalanceAvailable: overview.bridge.creditedBalance.available,
        destination: destinationAddress,
        connectedChainId: chainId,
        expectedChainId: config.arbitrum.chainId
      });

      const beforeCreditedRaw = BigInt(overview.bridge.creditedBalance.raw ?? "0");

      setWithdrawState({
        phase: "awaiting_signature",
        message: t("withdraw.awaitingSignature")
      });

      await bridgeClient.submitWithdraw({
        amount: validated.normalizedAmount,
        destination: destinationAddress as Address,
        walletClient,
        address: connectedAddress,
        hyperliquidExchangeUrl: config.hyperliquidExchangeUrl,
        signatureChainId: config.arbitrum.chainId
      });

      setWithdrawState({
        phase: "pending",
        message: t("withdraw.pending")
      });

      const completed = await pollUntil({
        attempts: 24,
        delayMs: 10000,
        predicate: (payload) => BigInt(payload.bridge.creditedBalance.raw ?? "0") < beforeCreditedRaw
      });

      setWithdrawState({
        phase: completed ? "confirmed" : "pending",
        message: completed ? t("withdraw.confirmed") : t("withdraw.stillPending")
      });
    } catch (error) {
      const message = error instanceof FundingBridgeError
        ? error.message
        : String((error as Error)?.message ?? t("errors.withdrawFailed"));
      setWithdrawState({
        phase: "error",
        code: error instanceof FundingBridgeError ? error.code : "withdraw_failed",
        message
      });
    }
  }

  if (!isConnected) {
    return (
      <div className="card walletCard walletEmptyState">
        <h3 style={{ marginTop: 0 }}>{t("connectTitle")}</h3>
        <div className="walletMutedText">{t("connectDescription")}</div>
      </div>
    );
  }

  if (overviewQuery.isLoading) {
    return (
      <section className={`card walletCard fundingBridgeSection${presentation === "modal" ? " fundingModalSection" : ""}`}>
        <div className="walletSectionHeader">
          <div className="walletSectionIntro">
            <h3 className="walletSectionTitle">{t("title")}</h3>
            <div className="walletMutedText">{t("subtitle")}</div>
          </div>
        </div>
        <div className="walletInfoGrid">
          <div className="walletInfoTile"><div className="skeletonLine skeletonLineLg" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} /></div>
          <div className="walletInfoTile"><div className="skeletonLine skeletonLineLg" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} /></div>
        </div>
      </section>
    );
  }

  if (overviewQuery.error) {
    return (
      <div className="walletNotice walletNoticeError">
        {String((overviewQuery.error as Error)?.message ?? t("loadError"))}
      </div>
    );
  }

  if (!overview) return null;

  return (
    <section className={`card walletCard fundingBridgeSection${presentation === "modal" ? " fundingModalSection" : ""}`}>
      <div className={`walletSectionHeader${presentation === "modal" ? " fundingModalTitleBlock" : ""}`}>
        <div className="walletSectionIntro">
          <h3 className="walletSectionTitle">{t("title")}</h3>
          <div className="walletMutedText">
            {presentation === "modal" ? t("subtitle") : t("subtitle")}
          </div>
        </div>
        {presentation === "card" ? (
          <div className="fundingBridgeBadges">
            <span className={`badge ${networkBadgeClass(isCorrectArbitrumChain)}`}>
              {isCorrectArbitrumChain ? t("networkReady") : t("networkMismatch")}
            </span>
            <span className={`badge ${routeBadgeClass(depositRouteStatus)}`}>
              {t("deposit.title")} · {routeStatusLabel(t, depositRouteStatus)}
            </span>
            <span className={`badge ${routeBadgeClass(withdrawRouteStatus)}`}>
              {t("withdraw.title")} · {routeStatusLabel(t, withdrawRouteStatus)}
            </span>
            <span className="badge">{t("nativeUsdcOnly")}</span>
          </div>
        ) : null}
      </div>

      {presentation === "card" ? (
        <div className="walletMutedText fundingBridgeExplainer">
          {t("explanation")} {t("creditedLocationNote", { location: overview.bridge.creditedLocationLabel })}
        </div>
      ) : null}

      {presentation === "card" ? (
        <div className="walletInfoGrid fundingBridgeTopGrid">
          <div className="walletInfoTile">
            <span className="walletLabel">{t("arbitrumUsdcBalance")}</span>
            <strong>{displayBalance(overview.arbitrum.usdc, 2)}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("arbitrumGasBalance")}</span>
            <strong>{displayBalance(overview.arbitrum.eth, 4)}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("creditedUsdcBalance")}</span>
            <strong>{displayBalance(overview.bridge.creditedBalance, 2)}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("timingLabel")}</span>
            <strong>{t("timingSummary")}</strong>
          </div>
        </div>
      ) : null}

      {presentation === "card" ? <div className="walletFormDivider" /> : null}

      <div className="fundingBridgeGrid">
        {presentation === "card" || activeFlow === "deposit" ? (
        <article className="fundingBridgeFlowCard">
          <div className={`walletSectionIntro${presentation === "modal" ? " fundingModalTitleBlock" : ""}`}>
            <h4 className="walletSectionTitle">{t("deposit.title")}</h4>
            <div className="walletMutedText">{presentation === "modal" ? t("deposit.expectedTimeValue") : t("deposit.subtitle")}</div>
          </div>

          {presentation === "modal" ? (
            <>
              <div className="fundingModalDirectionPill">{tCommon("locationArbitrum")} ↔ {tCommon("locationHyperCore")}</div>
              <div className="fundingModalAmountMeta">
                <span>MIN</span>
                <strong>{formatToken(config.bridge.minDepositUsdc, 0)} USDC</strong>
              </div>
              <div className="fundingModalAmountMeta">
                <span>MAX</span>
                <strong>{formatToken(overview.arbitrum.usdc.formatted ?? "0", 2)} USDC</strong>
              </div>
              <select className="input walletAmountInput" value="USDC" disabled>
                <option value="USDC">USDC</option>
              </select>
              <select className="input walletAmountInput" value="Arbitrum" disabled>
                <option value="Arbitrum">Arbitrum</option>
              </select>
            </>
          ) : (
            <>
              <div className="walletInfoGrid">
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("deposit.minDepositLabel")}</span>
                  <strong>{formatToken(config.bridge.minDepositUsdc, 0)} USDC</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("deposit.expectedTimeLabel")}</span>
                  <strong>{t("deposit.expectedTimeValue")}</strong>
                </div>
              </div>

              <div className="fundingBridgePhaseRow">
                <span className={`badge ${phaseStepClass(depositState.phase, "signature")}`}>{t("awaitingSignatureShort")}</span>
                <span className={`badge ${phaseStepClass(depositState.phase, "pending")}`}>{t("pendingShort")}</span>
                <span className={`badge ${phaseStepClass(depositState.phase, "complete")}`}>{t("confirmedShort")}</span>
              </div>
            </>
          )}

          <div className={`walletAmountRow fundingAmountActionRow${presentation === "modal" ? " fundingModalAmountRow fundingModalAmountField" : ""}`}>
            <input
              className="input walletAmountInput"
              inputMode="decimal"
              value={depositAmount}
              onChange={(event) => setDepositAmount(event.target.value)}
              placeholder={t("amountPlaceholder")}
            />
            <button type="button" className={presentation === "modal" ? "fundingInlineMaxButton" : "btn"} onClick={() => setDepositAmount(overview.arbitrum.usdc.formatted ?? "")}>
              {t("maxButton")}: {formatToken(overview.arbitrum.usdc.formatted ?? "0", 2)}
            </button>
          </div>

          <div className={presentation === "modal" ? "walletActionRow fundingModalPrimaryActionRow fundingBridgeInlineActions" : "walletActionRow fundingBridgeInlineActions"}>
            {presentation === "card" ? (
              <>
                {!isCorrectArbitrumChain ? (
                  <button type="button" className="btn" onClick={() => handleSwitchToArbitrum("deposit")}>
                    {t("deposit.switchToArbitrum")}
                  </button>
                ) : null}
                <button type="button" className="btn" onClick={() => handleCopy("bridge-contract", overview.bridge.depositContractAddress)}>
                  {copiedKey === "bridge-contract" ? tCommon("copied") : t("deposit.copyBridgeAddress")}
                </button>
              </>
            ) : null}
            {presentation === "card" && overview.bridge.links.depositContractExplorerUrl ? (
              <a className="btn" href={overview.bridge.links.depositContractExplorerUrl} target="_blank" rel="noreferrer">
                {t("deposit.bridgeExplorer")}
              </a>
            ) : null}
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => {
                if (!isCorrectArbitrumChain) {
                  void handleSwitchToArbitrum("deposit");
                  return;
                }
                void handleDeposit();
              }}
              disabled={!walletClient}
            >
              {!isCorrectArbitrumChain ? t("deposit.switchToArbitrum") : t("deposit.submit")}
            </button>
          </div>

          {depositState.phase !== "idle" ? (
            <div className={modalFeedbackClass(depositState, presentation)}>
              {depositState.message}
              {presentation === "card" && depositState.txHash && overview.arbitrum.explorerUrl ? (
                <div>
                  <a href={buildExplorerTxUrl(overview.arbitrum.explorerUrl, depositState.txHash)} target="_blank" rel="noreferrer">
                    {tCommon("explorer")}
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}

          {depositHints.length && presentation === "card" ? (
            <div className="walletMutedText fundingBridgeHint">
              {depositHints.join(" · ")}
            </div>
          ) : null}
        </article>
        ) : null}

        {presentation === "card" || activeFlow === "withdraw" ? (
        <article className="fundingBridgeFlowCard">
          <div className={`walletSectionIntro${presentation === "modal" ? " fundingModalTitleBlock" : ""}`}>
            <h4 className="walletSectionTitle">{t("withdraw.title")}</h4>
            <div className="walletMutedText">{presentation === "modal" ? `${t("withdraw.expectedTimeValue")} · ${formatToken(config.bridge.withdrawFeeUsdc, 0)} USDC fee` : t("withdraw.subtitle")}</div>
          </div>

          {presentation === "modal" ? (
            <>
              <div className="fundingModalDirectionPill">{tCommon("locationHyperCore")} ↔ {tCommon("locationArbitrum")}</div>
              <div className="fundingModalAmountMeta">
                <span>{t("withdraw.feeLabel")}</span>
                <strong>{formatToken(config.bridge.withdrawFeeUsdc, 0)} USDC</strong>
              </div>
              <div className="fundingModalAmountMeta">
                <span>MAX</span>
                <strong>{formatToken(overview.bridge.creditedBalance.formatted ?? "0", 2)} USDC</strong>
              </div>
              <select className="input walletAmountInput" value="USDC" disabled>
                <option value="USDC">USDC</option>
              </select>
              <select className="input walletAmountInput" value="Arbitrum" disabled>
                <option value="Arbitrum">Arbitrum</option>
              </select>
            </>
          ) : (
            <>
              <div className="walletInfoGrid">
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("withdraw.feeLabel")}</span>
                  <strong>{formatToken(config.bridge.withdrawFeeUsdc, 0)} USDC</strong>
                </div>
                <div className="walletInfoTile">
                  <span className="walletLabel">{t("withdraw.expectedTimeLabel")}</span>
                  <strong>{t("withdraw.expectedTimeValue")}</strong>
                </div>
              </div>

              <div className="fundingBridgePhaseRow">
                <span className={`badge ${phaseStepClass(withdrawState.phase, "signature")}`}>{t("awaitingSignatureShort")}</span>
                <span className={`badge ${phaseStepClass(withdrawState.phase, "pending")}`}>{t("pendingShort")}</span>
                <span className={`badge ${phaseStepClass(withdrawState.phase, "complete")}`}>{t("confirmedShort")}</span>
              </div>
            </>
          )}

          {presentation === "card" ? (
          <label className="settingsField">
            <span className="settingsFieldLabel">{t("withdraw.destinationLabel")}</span>
            <div className="walletAmountRow fundingAmountActionRow">
              <input
                className="input walletAmountInput"
                value={destinationAddress}
                onChange={(event) => setDestinationAddress(event.target.value)}
                placeholder={t("withdraw.destinationPlaceholder")}
              />
              <button type="button" className="btn" onClick={() => setDestinationAddress(address ?? "")}>
                {t("withdraw.useConnectedWallet")}
              </button>
              <button type="button" className="btn" onClick={() => handleCopy("withdraw-destination", destinationAddress)}>
                {copiedKey === "withdraw-destination" ? tCommon("copied") : tCommon("copyAddress")}
              </button>
            </div>
          </label>
          ) : null}

          <div className={`walletAmountRow fundingAmountActionRow${presentation === "modal" ? " fundingModalAmountRow fundingModalAmountField" : ""}`}>
            <input
              className="input walletAmountInput"
              inputMode="decimal"
              value={withdrawAmount}
              onChange={(event) => setWithdrawAmount(event.target.value)}
              placeholder={t("amountPlaceholder")}
            />
            <button type="button" className={presentation === "modal" ? "fundingInlineMaxButton" : "btn"} onClick={() => setWithdrawAmount(overview.bridge.creditedBalance.formatted ?? "")}>
              {t("maxButton")}: {formatToken(overview.bridge.creditedBalance.formatted ?? "0", 2)}
            </button>
            {presentation === "card" && !isCorrectArbitrumChain ? (
              <button type="button" className="btn" onClick={() => handleSwitchToArbitrum("withdraw")}>
                {t("withdraw.switchToArbitrum")}
              </button>
            ) : null}
            {presentation === "card" && overview.bridge.links.officialAppUrl ? (
              <a className="btn" href={overview.bridge.links.officialAppUrl} target="_blank" rel="noreferrer">
                {t("withdraw.officialBridge")}
              </a>
            ) : null}
            {presentation === "card" ? (
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() => {
                  if (!isCorrectArbitrumChain) {
                    void handleSwitchToArbitrum("withdraw");
                    return;
                  }
                  void handleWithdraw();
                }}
                disabled={!walletClient}
              >
                {!isCorrectArbitrumChain ? t("withdraw.switchToArbitrum") : t("withdraw.submit")}
              </button>
            ) : null}
          </div>

          {presentation === "modal" ? (
            <div className="walletActionRow fundingModalPrimaryActionRow">
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() => {
                  if (!isCorrectArbitrumChain) {
                    void handleSwitchToArbitrum("withdraw");
                    return;
                  }
                  void handleWithdraw();
                }}
                disabled={!walletClient}
              >
                {!isCorrectArbitrumChain ? t("withdraw.switchToArbitrum") : t("withdraw.submit")}
              </button>
            </div>
          ) : null}

          {withdrawState.phase !== "idle" ? (
            <div className={modalFeedbackClass(withdrawState, presentation)}>
              {withdrawState.message}
            </div>
          ) : null}

          {withdrawHints.length && presentation === "card" ? (
            <div className="walletMutedText fundingBridgeHint">
              {withdrawHints.join(" · ")}
            </div>
          ) : null}
        </article>
        ) : null}
      </div>

      {presentation === "card" ? (
        <>
          <div className="walletFormDivider" />
          <div className="walletInfoGrid fundingBridgeSafetyGrid">
            <div className="walletInfoTile">
              <span className="walletLabel">{t("safetyTitle")}</span>
              <strong>{t("safetyValue")}</strong>
            </div>
            <div className="walletInfoTile">
              <span className="walletLabel">{t("walletAddressLabel")}</span>
              <strong>{shortAddress(address)}</strong>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
