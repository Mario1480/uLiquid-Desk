"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import { useAccount, useChainId, useSendTransaction, useSwitchChain } from "wagmi";
import { signMessage, waitForTransactionReceipt } from "wagmi/actions";
import { ApiError, apiDelete, apiGet, apiPost } from "../../lib/api";
import { buildSiweMessage, shortenWalletAddress } from "../../lib/auth/siwe";
import { isUliqPublicPresaleLiveDataEnabled } from "../../lib/uliqPublicPresale";
import { wagmiConfig } from "../../lib/web3/config";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import {
  countdownLabel,
  createPublicPresalePreviewOverview,
  progressPercent,
  secondsToDays,
  type PublicPreparedTransaction,
  type PublicPresaleOverview,
  type PublicPresaleRound,
  type PublicPresaleRoundId,
  type PublicPresaleSession,
  type PublicTrackedPurchase,
  type PublicVestingPosition,
  type PublicWalletState
} from "../../src/uliq/publicPresale";
import { AppIcon } from "../components/AppIcon";
import Web3Providers from "../components/Web3Providers";

type Quote = {
  roundId: PublicPresaleRoundId;
  requestedUsdcRaw: string;
  acceptedUsdcRaw: string;
  uliqAllocationRaw: string;
  partialFill: boolean;
};

function formatRaw(value: string | null | undefined, decimals: number, maximumFractionDigits = 2): string {
  try {
    return Number(formatUnits(BigInt(value ?? "0"), decimals)).toLocaleString(undefined, { maximumFractionDigits });
  } catch {
    return "0";
  }
}

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return "–";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "–";
  return parsed.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return String(error.payload?.error ?? error.message);
  if (error && typeof error === "object" && "shortMessage" in error) return String((error as any).shortMessage);
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

function statusTone(status: string): string {
  const normalized = status.toUpperCase();
  if (["ACTIVE", "FINALIZED", "COMPLETED", "LISTING_LAUNCHED"].includes(normalized)) return "success";
  if (["PAUSED", "PENDING_WITHDRAWAL", "SUBMITTED", "SOFT_CONFIRMED", "SAFE", "LISTING_PENDING", "READY"].includes(normalized)) return "warning";
  if (["FAILED", "REORGED", "REVIEW_REQUIRED", "MISMATCH"].includes(normalized)) return "danger";
  return "neutral";
}

function RoundCard({ round, current, locale }: { round: PublicPresaleRound; current: boolean; locale: string }) {
  const t = useTranslations("presale");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const startCountdown = countdownLabel(round.saleStart, now);
  const endCountdown = countdownLabel(round.saleEnd, now);
  const countdown = round.state === "ACTIVE" && endCountdown
    ? t("rounds.endsIn", { time: endCountdown })
    : startCountdown
      ? t("rounds.startsIn", { time: startCountdown })
      : round.saleEnd && new Date(round.saleEnd).getTime() <= now
        ? t("rounds.ended")
        : null;
  const progress = progressPercent(round.totalRaisedUsdcRaw, round.hardCapUsdcRaw);
  const cliffDays = secondsToDays(round.cliffSeconds);
  const vestingDays = secondsToDays(round.linearVestingDurationSeconds);
  return (
    <article className={`publicPresaleRound uiSection ${current ? "isCurrent" : ""}`}>
      <div className="uiSectionHeader">
        <div className="uiSectionHeaderCopy">
          <span className="uliqSectionEyebrow">{current ? t("rounds.current") : t("rounds.round", { number: round.number })}</span>
          <h2 className="uiSectionTitle">{t("rounds.round", { number: round.number })}</h2>
          <p className="uiSectionDescription">
            {round.scheduleSource === "ONCHAIN" ? t("rounds.onchain") : round.scheduleSource === "BACKEND_DRAFT" ? t("rounds.planned") : t("rounds.notConfigured")}
          </p>
        </div>
        <span className={`uiStatusBadge uiStatusBadge-${statusTone(round.state)}`}>{t.has(`states.${round.state}`) ? t(`states.${round.state}`) : round.state}</span>
      </div>
      <div className="publicPresaleMetrics">
        <div><span>{t("rounds.price")}</span><strong>{formatRaw(round.priceUsdcRawPerUliq, 6, 4)} USDC</strong></div>
        <div><span>{t("rounds.allocation")}</span><strong>{formatRaw(round.allocationCapUliqRaw, 18, 0)} ULIQ</strong></div>
        <div><span>{t("rounds.hardCap")}</span><strong>{formatRaw(round.hardCapUsdcRaw, 6, 0)} USDC</strong></div>
        <div><span>{t("rounds.walletLimits")}</span><strong>{formatRaw(round.minPurchaseUsdcRaw, 6, 0)}–{formatRaw(round.maxPurchaseUsdcRaw, 6, 0)} USDC</strong></div>
        <div><span>{t("rounds.unlock")}</span><strong>{Number(round.initialUnlockBps) / 100}%</strong></div>
        <div><span>{t("rounds.vesting")}</span><strong>{cliffDays > 0 ? t("rounds.cliffVesting", { cliff: cliffDays, vesting: vestingDays }) : t("rounds.linearVesting", { vesting: vestingDays })}</strong></div>
      </div>
      <div className="publicPresaleProgress" aria-label={`${progress.toFixed(2)}%`}>
        <div className="publicPresaleProgressTrack"><span style={{ width: `${Math.min(100, progress)}%` }} /></div>
        <div className="publicPresaleProgressMeta">
          <span>{t("rounds.raised")}: {formatRaw(round.totalRaisedUsdcRaw, 6, 0)} USDC</span>
          <strong>{progress.toFixed(2)}%</strong>
        </div>
      </div>
      <div className="publicPresaleWindow">
        <AppIcon name="calendar" />
        <span>{t("rounds.saleWindow")}: {formatDate(round.saleStart, locale)} – {formatDate(round.saleEnd, locale)}</span>
        {countdown ? <strong>{countdown}</strong> : null}
      </div>
      {round.configurationStatus === "MISMATCH" ? <DeskSurface><div className="uiNotice uiNotice-danger">{t("rounds.configurationMismatch")}</div></DeskSurface> : null}
    </article>
  );
}

