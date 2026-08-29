"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiPost } from "../../lib/api";
import { redirectAfterAuth } from "../../lib/auth/redirect";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { AppIcon } from "../components/AppIcon";
import LegalRiskNotice, { LEGAL_ACKNOWLEDGEMENT_VERSION } from "../components/LegalRiskNotice";

function errMsg(e: unknown, t: ReturnType<typeof useTranslations<"auth">>): string {
  if (e instanceof ApiError) {
    const code = String(e.payload?.error ?? "").trim();
    if (code && t.has(`errors.${code}`)) return t(`errors.${code}`);
    return `${e.message} (HTTP ${e.status})`;
  }
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

type RegisterResponse = {
  ok: true;
  pendingVerification?: boolean;
  email?: string;
  expiresInMinutes?: number;
  devCode?: string;
};

export default function RegisterPage() {
  const t = useTranslations("auth");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [step, setStep] = useState<"register" | "verify">("register");
  const [referralCode, setReferralCode] = useState("");
  const [legalAcknowledged, setLegalAcknowledged] = useState(false);
  const [companyWebsite, setCompanyWebsite] = useState("");

  const registerPath = useMemo(() => withLocalePath("/register", locale), [locale]);

  useEffect(() => {
    const emailFromQuery = searchParams.get("email");
    const referralCodeFromQuery = searchParams.get("ref");
    const mode = searchParams.get("mode");
    if (emailFromQuery) setEmail(emailFromQuery.trim());
    if (referralCodeFromQuery) setReferralCode(referralCodeFromQuery.trim().toUpperCase());
    if (mode === "verify" && emailFromQuery) setStep("verify");
  }, [searchParams]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (step === "register") {
      if (!legalAcknowledged) {
        setError(t("legal.requiredError"));
        return;
      }
      setStatus(t("creatingAccount"));
      setDevCode(null);
      try {
        const payload = await apiPost<RegisterResponse>("/auth/register", {
          email,
          password,
          referralCode: referralCode.trim() || undefined,
          companyWebsite,
          legalAcknowledgementAccepted: legalAcknowledged,
          legalAcknowledgementVersion: LEGAL_ACKNOWLEDGEMENT_VERSION
        });
        const nextEmail = String(payload?.email ?? email).trim();
        const validWindow = payload?.expiresInMinutes
          ? ` (${t("validMinutes", { minutes: payload.expiresInMinutes })})`
          : "";
        setEmail(nextEmail);
        setStep("verify");
        setStatus(`${t("verificationCodeSent")}${validWindow}.`);
        setDevCode(payload?.devCode ?? null);
        router.replace(`${registerPath}?mode=verify&email=${encodeURIComponent(nextEmail)}`);
      } catch (e) {
        setStatus("");
        setError(errMsg(e, t));
      }
      return;
    }

    setStatus(t("verifyingEmail"));
    try {
      await apiPost("/auth/register/verify", { email, code });
      setStatus(t("emailVerified"));
      setTimeout(() => {
        redirectAfterAuth(locale);
      }, 800);
    } catch (e) {
      setStatus("");
      setError(errMsg(e, t));
    }
  }

  async function resendCode() {
    setStatus(t("sendingCode"));
    setError("");
    setDevCode(null);
    try {
      const payload = await apiPost<RegisterResponse>("/auth/register/resend", { email });
      const validWindow = payload?.expiresInMinutes
        ? ` (${t("validMinutes", { minutes: payload.expiresInMinutes })})`
        : "";
      setStatus(`${t("verificationCodeResent")}${validWindow}.`);
      setDevCode(payload?.devCode ?? null);
    } catch (e) {
      setStatus("");
      setError(errMsg(e, t));
    }
  }

  return (
    <div className="container authPage">
      <h1 className="authHeading">{t("createAccountTitle")}</h1>
      <div className="card authCard">
        <LegalRiskNotice />
        <form onSubmit={submit} className="authForm">
          <div className="authHoneypot" aria-hidden="true">
            <label htmlFor="companyWebsite">Company website</label>
            <input
              id="companyWebsite"
              name="companyWebsite"
              type="text"
              value={companyWebsite}
              onChange={(event) => setCompanyWebsite(event.target.value)}
              autoComplete="off"
              tabIndex={-1}
            />
          </div>
          <label className="authLabel">
            {t("email")}
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("placeholders.email")}
              required
              disabled={step === "verify"}
            />
          </label>
          <label className="authLabel">
            Referral Code
            <input
              className="input"
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              placeholder="Optional"
              disabled={step === "verify"}
            />
          </label>
          {step === "register" ? (
            <>
              <label className="authLabel">
                {t("password")}
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("placeholders.passwordMin")}
                  minLength={8}
                  required
                />
              </label>
              <div className="authLegalCheckbox">
                <input
                  id="legalAcknowledgement"
                  type="checkbox"
                  checked={legalAcknowledged}
                  onChange={(event) => setLegalAcknowledged(event.target.checked)}
                  required
                />
                <label htmlFor="legalAcknowledgement">
                  {t("legal.checkboxPrefix", { version: LEGAL_ACKNOWLEDGEMENT_VERSION })}{" "}
                  <Link href={withLocalePath("/terms", locale)}>{t("legal.documents.terms")}</Link>,{" "}
                  <Link href={withLocalePath("/privacy", locale)}>{t("legal.documents.privacy")}</Link>,{" "}
                  {t("legal.checkboxAnd")}{" "}
                  <Link href={withLocalePath("/risk-disclosure", locale)}>{t("legal.documents.risk")}</Link>.
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="authMessage">{t("verificationHint")}</div>
              <label className="authLabel">
                {t("verificationCode")}
                <input
                  className="input"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("placeholders.resetCode")}
                  maxLength={6}
                  required
                />
              </label>
            </>
          )}
          <div className="authActions">
            <button
              className="btn btnPrimary"
              type="submit"
              disabled={step === "register" ? (!email || password.length < 8 || !legalAcknowledged) : (!email || code.length !== 6)}
            >
              <AppIcon name={step === "register" ? "register" : "check"} />
              {step === "register" ? t("registerButton") : t("verifyEmailButton")}
            </button>
            {step === "verify" ? (
              <button className="btn" type="button" disabled={!email} onClick={() => void resendCode()}>
                <AppIcon name="mail" />
                {t("resendVerificationCode")}
              </button>
            ) : null}
            <Link href={withLocalePath("/login", locale)} className="btn">
              <AppIcon name="back" />
              {t("backToLogin")}
            </Link>
            <span className="authStatus">{status}</span>
          </div>
          {devCode ? (
            <div className="authDevCode">
              {t("devVerificationCode")}: <b>{devCode}</b>
            </div>
          ) : null}
          {error ? <div className="authError">{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
