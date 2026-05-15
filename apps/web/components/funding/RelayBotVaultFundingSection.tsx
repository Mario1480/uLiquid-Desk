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
  RELAY_DEFAULT_HYPE_TOPUP_USDC,
  RelayFundingError,
  RelayExecutionState,
  executeRelayLeg,
  getRelayQuote,
  pollRelayStatus,
  shouldSuggestHypeTopup,
  validateRelayFunding,
  validateRelayWithdrawal
} from "../../lib/funding/relayClient";
import {
  createFundingIntent,
  reconcileFundingIntent,
  submitFundingIntent
} from "../../lib/funding/intentClient";
import type {
  FundingBalance,
  FundingFeatureConfig,
  RelayFundingQuote,
  RelayFundingQuoteLeg,
  RelayFundingDirection,
  WalletFundingOverview
} from "../../lib/funding/types";
import { AppIcon } from "../../app/components/AppIcon";
import { buildExplorerTxUrl, formatToken } from "../../lib/wallet/format";

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
  if (!balance?.available || balance.formatted === null) return "-";
  return `${formatToken(balance.formatted, maxDecimals)} ${balance.symbol}`;
}

function feedbackClass(state: RelayExecutionState): string {
  if (state.phase === "error") return "walletNotice walletNoticeError";
  if (state.phase === "confirmed") return "walletNotice walletNoticeSuccess";
  return "walletNotice fundingModalFeedback";
}

function rawBalance(balance: FundingBalance | null | undefined): bigint {
  try {
    return BigInt(balance?.raw ?? "0");
  } catch {
    return BigInt(0);
  }
}

function destinationTargetRaw(balance: FundingBalance | null | undefined, leg: RelayFundingQuoteLeg): string {
  return (rawBalance(balance) + rawBalance({ raw: leg.destinationAmount.raw } as FundingBalance)).toString();
}

function quoteFeeLabel(leg: RelayFundingQuoteLeg | null): string {
  if (!leg?.feeAmount) return "-";
  return `${formatToken(leg.feeAmount.formatted, 6)} ${leg.feeAmount.symbol}`;
}

function quoteFeesLabel(quote: RelayFundingQuote | null): string {
  if (!quote) return "-";
  return [quote.hypeTopup, quote.usdc]
    .filter((leg): leg is RelayFundingQuoteLeg => Boolean(leg?.feeAmount))
    .map((leg) => quoteFeeLabel(leg))
    .join(" + ") || "-";
}

function quoteEtaLabel(quote: RelayFundingQuote | null): string {
  if (!quote) return "-";
  const values = [quote.hypeTopup?.timeEstimateSeconds, quote.usdc.timeEstimateSeconds]
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (values.length === 0) return "-";
  return `${values.reduce((sum, item) => sum + item, 0)}s`;
}

