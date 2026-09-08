"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { getAccount, getBlock, getTransactionReceipt, waitForTransactionReceipt } from "wagmi/actions";
import { apiGet, apiPost } from "../../../lib/api";
import { wagmiConfig } from "../../../lib/web3/config";
import { assertMainnetLockingTransaction, type MainnetLockingAction, type MainnetLockingTx } from "../../../src/uliq/mainnetLocking";
import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskAnchor } from "@/components/desk/DeskAnchor";
import { AppIcon } from "../../components/AppIcon";
import PageHeader from "../../components/ui/PageHeader";
import Web3Providers from "../../components/Web3Providers";
import styles from "./mainnet-locking.module.css";

type Position = { lockId: string; amountRaw: string; unlockAt: string; withdrawn: boolean; canUnlock: boolean };
type State = {
  walletAddress: Address; lockerAddress: Address; balanceRaw: string; lockedBalanceRaw: string;
  positions: Position[]; depositsEnabled: boolean; extensionsEnabled: boolean; partial: boolean;
  asOfBlock: string; asOfTimestamp: string; indexedThroughBlock: string | null; nextCursor: string | null;
};
type Pending = { wallet: string; hash: Hex; state: "submitted" | "confirmed" | "finalized" | "failed" | "cancelled" | "untracked"; block?: string };
const base = "/uliq/mainnet-locking";

