"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { isBotVaultRuntimeModelRow } from "@mm/core/dist/botVaultRuntimeModel.js";
import { apiPost } from "../../lib/api";
import { TARGET_CHAIN_NAME } from "../../lib/web3/config";
import { AppIcon } from "../../app/components/AppIcon";
import type { GridInstance } from "./types";
import { useOnchainActionFlow } from "./OnchainVaultActions";
import { createIdempotencyKey, errMsg, formatNumber } from "./utils";

type ClaimPreviewResponse = {
  ok: true;
  preview: {
    maxClaimableUsd: number;
    requestedAmountUsd: number;
    feeRatePct: number;
    feeAmountUsd: number;
    netAmountUsd: number;
  };
};

type MarginPreviewResponse = {
  adjustment?: {
    transferAmountUsd: number;
    currentTotalBudgetUsd: number;
    nextTotalBudgetUsd: number;
    currentLiqEstimate: number | null;
    projectedLiqEstimate: number | null;
    currentInvestUsd: number;
    currentExtraMarginUsd: number;
    nextInvestUsd: number;
    nextExtraMarginUsd: number;
  };
  validation?: {
    ready: boolean;
    severity: string;
    codes: string[];
  };
};

type SharedDialogProps = {
  instance: GridInstance | null;
  onClose: () => void;
  onUpdated?: () => Promise<void> | void;
};

function getStablecoinLabel(input: {
  executionProvider?: string | null;
}): string {
  const provider = String(input.executionProvider ?? "").trim().toLowerCase();
  if (provider === "hyperliquid" || provider === "hyperliquid_demo") return "USDC";
  return "USDT";
}

function formatAmountInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(Number(value.toFixed(6)));
}

