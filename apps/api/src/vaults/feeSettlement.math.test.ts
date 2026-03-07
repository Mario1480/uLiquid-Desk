import assert from "node:assert/strict";
import test from "node:test";
import {
  computeFeeSettlementMath,
  computeProfitOnlyWithdrawableUsd
} from "./feeSettlement.math.js";

test("profit-only withdraw computes 30% fee on feeable realized profit", () => {
  const result = computeFeeSettlementMath({
    mode: "PROFIT_ONLY_WITHDRAW",
    requestedGrossUsd: 40,
    availableUsd: 160,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: 70,
    highWaterMarkUsd: 20,
    feeRatePct: 30
  });

  assert.equal(result.maxProfitOnlyWithdrawableUsd, 60);
  assert.equal(result.grossTransferUsd, 40);
  assert.equal(result.principalComponentUsd, 0);
  assert.equal(result.realizedProfitComponentUsd, 40);
  assert.equal(result.feeableProfitCapacityBeforeUsd, 50);
  assert.equal(result.feeBaseUsd, 40);
  assert.equal(result.feeAmountUsd, 12);
  assert.equal(result.netTransferUsd, 28);
  assert.equal(result.highWaterMarkAfterUsd, 60);
});

test("final close splits principal and profit and applies fee only on profit", () => {
  const result = computeFeeSettlementMath({
    mode: "FINAL_CLOSE",
    availableUsd: 150,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: 80,
    highWaterMarkUsd: 20,
    feeRatePct: 30
  });

  assert.equal(result.grossTransferUsd, 150);
  assert.equal(result.principalComponentUsd, 100);
  assert.equal(result.realizedProfitComponentUsd, 50);
  assert.equal(result.feeBaseUsd, 50);
  assert.equal(result.feeAmountUsd, 15);
  assert.equal(result.netTransferUsd, 135);
  assert.equal(result.highWaterMarkAfterUsd, 70);
});

test("final close without profit charges no fee", () => {
  const result = computeFeeSettlementMath({
    mode: "FINAL_CLOSE",
    availableUsd: 90,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: 0,
    highWaterMarkUsd: 0,
    feeRatePct: 30
  });

  assert.equal(result.grossTransferUsd, 90);
  assert.equal(result.principalComponentUsd, 90);
  assert.equal(result.realizedProfitComponentUsd, 0);
  assert.equal(result.feeBaseUsd, 0);
  assert.equal(result.feeAmountUsd, 0);
  assert.equal(result.netTransferUsd, 90);
});

test("profit-only withdraw cannot exceed available minus principal", () => {
  const result = computeFeeSettlementMath({
    mode: "PROFIT_ONLY_WITHDRAW",
    requestedGrossUsd: 120,
    availableUsd: 160,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: 200,
    highWaterMarkUsd: 0,
    feeRatePct: 30
  });

  assert.equal(result.maxProfitOnlyWithdrawableUsd, 60);
  assert.equal(result.grossTransferUsd, 60);
  assert.equal(result.principalComponentUsd, 0);
  assert.equal(result.realizedProfitComponentUsd, 60);
});

test("hwm drawdown recovery avoids double fee below old highwater mark", () => {
  const result = computeFeeSettlementMath({
    mode: "PROFIT_ONLY_WITHDRAW",
    requestedGrossUsd: 40,
    availableUsd: 200,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: 70,
    highWaterMarkUsd: 90,
    feeRatePct: 30
  });

  assert.equal(result.feeableProfitCapacityBeforeUsd, 0);
  assert.equal(result.feeBaseUsd, 0);
  assert.equal(result.feeAmountUsd, 0);
  assert.equal(result.netTransferUsd, 40);
  assert.equal(result.highWaterMarkAfterUsd, 90);
});

test("computeProfitOnlyWithdrawableUsd returns max(available-principalOutstanding,0)", () => {
  assert.equal(
    computeProfitOnlyWithdrawableUsd({
      availableUsd: 80,
      principalOutstandingUsd: 100
    }),
    0
  );
  assert.equal(
    computeProfitOnlyWithdrawableUsd({
      availableUsd: 150,
      principalOutstandingUsd: 100
    }),
    50
  );
});

test("fee base is capped by feeable capacity and fee is rounded to 4 decimals", () => {
  const result = computeFeeSettlementMath({
    mode: "PROFIT_ONLY_WITHDRAW",
    requestedGrossUsd: 25,
    availableUsd: 200,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: 12.34567,
    highWaterMarkUsd: 2.34567,
    feeRatePct: 30
  });

  assert.equal(result.feeableProfitCapacityBeforeUsd, 10);
  assert.equal(result.feeBaseUsd, 10);
  assert.equal(result.feeAmountUsd, 3);
  assert.equal(result.netTransferUsd, 22);
});