function Content() {
  const t = useTranslations("uliq.mainnetLocking");
  const locale = useLocale();
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState(32);
  const [extensions, setExtensions] = useState<Record<string, number>>({});
  const [before, setBefore] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const walletMatches = Boolean(address && data && address.toLowerCase() === data.walletAddress.toLowerCase());
  const pendingActive = Boolean(pending && ["submitted", "confirmed"].includes(pending.state));
  const updatePending = useCallback((next: Pending) => {
    if (getAccount(wagmiConfig).address?.toLowerCase() === next.wallet.toLowerCase()) setPending(next);
    try { sessionStorage.setItem(`uliq-mainnet-locking:${next.wallet.toLowerCase()}`, JSON.stringify(next)); }
    catch { /* Receipt tracking continues in memory if browser storage is unavailable. */ }
  }, []);
  useEffect(() => {
    generation.current += 1;
    setBefore(undefined);
    setPending(null);
    if (!address) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`uliq-mainnet-locking:${address.toLowerCase()}`) ?? "null") as Pending | null;
      if (saved && saved.wallet.toLowerCase() === address.toLowerCase() && /^0x[0-9a-fA-F]{64}$/.test(saved.hash)
        && ["submitted", "confirmed", "finalized", "failed", "cancelled", "untracked"].includes(saved.state)) setPending(saved);
    } catch { /* Invalid local history cannot authorize a transaction. */ }
  }, [address]);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await apiGet<State>(`${base}${before ? `?before=${before}` : ""}`);
      if (current === generation.current) { setData(next); setError(""); }
    } catch { if (current === generation.current) { setData(null); setError(t("unavailable")); } }
    finally { if (current === generation.current) setLoading(false); }
  }, [before, t]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15000); return () => { clearInterval(timer); generation.current += 1; }; }, [load]);
  useEffect(() => {
    if (!pending || !address || pending.wallet.toLowerCase() !== address.toLowerCase() || !pendingActive) return;
    let cancelled = false;
    const check = async () => {
      try {
        const receipt = await getTransactionReceipt(wagmiConfig, { chainId: 42161, hash: pending.hash });
        const canonical = await getBlock(wagmiConfig, { chainId: 42161, blockNumber: receipt.blockNumber });
        if (cancelled) return;
        if (canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return;
        const reconciled = data && BigInt(data.asOfBlock) >= receipt.blockNumber
          && data.indexedThroughBlock && BigInt(data.indexedThroughBlock) >= receipt.blockNumber;
        const state = receipt.status !== "success" ? "failed" : reconciled ? "finalized" : "confirmed";
        if (state !== pending.state || pending.block !== receipt.blockNumber.toString()) updatePending({ ...pending, block: receipt.blockNumber.toString(), state });
      } catch { /* Missing receipt remains pending; provider lag is not transaction failure. */ }
    };
    void check(); const timer = setInterval(() => void check(), 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [address, data, pending, pendingActive, updatePending]);

  async function send(tx: MainnetLockingTx, action: MainnetLockingAction, wallet: Address, locker: Address) {
    assertMainnetLockingTransaction(tx, wallet, locker, action);
    if (getAccount(wagmiConfig).address?.toLowerCase() !== wallet.toLowerCase()) throw new Error("wallet_changed");
    if (getAccount(wagmiConfig).chainId !== 42161) await switchChainAsync({ chainId: 42161 });
    const current = getAccount(wagmiConfig);
    if (current.address?.toLowerCase() !== wallet.toLowerCase() || current.chainId !== 42161) throw new Error("wallet_changed");
    const hash = await sendTransactionAsync({ account: wallet, chainId: 42161, to: tx.to, data: tx.data, value: BigInt(0) });
    updatePending({ wallet, hash, state: "submitted" });
    let replaced = false;
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      chainId: 42161, hash, timeout: 120000,
      onReplaced: (replacement) => {
        replaced = replacement.reason !== "repriced" || replacement.transaction.to?.toLowerCase() !== tx.to.toLowerCase()
          || replacement.transaction.input.toLowerCase() !== tx.data.toLowerCase() || replacement.transaction.value !== BigInt(0);
        updatePending({ wallet, hash: replacement.transaction.hash, state: replaced ? "cancelled" : "submitted" });
      }
    });
    if (replaced) throw new Error("transaction_replaced");
    updatePending({ wallet, hash: receipt.transactionHash, state: receipt.status === "success" ? "confirmed" : "failed", block: receipt.blockNumber.toString() });
    if (receipt.status !== "success") throw new Error("transaction_reverted");
    return receipt;
  }
  async function run(action: () => Promise<void>) {
    if (inFlight.current || !walletMatches || !data || !address) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await action(); await load(); } catch { setError(t("actionFailed")); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function lock() {
    if (!data || !address) return;
    const wallet = address; const locker = data.lockerAddress;
    if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(amount)) throw new Error("invalid_amount");
    const raw = parseUnits(amount, 18);
    if (raw <= BigInt(0) || raw > BigInt(data.balanceRaw)) throw new Error("invalid_amount");
    const body = { amountRaw: raw.toString(), durationDays: days };
    const prepared = await apiPost<{ approval: MainnetLockingTx; transaction: MainnetLockingTx }>(`${base}/lock/prepare`, body);
    await send(prepared.approval, { kind: "approve", amount: raw, days }, wallet, locker);
    // Refresh the server's deposit gate and linked-wallet binding after approval.
    const fresh = await apiPost<{ transaction: MainnetLockingTx }>(`${base}/lock/prepare`, body);
    await send(fresh.transaction, { kind: "lock", amount: raw, days }, wallet, locker);
  }
  async function positionAction(position: Position, extend: boolean) {
    if (!data || !address) return;
    const expiry = (BigInt(position.unlockAt) > BigInt(data.asOfTimestamp) ? BigInt(position.unlockAt) : BigInt(data.asOfTimestamp)) + BigInt(extensions[position.lockId] ?? 32) * BigInt(86400);
    const tx = await apiPost<MainnetLockingTx>(`${base}/${extend ? "extend" : "unlock"}/prepare`, {
      lockId: position.lockId, contractAddress: data.lockerAddress, ...(extend ? { newUnlockAt: expiry.toString() } : {})
    });
    await send(tx, extend ? { kind: "extend", id: BigInt(position.lockId), expiry } : { kind: "unlock", id: BigInt(position.lockId) }, address, data.lockerAddress);
  }
  const disabled = busy || pendingActive || !walletMatches;
  const format = (raw: string) => formatUnits(BigInt(raw), 18);
  return <div className={`uiPage ${styles.page}`}>
    <PageHeader title={t("title")} description={t("description")} eyebrow="Arbitrum One" actions={<DeskButton className="btn" disabled={busy} onClick={() => void load()}><AppIcon name="refresh" />{t("refresh")}</DeskButton>} />
    {error ? <div className="uiNotice uiNotice-danger" role="alert">{error}</div> : null}
    {loading ? <p role="status">{t("loading")}</p> : null}
    {data ? <>
      {!walletMatches ? <div className="uiNotice uiNotice-warning">{t("walletRequired")}</div> : null}
      {data.partial ? <div className="uiNotice uiNotice-info" role="status">{t("syncing")}</div> : null}
      <DeskSurface><section className={styles.section}>
        <dl className={styles.metrics}><div><dt>{t("available")}</dt><dd>{format(data.balanceRaw)} ULIQ</dd></div><div><dt>{t("locked")}</dt><dd>{format(data.lockedBalanceRaw)} ULIQ</dd></div></dl>
        {!data.depositsEnabled ? <p>{t("depositsClosed")}</p> : <form className={styles.controls} onSubmit={event => { event.preventDefault(); void run(lock); }}>
          <label>{t("amount")}<DeskInput className="input" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required disabled={busy} /></label>
          <label>{t("duration")}<DeskSelect className="input" value={days} onChange={event => setDays(Number(event.target.value))} disabled={busy}>{[32,185,367].map(term => <option key={term} value={term}>{t("days", { days: term })}</option>)}</DeskSelect></label>
          <DeskButton className="btn btnPrimary" type="submit" disabled={disabled || !amount}><AppIcon name="wallet" />{t("lock")}</DeskButton>
        </form>}
      </section></DeskSurface>
      <section className={styles.positions}><h2 className="uiSectionTitle">{t("positions")}</h2>
        {!data.positions.length ? <p>{t("empty")}</p> : data.positions.map(position => <DeskSurface key={position.lockId}><article className={styles.section}>
          <strong>{t("position", { id: position.lockId })}</strong>
          <dl className={styles.metrics}><div><dt>{t("amount")}</dt><dd>{format(position.amountRaw)} ULIQ</dd></div><div><dt>{t("unlockAt")}</dt><dd>{new Date(Number(position.unlockAt) * 1000).toLocaleString(locale)}</dd></div></dl>
          {position.withdrawn ? <p>{t("withdrawn")}</p> : <div className={styles.controls}>
            {data.extensionsEnabled ? <><label>{t("extendBy")}<DeskSelect className="input" value={extensions[position.lockId] ?? 32} onChange={event => setExtensions(previous => ({ ...previous, [position.lockId]: Number(event.target.value) }))} disabled={busy}>{[32,185,367].map(term => <option key={term} value={term}>{t("days", { days: term })}</option>)}</DeskSelect></label><DeskButton className="btn" disabled={disabled} onClick={() => void run(() => positionAction(position, true))}><AppIcon name="refresh" />{t("extend")}</DeskButton></> : null}
            <DeskButton className="btn" disabled={disabled || !position.canUnlock} onClick={() => void run(() => positionAction(position, false))}><AppIcon name="withdraw" />{t("unlock")}</DeskButton>
          </div>}
        </article></DeskSurface>)}
        <div className={styles.controls}>{before ? <DeskButton className="btn" onClick={() => setBefore(undefined)}><AppIcon name="refresh" />{t("newest")}</DeskButton> : null}{data.nextCursor ? <DeskButton className="btn" onClick={() => setBefore(data.nextCursor!)}><AppIcon name="positions" />{t("older")}</DeskButton> : null}</div>
      </section>
      <DeskAnchor href={`https://arbiscan.io/address/${data.lockerAddress}`} target="_blank" rel="noreferrer"><AppIcon name="external" />{t("contract")}</DeskAnchor>
    </> : null}
    {pending ? <div className="uiNotice uiNotice-info" role="status"><p>{t(`transaction.${pending.state}`)}</p><div className={styles.controls}><DeskAnchor href={`https://arbiscan.io/tx/${pending.hash}`} target="_blank" rel="noreferrer"><AppIcon name="external" />{t("viewTransaction")}</DeskAnchor>{pendingActive && !busy ? <DeskButton className="btn" onClick={() => updatePending({ ...pending, state: "untracked" })}><AppIcon name="close" />{t("stopTracking")}</DeskButton> : null}</div></div> : null}
  </div>;
}

export default function MainnetLockingClient() { return <Web3Providers><Content /></Web3Providers>; }