export default function RelayBotVaultFundingSection({
  config,
  presentation = "modal",
  direction = "arbitrum_to_hyperevm"
}: {
  config: FundingFeatureConfig;
  presentation?: "card" | "modal";
  direction?: RelayFundingDirection;
}) {
  const tFunding = useTranslations("funding.relay");
  const tWithdrawal = useTranslations("funding.relayWithdrawal");
  const t = direction === "hyperevm_to_arbitrum" ? tWithdrawal : tFunding;
  const tCommon = useTranslations("funding.common");
  const isWithdrawal = direction === "hyperevm_to_arbitrum";
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const arbitrumPublicClient = usePublicClient({ chainId: config.arbitrum.chainId });
  const hyperEvmPublicClient = usePublicClient({ chainId: config.hyperEvm.id });
  const [amount, setAmount] = useState("25");
  const [includeHypeTopup, setIncludeHypeTopup] = useState(false);
  const [hypeTopupAmount, setHypeTopupAmount] = useState(RELAY_DEFAULT_HYPE_TOPUP_USDC);
  const [quote, setQuote] = useState<RelayFundingQuote | null>(null);
  const [state, setState] = useState<RelayExecutionState>({ phase: "idle" });

  const connectedAddress = isAddress(address ?? "") ? (address as Address) : undefined;
  const overviewQuery = useQuery({
    queryKey: ["funding-overview", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletFundingOverview>(`/funding/${address}/overview`)
  });
  const arbitrumEth = useBalance({
    address: connectedAddress,
    chainId: config.arbitrum.chainId,
    query: { enabled: Boolean(connectedAddress) }
  });
  const arbitrumUsdc = useReadContract({
    address: isAddress(config.arbitrum.usdcAddress ?? "") ? (config.arbitrum.usdcAddress as Address) : undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    chainId: config.arbitrum.chainId,
    query: { enabled: Boolean(connectedAddress && isAddress(config.arbitrum.usdcAddress ?? "")) }
  });
  const hyperEvmHype = useBalance({
    address: connectedAddress,
    chainId: config.hyperEvm.id,
    query: { enabled: Boolean(connectedAddress) }
  });

  const liveArbitrumEth = createLiveBalance("ETH", 18, arbitrumEth.data?.value);
  const liveArbitrumUsdc = createLiveBalance("USDC", config.arbitrum.usdcDecimals, arbitrumUsdc.data as bigint | undefined);
  const liveHyperEvmHype = createLiveBalance("HYPE", 18, hyperEvmHype.data?.value);

  const overview = useMemo(() => {
    if (!overviewQuery.data) return null;
    return {
      ...overviewQuery.data,
      arbitrum: {
        ...overviewQuery.data.arbitrum,
        eth: liveArbitrumEth ?? overviewQuery.data.arbitrum.eth,
        usdc: liveArbitrumUsdc ?? overviewQuery.data.arbitrum.usdc
      },
      hyperEvm: {
        ...overviewQuery.data.hyperEvm,
        hype: liveHyperEvmHype ?? overviewQuery.data.hyperEvm.hype
      }
    };
  }, [liveArbitrumEth, liveArbitrumUsdc, liveHyperEvmHype, overviewQuery.data]);

  useEffect(() => {
    if (isWithdrawal) return;
    const raw = overview?.hyperEvm.hype.raw;
    if (raw !== undefined && shouldSuggestHypeTopup(raw)) {
      setIncludeHypeTopup(true);
    }
  }, [isWithdrawal, overview?.hyperEvm.hype.raw]);

  function clearQuote() {
    setQuote(null);
    if (state.phase !== "idle") setState({ phase: "idle" });
  }

  async function refreshQueries() {
    if (!address) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["funding-overview", address] }),
      queryClient.invalidateQueries({ queryKey: ["transfer-overview", address] }),
      queryClient.invalidateQueries({ queryKey: ["funding-history", address] }),
      queryClient.invalidateQueries({ queryKey: ["wallet-activity", address] })
    ]);
  }

  function validate() {
    if (!overview) throw new RelayFundingError("overview_missing", t("errors.overviewMissing"));
    if (isWithdrawal) {
      return validateRelayWithdrawal({
        usdcAmount: amount,
        hyperEvmUsdcRaw: overview.hyperEvm.usdc.raw,
        hyperEvmUsdcAvailable: overview.hyperEvm.usdc.available,
        hyperEvmHypeRaw: overview.hyperEvm.hype.raw,
        hyperEvmHypeAvailable: overview.hyperEvm.hype.available,
        connectedChainId: chainId,
        expectedChainId: config.hyperEvm.id
      });
    }
    return validateRelayFunding({
      usdcAmount: amount,
      includeHypeTopup,
      hypeTopupUsdcAmount: hypeTopupAmount,
      arbitrumUsdcRaw: overview.arbitrum.usdc.raw,
      arbitrumUsdcAvailable: overview.arbitrum.usdc.available,
      arbitrumEthRaw: overview.arbitrum.eth.raw,
      arbitrumEthAvailable: overview.arbitrum.eth.available,
      connectedChainId: chainId,
      expectedChainId: config.arbitrum.chainId
    });
  }

  async function loadQuote(): Promise<RelayFundingQuote> {
    const validated = validate();
    const validatedTopupAmount = !isWithdrawal && "hypeTopupUsdcAmount" in validated
      ? String(validated.hypeTopupUsdcAmount)
      : "0";
    setState({ phase: "quoting", message: t("quote.loading") });
    const nextQuote = await getRelayQuote(connectedAddress!, {
      direction,
      usdcAmount: validated.usdcAmount,
      includeHypeTopup: isWithdrawal ? false : includeHypeTopup,
      hypeTopupUsdcAmount: validatedTopupAmount
    });
    setQuote(nextQuote);
    setState({ phase: "idle" });
    return nextQuote;
  }

  async function handleSwitchToArbitrum() {
    try {
      await switchChainAsync({ chainId: isWithdrawal ? config.hyperEvm.id : config.arbitrum.chainId });
      setState({ phase: "idle" });
    } catch (error) {
      setState({ phase: "error", code: "switch_failed", message: String((error as Error)?.message ?? t("errors.switchFailed")) });
    }
  }

  async function executeLeg(leg: RelayFundingQuoteLeg, latestOverview: WalletFundingOverview) {
    const publicClient = isWithdrawal ? hyperEvmPublicClient : arbitrumPublicClient;
    if (!walletClient || !publicClient || !connectedAddress) {
      throw new RelayFundingError("wallet_missing", t("errors.walletMissing"));
    }
    const isHypeTopup = leg.legId === "hype_topup";
    const beforeSource = isWithdrawal ? latestOverview.hyperEvm.usdc : latestOverview.arbitrum.usdc;
    const beforeDestination = isWithdrawal
      ? latestOverview.arbitrum.usdc
      : isHypeTopup ? latestOverview.hyperEvm.hype : latestOverview.hyperEvm.usdc;
    const intent = await createFundingIntent(connectedAddress, {
      actionType: isWithdrawal
        ? "funding_relay_usdc_to_arbitrum"
        : isHypeTopup ? "funding_relay_hype_topup" : "funding_relay_usdc_to_hyperevm",
      actionKey: `relay:${leg.legId}:${leg.requestId ?? Date.now()}`,
      chainId: isWithdrawal ? config.hyperEvm.id : config.arbitrum.chainId,
      toAddress: leg.steps.at(-1)?.items.at(-1)?.tx.to ?? null,
      asset: isHypeTopup ? "HYPE" : "USDC",
      direction: isWithdrawal
        ? "hyperevm_to_arbitrum_usdc"
        : isHypeTopup ? "arbitrum_to_hyperevm_hype" : "arbitrum_to_hyperevm_usdc",
      amountRaw: leg.sourceAmount.raw,
      amountFormatted: leg.sourceAmount.formatted,
      sourceLocation: isWithdrawal ? "hyperEvm" : "arbitrum",
      destinationLocation: isWithdrawal ? "arbitrum" : "hyperEvm",
      beforeSourceRaw: beforeSource.raw ?? "0",
      beforeDestinationRaw: beforeDestination.raw ?? "0",
      targetDestinationRaw: destinationTargetRaw(beforeDestination, leg),
      reasonCode: "relay_funding_prepared",
      recoveryHint: "confirm_relay_transactions"
    });

    try {
      setState({ phase: "awaiting_signature", message: isHypeTopup ? t("execute.awaitingHype") : t("execute.awaitingUsdc") });
      const result = await executeRelayLeg({
        leg,
        walletClient,
        publicClient,
        address: connectedAddress
      });
      await submitFundingIntent(intent.action.id, {
        ...(result.txHash ? { txHash: result.txHash } : {}),
        status: "submitted",
        reasonCode: "relay_transaction_submitted",
        recoveryHint: "wait_for_relay_settlement"
      });
      setState({
        phase: "pending",
        txHash: result.txHash,
        message: isHypeTopup ? t("execute.pendingHype") : t("execute.pendingUsdc")
      });
      const relayStatus = await pollRelayStatus({ requestId: leg.requestId });
      if (relayStatus?.status === "failed") {
        await submitFundingIntent(intent.action.id, {
          ...(result.txHash ? { txHash: result.txHash } : {}),
          status: "failed",
          reasonCode: "relay_settlement_failed",
          recoveryHint: "retry_relay_funding"
        });
        throw new RelayFundingError("relay_settlement_failed", t("errors.relayFailed"));
      }
      await reconcileFundingIntent(intent.action.id);
      return result.txHash;
    } catch (error) {
      await submitFundingIntent(intent.action.id, {
        status: "failed",
        reasonCode: error instanceof RelayFundingError ? error.code : "relay_execution_failed",
        recoveryHint: "retry_relay_funding"
      }).catch(() => undefined);
      throw error;
    }
  }

  async function handleQuote() {
    try {
      if (!isConnected || !connectedAddress) throw new RelayFundingError("wallet_missing", t("errors.walletMissing"));
      await loadQuote();
    } catch (error) {
      setState({
        phase: "error",
        code: error instanceof RelayFundingError ? error.code : "quote_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleExecute() {
    try {
      if (!isConnected || !connectedAddress) throw new RelayFundingError("wallet_missing", t("errors.walletMissing"));
      if (!overview) throw new RelayFundingError("overview_missing", t("errors.overviewMissing"));
      const activeQuote = quote ?? await loadQuote();
      const legs = [
        ...(!isWithdrawal && includeHypeTopup && activeQuote.hypeTopup ? [activeQuote.hypeTopup] : []),
        activeQuote.usdc
      ];
      let lastTxHash: `0x${string}` | null = null;
      for (const leg of legs) {
        lastTxHash = await executeLeg(leg, overview);
      }
      setState({
        phase: "confirmed",
        txHash: lastTxHash,
        message: t("execute.confirmed")
      });
      await refreshQueries();
    } catch (error) {
      setState({
        phase: "error",
        code: error instanceof RelayFundingError ? error.code : "relay_execution_failed",
        message: error instanceof Error ? error.message : String(error)
      });
      await refreshQueries();
    }
  }

  const sourceChainId = isWithdrawal ? config.hyperEvm.id : config.arbitrum.chainId;
  const sourceExplorerUrl = isWithdrawal ? config.hyperEvm.explorerUrl : config.arbitrum.explorerUrl;
  const isCorrectSourceChain = chainId === sourceChainId;
  const busy = state.phase === "quoting" || state.phase === "awaiting_signature" || state.phase === "submitted" || state.phase === "pending";
  const usdcOut = quote?.usdc.destinationAmount.formatted ?? null;
  const hypeOut = quote?.hypeTopup?.destinationAmount.formatted ?? null;
  const sourceUsdcBalance = isWithdrawal ? overview?.hyperEvm.usdc : overview?.arbitrum.usdc;
  const destinationUsdcBalance = isWithdrawal ? overview?.arbitrum.usdc : overview?.hyperEvm.usdc;
  const sourceUsdcLabel = isWithdrawal ? t("balances.hyperEvmUsdc") : t("balances.arbitrumUsdc");
  const destinationUsdcLabel = isWithdrawal ? t("balances.arbitrumUsdc") : t("balances.hyperEvmUsdc");

  if (overviewQuery.isLoading) {
    return (
      <section className={`card walletCard fundingBridgeSection${presentation === "modal" ? " fundingModalSection" : ""}`}>
        <div className="skeletonLine skeletonLineLg" />
        <div className="skeletonLine skeletonLineMd" style={{ marginTop: 12 }} />
      </section>
    );
  }

  if (!overview) {
    return <div className="walletNotice walletNoticeError">{t("errors.overviewMissing")}</div>;
  }

  return (
    <section className={`card walletCard fundingBridgeSection${presentation === "modal" ? " fundingModalSection fundingRelayModalSection" : ""}`}>
      <div className={`walletSectionHeader${presentation === "modal" ? " fundingModalTitleBlock" : ""}`}>
        <div className="walletSectionIntro">
          {presentation === "modal" ? (
            <div className="fundingModalDirectionPill">
              {isWithdrawal ? tCommon("locationHyperEvm") : tCommon("locationArbitrum")} {"->"} {isWithdrawal ? tCommon("locationArbitrum") : tCommon("locationHyperEvm")}
            </div>
          ) : null}
          <h3 className="walletSectionTitle">{t("title")}</h3>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
        <span className={`badge ${isCorrectSourceChain ? "badgeOk" : "badgeWarn"}`}>
          {isCorrectSourceChain ? t("networkReady") : t("networkMismatch")}
        </span>
      </div>

      <div className="fundingRelayRouteStrip" aria-hidden="true">
        <div className="fundingRelayRouteNode">
          <span className="uiMetricLabel">{sourceUsdcLabel}</span>
          <strong>{isWithdrawal ? tCommon("locationHyperEvm") : tCommon("locationArbitrum")}</strong>
        </div>
        <div className="fundingRelayRouteArrow">
          <AppIcon name="chevronRight" size="1em" strokeWidth={1.8} aria-hidden />
        </div>
        <div className="fundingRelayRouteNode">
          <span className="uiMetricLabel">{destinationUsdcLabel}</span>
          <strong>{isWithdrawal ? tCommon("locationArbitrum") : tCommon("locationHyperEvm")}</strong>
        </div>
      </div>

      <div className="fundingRelayBalanceGrid">
        <div className="uiMetricTile fundingRelayBalanceTile">
          <span className="uiMetricLabel">{sourceUsdcLabel}</span>
          <strong className="uiMetricValue">{displayBalance(sourceUsdcBalance)}</strong>
        </div>
        <div className="uiMetricTile fundingRelayBalanceTile">
          <span className="uiMetricLabel">{destinationUsdcLabel}</span>
          <strong className="uiMetricValue">{displayBalance(destinationUsdcBalance)}</strong>
        </div>
        <div className="uiMetricTile fundingRelayBalanceTile">
          <span className="uiMetricLabel">{t("balances.hyperEvmHype")}</span>
          <strong className="uiMetricValue">{displayBalance(overview.hyperEvm.hype, 6)}</strong>
        </div>
      </div>

      <div className="fundingRelayPanel">
        <div className="fundingRelayPanelHeader">
          <span className="uiMetricLabel">{t("amountPlaceholder")}</span>
          <strong>USDC</strong>
        </div>
        <div className={`walletAmountRow fundingAmountActionRow${presentation === "modal" ? " fundingModalAmountRow fundingModalAmountField fundingRelayAmountRow" : ""}`}>
          <input
            className="walletAmountInput"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              clearQuote();
            }}
            placeholder={t("amountPlaceholder")}
            disabled={busy}
          />
          <button
            type="button"
            className="btn"
            disabled={busy || !sourceUsdcBalance?.available}
            onClick={() => {
              setAmount(sourceUsdcBalance?.formatted ?? amount);
              clearQuote();
            }}
          >
            <AppIcon name="max" />
            {t("maxButton")}
          </button>
        </div>
      </div>

      {!isWithdrawal ? (
        <div className={`fundingRelayTopupCard${includeHypeTopup ? " isActive" : ""}`}>
          <label className="fundingRelayTopupToggle">
            <input
              type="checkbox"
              checked={includeHypeTopup}
              onChange={(event) => {
                setIncludeHypeTopup(event.target.checked);
                clearQuote();
              }}
              disabled={busy}
            />
            <span>{t("topup.label")}</span>
          </label>
          <span className="walletMutedText">{displayBalance(overview.hyperEvm.hype, 6)}</span>
        </div>
      ) : null}

      {!isWithdrawal && includeHypeTopup ? (
        <div className={`walletAmountRow fundingAmountActionRow${presentation === "modal" ? " fundingModalAmountRow fundingModalAmountField fundingRelayAmountRow" : ""}`}>
          <input
            className="walletAmountInput"
            type="number"
            min="0"
            step="0.01"
            value={hypeTopupAmount}
            onChange={(event) => {
              setHypeTopupAmount(event.target.value);
              clearQuote();
            }}
            placeholder={t("topup.amountPlaceholder")}
            disabled={busy}
          />
          <span className="walletMutedText">{t("topup.usdcToHype")}</span>
        </div>
      ) : null}

      <div className="fundingRelayQuoteGrid">
        <div className="uiMetricTile fundingRelayQuoteTile">
          <span className="uiMetricLabel">{t("quote.usdcOut")}</span>
          <div className="uiMetricMeta">{usdcOut ? `${formatToken(usdcOut, 6)} USDC` : "-"}</div>
        </div>
        {!isWithdrawal ? (
          <div className="uiMetricTile fundingRelayQuoteTile">
            <span className="uiMetricLabel">{t("quote.hypeOut")}</span>
            <div className="uiMetricMeta">{hypeOut ? `${formatToken(hypeOut, 6)} HYPE` : includeHypeTopup ? "-" : t("quote.notIncluded")}</div>
          </div>
        ) : null}
        <div className="uiMetricTile fundingRelayQuoteTile">
          <span className="uiMetricLabel">{t("quote.relayFee")}</span>
          <div className="uiMetricMeta">{quoteFeesLabel(quote)}</div>
        </div>
        <div className="uiMetricTile fundingRelayQuoteTile">
          <span className="uiMetricLabel">{t("quote.eta")}</span>
          <div className="uiMetricMeta">{quoteEtaLabel(quote)}</div>
        </div>
      </div>

      {!isCorrectSourceChain ? (
	        <div className="walletActionRow fundingModalPrimaryActionRow">
	          <button type="button" className="btn btnPrimary" onClick={() => void handleSwitchToArbitrum()} disabled={busy}>
	            <AppIcon name="switch" />
	            {t("switchNetwork")}
	          </button>
	        </div>
      ) : (
	        <div className="walletActionRow fundingModalPrimaryActionRow">
	          <button type="button" className="btn" onClick={() => void handleQuote()} disabled={busy}>
	            <AppIcon name="preview" />
	            {state.phase === "quoting" ? t("quote.loadingShort") : t("quote.button")}
	          </button>
	          <button type="button" className="btn btnPrimary" onClick={() => void handleExecute()} disabled={busy || !walletClient || !(isWithdrawal ? hyperEvmPublicClient : arbitrumPublicClient)}>
	            <AppIcon name={isWithdrawal ? "withdraw" : "deposit"} />
	            {busy && state.phase !== "quoting" ? t("execute.busy") : t("execute.button")}
	          </button>
        </div>
      )}

      {state.phase !== "idle" ? (
        <div className={feedbackClass(state)} style={{ marginTop: 12 }}>
          <div>{state.message}</div>
          {state.txHash ? (
            <a href={buildExplorerTxUrl(sourceExplorerUrl, state.txHash)} target="_blank" rel="noreferrer">
              {t("txLink")}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
