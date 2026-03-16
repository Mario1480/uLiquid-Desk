"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiPost } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function RegisterPage() {
  const t = useTranslations("auth");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus(t("creatingAccount"));
    setError("");
    try {
      await apiPost("/auth/register", { email, password });
      router.push(withLocalePath("/", locale));
    } catch (e) {
      setStatus("");
      setError(errMsg(e));
    }
  }

  return (
    <div className="container authPage">
      <h1 className="authHeading">{t("createAccountTitle")}</h1>
      <div className="card authCard">
        <form onSubmit={submit} className="authForm">
          <label className="authLabel">
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
          <div className="authActions">
            <button className="btn btnPrimary" type="submit" disabled={!email || password.length < 8}>
              {t("registerButton")}
            </button>
            <Link href={withLocalePath("/login", locale)} className="btn">
              {t("backToLogin")}
            </Link>
            <span className="authStatus">{status}</span>
          </div>
          {error ? <div className="authError">{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
