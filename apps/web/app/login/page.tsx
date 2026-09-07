"use client";
import { DeskLink } from "@/components/desk/DeskLink";

import { GlassButton } from "@/components/einui/liquid-glass/glass-button";
import { GlassInput } from "@/components/einui/liquid-glass/glass-input";
import { GlassAuthFrame } from "@/components/einui/auth-frame";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiPost } from "../../lib/api";
import { redirectAfterAuth } from "../../lib/auth/redirect";
import { buildSiweMessage, fetchSiweNonce, shortenWalletAddress, verifySiweLogin } from "../../lib/auth/siwe";
import { wagmiConfig } from "../../lib/web3/config";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { useAccount, useChainId } from "wagmi";
import { signMessage } from "wagmi/actions";
import { AppIcon } from "../components/AppIcon";
import LegalRiskNotice from "../components/LegalRiskNotice";
import Web3Providers from "../components/Web3Providers";

function errMsg(e: unknown, t: ReturnType<typeof useTranslations<"auth">>): string {
  if (e instanceof ApiError) {
    const code = String(e.payload?.error ?? "").trim();
    if (code && t.has(`errors.${code}`)) return t(`errors.${code}`);
    return `${e.message} (HTTP ${e.status})`;
  }
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

function LoginPageContent() {
  const t = useTranslations("auth");
  const locale = useLocale() as AppLocale;
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [siweStatus, setSiweStatus] = useState("");
  const [siweError, setSiweError] = useState("");
  const [siwePending, setSiwePending] = useState(false);
  const verifyEmailHref = useMemo(() => {
    const base = withLocalePath("/register", locale);
    const nextEmail = email.trim();
    return nextEmail ? `${base}?mode=verify&email=${encodeURIComponent(nextEmail)}` : base;
  }, [email, locale]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus(t("signingIn"));
    setError("");
    setErrorCode("");
    try {
      await apiPost("/auth/login", { email, password });
      redirectAfterAuth(locale);
    } catch (e) {
      setStatus("");
      setErrorCode(e instanceof ApiError ? String(e.payload?.error ?? "").trim() : "");
      setError(errMsg(e, t));
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
      redirectAfterAuth(locale);
    } catch (e) {
      setSiweStatus("");
      const code = mapSiweErrorCode(e);
      const known = t.has(`siwe.errors.${code}`) ? t(`siwe.errors.${code}`) : errMsg(e, t);
      setSiweError(known);
    } finally {
      setSiwePending(false);
    }
  }

  return (
    <GlassAuthFrame title={t("signIn")} icon={<AppIcon name="login" />} notice={<LegalRiskNotice compact />}>
        <form onSubmit={submit} className="authForm">
          <label className="authLabel">
            {t("email")}
            <GlassInput
              glowOnFocus={false}
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("placeholders.email")}
              required
            />
          </label>
          <label className="authLabel">
            {t("password")}
            <GlassInput
              glowOnFocus={false}
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("placeholders.passwordDots")}
              required
            />
          </label>
          <div className="authActions">
            <GlassButton className="btn btnPrimary" type="submit" disabled={!email || !password}>
              <AppIcon name="login" />
              {t("signInButton")}
            </GlassButton>
            <DeskLink href={withLocalePath("/register", locale)} className="btn">
              <AppIcon name="register" />
              {t("createAccount")}
            </DeskLink>
            <DeskLink href={withLocalePath("/reset-password", locale)} className="btn">
              <AppIcon name="key" />
              {t("forgotPassword")}
            </DeskLink>
            <span className="authStatus" role="status">{status}</span>
          </div>
          {errorCode === "email_not_verified" ? (
            <div className="authActions">
              <DeskLink href={verifyEmailHref} className="btn">
                <AppIcon name="mail" />
                {t("continueEmailVerification")}
              </DeskLink>
            </div>
          ) : null}
          {error ? <div className="authError" role="alert">{error}</div> : null}
        </form>
        <div className="authDivider">
          {!isConnected ? <div className="authWalletMeta">{t("siwe.connectWalletFirst")}</div> : null}
          <GlassButton
            className="btn"
            type="button"
            onClick={() => void submitSiwe()}
            disabled={siwePending}
          >
            <AppIcon name="wallet" />
            {t("siwe.signInButton")}
          </GlassButton>
          {isConnected && address ? (
            <div className="authWalletMeta">
              {t("siwe.connectedWallet", { wallet: shortenWalletAddress(address) || address })}
            </div>
          ) : null}
          {siweStatus ? <div className="authMessage">{siweStatus}</div> : null}
          {siweError ? <div className="authError" role="alert">{siweError}</div> : null}
        </div>
    </GlassAuthFrame>
  );
}

export default function LoginPage() {
  return (
    <Web3Providers>
      <LoginPageContent />
    </Web3Providers>
  );
}
