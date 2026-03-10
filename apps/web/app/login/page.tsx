"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiPost } from "../../lib/api";
import { buildSiweMessage, fetchSiweNonce, shortenWalletAddress, verifySiweLogin } from "../../lib/auth/siwe";
import { wagmiConfig } from "../../lib/web3/config";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { useAccount, useChainId } from "wagmi";
import { signMessage } from "wagmi/actions";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function mapSiweErrorCode(error: unknown): string {
  if (error instanceof ApiError) {
    const code = String(error.payload?.error ?? "").trim();
    if (code) return code;
  }
  return "siwe_unexpected_error";
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [siweStatus, setSiweStatus] = useState("");
  const [siweError, setSiweError] = useState("");
  const [siwePending, setSiwePending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus(t("signingIn"));
    setError("");
    try {
      await apiPost("/auth/login", { email, password });
      router.push(withLocalePath("/", locale));
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  async function submitSiwe() {
    setSiwePending(true);
    setSiweStatus(t("siwe.signingIn"));
    setSiweError("");

    if (!isConnected || !address) {
      setSiwePending(false);
      setSiweStatus("");
      setSiweError(t("siwe.connectWalletFirst"));
      return;
    }

    try {
      const nonceResult = await fetchSiweNonce();
      const domain = window.location.host;
      const uri = window.location.origin;
      const message = buildSiweMessage({
        domain,
        address,
        uri,
        chainId: Number(chainId || 999),
        nonce: nonceResult.nonce,
        statement: t("siwe.statement")
      });
      const signature = await signMessage(wagmiConfig, {
        account: address as `0x${string}`,
        message
      });

      await verifySiweLogin({
        message,
        signature,
        address
      });

      setSiweStatus(t("siwe.success", { wallet: shortenWalletAddress(address) || address }));
      router.push(withLocalePath("/", locale));
    } catch (e) {
      setSiweStatus("");
      const code = mapSiweErrorCode(e);
      const known = t.has(`siwe.errors.${code}`) ? t(`siwe.errors.${code}`) : errMsg(e);
      setSiweError(known);
    } finally {
      setSiwePending(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>{t("signIn")}</h1>
      <div className="card" style={{ padding: 16 }}>
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            {t("email")}
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("placeholders.email")}
              required
            />
          </label>
          <label style={{ fontSize: 13 }}>
            {t("password")}
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("placeholders.passwordDots")}
              required
            />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btnPrimary" type="submit" disabled={!email || !password}>
              {t("signInButton")}
            </button>
            <Link href={withLocalePath("/register", locale)} className="btn">
              {t("createAccount")}
            </Link>
            <Link href={withLocalePath("/reset-password", locale)} className="btn">
              {t("forgotPassword")}
            </Link>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{status}</span>
          </div>
          {error ? <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div> : null}
        </form>
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            className="btn"
            type="button"
            onClick={() => void submitSiwe()}
            disabled={siwePending}
            style={{ width: "100%" }}
          >
            {t("siwe.signInButton")}
          </button>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            {isConnected && address
              ? t("siwe.connectedWallet", { wallet: shortenWalletAddress(address) || address })
              : t("siwe.walletNotConnected")}
          </div>
          {siweStatus ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{siweStatus}</div> : null}
          {siweError ? <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444" }}>{siweError}</div> : null}
        </div>
      </div>
    </div>
  );
}
