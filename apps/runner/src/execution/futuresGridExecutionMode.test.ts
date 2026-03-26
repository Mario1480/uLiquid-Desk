import test from "node:test";
import assert from "node:assert/strict";
import { resolveAllowedGridExchangesForBot } from "./futuresGridExecutionMode.js";

test("resolveAllowedGridExchangesForBot adds hyperliquid for live hypervault execution", () => {
  const allowed = resolveAllowedGridExchangesForBot(new Set(["paper"]), {
    executionExchange: "hyperliquid",
    marketDataVenue: "hyperliquid",
    executionProvider: "hyperliquid"
  });

  assert.deepEqual([...allowed].sort(), ["hyperliquid", "paper"]);
});

test("resolveAllowedGridExchangesForBot adds hyperliquid for paper bots linked to hyperliquid market data", () => {
  const allowed = resolveAllowedGridExchangesForBot(new Set(["paper"]), {
    executionExchange: "paper",
    marketDataVenue: "hyperliquid",
    executionProvider: null
  });

  assert.deepEqual([...allowed].sort(), ["hyperliquid", "paper"]);
});

test("resolveAllowedGridExchangesForBot keeps the base allowlist for non-hyperliquid bots", () => {
  const base = new Set(["paper"]);
  const allowed = resolveAllowedGridExchangesForBot(base, {
    executionExchange: "bitget",
    marketDataVenue: "bitget",
    executionProvider: null
  });

  assert.equal(allowed, base);
  assert.deepEqual([...allowed], ["paper"]);
});
