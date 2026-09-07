"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiPost } from "../../lib/api";
import { GlassAuthFrame } from "../einui/auth-frame";
import { DeskInput } from "../desk/DeskInput";
import { DeskCheckbox } from "../desk/DeskCheckbox";
import { DeskButton } from "../desk/DeskButton";
import { DeskLink } from "../desk/DeskLink";
import { AppIcon } from "../../app/components/AppIcon";
import LegalRiskNotice, { LEGAL_ACKNOWLEDGEMENT_VERSION } from "../../app/components/LegalRiskNotice";
import { withLocalePath, type AppLocale } from "../../i18n/config";

export default function BetaRedemption() {
  const t = useTranslations("auth.beta"); const auth = useTranslations("auth"); const locale = useLocale() as AppLocale;
  const [link, setLink] = useState<{ mode: string; token: string } | null>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [done, setDone] = useState("");
  const initialized = useRef(false);
  const linkGeneration = useRef(0);
  useEffect(() => {
    const readLink = () => {
      if (initialized.current && !window.location.hash) return;
      initialized.current = true;
      const generation = ++linkGeneration.current;
      const params = new URLSearchParams(window.location.hash.slice(1));
      const mode = params.has("verify") ? "verify" : "invite"; const token = params.get(mode) ?? "";
      window.history.replaceState(null, "", window.location.pathname);
      setDone(""); setError(""); setEmail(""); setPassword(""); setAccepted(false); setLink(null); setBusy(false);
      if (!/^[a-f0-9]{64}$/.test(token)) { setError("invalidLink"); return; }
      setLink({ mode, token });
      // A later email can target this same page with a new fragment, without a full navigation.
      if (mode === "invite") apiPost<{ email: string }>("/auth/beta-access/invitation", { token })
        .then(r => { if (linkGeneration.current === generation) setEmail(r.email); })
        .catch(() => { if (linkGeneration.current === generation) setError("invalidLink"); });
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!link || busy) return;
    const generation = linkGeneration.current;
    setBusy(true); setError("");
    try {
      if (link.mode === "verify") { await apiPost("/auth/beta-access/confirm", { token: link.token }); if (linkGeneration.current !== generation) return; setDone("confirmed"); }
      else { const result = await apiPost<{ provisioningPending: boolean }>("/auth/beta-access/complete", { token: link.token, password, legalAcknowledgementAccepted: accepted, legalAcknowledgementVersion: LEGAL_ACKNOWLEDGEMENT_VERSION }); if (linkGeneration.current !== generation) return; setDone(result.provisioningPending ? "provisioning" : "created"); }
      setPassword(""); setLink(null);
    } catch (e) {
      if (linkGeneration.current !== generation) return;
      if (e instanceof ApiError && e.payload?.error === "legal_acknowledgement_version_mismatch") { setAccepted(false); setError("legalChanged"); }
      else setError("error");
    } finally { if (linkGeneration.current === generation) setBusy(false); }
  }
  return <GlassAuthFrame title={t(link?.mode === "verify" ? "confirmTitle" : "invitationTitle")} icon={<AppIcon name="register" />} notice={link?.mode === "invite" && email ? <LegalRiskNotice /> : null}>
    {done ? <p role="status">{t(done)}</p> : <form className="authForm" onSubmit={submit}>
      {link?.mode === "invite" && email ? <>
        <label className="authLabel">{t("email")}<DeskInput className="input" type="email" value={email} readOnly autoComplete="email" /></label>
        <label className="authLabel">{auth("password")}<DeskInput className="input" type="password" required minLength={8} maxLength={256} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
        <div className="authLegalCheckbox"><DeskCheckbox id="beta-legal" required checked={accepted} onCheckedChange={setAccepted} disabled={busy} /><label htmlFor="beta-legal">{t("accept", { version: LEGAL_ACKNOWLEDGEMENT_VERSION })}</label></div>
        <p><DeskLink href={withLocalePath("/terms", locale)}>{t("terms")}</DeskLink>{" · "}<DeskLink href={withLocalePath("/risk-disclosure", locale)}>{t("risk")}</DeskLink></p>
      </> : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      {!link && !error ? <p role="status">{t("loading")}</p> : null}
      {link ? <DeskButton className="btn btnPrimary" type="submit" disabled={busy || (link.mode === "invite" && (!email || !accepted))}><AppIcon name="check" />{busy ? t("working") : link.mode === "verify" ? t("confirm") : t("create")}</DeskButton> : null}
    </form>}
    <DeskLink className="btn" href={withLocalePath("/login", locale)}><AppIcon name="login" />{auth("backToLogin")}</DeskLink>
  </GlassAuthFrame>;
}
