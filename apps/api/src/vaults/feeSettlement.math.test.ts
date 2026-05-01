import assert from "node:assert/strict";
import test from "node:test";
import {
  computeFeeSettlementMath,
  computeProfitShareAccounting,
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

test("profit share accounting charges one realized profit claim once", () => {
  const first = computeProfitShareAccounting({
    realizedClosedPnlUsd: 10,
    settledProfitUsd: 0,
    payoutProfitUsd: 10,
    feeRatePct: 30
  });
  const duplicate = computeProfitShareAccounting({
    realizedClosedPnlUsd: 10,
    settledProfitUsd: first.settledProfitAfterUsd,
    payoutProfitUsd: 10,
    feeRatePct: 30
  });

  assert.equal(first.feeBaseUsd, 10);
  assert.equal(first.feeAmountUsd, 3);
  assert.equal(first.settledProfitAfterUsd, 10);
  assert.equal(duplicate.feeBaseUsd, 0);
  assert.equal(duplicate.feeAmountUsd, 0);
  assert.equal(duplicate.settledProfitAfterUsd, 10);
});

test("profit share accounting supports multiple partial claims without double fees", () => {
  const first = computeProfitShareAccounting({
    realizedClosedPnlUsd: 30,
    settledProfitUsd: 0,
    payoutProfitUsd: 10,
    feeRatePct: 30
  });
  const second = computeProfitShareAccounting({
    realizedClosedPnlUsd: 30,
    settledProfitUsd: first.settledProfitAfterUsd,
    payoutProfitUsd: 10,
    feeRatePct: 30
  });

  assert.equal(first.feeBaseUsd, 10);
  assert.equal(second.feeBaseUsd, 10);
  assert.equal(first.feeAmountUsd + second.feeAmountUsd, 6);
  assert.equal(second.settledProfitAfterUsd, 20);
});

test("profit share accounting lets losses reduce future fee capacity", () => {
  const afterLoss = computeProfitShareAccounting({
    realizedClosedPnlUsd: 15,
    settledProfitUsd: 20,
    payoutProfitUsd: 5,
    feeRatePct: 30
  });
  const laterGain = computeProfitShareAccounting({
    realizedClosedPnlUsd: 30,
    settledProfitUsd: 20,
    payoutProfitUsd: 20,
    feeRatePct: 30
  });

  assert.equal(afterLoss.feeableProfitCapacityBeforeUsd, 0);
  assert.equal(afterLoss.feeAmountUsd, 0);
  assert.equal(afterLoss.settledProfitAfterUsd, 20);
  assert.equal(laterGain.feeableProfitCapacityBeforeUsd, 10);
  assert.equal(laterGain.feeBaseUsd, 10);
  assert.equal(laterGain.feeAmountUsd, 3);
  assert.equal(laterGain.settledProfitAfterUsd, 30);
});

test("final close remains consistent with previously settled profit", () => {
  const result = computeFeeSettlementMath({
    mode: "FINAL_CLOSE",
    availableUsd: 140,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: 50,
    highWaterMarkUsd: 30,
    feeRatePct: 30
  });

  assert.equal(result.realizedProfitComponentUsd, 40);
  assert.equal(result.feeableProfitCapacityBeforeUsd, 20);
  assert.equal(result.feeBaseUsd, 20);
  assert.equal(result.feeAmountUsd, 6);
  assert.equal(result.highWaterMarkAfterUsd, 50);
});

test("net loss never produces profit share", () => {
  const result = computeFeeSettlementMath({
    mode: "FINAL_CLOSE",
    availableUsd: 80,
    principalOutstandingUsd: 100,
    realizedPnlNetUsd: -20,
    highWaterMarkUsd: 0,
    feeRatePct: 30
  });

  assert.equal(result.feeableProfitCapacityBeforeUsd, 0);
  assert.equal(result.feeBaseUsd, 0);
  assert.equal(result.feeAmountUsd, 0);
});
