"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiGet } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { formatAiCreditAmount, type AiCreditHeaderSummary } from "../../src/billing/aiCredits";
import { AppIcon } from "./AppIcon";

const AI_CREDIT_REFRESH_MS = 30_000;

export default function AiCreditHeaderPill() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("nav.header.aiCredits");
  const [summary, setSummary] = useState<AiCreditHeaderSummary | null>(null);

  useEffect(() => {
    let active = true;
    let loading = false;

    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await apiGet<AiCreditHeaderSummary>("/api/billing/ai-credits/summary");
        if (active) setSummary(next);
      } catch {
        // Keep the last confirmed value visible during a transient API interruption.
      } finally {
        loading = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), AI_CREDIT_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const available = summary ? formatAiCreditAmount(summary.available, locale) : "–";
  const reserved = summary ? formatAiCreditAmount(summary.reserved, locale) : "–";
  const label = summary
    ? t("tooltip", { available, reserved })
    : t("loading");

  return (
    <Link
      href={withLocalePath("/settings/subscription", locale)}
      className={`appHeaderCreditPill appHeaderCreditPill-${summary?.warningLevel ?? "none"}`}
      title={label}
      aria-label={label}
    >
      <span className="appHeaderCreditIcon" aria-hidden="true"><AppIcon name="ai" /></span>
      <span className="appHeaderCreditLabel">{t("short")}</span>
      <strong className="appHeaderCreditValue">{available}</strong>
    </Link>
  );
}
