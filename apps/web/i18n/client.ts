import { buildLocalePreferenceCookie, type AppLocale } from "./config";

export function persistLocalePreference(locale: AppLocale): void {
  document.cookie = buildLocalePreferenceCookie(locale, window.location.protocol === "https:");
}
