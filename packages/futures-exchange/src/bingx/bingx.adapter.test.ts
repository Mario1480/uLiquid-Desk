import assert from "node:assert/strict";
import test from "node:test";
import { toBingxContractInfo } from "./bingx.adapter.js";

test("toBingxContractInfo maps BingX USD-M contract precision and symbols", () => {
  const mapped = toBingxContractInfo({
    symbol: "BTC-USDT",
    asset: "BTC",
    currency: "USDT",
    status: 1,
    apiStateOpen: "true",
    apiStateClose: "true",
    size: "0.0001",
    pricePrecision: 1,
    quantityPrecision: 4,
    tradeMinQuantity: "0.0001",
    tradeMinUSDT: "2",
    makerFeeRate: "0.0002",
    takerFeeRate: "0.0005"
  });

  assert.equal(mapped.canonicalSymbol, "BTCUSDT");
  assert.equal(mapped.exchangeSymbol, "BTC-USDT");
  assert.equal(mapped.tickSize, 0.1);
  assert.equal(mapped.stepSize, 0.0001);
  assert.equal(mapped.minVol, 0.0001);
  assert.equal(mapped.minNotional, 2);
  assert.equal(mapped.apiAllowed, true);
});
