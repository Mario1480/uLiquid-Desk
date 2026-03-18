"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { AppLocale } from "../../i18n/config";
import { extractLocaleFromPathname, withLocalePath } from "../../i18n/config";
import ClientErrorBoundary from "./ClientErrorBoundary";

const WalletConnectionWidget = dynamic(() => import("./WalletConnectionWidget"), {
  ssr: false
});

const LANGUAGE_OPTIONS: Array<{ locale: AppLocale; label: string; flag: string }> = [
  { locale: "en", label: "EN", flag: "🇺🇸" },
  { locale: "de", label: "DE", flag: "🇩🇪" }
];

function buildLocalizedPath(pathname: string, search: string, locale: AppLocale): string {
  const { pathnameWithoutLocale } = extractLocaleFromPathname(pathname);
  const localizedPath = withLocalePath(pathnameWithoutLocale || "/", locale);
  return search ? `${localizedPath}?${search}` : localizedPath;
}

export default function AuthHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale() as AppLocale;
  const tHeader = useTranslations("nav.header");
  const search = searchParams.toString();

  return (
    <header className="authHeader">
      <div className="authHeaderInner">
        <Link href={withLocalePath("/", locale)} className="appLogo authHeaderLogo" aria-label="uLiquid Desk">
          <img src="/images/logo.png" alt="uLiquid Desk logo" className="appLogoMark" />
        </Link>

        <div className="authHeaderToolbar">
          <nav className="authHeaderLocaleSwitch" aria-label={tHeader("languageMenu")}>
            {LANGUAGE_OPTIONS.map((option) => {
              const href = buildLocalizedPath(pathname, search, option.locale);
              const active = option.locale === locale;
              return (
                <Link
                  key={option.locale}
                  href={href}
                  className={`authHeaderLocaleLink ${active ? "authHeaderLocaleLinkActive" : ""}`}
                  aria-current={active ? "page" : undefined}
                  aria-label={tHeader(`language.${option.locale}`)}
                >
                  <span className="authHeaderLanguageFlag" aria-hidden="true">{option.flag}</span>
                  <span className="authHeaderLanguageCode">{option.label}</span>
                </Link>
              );
            })}
          </nav>

          <ClientErrorBoundary fallback={<button className="appHeaderWalletTrigger" type="button" disabled>Wallet unavailable</button>}>
            <WalletConnectionWidget />
          </ClientErrorBoundary>
        </div>
      </div>
    </header>
  );
}