function PublicPresaleContent({ view, deskAuthenticated }: { view: "presale" | "vesting"; deskAuthenticated: boolean }) {
  const t = useTranslations("presale");
  const locale = useLocale() as AppLocale;
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const liveDataEnabled = isUliqPublicPresaleLiveDataEnabled();
  const configuredChainId = Number(process.env.NEXT_PUBLIC_ULIQ_PUBLIC_PRESALE_CHAIN_ID ?? "42161");
  const previewOverview = useMemo(() => createPublicPresalePreviewOverview(configuredChainId), [configuredChainId]);
  const [overview, setOverview] = useState<PublicPresaleOverview | null>(() => liveDataEnabled ? null : previewOverview);
  const [session, setSession] = useState<PublicPresaleSession | null>(null);
  const [walletState, setWalletState] = useState<PublicWalletState | null>(null);
  const [loading, setLoading] = useState(liveDataEnabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<Hex | null>(null);
  const [previewOnly, setPreviewOnly] = useState(!liveDataEnabled);

  const connectedMatchesSession = Boolean(address && session?.walletAddress && address.toLowerCase() === session.walletAddress.toLowerCase());
  const activeRound = overview?.rounds.find((round) => round.id === overview.currentRoundId) ?? overview?.rounds[0] ?? null;

  const load = useCallback(async () => {
    setError(null);
    if (!liveDataEnabled) {
      setOverview(previewOverview);
      setPreviewOnly(true);
      setSession(null);
      setWalletState(null);
      setLoading(false);
      return;
    }
    const [overviewResult, sessionResult, linkedWalletResult] = await Promise.allSettled([
      apiGet<PublicPresaleOverview>("/uliq/public/presale"),
      apiGet<PublicPresaleSession>("/uliq/public/session"),
      deskAuthenticated
        ? apiGet<PublicWalletState>("/uliq/public-presale/me")
        : Promise.reject(new Error("desk_session_not_requested"))
    ]);
    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
      setPreviewOnly(false);
    } else {
      setOverview(previewOverview);
      setPreviewOnly(true);
    }
    if (sessionResult.status === "fulfilled") {
      setSession(sessionResult.value);
      try { setWalletState(await apiGet<PublicWalletState>("/uliq/public/me")); }
      catch { setWalletState(null); }
    } else {
      setSession(null);
      setWalletState(overviewResult.status === "fulfilled" && linkedWalletResult.status === "fulfilled" ? linkedWalletResult.value : null);
    }
    setLoading(false);
  }, [deskAuthenticated, liveDataEnabled, previewOverview]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const pending = walletState?.trackedPurchases.some((purchase) => ["SUBMITTED", "SOFT_CONFIRMED", "SAFE"].includes(purchase.confirmationStatus));
    if (!pending) return;
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [load, walletState?.trackedPurchases]);

  async function runAction<T>(key: string, action: () => Promise<T>, success?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(null);
    }
  }

  async function verifyWallet() {
    if (!overview || !address || !isConnected) throw new Error(t("common.walletRequired"));
    if (chainId !== overview.chainId) await switchChainAsync({ chainId: overview.chainId });
    if (session) {
      await apiDelete("/uliq/public/session").catch(() => undefined);
      setSession(null);
      setWalletState(null);
    }
    const nonce = await apiGet<{ nonce: string }>("/uliq/public/session/nonce");
    const message = buildSiweMessage({
      domain: window.location.host,
      address,
      uri: window.location.origin,
      chainId: overview.chainId,
      nonce: nonce.nonce,
      statement: t("access.statement")
    });
    const signature = await signMessage(wagmiConfig, { account: address, message });
    const verified = await apiPost<PublicPresaleSession>("/uliq/public/session/verify", { message, signature, address });
    setSession(verified);
  }

  async function acceptTerms() {
    if (!session?.terms.ready || !session.terms.version || !session.terms.textHash) throw new Error(t("access.termsUnavailable"));
    await apiPost("/uliq/public/terms/accept", {
      accepted: true,
      version: session.terms.version,
      textHash: session.terms.textHash
    });
    setTermsChecked(false);
  }

  async function requestQuote() {
    if (!activeRound) return;
    const requestedUsdcRaw = parseUnits(amount.trim().replace(",", "."), 6).toString();
    const next = await apiPost<Quote>(`/uliq/public/presale/${activeRound.id}/quote`, { requestedUsdcRaw });
    setQuote(next);
  }

  async function executeTransaction(tx: PublicPreparedTransaction, onSubmitted?: (hash: Hex) => Promise<void> | void) {
    if (!address || !connectedMatchesSession) throw new Error(t("common.walletRequired"));
    if (tx.expectedSender && tx.expectedSender.toLowerCase() !== address.toLowerCase()) throw new Error(t("access.wrongWallet"));
    if (chainId !== tx.chainId) await switchChainAsync({ chainId: tx.chainId });
    const submittedHash = await sendTransactionAsync({
      account: address,
      chainId: tx.chainId,
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || "0")
    });
    setLastTransaction(submittedHash);
    await onSubmitted?.(submittedHash);
    let receiptHash = submittedHash;
    let replacementReason: "cancelled" | "replaced" | "repriced" | null = null;
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      chainId: tx.chainId,
      hash: submittedHash,
      confirmations: 1,
      onReplaced(replacement) {
        replacementReason = replacement.reason;
        receiptHash = replacement.transaction.hash;
        setLastTransaction(receiptHash);
      }
    });
    if (receipt.status !== "success" || replacementReason === "cancelled") throw new Error(t("common.transactionFailed"));
    return { submittedHash, receiptHash, replacementReason };
  }

  async function purchase() {
    if (!activeRound || !quote) return;
    const trackingPayload = {
      maxUsdcAmountRaw: quote.acceptedUsdcRaw,
      minUliqAllocationRaw: quote.uliqAllocationRaw
    };
    const prepared = await apiPost<{ approval: PublicPreparedTransaction; purchase: PublicPreparedTransaction }>(
      `/uliq/public/presale/${activeRound.id}/purchase/prepare`,
      trackingPayload
    );
    await executeTransaction(prepared.approval);
    setNotice(t("purchase.approvalConfirmed"));
    const result = await executeTransaction(prepared.purchase, async (hash) => {
      await apiPost(`/uliq/public/presale/${activeRound.id}/purchase/track`, {
        transactionHash: hash,
        ...trackingPayload
      }).catch(() => undefined);
    });
    if (result.receiptHash !== result.submittedHash) {
      await apiPost(`/uliq/public/presale/${activeRound.id}/purchase/track/replace`, {
        transactionHash: result.submittedHash,
        replacementTransactionHash: result.receiptHash,
        reason: result.replacementReason ?? "replaced"
      }).catch(() => undefined);
    }
    await apiPost(`/uliq/public/presale/${activeRound.id}/purchase/track`, {
      transactionHash: result.receiptHash,
      ...trackingPayload
    });
    await apiPost(`/uliq/public/presale/${activeRound.id}/purchase/track/refresh`, { transactionHash: result.receiptHash });
    setQuote(null);
    setAmount("");
  }

  async function settle(roundId: PublicPresaleRoundId, purchaseId: string, action: "withdraw" | "finalize") {
    const prepared = await apiPost<PublicPreparedTransaction>(`/uliq/public/presale/${roundId}/${action}/prepare`, { purchaseId });
    await executeTransaction(prepared);
  }

  async function claim(position: PublicVestingPosition) {
    const prepared = await apiPost<PublicPreparedTransaction>(`/uliq/public/vesting/${position.roundId}/claim/prepare`, {});
    await executeTransaction(prepared);
  }

  const allHistory = useMemo(() => {
    const canonical = (walletState?.purchases ?? []).map((purchase) => ({
      key: `purchase:${purchase.id}`,
      roundId: purchase.roundId,
      purchaseId: purchase.purchaseIdOnchain,
      transactionHash: purchase.transactionHash,
      confirmationStatus: purchase.confirmationStatus,
      state: purchase.status,
      usdcAmountRaw: purchase.usdcAmountRaw,
      uliqAllocationRaw: purchase.uliqAllocationRaw,
      withdrawalDeadline: purchase.withdrawalDeadline
    }));
    const tracked = (walletState?.trackedPurchases ?? []).map((purchase: PublicTrackedPurchase) => ({
      key: `tracking:${purchase.id}`,
      roundId: purchase.roundId,
      purchaseId: purchase.purchaseIdOnchain,
      transactionHash: purchase.transactionHash,
      confirmationStatus: purchase.confirmationStatus,
      state: purchase.onchainPurchase?.state ?? purchase.confirmationStatus,
      usdcAmountRaw: purchase.usdcAmountRaw ?? purchase.maxUsdcAmountRaw,
      uliqAllocationRaw: purchase.uliqAllocationRaw ?? purchase.minUliqAllocationRaw,
      withdrawalDeadline: purchase.onchainPurchase?.withdrawalDeadline ?? null
    }));
    return [...tracked, ...canonical];
  }, [walletState]);

  if (loading) return <div className="publicPresalePage"><DeskSurface><div className="uiNotice">{t("common.loading")}</div></DeskSurface></div>;
  if (!overview) return <div className="publicPresalePage"><DeskSurface><div className="uiNotice uiNotice-warning">{t("hero.unavailable")} {error ? <small>{error}</small> : null}</div></DeskSurface></div>;

  return (
    <div className="publicPresalePage">
      <header className="uiPageHeader publicPresaleHero">
        <div className="uiPageHeaderCopy">
          <span className="uliqSectionEyebrow">{view === "vesting" ? t("vesting.eyebrow") : t("hero.eyebrow")}</span>
          <h1>{view === "vesting" ? t("vesting.title") : t("hero.title")}</h1>
          <p>{view === "vesting" ? t("vesting.description") : t("hero.description")}</p>
          <div className="publicPresaleHeroMeta">
            <span className="uiStatusBadge uiStatusBadge-warning">{t("hero.preview")}</span>
            <span>{previewOnly ? t(overview.explorerUrl && !/^0x0{40}$/i.test(overview.tokenAddress) ? "hero.presaleContractsPending" : "hero.contractsPending") : t("hero.finalizedBlock", { block: overview.asOfBlock })}</span>
            {overview.explorerUrl && !/^0x0{40}$/i.test(overview.tokenAddress) ? (
              <a className="btn" href={`${overview.explorerUrl}/token/${overview.tokenAddress}`} target="_blank" rel="noreferrer" title={overview.tokenAddress}>
                <AppIcon name="external" /> {t("hero.tokenContract")}: {overview.tokenAddress.slice(0, 8)}…{overview.tokenAddress.slice(-6)}
              </a>
            ) : null}
          </div>
        </div>
        <DeskButton className="btn" type="button" onClick={() => void load()} disabled={busy !== null}>
          <AppIcon name="refresh" /> {t("hero.refresh")}
        </DeskButton>
      </header>

      <nav className="uliqRouteTabs publicPresaleTabs" aria-label={t("tabs.label")}>
        <Link className={view === "presale" ? "isActive" : ""} href={withLocalePath("/presale", locale)}><AppIcon name="billing" /> {t("tabs.presale")}</Link>
        <Link className={view === "vesting" ? "isActive" : ""} href={withLocalePath("/presale/vesting", locale)}><AppIcon name="withdraw" /> {t("tabs.vesting")}</Link>
        <Link href={withLocalePath("/presale/terms", locale)}><AppIcon name="detail" /> {t("tabs.terms")}</Link>
      </nav>

      {previewOnly ? <DeskSurface><div className="uiNotice uiNotice-warning">{t("hero.previewNotice")}</div></DeskSurface> : null}
      {error ? <DeskSurface><div className="uiNotice uiNotice-danger">{error}</div></DeskSurface> : null}
      {notice ? <DeskSurface><div className="uiNotice uiNotice-success">{notice}</div></DeskSurface> : null}

      {view === "presale" ? (
        <>
          <section>
            <div className="uiSectionHeader publicPresaleSectionHeader">
              <div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("rounds.title")}</h2><p className="uiSectionDescription">{t("rounds.description")}</p></div>
            </div>
            <div className="publicPresaleRoundGrid">
              {overview.rounds.map((round) => <RoundCard key={round.id} round={round} current={!previewOnly && round.id === overview.currentRoundId} locale={locale} />)}
            </div>
          </section>

          <section className="publicPresaleActionGrid">
            <article className="uiSection publicPresaleAccess">
              <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("access.title")}</h2><p className="uiSectionDescription">{t("access.description")}</p></div><span className="uliqSummaryIcon"><AppIcon name="wallet" /></span></div>
              {previewOnly ? <DeskSurface><div className="uiNotice">{t("access.previewUnavailable")}</div></DeskSurface> : !isConnected || !address ? <DeskSurface><div className="uiNotice">{t("access.connect")}</div></DeskSurface> : null}
              {!previewOnly && isConnected && address && !connectedMatchesSession ? (
                <DeskButton className="btn btnPrimary" type="button" disabled={busy !== null} onClick={() => void runAction("verify", verifyWallet)}>
                  <AppIcon name="wallet" /> {busy === "verify" ? t("access.verifying") : t("access.verify")}
                </DeskButton>
              ) : null}
              {!previewOnly && session && connectedMatchesSession ? <DeskSurface><div className="uiNotice uiNotice-success">{t("access.verified", { time: formatDate(session.expiresAt, locale) })}<br />{shortenWalletAddress(session.walletAddress)}</div></DeskSurface> : null}
              {session && connectedMatchesSession && !session.terms.ready ? <DeskSurface><div className="uiNotice uiNotice-warning">{t("access.termsUnavailable")}</div></DeskSurface> : null}
              {session && connectedMatchesSession && session.terms.ready && !session.termsAccepted ? (
                <div className="publicPresaleTermsAccept">
                  <h3>{t("access.termsTitle")}</h3>
                  <p>{t("access.termsDescription")}</p>
                  <label><DeskInput type="checkbox" checked={termsChecked} onChange={(event) => setTermsChecked(event.target.checked)} /> <span>{t("access.termsCheckbox")}</span></label>
                  <div className="publicPresaleInlineLinks">
                    <Link href={withLocalePath("/presale/terms", locale)}>{t("tabs.terms")}</Link>
                    <Link href={withLocalePath("/terms", locale)}>{t("terms.platformTerms")}</Link>
                    <Link href={withLocalePath("/privacy", locale)}>{t("terms.privacy")}</Link>
                    <Link href={withLocalePath("/risk-disclosure", locale)}>{t("terms.risk")}</Link>
                  </div>
                  <DeskButton className="btn btnPrimary" type="button" disabled={!termsChecked || busy !== null} onClick={() => void runAction("terms", acceptTerms, t("access.termsAccepted"))}><AppIcon name="check" /> {t("access.acceptTerms")}</DeskButton>
                </div>
              ) : null}
              {session?.termsAccepted && connectedMatchesSession ? <DeskSurface><div className="uiNotice uiNotice-success"><AppIcon name="check" /> {t("access.termsAccepted")}</div></DeskSurface> : null}
            </article>

            <article className="uiSection publicPresalePurchase">
              <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("purchase.title", { round: activeRound ? t("rounds.round", { number: activeRound.number }) : "–" })}</h2><p className="uiSectionDescription">{t("purchase.description")}</p></div><span className="uliqSummaryIcon"><AppIcon name="billing" /></span></div>
              {!activeRound?.purchaseEnabled ? <DeskSurface><div className="uiNotice uiNotice-warning">{t("purchase.inactive")}</div></DeskSurface> : null}
              {!session?.termsAccepted || !connectedMatchesSession ? <DeskSurface><div className="uiNotice">{t("purchase.termsRequired")}</div></DeskSurface> : null}
              <label className="publicPresaleField"><span>{t("purchase.amount")}</span><DeskInput className="input" inputMode="decimal" value={amount} disabled={previewOnly} onChange={(event) => { setAmount(event.target.value); setQuote(null); }} placeholder="500" /></label>
              <DeskButton className="btn" type="button" disabled={!activeRound?.purchaseEnabled || !session?.termsAccepted || !connectedMatchesSession || !amount || busy !== null} onClick={() => void runAction("quote", requestQuote)}><AppIcon name="preview" /> {t("purchase.quote")}</DeskButton>
              {quote ? (
                <div className="publicPresaleQuote">
                  <div><span>{t("purchase.accepted")}</span><strong>{formatRaw(quote.acceptedUsdcRaw, 6)} USDC</strong></div>
                  <div><span>{t("purchase.allocation")}</span><strong>{formatRaw(quote.uliqAllocationRaw, 18)} ULIQ</strong></div>
                  {quote.partialFill ? <p>{t("purchase.partial")}</p> : null}
                  <DeskButton className="btn btnPrimary" type="button" disabled={busy !== null} onClick={() => void runAction("purchase", purchase, t("purchase.submitted"))}><AppIcon name="wallet" /> {t("purchase.approveBuy")}</DeskButton>
                </div>
              ) : null}
              {lastTransaction && overview.explorerUrl ? <a className="btn" href={`${overview.explorerUrl}/tx/${lastTransaction}`} target="_blank" rel="noreferrer"><AppIcon name="external" /> {t("purchase.lastTransaction")}</a> : null}
            </article>
          </section>

          <section className="uiSection publicPresaleHistory">
            <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><h2 className="uiSectionTitle">{t("history.title")}</h2><p className="uiSectionDescription">{t("history.description")}</p></div></div>
            {allHistory.length === 0 ? <div className="uiEmptyState">{t("history.empty")}</div> : (
              <div className="publicPresaleHistoryList">
                {allHistory.map((purchase) => {
                  const withdrawalOpen = purchase.state === "PENDING_WITHDRAWAL" && Boolean(purchase.withdrawalDeadline) && new Date(purchase.withdrawalDeadline!).getTime() >= Date.now();
                  const canFinalize = purchase.state === "PENDING_WITHDRAWAL" && Boolean(purchase.withdrawalDeadline) && new Date(purchase.withdrawalDeadline!).getTime() < Date.now();
                  return (
                    <article key={purchase.key} className="publicPresaleHistoryRow">
                      <div><strong>{purchase.purchaseId ? t("history.purchase", { id: purchase.purchaseId }) : purchase.roundId ?? "ULIQ"}</strong><span>{t("history.amount", { usdc: formatRaw(purchase.usdcAmountRaw, 6), uliq: formatRaw(purchase.uliqAllocationRaw, 18) })}</span></div>
                      <span className={`uiStatusBadge uiStatusBadge-${statusTone(purchase.confirmationStatus)}`}>{purchase.confirmationStatus.replaceAll("_", " ")}</span>
                      <div><span>{t("history.withdrawalDeadline")}</span><strong>{formatDate(purchase.withdrawalDeadline, locale)}</strong></div>
                      <div className="publicPresaleHistoryActions">
                        {overview.explorerUrl ? <a className="btn btnIcon" href={`${overview.explorerUrl}/tx/${purchase.transactionHash}`} target="_blank" rel="noreferrer" aria-label={t("history.transaction")}><AppIcon name="external" /></a> : null}
                        {purchase.roundId && purchase.purchaseId && withdrawalOpen ? <DeskButton className="btn" type="button" disabled={busy !== null} onClick={() => void runAction(`withdraw:${purchase.key}`, () => settle(purchase.roundId!, purchase.purchaseId!, "withdraw"))}><AppIcon name="withdraw" /> {t("history.withdraw")}</DeskButton> : null}
                        {purchase.roundId && purchase.purchaseId && canFinalize ? <DeskButton className="btn btnPrimary" type="button" disabled={busy !== null} onClick={() => void runAction(`finalize:${purchase.key}`, () => settle(purchase.roundId!, purchase.purchaseId!, "finalize"))}><AppIcon name="check" /> {t("history.finalize")}</DeskButton> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="publicPresaleVestingGrid">
          {!walletState ? <DeskSurface><div className="uiNotice">{previewOnly ? t("vesting.previewUnavailable") : t("vesting.connect")}</div></DeskSurface> : null}
          {(walletState?.vesting ?? overview.rounds.map((round) => ({ roundId: round.id } as PublicVestingPosition))).map((position) => {
            const round = overview.rounds.find((item) => item.id === position.roundId);
            const hasData = typeof position.allocatedRaw === "string";
            const progress = hasData && BigInt(position.allocatedRaw) > BigInt(0) ? Number(BigInt(position.vestedRaw) * BigInt(10_000) / BigInt(position.allocatedRaw)) / 100 : 0;
            return (
              <article className="uiSection publicPresaleVestingCard" key={position.roundId}>
                <div className="uiSectionHeader"><div className="uiSectionHeaderCopy"><span className="uliqSectionEyebrow">{round ? t("rounds.round", { number: round.number }) : position.roundId}</span><h2 className="uiSectionTitle">{t("vesting.title")}</h2></div><span className={`uiStatusBadge uiStatusBadge-${BigInt(position.claimableRaw ?? "0") > BigInt(0) ? "success" : "neutral"}`}>{formatRaw(position.claimableRaw, 18)} ULIQ</span></div>
                <div className="publicPresaleMetrics">
                  <div><span>{t("vesting.allocated")}</span><strong>{formatRaw(position.allocatedRaw, 18)} ULIQ</strong></div>
                  <div><span>{t("vesting.vested")}</span><strong>{formatRaw(position.vestedRaw, 18)} ULIQ</strong></div>
                  <div><span>{t("vesting.released")}</span><strong>{formatRaw(position.releasedRaw, 18)} ULIQ</strong></div>
                  <div><span>{t("vesting.claimable")}</span><strong>{formatRaw(position.claimableRaw, 18)} ULIQ</strong></div>
                  <div><span>{t("vesting.unreleased")}</span><strong>{formatRaw(position.unreleasedRaw, 18)} ULIQ</strong></div>
                </div>
                <div className="publicPresaleProgress"><div className="publicPresaleProgressTrack"><span style={{ width: `${Math.min(100, progress)}%` }} /></div><div className="publicPresaleProgressMeta"><span>{t("vesting.vested")}</span><strong>{progress.toFixed(2)}%</strong></div></div>
                <dl className="publicPresaleSchedule">
                  <div><dt>{t("vesting.listing")}</dt><dd>{formatDate(position.listingTimestamp, locale)}</dd></div>
                  <div><dt>{t("vesting.linearStart")}</dt><dd>{formatDate(position.linearVestingStart, locale)}</dd></div>
                  <div><dt>{t("vesting.vestingEnd")}</dt><dd>{formatDate(position.vestingEnd, locale)}</dd></div>
                </dl>
                <DeskButton className="btn btnPrimary" type="button" disabled={!hasData || !connectedMatchesSession || BigInt(position.claimableRaw ?? "0") === BigInt(0) || busy !== null} onClick={() => void runAction(`claim:${position.roundId}`, () => claim(position), t("vesting.claimSubmitted"))}><AppIcon name="withdraw" /> {t("vesting.claim")}</DeskButton>
                {hasData && BigInt(position.claimableRaw) === BigInt(0) ? <p className="uiSectionDescription">{t("vesting.nothing")}</p> : null}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

export default function PublicPresaleClient({ view, deskAuthenticated = false }: { view: "presale" | "vesting"; deskAuthenticated?: boolean }) {
  return <Web3Providers><PublicPresaleContent view={view} deskAuthenticated={deskAuthenticated} /></Web3Providers>;
}
