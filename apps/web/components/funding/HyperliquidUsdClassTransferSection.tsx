"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import type { Address } from "viem";
import { apiGet } from "../../lib/api";
import {
  createUsdClassTransferClient,
  HyperliquidUsdClassTransferError,
  type UsdClassTransferExecutionState,
  validateUsdClassTransfer
} from "../../lib/funding/usdClassTransferClient";
import type { FundingBalance, FundingFeatureConfig, WalletFundingOverview } from "../../lib/funding/types";
import { formatToken, shortAddress } from "../../lib/wallet/format";

type TransferDirection = "spot_to_perp" | "perp_to_spot";

function displayBalance(balance: FundingBalance | null | undefined, maxDecimals = 4): string {
  if (!balance) return "—";
  if (!balance.available || balance.formatted === null) return "—";
  return `${formatToken(balance.formatted, maxDecimals)} ${balance.symbol}`;
}

function feedbackClass(state: UsdClassTransferExecutionState): string {
  if (state.phase === "error") return "walletNotice walletNoticeError";
  if (state.phase === "confirmed") return "walletNotice walletNoticeSuccess";
  return "walletNotice";
}

function phaseStepClass(current: UsdClassTransferExecutionState["phase"], step: "signature" | "pending" | "complete"): string {
  if (current === "error") return "";
  if (step === "signature") {
    return current === "awaiting_signature" || current === "submitted" || current === "pending" || current === "confirmed"
      ? "isActive"
      : "";
  }
  if (step === "pending") {
    return current === "submitted" || current === "pending" || current === "confirmed" ? "isActive" : "";
  }
  return current === "confirmed" ? "isActive" : "";
}

