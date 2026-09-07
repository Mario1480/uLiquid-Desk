import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import {
  buildLocalePreferenceCookie,
  extractLocaleFromPathname,
  isEnglishOnlyPath,
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

test("public presale links stay English, including nested pages and queries", () => {
  for (const path of ["/presale", "/de/presale", "/presale/terms", "/de/presale/vesting", "/presale?round=2"]) {
    assert.equal(isEnglishOnlyPath(path), true);
    assert.ok(withLocalePath(path, "de").startsWith("/en/presale"));
  }
});

test("presale language policy does not affect unrelated or admin routes", () => {
  for (const path of ["/presales", "/presale-other", "/admin/uliq", "/terms", "/settings"]) {
    assert.equal(isEnglishOnlyPath(path), false);
    assert.equal(withLocalePath(path, "de"), `/de${path}`);
  }
});

test("presale requests override German preferences and preserve query parameters", async () => {
  for (const path of ["/de/presale", "/presale/terms", "/de/presale/vesting"]) {
    const response = await proxy(new NextRequest(`https://desk.example${path}?round=2`, {
      headers: { cookie: "utrade_locale=de", "accept-language": "de-DE" }
    }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `https://desk.example${withLocalePath(path, "en")}?round=2`);
  }
});

test("English presale requests render with English despite a German cookie", async () => {
  const response = await proxy(new NextRequest("https://desk.example/en/presale/terms", {
    headers: { cookie: "utrade_locale=de", "accept-language": "de-DE" }
  }));
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-rewrite"), "https://desk.example/presale/terms");
  assert.equal(response.headers.get("x-middleware-request-x-utrade-locale"), "en");
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
