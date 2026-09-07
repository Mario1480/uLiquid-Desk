"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Script from "next/script";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPost } from "../../lib/api";
import { DeskInput } from "../desk/DeskInput";
import { DeskTextarea } from "../desk/DeskTextarea";
import { DeskButton } from "../desk/DeskButton";
import { DeskLink } from "../desk/DeskLink";
import { AppIcon } from "../../app/components/AppIcon";
import { withLocalePath, type AppLocale } from "../../i18n/config";

type Turnstile = { render(el: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void; reset(id: string): void };
declare global { interface Window { turnstile?: Turnstile } }

export default function BetaApplication() {
  const t = useTranslations("auth.beta");
  const locale = useLocale() as AppLocale;
  const [config, setConfig] = useState<{ enabled: boolean; siteKey: string } | null>(null);
  const [email, setEmail] = useState(""); const [motivation, setMotivation] = useState("");
  const [honey, setHoney] = useState(""); const [token, setToken] = useState("");
  const [resend, setResend] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false); const [sent, setSent] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const container = useRef<HTMLDivElement>(null); const widget = useRef<string | null>(null);
  useEffect(() => { let active = true; apiGet<{ enabled: boolean; siteKey: string }>("/auth/beta-access").then(c => { if (active) setConfig(c); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, []);
  const ready = useCallback(() => setScriptReady(true), []);
  useEffect(() => {
    if (!config?.enabled || !scriptReady || !container.current || !window.turnstile) return;
    setToken("");
    widget.current = window.turnstile.render(container.current, { sitekey: config.siteKey, action: resend ? "beta_resend" : "beta_apply", theme: "dark", size: "flexible", language: locale, callback: (value: string) => setToken(value), "expired-callback": () => setToken(""), "error-callback": () => { setToken(""); setError(true); } });
    return () => { if (widget.current !== null) window.turnstile?.remove(widget.current); widget.current = null; };
  }, [config, scriptReady, resend, locale]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !token) return;
    setBusy(true); setError(false); setSent(false);
    try { await apiPost(`/auth/beta-access${resend ? "/resend" : ""}`, { email, motivation: motivation || "resend", locale, companyWebsite: honey, turnstileToken: token }); setSent(true); }
    catch { setError(true); }
    finally { setBusy(false); setToken(""); if (widget.current !== null) window.turnstile?.reset(widget.current); }
  }
  if (!config?.enabled) return <p role={error ? "alert" : "status"}>{error ? t("error") : config ? t("closed") : t("loading")}</p>;
  return <form className="authForm betaApplication" onSubmit={submit}>
    <p>{t("intro")}</p>
    <label className="authLabel">{t("email")}<DeskInput className="input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
    {!resend ? <label className="authLabel">{t("motivation")}<DeskTextarea className="input" required maxLength={1000} rows={4} value={motivation} onChange={e => setMotivation(e.target.value)} disabled={busy} /></label> : null}
    <div className="authHoneypot" aria-hidden="true"><label>Company website<DeskInput tabIndex={-1} autoComplete="off" value={honey} onChange={e => setHoney(e.target.value)} /></label></div>
    <p>{t("privacy")} <DeskLink href={withLocalePath("/privacy", locale)}>{t("privacyLink")}</DeskLink></p>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={ready} onError={() => setError(true)} />
    <div ref={container} />
    {error ? <p role="alert">{t("error")}</p> : null}{sent ? <p role="status">{t("sent")}</p> : null}
    <DeskButton type="submit" className="btn btnPrimary" disabled={busy || !token}><AppIcon name="send" />{busy ? t("working") : resend ? t("resend") : t("apply")}</DeskButton>
    <DeskButton type="button" className="btn" disabled={busy} onClick={() => { setResend(!resend); setSent(false); setError(false); }}><AppIcon name="refresh" />{resend ? t("newRequest") : t("resend")}</DeskButton>
  </form>;
}
