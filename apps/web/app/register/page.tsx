"use client";
import { DeskCheckbox } from "@/components/desk/DeskCheckbox";
import { DeskLink } from "@/components/desk/DeskLink";

import { GlassButton } from "@/components/einui/liquid-glass/glass-button";
import { GlassInput } from "@/components/einui/liquid-glass/glass-input";
import { GlassAuthFrame } from "@/components/einui/auth-frame";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiGet, apiPost } from "../../lib/api";
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
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [registrationUnavailable, setRegistrationUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet<{ enabled: boolean }>("/auth/registration")
      .then((result) => { if (active) setRegistrationEnabled(result.enabled); })
      .catch(() => { if (active) setRegistrationUnavailable(true); });
    return () => { active = false; };
  }, []);

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
      if (registrationEnabled !== true) return;
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
    <GlassAuthFrame title={t("createAccountTitle")} icon={<AppIcon name="register" />} notice={step === "verify" || registrationEnabled === true ? <LegalRiskNotice /> : null}>
        {step === "register" && registrationEnabled !== true ? (
          <div className="authForm">
            <p role="status">{registrationUnavailable ? t("errors.registration_unavailable") : registrationEnabled === false ? t("errors.registration_disabled") : t("registrationLoading")}</p>
            <DeskLink href={withLocalePath("/login", locale)} className="btn">
              <AppIcon name="back" /> {t("backToLogin")}
            </DeskLink>
          </div>
        ) : <>
        <form onSubmit={submit} className="authForm">
          <div className="authHoneypot" aria-hidden="true">
            <label htmlFor="companyWebsite">Company website</label>
            <GlassInput
              glowOnFocus={false}
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
            <GlassInput
              glowOnFocus={false}
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
            <GlassInput
              glowOnFocus={false}
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
                <GlassInput
              glowOnFocus={false}
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
                <DeskCheckbox
                  id="legalAcknowledgement"
                  checked={legalAcknowledged}
                  onCheckedChange={(checked) => setLegalAcknowledged(checked)}
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
                <GlassInput
              glowOnFocus={false}
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
            <GlassButton
              className="btn btnPrimary"
              type="submit"
              disabled={step === "register" ? (!email || password.length < 8 || !legalAcknowledged) : (!email || code.length !== 6)}
            >
              <AppIcon name={step === "register" ? "register" : "check"} />
              {step === "register" ? t("registerButton") : t("verifyEmailButton")}
            </GlassButton>
            {step === "verify" ? (
              <GlassButton className="btn" type="button" disabled={!email} onClick={() => void resendCode()}>
                <AppIcon name="mail" />
                {t("resendVerificationCode")}
              </GlassButton>
            ) : null}
            <DeskLink href={withLocalePath("/login", locale)} className="btn">
              <AppIcon name="back" />
              {t("backToLogin")}
            </DeskLink>
            <span className="authStatus" role="status">{status}</span>
          </div>
          {devCode ? (
            <div className="authDevCode">
              {t("devVerificationCode")}: <b>{devCode}</b>
            </div>
          ) : null}
          {error ? <div className="authError" role="alert">{error}</div> : null}
        </form>
        </>}
    </GlassAuthFrame>
  );
}
