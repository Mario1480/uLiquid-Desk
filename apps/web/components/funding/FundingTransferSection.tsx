"use client";

import { useState } from "react";
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
import { createHyperliquidViemWalletAdapter } from "../../lib/funding/hyperliquidViemWalletAdapter";
import {
  createTransferClient,
  isTransferCapableAsset,
  validateTransferRequest,
  TransferClientError
} from "../../lib/transfers/client";
import type {
  TransferAsset,
  TransferBalance,
  TransferDirection,
  TransferExecutionState,
  TransferFeatureConfig,
  WalletTransferOverview
} from "../../lib/transfers/types";
import { formatToken } from "../../lib/wallet/format";

function createLiveBalance(symbol: TransferAsset, decimals: number, value: bigint | undefined): TransferBalance | null {
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

function displayBalance(balance: TransferBalance | null | undefined, maxDecimals = 4): string {
  if (!balance) return "—";
  if (!balance.available || balance.formatted === null) return "—";
  return `${formatToken(balance.formatted, maxDecimals)} ${balance.symbol}`;
}

function feedbackClass(state: TransferExecutionState): string {
  if (state.phase === "error") return "walletNotice walletNoticeError";
  if (state.phase === "confirmed") return "walletNotice walletNoticeSuccess";
  return "walletNotice";
}

function networkBadgeClass(isCorrectChain: boolean): string {
  return isCorrectChain ? "badgeOk" : "badgeWarn";
}

function overviewReasonMessage(reason: string | null | undefined, tErrors: ReturnType<typeof useTranslations>) {
  switch (reason) {
    case "hyperliquid_info_rate_limited":
      return tErrors("hyperliquidRateLimited");
    case "hyperliquid_info_rate_limited_cached":
      return tErrors("hyperliquidRateLimitedCached");
    default:
      return reason;
  }
}

function overviewReasonClass(reason: string | null | undefined): string {
  switch (reason) {
    case "hyperliquid_info_rate_limited_cached":
      return "walletNotice";
    default:
      return "walletNotice walletNoticeError";
  }
}

function capabilityReasonMessage(reason: string | null | undefined, tErrors: ReturnType<typeof useTranslations>) {
  switch (reason) {
    case "hyperliquid_info_rate_limited":
      return tErrors("hyperliquidRateLimited");
    case "hyperliquid_info_rate_limited_cached":
      return tErrors("hyperliquidRateLimitedCached");
    case "system_address_missing":
      return tErrors("coreTransferNotConfigured");
    case "core_deposit_wallet_missing":
      return tErrors("coreDepositWalletMissing");
    case "hypercore_token_missing":
      return tErrors("assetConfigMissing");
    case "hyperevm_token_address_missing":
      return tErrors("assetConfigMissing");
    default:
      return reason ?? tErrors("unsupportedAsset");
  }
}

export default function FundingTransferSection({ config }: { config: TransferFeatureConfig }) {
  const t = useTranslations("funding.overview");
  const tCommon = useTranslations("funding.common");
  const tErrors = useTranslations("funding.errors");
  const { address, chainId, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: config.hyperEvm.id });

  const [direction, setDirection] = useState<TransferDirection>("core_to_evm");
  const [asset, setAsset] = useState<TransferAsset>("USDC");
  const [amount, setAmount] = useState("");
  const [executionState, setExecutionState] = useState<TransferExecutionState>({ phase: "idle" });

  const transferQuery = useQuery({
    queryKey: ["transfer-overview", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletTransferOverview>(`/transfers/${address}/overview`),
    staleTime: 15_000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const connectedAddress = isAddress(address ?? "") ? (address as Address) : undefined;
  const hyperEvmHype = useBalance({
    address: connectedAddress,
    chainId: config.hyperEvm.id,
    query: {
      enabled: Boolean(connectedAddress)
    }
  });
  const hyperEvmUsdc = useReadContract({
    address: isAddress(config.wallet.usdc.address ?? "") ? (config.wallet.usdc.address as Address) : undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    chainId: config.hyperEvm.id,
    query: {
      enabled: Boolean(connectedAddress && isAddress(config.wallet.usdc.address ?? ""))
    }
  });

  const liveHyperEvmHype = createLiveBalance("HYPE", 18, hyperEvmHype.data?.value);
  const liveHyperEvmUsdc = createLiveBalance(
    "USDC",
    config.wallet.usdc.decimals,
    hyperEvmUsdc.data as bigint | undefined
  );

  const overview = transferQuery.data
    ? {
        ...transferQuery.data,
        hyperEvm: {
          ...transferQuery.data.hyperEvm,
          hype: liveHyperEvmHype ?? transferQuery.data.hyperEvm.hype,
          usdc: liveHyperEvmUsdc ?? transferQuery.data.hyperEvm.usdc
        }
      }
    : null;

  const capability = overview?.capabilities.find(
    (item) => item.direction === direction && item.asset === asset
  ) ?? null;
  const sourceBalance = direction === "core_to_evm"
    ? asset === "USDC"
      ? overview?.hyperCore.usdc
      : overview?.hyperCore.hype
    : asset === "USDC"
      ? overview?.hyperEvm.usdc
      : overview?.hyperEvm.hype;
  const gasBalance = direction === "core_to_evm"
    ? overview?.hyperCore.hype
    : overview?.hyperEvm.hype;
  const locationFrom = direction === "core_to_evm" ? tCommon("locationHyperCore") : tCommon("locationHyperEvm");
  const locationTo = direction === "core_to_evm" ? tCommon("locationHyperEvm") : tCommon("locationHyperCore");
  const isCorrectHyperEvmChain = chainId === config.hyperEvm.id;
  const isCorrectSignatureChain = chainId === config.signatureChainId;
  const transferDisabledReason = !isConnected
    ? tErrors("connectWallet")
    : !capability
      ? tErrors("actionUnavailable")
      : !capability.supported
        ? capabilityReasonMessage(capability.reason, tErrors)
        : direction === "evm_to_core" && !isCorrectHyperEvmChain
          ? tErrors("switchToHyperEvm")
          : direction === "core_to_evm" && !isCorrectSignatureChain
            ? tErrors("switchToArbitrum")
          : null;

  async function handleTransfer() {
    if (!isConnected || !connectedAddress || !walletClient || !overview || !capability) return;

    try {
      validateTransferRequest({
        amount,
        capability,
        sourceBalanceRaw: sourceBalance?.raw ?? null,
        sourceBalanceDecimals: sourceBalance?.decimals,
        sourceBalanceAvailable: Boolean(sourceBalance?.available),
        gasBalanceRaw: gasBalance?.raw ?? null,
        gasAvailable: Boolean(gasBalance?.available),
        connectedChainId: chainId,
        expectedChainId: config.hyperEvm.id
      });

      if (direction === "core_to_evm" && !isCorrectSignatureChain) {
        throw new TransferClientError("wrong_chain", tErrors("switchToArbitrum"));
      }

      setExecutionState({
        phase: "awaiting_signature",
        message: direction === "core_to_evm" ? t("awaitingCoreSignature") : t("awaitingEvmSignature")
      });

      const client = createTransferClient({
        submitCoreToEvm: async (input) => {
          const { HttpTransport } = await import("@nktkas/hyperliquid");
          const { spotSend } = await import("@nktkas/hyperliquid/api/exchange");
          if (!input.capability.systemAddress || !input.capability.hyperCoreToken) {
            throw new TransferClientError("transfer_metadata_missing", capabilityReasonMessage(
              !input.capability.systemAddress ? "system_address_missing" : "hypercore_token_missing",
              tErrors
            ));
          }
          await spotSend(
            {
              transport: new HttpTransport({
                apiUrl: config.hyperliquidExchangeUrl,
                fetchOptions: {
                  cache: "no-store"
                }
              }),
              wallet: createHyperliquidViemWalletAdapter({
                walletClient,
                address: input.address,
                chainId: config.signatureChainId
              })
            },
            {
            destination: input.capability.systemAddress,
            token: input.capability.hyperCoreToken,
            amount: input.amount
            }
          );
        }
      });

      const result = await client.submitTransfer({
        amount,
        asset,
        direction,
        capability,
        walletClient,
        publicClient: publicClient ?? null,
        address: connectedAddress
      });
      setExecutionState({
        ...result,
        message:
          result.phase === "queued"
            ? t("queuedSuccess")
            : result.phase === "confirmed"
              ? t("confirmedSuccess")
              : result.message
      });
      await queryClient.invalidateQueries({
        queryKey: ["transfer-overview", address]
      });
      hyperEvmHype.refetch();
      hyperEvmUsdc.refetch();
      if (result.phase === "queued") {
        window.setTimeout(() => {
          void queryClient.invalidateQueries({
            queryKey: ["transfer-overview", address]
          });
        }, 5000);
      }
    } catch (error) {
      const message = error instanceof TransferClientError
        ? error.message
        : String((error as Error)?.message ?? error ?? tErrors("transferFailed"));
      setExecutionState({
        phase: "error",
        message,
        txHash: null,
        code: error instanceof TransferClientError ? error.code : "transfer_failed"
      });
    }
  }

  async function handleSwitchChain() {
    if (!switchChainAsync) return;
    try {
      await switchChainAsync({
        chainId: direction === "core_to_evm" ? config.signatureChainId : config.hyperEvm.id
      });
    } catch (error) {
      setExecutionState({
        phase: "error",
        message: String((error as Error)?.message ?? tErrors("switchToHyperEvm")),
        txHash: null,
        code: "switch_chain_failed"
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

  if (transferQuery.isLoading) {
    return (
      <div className="walletStack">
        <div className="walletMetricsGrid fundingMetricsGrid">
          <div className="card walletCard">
            <div className="skeletonLine skeletonLineLg" />
            <div className="skeletonLine skeletonLineMd" style={{ marginTop: 14 }} />
          </div>
          <div className="card walletCard">
            <div className="skeletonLine skeletonLineLg" />
            <div className="skeletonLine skeletonLineMd" style={{ marginTop: 14 }} />
          </div>
        </div>
      </div>
    );
  }

  if (transferQuery.error) {
    return (
      <div className="walletNotice walletNoticeError">
        {String((transferQuery.error as Error)?.message ?? t("loadError"))}
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="walletStack">
      <div className="fundingCalloutGrid">
        <div className="card walletCard fundingCalloutCard">
          <strong>{t("calloutDomainsTitle")}</strong>
          <div className="walletMutedText">{overview.protocol.domainsDescription}</div>
        </div>
        <div className="card walletCard fundingCalloutCard">
          <strong>{t("calloutCoreGasTitle")}</strong>
          <div className="walletMutedText">{t("calloutCoreGasBody")}</div>
        </div>
        <div className="card walletCard fundingCalloutCard">
          <strong>{t("calloutEvmGasTitle")}</strong>
          <div className="walletMutedText">{t("calloutEvmGasBody")}</div>
        </div>
      </div>

      <section className="walletMetricsGrid fundingMetricsGrid">
        <article className="card walletCard fundingMetricCard">
          <div className="walletSectionHeader">
            <div className="walletSectionIntro">
              <h3 className="walletSectionTitle">{t("hyperCoreCardTitle")}</h3>
              <div className="walletMutedText">{tCommon("locationHyperCore")}</div>
            </div>
            <span className={`badge ${overview.hyperCore.available ? "badgeOk" : "badgeWarn"}`}>
              {overview.hyperCore.available ? t("statusLive") : t("statusUnavailable")}
            </span>
          </div>
          {overview.hyperCore.reason ? (
            <div className={overviewReasonClass(overview.hyperCore.reason)}>
              {overviewReasonMessage(overview.hyperCore.reason, tErrors)}
            </div>
          ) : null}
          <div className="walletInfoGrid">
            <div className="walletInfoTile">
              <span className="walletLabel">USDC</span>
              <strong>{displayBalance(overview.hyperCore.usdc)}</strong>
            </div>
            <div className="walletInfoTile">
              <span className="walletLabel">HYPE</span>
              <strong>{displayBalance(overview.hyperCore.hype)}</strong>
            </div>
          </div>
        </article>

        <article className="card walletCard fundingMetricCard">
          <div className="walletSectionHeader">
            <div className="walletSectionIntro">
              <h3 className="walletSectionTitle">{t("hyperEvmCardTitle")}</h3>
              <div className="walletMutedText">
                {tCommon("locationHyperEvm")} · {overview.hyperEvm.network.networkName}
              </div>
            </div>
            <span className={`badge ${networkBadgeClass(isCorrectHyperEvmChain)}`}>
              {isCorrectHyperEvmChain ? t("networkReady") : t("networkMismatch")}
            </span>
          </div>
          {overview.hyperEvm.reason ? (
            <div className="walletNotice walletNoticeError">{overview.hyperEvm.reason}</div>
          ) : null}
          <div className="walletInfoGrid">
            <div className="walletInfoTile">
              <span className="walletLabel">USDC</span>
              <strong>{displayBalance(overview.hyperEvm.usdc)}</strong>
            </div>
            <div className="walletInfoTile">
              <span className="walletLabel">HYPE</span>
              <strong>{displayBalance(overview.hyperEvm.hype)}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="card walletCard fundingTransferCard">
        <div className="walletSectionHeader">
          <div className="walletSectionIntro">
            <h3 className="walletSectionTitle">{t("transferCardTitle")}</h3>
            <div className="walletMutedText">{t("transferCardSubtitle")}</div>
          </div>
        </div>

        <div className="fundingDirectionRow fundingSegmentedRow">
          <button
            type="button"
            className={`btn ${direction === "core_to_evm" ? "btnPrimary" : ""}`}
            onClick={() => setDirection("core_to_evm")}
          >
            {t("moveToHyperEvm")}
          </button>
          <button
            type="button"
            className={`btn ${direction === "evm_to_core" ? "btnPrimary" : ""}`}
            onClick={() => setDirection("evm_to_core")}
          >
            {t("moveToHyperCore")}
          </button>
        </div>

        <div className="fundingAssetRow fundingSegmentedRow">
          {(["USDC", "HYPE"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={`btn ${asset === candidate ? "btnPrimary" : ""}`}
              onClick={() => {
                if (isTransferCapableAsset(candidate)) setAsset(candidate);
              }}
            >
              {candidate}
            </button>
          ))}
        </div>

        <div className="walletFormDivider" />

        <div className="walletInfoGrid">
          <div className="walletInfoTile">
            <span className="walletLabel">{t("fromLabel")}</span>
            <strong>{locationFrom}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("toLabel")}</span>
            <strong>{locationTo}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("sourceBalanceLabel")}</span>
            <strong>{displayBalance(sourceBalance)}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("gasBalanceLabel")}</span>
            <strong>{displayBalance(gasBalance)}</strong>
          </div>
        </div>

        <div className="walletFormDivider" />

        <div className="walletAmountRow fundingAmountRow fundingAmountActionRow">
          <input
            className="walletAmountInput"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={t("amountPlaceholder")}
          />
          <button
            type="button"
            className="btn"
            onClick={() => setAmount(sourceBalance?.formatted ?? "")}
          >
            {t("maxButton")}
          </button>
        </div>

        {capability && !capability.supported ? (
          <div className="walletNotice walletNoticeError">
            {capabilityReasonMessage(capability.reason, tErrors)}
          </div>
        ) : null}

        {executionState.phase !== "idle" ? (
          <div className={feedbackClass(executionState)}>
            {executionState.message}
            {executionState.txHash ? (
              <div>
                <a
                  href={`${overview.hyperEvm.network.explorerUrl.replace(/\/$/, "")}/tx/${executionState.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tCommon("explorer")}
                </a>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="walletFormDivider" />

        <div className="walletActionRow walletCardActions fundingPrimaryActionRow">
          {(direction === "evm_to_core" && !isCorrectHyperEvmChain) || (direction === "core_to_evm" && !isCorrectSignatureChain) ? (
            <button type="button" className="btn" onClick={handleSwitchChain}>
              {direction === "core_to_evm" ? tErrors("switchToArbitrum") : t("switchNetworkButton")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btnPrimary"
            onClick={handleTransfer}
            disabled={Boolean(transferDisabledReason)}
          >
            {direction === "core_to_evm" ? t("submitToHyperEvm") : t("submitToHyperCore")}
          </button>
        </div>
        {transferDisabledReason ? (
          <div className="walletMutedText">{transferDisabledReason}</div>
        ) : null}
        {direction === "evm_to_core" && asset === "USDC" ? (
          <div className="walletMutedText">{t("evmToCoreUsdcHint")}</div>
        ) : null}
      </section>
    </div>
  );
}
