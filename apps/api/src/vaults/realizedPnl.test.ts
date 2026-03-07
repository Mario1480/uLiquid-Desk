import assert from "node:assert/strict";
import test from "node:test";
import { applyFillToRealizedPnl, parseBotVaultMatchingState } from "./realizedPnl.js";

test("applyFillToRealizedPnl realizes long close with fees", () => {
  const initial = parseBotVaultMatchingState(null);
  const opened = applyFillToRealizedPnl(initial, {
    side: "buy",
    price: 100,
    qty: 1,
    feeUsd: 1
  });
  assert.equal(opened.realizedNetUsd, 0);

  const closed = applyFillToRealizedPnl(opened.nextState, {
    side: "sell",
    price: 120,
    qty: 1,
    feeUsd: 1
  });
  assert.equal(closed.realizedGrossUsd, 20);
  assert.equal(closed.realizedFeesUsd, 2);
  assert.equal(closed.realizedNetUsd, 18);
});

test("applyFillToRealizedPnl realizes short close with fees", () => {
  const initial = parseBotVaultMatchingState(null);
  const opened = applyFillToRealizedPnl(initial, {
    side: "sell",
    price: 200,
    qty: 2,
    feeUsd: 2
  });
  assert.equal(opened.realizedNetUsd, 0);

  const closed = applyFillToRealizedPnl(opened.nextState, {
    side: "buy",
    price: 180,
    qty: 2,
    feeUsd: 2
  });
  assert.equal(closed.realizedGrossUsd, 40);
  assert.equal(closed.realizedFeesUsd, 4);
  assert.equal(closed.realizedNetUsd, 36);
});
