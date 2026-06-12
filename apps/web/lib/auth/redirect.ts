import { withLocalePath, type AppLocale } from "../../i18n/config";

export function buildPostAuthRedirectPath(locale: AppLocale, pathname = "/"): string {
  return withLocalePath(pathname, locale);
}

export function redirectAfterAuth(locale: AppLocale, pathname = "/"): void {
  if (typeof window === "undefined") return;
  window.location.replace(buildPostAuthRedirectPath(locale, pathname));
}