function parsePositiveAmount(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function QuickActionDialogFrame({
  title,
  subtitle,
  error,
  notice,
  onClose,
  children
}: {
  title: string;
  subtitle: string;
  error: string | null;
  notice: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fundingModalOverlay" onClick={onClose}>
      <div className="fundingModalCard" onClick={(event) => event.stopPropagation()}>
        <div className="fundingModalHeader">
          <div className="fundingModalHeaderCompact" style={{ display: "flex" }}>
            <button type="button" className="fundingModalCloseButton" onClick={onClose} aria-label="Close">
              <AppIcon name="close" />
            </button>
          </div>
        </div>
        <div className="fundingModalBody">
          <div className="walletSection fundingModalSection">
            <div className="fundingModalTitleBlock walletSectionHeader">
              <div className="walletSectionIntro">
                <div className="walletSectionTitle">{title}</div>
                <div className="walletMutedText">{subtitle}</div>
              </div>
            </div>
            {error ? (
              <div className="card" style={{ padding: 12, borderColor: "#ef4444" }}>{error}</div>
            ) : null}
            {notice ? (
              <div className="card" style={{ padding: 12, borderColor: "#22c55e" }}>{notice}</div>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GridClaimDialog({ instance, onClose, onUpdated }: SharedDialogProps) {
  const tGrid = useTranslations("grid.marketplace");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<ClaimPreviewResponse["preview"] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!instance) return;
    let cancelled = false;
    setLoadingPreview(true);
    setError(null);
    setNotice(null);
    void apiPost<ClaimPreviewResponse>(`/grid/instances/${instance.id}/claim-preview`, {})
      .then((response) => {
        if (cancelled) return;
        setPreview(response.preview);
        setAmount(formatAmountInput(response.preview.requestedAmountUsd));
      })
      .catch((previewError) => {
        if (cancelled) return;
        setError(errMsg(previewError));
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instance]);

  useEffect(() => {
    if (!instance) return;
    const amountUsd = parsePositiveAmount(amount);
    if (amount.trim() !== "" && amountUsd == null) return;
    const timer = window.setTimeout(() => {
      setLoadingPreview(true);
      setError(null);
      void apiPost<ClaimPreviewResponse>(`/grid/instances/${instance.id}/claim-preview`, {
        amountUsd: amountUsd ?? undefined
      })
        .then((response) => {
          setPreview(response.preview);
        })
        .catch((previewError) => {
          setError(errMsg(previewError));
        })
        .finally(() => {
          setLoadingPreview(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [amount, instance]);

  if (!instance) return null;

  const stablecoinLabel = getStablecoinLabel({
    executionProvider: instance.botVault?.executionProvider
  });

  async function submitClaim() {
    const amountUsd = parsePositiveAmount(amount);
    if (amountUsd == null) {
      setError(tGrid("quickActionAmountInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/grid/instances/${instance.id}/withdraw-profit`, {
        amountUsd
      });
      await Promise.resolve(onUpdated?.()).catch(() => undefined);
      onClose();
    } catch (claimError) {
      setError(errMsg(claimError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <QuickActionDialogFrame
      title={tGrid("quickClaimTitle")}
      subtitle={tGrid("quickClaimSubtitle", {
        symbol: instance.template?.symbol ?? "n/a"
      })}
      error={error}
      notice={notice}
      onClose={onClose}
    >
      <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>{tGrid("quickClaimAmountLabel")}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => setAmount(formatAmountInput(preview?.maxClaimableUsd ?? 0))}
            disabled={!preview}
          >
            <AppIcon name="max" />
            {tGrid("quickActionMax")}
          </button>
          </div>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <div className="card" style={{ padding: 10 }}>
            <div className="settingsMutedText">{tGrid("quickClaimMaxLabel")}</div>
            <strong>{formatNumber(preview?.maxClaimableUsd ?? 0, 6)} {stablecoinLabel}</strong>
          </div>
          <div className="card" style={{ padding: 10 }}>
            <div className="settingsMutedText">{tGrid("quickClaimFeeLabel")}</div>
            <strong>{formatNumber(preview?.feeAmountUsd ?? 0, 6)} {stablecoinLabel}</strong>
            <div className="settingsMutedText">{formatNumber(preview?.feeRatePct ?? 0, 0)}%</div>
          </div>
          <div className="card" style={{ padding: 10 }}>
            <div className="settingsMutedText">{tGrid("quickClaimNetLabel")}</div>
            <strong>{formatNumber(preview?.netAmountUsd ?? 0, 6)} {stablecoinLabel}</strong>
          </div>
        </div>

        {loadingPreview ? (
          <div className="settingsMutedText">{tGrid("quickActionPreviewLoading")}</div>
        ) : null}

	        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
	          <button type="button" className="btn" onClick={onClose}>
	            <AppIcon name="close" />
	            {tGrid("catalogClose")}
	          </button>
	          <button
	            type="button"
	            className="btn btnPrimary"
	            onClick={() => void submitClaim()}
	            disabled={busy || loadingPreview || !preview || (preview.maxClaimableUsd ?? 0) <= 0}
	          >
	            <AppIcon name="withdraw" />
	            {busy ? tGrid("saving") : tGrid("withdrawProfit")}
	          </button>
        </div>
      </div>
    </QuickActionDialogFrame>
  );
}

export function GridMarginDialog({ instance, onClose, onUpdated }: SharedDialogProps) {
  const tGrid = useTranslations("grid.marketplace");
  const tOnchain = useTranslations("grid.onchain");
  const flow = useOnchainActionFlow(onUpdated);
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<MarginPreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!instance) return;
    setAmount("");
    setPreview(null);
    setError(null);
    setNotice(null);
    flow.setError(null);
    flow.setNotice(null);
  }, [instance?.id, mode]);

  useEffect(() => {
    if (!instance) return;
    const amountUsd = parsePositiveAmount(amount);
    if (amount.trim() === "" || amountUsd == null) {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoadingPreview(true);
      setError(null);
      void apiPost<MarginPreviewResponse>(`/grid/instances/${instance.id}/margin/preview`, {
        mode,
        amountUsd
      })
        .then((response) => {
          setPreview(response);
        })
        .catch((previewError) => {
          setError(errMsg(previewError));
          setPreview(null);
        })
        .finally(() => {
          setLoadingPreview(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [amount, instance?.id, mode]);

  const stablecoinLabel = useMemo(
    () => getStablecoinLabel({ executionProvider: instance?.botVault?.executionProvider }),
    [instance?.botVault?.executionProvider]
  );

  if (!instance) return null;

  const liqDelta = preview?.adjustment?.currentLiqEstimate != null && preview?.adjustment?.projectedLiqEstimate != null
    ? preview.adjustment.projectedLiqEstimate - preview.adjustment.currentLiqEstimate
    : null;
  const walletFundingRequired = mode === "add" && isBotVaultRuntimeModelRow(instance.botVault);
  const canSubmitAdd = !walletFundingRequired || flow.canSignLiveActions;

  async function submitMarginAction() {
    const amountUsd = parsePositiveAmount(amount);
    if (amountUsd == null) {
      setError(tGrid("quickActionAmountInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "remove") {
        await apiPost(`/grid/instances/${instance.id}/margin/remove`, { amountUsd });
      } else if (walletFundingRequired) {
        const reserveAmountUsd = Number(preview?.adjustment?.transferAmountUsd ?? amountUsd);
        const signed = await flow.executeAction({
          busyKey: `grid-margin-add:${instance.id}`,
          buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(String(instance.botVault?.id ?? ""))}/reserve-tx`,
          body: {
            amountUsd: reserveAmountUsd,
            actionKey: createIdempotencyKey(`grid-margin-add:${instance.id}:${reserveAmountUsd}`)
          }
        });
        if (!signed) return;
        await apiPost(`/grid/instances/${instance.id}/margin/add/finalize`, { amountUsd });
      } else {
        await apiPost(`/grid/instances/${instance.id}/margin/add`, { amountUsd });
      }
      await Promise.resolve(onUpdated?.()).catch(() => undefined);
      onClose();
    } catch (marginError) {
      setError(errMsg(marginError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <QuickActionDialogFrame
      title={tGrid("quickMarginTitle")}
      subtitle={tGrid("quickMarginSubtitle", {
        symbol: instance.template?.symbol ?? "n/a"
      })}
      error={error ?? flow.error}
      notice={notice ?? flow.notice}
      onClose={onClose}
    >
      <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
	            className={`btn ${mode === "add" ? "btnPrimary" : ""}`}
	            onClick={() => setMode("add")}
	          >
	            <AppIcon name="add" />
	            {tGrid("add")}
	          </button>
          <button
            type="button"
	            className={`btn ${mode === "remove" ? "btnPrimary" : ""}`}
	            onClick={() => setMode("remove")}
	          >
	            <AppIcon name="remove" />
	            {tGrid("remove")}
          </button>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>{tGrid("quickMarginAmountLabel")}</span>
          <input
            className="input"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>

        {walletFundingRequired ? (
          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            {!flow.linkedWalletAddress ? (
              <div className="settingsMutedText">{tOnchain("walletLinkRequired")}</div>
            ) : !flow.isConnected ? (
              <div className="settingsMutedText">{tOnchain("walletConnectRequired")}</div>
            ) : !flow.walletMatches ? (
              <div className="settingsMutedText">{tOnchain("walletMismatch", { wallet: flow.linkedWalletAddress })}</div>
            ) : flow.chainMismatch ? (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
	                <div className="settingsMutedText">{tOnchain("wrongNetwork", { chain: TARGET_CHAIN_NAME })}</div>
	                <button type="button" className="btn" onClick={() => void flow.requestChainSwitch()}>
	                  <AppIcon name="switch" />
	                  {tOnchain("switchNetwork")}
	                </button>
              </div>
            ) : (
              <div className="settingsMutedText">{tGrid("quickMarginWalletReady")}</div>
            )}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <div className="card" style={{ padding: 10 }}>
            <div className="settingsMutedText">{tGrid("quickMarginCurrentLabel")}</div>
            <strong>{formatNumber(preview?.adjustment?.currentExtraMarginUsd ?? Number(instance.extraMarginUsd ?? 0), 2)} {stablecoinLabel}</strong>
          </div>
          <div className="card" style={{ padding: 10 }}>
            <div className="settingsMutedText">{tGrid("quickMarginProjectedLabel")}</div>
            <strong>{formatNumber(preview?.adjustment?.nextExtraMarginUsd ?? Number(instance.extraMarginUsd ?? 0), 2)} {stablecoinLabel}</strong>
          </div>
          <div className="card" style={{ padding: 10 }}>
            <div className="settingsMutedText">{tGrid("quickMarginLiqLabel")}</div>
            <strong>
              {formatNumber(preview?.adjustment?.currentLiqEstimate ?? Number(instance.metricsJson?.liqEstimateLong ?? instance.metricsJson?.liqEstimateShort ?? NaN), 2)}
              {" → "}
              {formatNumber(preview?.adjustment?.projectedLiqEstimate ?? NaN, 2)}
            </strong>
            <div className="settingsMutedText">
              {liqDelta == null ? "n/a" : `${liqDelta >= 0 ? "+" : ""}${formatNumber(liqDelta, 2)}`}
            </div>
          </div>
        </div>

        {preview?.adjustment ? (
          <div className="settingsMutedText">
            {tGrid("quickMarginBudgetLine", {
              current: formatNumber(preview.adjustment.currentTotalBudgetUsd, 2),
              next: formatNumber(preview.adjustment.nextTotalBudgetUsd, 2),
              unit: stablecoinLabel
            })}
          </div>
        ) : null}

        {loadingPreview ? (
          <div className="settingsMutedText">{tGrid("quickActionPreviewLoading")}</div>
        ) : null}
        {preview?.validation?.ready === false ? (
          <div className="settingsMutedText" style={{ color: "var(--warning)" }}>
            {tGrid("quickMarginPreviewBlocked")}
          </div>
        ) : null}

	        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
	          <button type="button" className="btn" onClick={onClose}>
	            <AppIcon name="close" />
	            {tGrid("catalogClose")}
	          </button>
	          <button
	            type="button"
	            className="btn btnPrimary"
	            onClick={() => void submitMarginAction()}
	            disabled={busy || loadingPreview || !preview?.adjustment || preview?.validation?.ready === false || !canSubmitAdd}
	          >
	            <AppIcon name={mode === "add" ? "add" : "remove"} />
	            {busy ? tGrid("saving") : mode === "add" ? tGrid("add") : tGrid("remove")}
          </button>
        </div>
      </div>
    </QuickActionDialogFrame>
  );
}
