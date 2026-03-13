import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPaperLinkedMarketDataSupport,
  isValidPaperLinkedMarketDataExchange,
  resolvePaperLinkedMarketDataSupport,
  type PaperPolicyFlags
} from "./policy.js";

const baseFlags: PaperPolicyFlags = {
  manualTradingSpotEnabled: true,
  mexcSpotEnabled: true,
  mexcPerpEnabled: false,
  binanceSpotEnabled: false,
  binancePerpEnabled: false
};

test("paper spot supports bitget market data by default", () => {
  const result = resolvePaperLinkedMarketDataSupport(
    { marketType: "spot", marketDataExchange: "bitget" },
    baseFlags
  );

  assert.deepEqual(result, { supported: true, code: null });
});

test("paper spot gates binance market data behind spot flag", () => {
  const blocked = resolvePaperLinkedMarketDataSupport(
    { marketType: "spot", marketDataExchange: "binance" },
    baseFlags
  );
  assert.deepEqual(blocked, {
    supported: false,
    code: "paper_spot_requires_supported_market_data"
  });

  const allowed = resolvePaperLinkedMarketDataSupport(
    { marketType: "spot", marketDataExchange: "binance" },
    { ...baseFlags, binanceSpotEnabled: true }
  );
  assert.deepEqual(allowed, { supported: true, code: null });
});

test("paper perp supports hyperliquid and gates mexc or binance by flags", () => {
  const hyperliquid = resolvePaperLinkedMarketDataSupport(
    { marketType: "perp", marketDataExchange: "hyperliquid" },
    baseFlags
  );
  assert.deepEqual(hyperliquid, { supported: true, code: null });

  const mexcBlocked = resolvePaperLinkedMarketDataSupport(
    { marketType: "perp", marketDataExchange: "mexc" },
    baseFlags
  );
  assert.deepEqual(mexcBlocked, {
    supported: false,
    code: "paper_perp_requires_supported_market_data"
  });

  const mexcAllowed = resolvePaperLinkedMarketDataSupport(
    { marketType: "perp", marketDataExchange: "mexc" },
    { ...baseFlags, mexcPerpEnabled: true }
  );
  assert.deepEqual(mexcAllowed, { supported: true, code: null });
});

test("paper policy rejects unsupported linked exchanges with stable manual trading code", () => {
  assert.equal(isValidPaperLinkedMarketDataExchange("bitget"), true);
  assert.equal(isValidPaperLinkedMarketDataExchange("paper"), false);
  assert.equal(isValidPaperLinkedMarketDataExchange(""), false);

  assert.throws(
    () =>
      assertPaperLinkedMarketDataSupport(
        { marketType: "perp", marketDataExchange: "paper" },
        baseFlags
      ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "paper_perp_requires_supported_market_data");
      return true;
    }
  );
});

test("paper spot respects the global manual spot feature flag", () => {
  assert.throws(
    () =>
      assertPaperLinkedMarketDataSupport(
        { marketType: "spot", marketDataExchange: "bitget" },
        { ...baseFlags, manualTradingSpotEnabled: false }
      ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "manual_spot_trading_disabled");
      return true;
    }
  );
});
