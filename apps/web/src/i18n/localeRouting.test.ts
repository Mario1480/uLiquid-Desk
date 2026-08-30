import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalePreferenceCookie,
  extractLocaleFromPathname,
  withLocalePath,
  resolvePreferredLocale
} from "../../i18n/config";

test("extractLocaleFromPathname handles localized path", () => {
  const parsed = extractLocaleFromPathname("/de/predictions");
  assert.equal(parsed.locale, "de");
  assert.equal(parsed.pathnameWithoutLocale, "/predictions");
});

test("extractLocaleFromPathname handles root locale", () => {
  const parsed = extractLocaleFromPathname("/en");
  assert.equal(parsed.locale, "en");
  assert.equal(parsed.pathnameWithoutLocale, "/");
});

test("withLocalePath normalizes existing locale path", () => {
  assert.equal(withLocalePath("/de/settings", "en"), "/en/settings");
});

test("resolvePreferredLocale prefers cookie", () => {
  assert.equal(resolvePreferredLocale({ cookieLocale: "de", acceptLanguage: "en-US,en;q=0.9" }), "de");
});

test("resolvePreferredLocale falls back to accept-language", () => {
  assert.equal(resolvePreferredLocale({ cookieLocale: null, acceptLanguage: "de-DE,de;q=0.8,en;q=0.7" }), "de");
});

test("buildLocalePreferenceCookie applies explicit preference safeguards", () => {
  assert.equal(
    buildLocalePreferenceCookie("de", true),
    "utrade_locale=de; Path=/; Max-Age=31536000; SameSite=Lax; Secure"
  );
  assert.equal(
    buildLocalePreferenceCookie("en", false),
    "utrade_locale=en; Path=/; Max-Age=31536000; SameSite=Lax"
  );
});
