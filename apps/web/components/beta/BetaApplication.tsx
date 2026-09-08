"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPost } from "../../lib/api";
import { DeskInput } from "../desk/DeskInput";
import { DeskTextarea } from "../desk/DeskTextarea";
import { DeskButton } from "../desk/DeskButton";
import { DeskLink } from "../desk/DeskLink";
import { AppIcon } from "../../app/components/AppIcon";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { TurnstileChallenge } from "../auth/TurnstileChallenge";

export default function BetaApplication() {
  const t = useTranslations("auth.beta");
  const locale = useLocale() as AppLocale;
  const [config, setConfig] = useState<{ enabled: boolean; siteKey: string } | null>(null);
  const [email, setEmail] = useState(""); const [motivation, setMotivation] = useState("");
  const [honey, setHoney] = useState(""); const [token, setToken] = useState("");
  const [resend, setResend] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false); const [sent, setSent] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => { let active = true; apiGet<{ enabled: boolean; siteKey: string }>("/auth/beta-access").then(c => { if (active) setConfig(c); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !token) return;
    setBusy(true); setError(false); setSent(false);
    try { await apiPost(`/auth/beta-access${resend ? "/resend" : ""}`, { email, motivation: motivation || "resend", locale, companyWebsite: honey, turnstileToken: token }); setSent(true); }
    catch { setError(true); }
    finally { setBusy(false); setToken(""); setResetKey(value => value + 1); }
  }
  if (!config?.enabled) return <p role={error ? "alert" : "status"}>{error ? t("error") : config ? t("closed") : t("loading")}</p>;
  return <form className="authForm betaApplication" onSubmit={submit}>
    <p>{t("intro")}</p>
    <label className="authLabel">{t("email")}<DeskInput className="input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
    {!resend ? <label className="authLabel">{t("motivation")}<DeskTextarea className="input" required maxLength={1000} rows={4} value={motivation} onChange={e => setMotivation(e.target.value)} disabled={busy} /></label> : null}
    <div className="authHoneypot" aria-hidden="true"><label>Company website<DeskInput tabIndex={-1} autoComplete="off" value={honey} onChange={e => setHoney(e.target.value)} /></label></div>
    <p>{t("privacy")} <DeskLink href={withLocalePath("/privacy", locale)}>{t("privacyLink")}</DeskLink></p>
    <TurnstileChallenge siteKey={config.siteKey} action={resend ? "beta_resend" : "beta_apply"} locale={locale} resetKey={resetKey} onTokenChange={setToken} onError={() => setError(true)} />
    {error ? <p role="alert">{t("error")}</p> : null}{sent ? <p role="status">{t("sent")}</p> : null}
    <DeskButton type="submit" className="btn btnPrimary" disabled={busy || !token}><AppIcon name="send" />{busy ? t("working") : resend ? t("resend") : t("apply")}</DeskButton>
    <DeskButton type="button" className="btn" disabled={busy} onClick={() => { setResend(!resend); setSent(false); setError(false); setResetKey(value => value + 1); }}><AppIcon name="refresh" />{resend ? t("newRequest") : t("resend")}</DeskButton>
  </form>;
}