export default function HyperliquidUsdClassTransferSection({
  config,
  presentation = "card",
  initialDirection = "perp_to_spot"
}: {
  config: FundingFeatureConfig;
  presentation?: "card" | "modal";
  initialDirection?: TransferDirection;
}) {
  const t = useTranslations("funding.spotPerp");
  const tCommon = useTranslations("funding.common");
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<TransferDirection>(initialDirection);
  const [amount, setAmount] = useState("");
  const [executionState, setExecutionState] = useState<UsdClassTransferExecutionState>({ phase: "idle" });
  const client = useMemo(() => createUsdClassTransferClient(), []);

  const overviewQuery = useQuery({
    queryKey: ["funding-overview", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletFundingOverview>(`/funding/${address}/overview`)
  });

  const overview = overviewQuery.data ?? null;
  const spotBalance = overview?.hyperCore.usdc ?? null;
  const perpBalance = overview?.bridge.creditedBalance ?? null;
  const directionIsToPerp = direction === "spot_to_perp";
  const sourceBalance = directionIsToPerp ? spotBalance : perpBalance;
  const destinationBalance = directionIsToPerp ? perpBalance : spotBalance;
  const isCorrectSignatureChain = chainId === config.arbitrum.chainId;

  async function refreshOverview() {
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
      const payload = await refreshOverview();
      if (payload && params.predicate(payload)) return true;
      await new Promise((resolve) => window.setTimeout(resolve, params.delayMs));
    }
    return false;
  }

  async function handleTransfer() {
    if (!isConnected || !address || !walletClient || !overview) return;

    try {
      if (!isCorrectSignatureChain) {
        throw new HyperliquidUsdClassTransferError("wrong_chain", t("switchToArbitrum"));
      }

      validateUsdClassTransfer({
        amount,
        toPerp: directionIsToPerp,
        spotBalanceRaw: overview.hyperCore.usdc.raw,
        spotBalanceAvailable: overview.hyperCore.usdc.available,
        perpBalanceRaw: overview.bridge.creditedBalance.raw,
        perpBalanceAvailable: overview.bridge.creditedBalance.available
      });

      const beforeSpotRaw = BigInt(overview.hyperCore.usdc.raw ?? "0");
      const beforePerpRaw = BigInt(overview.bridge.creditedBalance.raw ?? "0");

      setExecutionState({
        phase: "awaiting_signature",
        message: t("awaitingSignature")
      });

      await client.submitTransfer({
        amount,
        toPerp: directionIsToPerp,
        walletClient,
        address: address as Address,
        hyperliquidExchangeUrl: config.hyperliquidExchangeUrl,
        signatureChainId: config.arbitrum.chainId
      });

      setExecutionState({
        phase: "pending",
        message: t("pending")
      });

      await refreshOverview();

      const confirmed = await pollUntil({
        attempts: 8,
        delayMs: 2500,
        predicate: (payload) => {
          const nextSpot = BigInt(payload.hyperCore.usdc.raw ?? "0");
          const nextPerp = BigInt(payload.bridge.creditedBalance.raw ?? "0");
          if (directionIsToPerp) {
            return nextPerp > beforePerpRaw || nextSpot < beforeSpotRaw;
          }
          return nextSpot > beforeSpotRaw || nextPerp < beforePerpRaw;
        }
      });

      setExecutionState({
        phase: confirmed ? "confirmed" : "pending",
        message: confirmed ? t("confirmed") : t("stillPending")
      });
    } catch (error) {
      const message = error instanceof HyperliquidUsdClassTransferError
        ? error.message
        : String((error as Error)?.message ?? error ?? t("errors.transferFailed"));
      setExecutionState({
        phase: "error",
        code: error instanceof HyperliquidUsdClassTransferError ? error.code : "usd_class_transfer_failed",
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
        <div className="skeletonLine skeletonLineLg" />
        <div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} />
        <div className="walletInfoGrid" style={{ marginTop: 12 }}>
          <div className="walletInfoTile"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} /></div>
          <div className="walletInfoTile"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" style={{ marginTop: 10 }} /></div>
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
      <div className="walletSectionHeader">
        <div className="walletSectionIntro">
          <h3 className="walletSectionTitle">{t("title")}</h3>
          <div className="walletMutedText">{t("subtitle")}</div>
        </div>
        <div className="fundingBridgeBadges">
          <span className="badge badgeOk">{tCommon("locationHyperCore")} / {t("spotLabel")}</span>
          <span className="badge badgeOk">{t("perpLabel")}</span>
          <span className="badge">{t("officialAction")}</span>
        </div>
      </div>

      <div className="walletMutedText fundingBridgeExplainer">
        {t("explanation")} {t("bridgeCreditsNote", { location: overview.bridge.creditedLocationLabel })}
      </div>

      <div className="walletInfoGrid fundingBridgeTopGrid">
        <div className="walletInfoTile">
          <span className="walletLabel">{t("spotUsdcBalance")}</span>
          <strong>{displayBalance(spotBalance, 2)}</strong>
        </div>
        <div className="walletInfoTile">
          <span className="walletLabel">{t("perpUsdcBalance")}</span>
          <strong>{displayBalance(perpBalance, 2)}</strong>
        </div>
        <div className="walletInfoTile">
          <span className="walletLabel">{t("timingLabel")}</span>
          <strong>{t("timingValue")}</strong>
        </div>
        <div className="walletInfoTile">
          <span className="walletLabel">{t("walletAddressLabel")}</span>
          <strong>{shortAddress(address)}</strong>
        </div>
      </div>

      {!isCorrectSignatureChain ? (
        <div className="walletNotice">
          <div>{t("switchToArbitrum")}</div>
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={() => void switchChainAsync({ chainId: config.arbitrum.chainId })}
            >
              {t("switchToArbitrumButton")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="fundingDirectionRow fundingSegmentedRow">
        <button
          type="button"
          className={`btn ${direction === "perp_to_spot" ? "btnPrimary" : ""}`}
          onClick={() => setDirection("perp_to_spot")}
        >
          {t("moveToSpot")}
        </button>
        <button
          type="button"
          className={`btn ${direction === "spot_to_perp" ? "btnPrimary" : ""}`}
          onClick={() => setDirection("spot_to_perp")}
        >
          {t("moveToPerp")}
        </button>
      </div>

      <div className="fundingBridgeFlowCard">
        <div className="walletInfoGrid">
          <div className="walletInfoTile">
            <span className="walletLabel">{t("fromLabel")}</span>
            <strong>{directionIsToPerp ? t("spotWallet") : t("perpWallet")}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("toLabel")}</span>
            <strong>{directionIsToPerp ? t("perpWallet") : t("spotWallet")}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("sourceBalanceLabel")}</span>
            <strong>{displayBalance(sourceBalance, 2)}</strong>
          </div>
          <div className="walletInfoTile">
            <span className="walletLabel">{t("destinationBalanceLabel")}</span>
            <strong>{displayBalance(destinationBalance, 2)}</strong>
          </div>
        </div>

        <div className="fundingBridgePhaseRow">
          <span className={`badge ${phaseStepClass(executionState.phase, "signature")}`}>{t("awaitingSignatureShort")}</span>
          <span className={`badge ${phaseStepClass(executionState.phase, "pending")}`}>{t("pendingShort")}</span>
          <span className={`badge ${phaseStepClass(executionState.phase, "complete")}`}>{t("confirmedShort")}</span>
        </div>

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
          {overview.bridge.links.officialAppUrl ? (
            <a className="btn" href={overview.bridge.links.officialAppUrl} target="_blank" rel="noreferrer">
              {t("openOfficialApp")}
            </a>
          ) : null}
        </div>

        <div className="walletMutedText fundingBridgeHint">{t("chainHint")}</div>

        {executionState.phase !== "idle" ? (
          <div className={feedbackClass(executionState)}>
            {executionState.message}
          </div>
        ) : null}

        <div className="walletActionRow walletCardActions fundingPrimaryActionRow">
          <button
            type="button"
            className="btn btnPrimary"
            onClick={handleTransfer}
            disabled={!walletClient || !isCorrectSignatureChain}
          >
            {directionIsToPerp ? t("submitToPerp") : t("submitToSpot")}
          </button>
        </div>
      </div>
    </section>
  );
}
