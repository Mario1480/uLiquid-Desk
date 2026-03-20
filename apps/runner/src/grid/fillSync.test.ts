import assert from "node:assert/strict";
import test from "node:test";
import { __fillSyncTestUtils } from "./fillSync.js";

test("extractRows reads nested provider payloads", () => {
  const rows = __fillSyncTestUtils.extractRows({
    data: {
      rows: [{ id: 1 }, { id: 2 }]
    }
  });
  assert.equal(rows.length, 2);
});

test("normalizeFillRow parses common fill fields", () => {
  const parsed = __fillSyncTestUtils.normalizeFillRow({
    orderId: "123",
    clientOid: "cid-1",
    side: "buy",
    price: "100.5",
    size: "0.2",
    fee: "-0.01",
    timestamp: String(Date.now()),
    symbol: "BTCUSDT"
  });
  assert.ok(parsed);
  assert.equal(parsed?.exchangeOrderId, "123");
  assert.equal(parsed?.clientOrderId, "cid-1");
  assert.equal(parsed?.side, "buy");
  assert.equal(parsed?.fillPrice, 100.5);
  assert.equal(parsed?.fillQty, 0.2);
});

test("symbolMatches allows base symbol compatibility", () => {
  assert.equal(__fillSyncTestUtils.symbolMatches("BTCUSDT", "BTC"), true);
  assert.equal(__fillSyncTestUtils.symbolMatches("BTCUSDT", "ETHUSDT"), false);
});

test("isTerminalFillRow stays conservative for partial fills", () => {
  assert.equal(__fillSyncTestUtils.isTerminalFillRow({
    status: "partial_fill",
    filledQty: "0.5",
    orderQty: "1"
  }), false);
  assert.equal(__fillSyncTestUtils.isTerminalFillRow({
    status: "filled",
    filledQty: "1",
    orderQty: "1"
  }), true);
});
