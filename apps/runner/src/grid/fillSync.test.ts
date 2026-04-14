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

test("normalizeFillRow parses Hyperliquid fills with px and cloid references", () => {
  const parsed = __fillSyncTestUtils.normalizeFillRow({
    oid: "98123",
    tid: "fill-1",
    cloid: "208456784328589790982014142665896995042",
    dir: "Open Long",
    px: "71000",
    sz: "0.00015",
    fee: "-0.01",
    time: 1710000000000,
    coin: "BTC"
  });
  assert.ok(parsed);
  assert.equal(parsed?.exchangeOrderId, "98123");
  assert.equal(parsed?.exchangeFillId, "fill-1");
  assert.equal(parsed?.cloid, "208456784328589790982014142665896995042");
  assert.equal(parsed?.side, "buy");
  assert.equal(parsed?.fillPrice, 71000);
  assert.equal(parsed?.fillQty, 0.00015);
  assert.equal(parsed?.symbol, "BTC");
});

test("normalizeFillRow maps Hyperliquid direction labels to execution side", () => {
  const parsed = __fillSyncTestUtils.normalizeFillRow({
    oid: "98124",
    dir: "Close Long",
    px: "72000",
    sz: "0.00015",
    time: 1710000001000,
    coin: "BTC"
  });
  assert.equal(parsed?.side, "sell");
});

test("normalizeFillRow treats Hyperliquid side A as sell and preserves numeric order refs", () => {
  const parsed = __fillSyncTestUtils.normalizeFillRow({
    px: "72089.0",
    sz: "0.00014",
    dir: "Close Long",
    fee: "0.004541",
    oid: 375652747172,
    tid: 241789647540230,
    coin: "BTC",
    side: "A",
    time: 1775749007778,
    cloid: "0x14001ff757765f4369b2a0b973f1d716"
  });

  assert.ok(parsed);
  assert.equal(parsed.exchangeOrderId, "375652747172");
  assert.equal(parsed.exchangeFillId, "241789647540230");
  assert.equal(parsed.side, "sell");
  assert.equal(parsed.fillPrice, 72089);
  assert.equal(parsed.fillQty, 0.00014);
});

test("matched order terminal detection marks full Hyperliquid trade fills", () => {
  assert.equal(__fillSyncTestUtils.isMatchedOrderTerminalFill({
    fillQty: 0.00014,
    orderQty: 0.00014,
    rawJson: {
      px: "72089.0",
      sz: "0.00014",
      dir: "Close Long",
      side: "A"
    }
  }), true);

  assert.equal(__fillSyncTestUtils.isMatchedOrderTerminalFill({
    fillQty: 0.00004,
    orderQty: 0.00014,
    rawJson: {
      px: "77000.0",
      sz: "0.00004",
      dir: "Close Long",
      side: "A"
    }
  }), false);
});

test("symbolMatches allows base symbol compatibility", () => {
  assert.equal(__fillSyncTestUtils.symbolMatches("BTCUSDT", "BTC"), true);
  assert.equal(__fillSyncTestUtils.symbolMatches("BTCUSDT", "ETHUSDT"), false);
});

test("fillMatchesOrderRef matches Hyperliquid cloid fills against local corewriter order ids", () => {
  assert.equal(__fillSyncTestUtils.fillMatchesOrderRef({
    fill: {
      clientOrderId: null,
      exchangeOrderId: "375652747172",
      cloid: "0x14001ff757765f4369b2a0b973f1d716"
    },
    orderRef: {
      clientOrderId: "grid-inst-long-14",
      exchangeOrderId: "cloid:0:26585208266820470652686268590470584086"
    }
  }), true);

  assert.equal(__fillSyncTestUtils.fillMatchesOrderRef({
    fill: {
      clientOrderId: null,
      exchangeOrderId: "375652747172",
      cloid: "208456784328589790982014142665896995042"
    },
    orderRef: {
      clientOrderId: "grid-inst-long-14",
      exchangeOrderId: "cloid:0:26585208266820470652686268590470584086"
    }
  }), false);
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
