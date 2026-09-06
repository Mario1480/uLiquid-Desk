import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import PositionCopilotDataQuality from "../../components/trade/PositionCopilotDataQuality.js";
import { positionCopilotMarketQuality } from "./positionCopilot.js";
import en from "../../messages/en/system.json";
import de from "../../messages/de/system.json";

test("market quality remains unavailable for missing, legacy and malformed context", () => {
  for (const value of [null, undefined, [], {}, { quality: "fresh" }, { version: "2.0.0", quality: "fresh" }, { version: "1.0.0", quality: "complete" }]) {
    assert.equal(positionCopilotMarketQuality(value), "unavailable");
  }
  for (const quality of ["fresh", "stale", "degraded", "unavailable"] as const) {
    assert.equal(positionCopilotMarketQuality({ version: "1.0.0", quality }), quality);
  }
});

test("English and German distinguish complete position data from degraded or missing market context", () => {
  for (const [locale, system] of [["en", en], ["de", de]] as const) {
    for (const market of ["fresh", "stale", "degraded", "unavailable"] as const) {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
        locale, timeZone: "UTC", messages: { system }, onError: error => { throw error; },
        children: createElement(PositionCopilotDataQuality, { position: "complete", market })
      }));
      assert.match(html, locale === "en" ? /Position data: complete/ : /Positionsdaten: vollständig/);
      assert.match(html, locale === "en" ? /Market context:/ : /Marktkontext:/);
      assert.ok(html.includes(system.trade.copilot.marketQuality[market]));
      assert.equal(html.includes("tradeCopilotQualityDegraded"), market !== "fresh");
    }
  }
});
