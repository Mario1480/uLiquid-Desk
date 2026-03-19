import test from "node:test";
import assert from "node:assert/strict";
import {
  accruePaperFunding,
  applyPaperBalanceDelta,
  applyPaperOrderFillToState,
  buildPaperAccountSnapshot,
  buildPerpTradingContext,
  createPaperOrderState,
  createPaperStateSnapshot,
  isPaperStopTriggered,
  liquidatePaperPositionsIfNeeded,
  normalizeOrderBookPayload,
  normalizeTickerPayload,
  normalizeTradesPayload,
  normalizeSymbolInput,
  recordPaperOrderFill,
  resolvePaperLimitFillQty,
  resolvePaperTriggeredFillPrice,
  type PaperState
} from "./trading.js";
import type { PaperSimulationPolicy } from "./paper/policy.js";

function applyFilledPosition(state: PaperState, symbol: string, nextPosition: PaperState["positions"][number] | null) {
  state.positions = state.positions.filter((row) => row.symbol !== symbol);
  if (nextPosition) state.positions.push(nextPosition);
}

const realisticPaperPolicy: PaperSimulationPolicy = {
  feeBps: 5,
  slippageBps: 10,
  makerFeeBps: 2,
  takerFeeBps: 5,
  marketOrderSlippageBps: 10,
  stopOrderSlippageBps: 20,
  limitPartialFillRatio: 0.5,
  initialMarginRatio: 0.1,
  maintenanceMarginRatio: 0.05,
  liquidationSlippageBps: 15,
  fundingMode: "fixed_rate",
  fundingRateBpsPerHour: 1,
  fundingIntervalMinutes: 60,
  startBalanceUsd: 1000
};

test("normalizeSymbolInput strips separators", () => {
  assert.equal(normalizeSymbolInput("btc_usdt"), "BTCUSDT");
  assert.equal(normalizeSymbolInput("BTC-USDT"), "BTCUSDT");
});

test("normalizeOrderBookPayload parses levels", () => {
  const book = normalizeOrderBookPayload({
    bids: [["100", "2"]],
    asks: [["101", "3"]],
    ts: "123"
  });

  assert.equal(book.bids.length, 1);
  assert.equal(book.asks.length, 1);
  assert.equal(book.bids[0].price, 100);
  assert.equal(book.asks[0].qty, 3);
  assert.equal(book.ts, 123);
});

test("normalizeTickerPayload extracts numeric fields", () => {
  const ticker = normalizeTickerPayload({
    instId: "BTCUSDT",
    lastPr: "101.5",
    markPrice: "101.2",
    bidPr: "101.4",
    askPr: "101.6",
    ts: "99"
  });

  assert.equal(ticker.symbol, "BTCUSDT");
  assert.equal(ticker.last, 101.5);
  assert.equal(ticker.mark, 101.2);
  assert.equal(ticker.bid, 101.4);
  assert.equal(ticker.ask, 101.6);
  assert.equal(ticker.ts, 99);
});

test("normalizeTradesPayload handles array payload", () => {
  const trades = normalizeTradesPayload([
    [1710000000000, "100", "0.5", "buy"],
    { symbol: "BTCUSDT", price: "101", size: "0.4", side: "sell", ts: "1710000001000" }
  ]);

  assert.equal(trades.length, 2);
  assert.equal(trades[0].price, 100);
  assert.equal(trades[0].side, "buy");
  assert.equal(trades[1].symbol, "BTCUSDT");
  assert.equal(trades[1].qty, 0.4);
});

test("buildPerpTradingContext models paper as linked-market-data execution", () => {
  const context = buildPerpTradingContext(
    {
      id: "paper_1",
      userId: "user_1",
      exchange: "paper",
      label: "Paper",
      apiKey: "",
      apiSecret: "",
      passphrase: null,
      marketDataExchangeAccountId: "bitget_1"
    },
    {
      id: "bitget_1",
      userId: "user_1",
      exchange: "bitget",
      label: "Bitget",
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
      marketDataExchangeAccountId: null
    }
  );

  assert.equal(context.executionMode, "paper");
  assert.equal(context.executionVenue.kind, "paper");
  assert.equal(context.executionVenue.capabilities.requiresLinkedMarketData, true);
  assert.equal(context.marketDataVenue.kind, "adapter");
  assert.equal(context.marketDataVenue.capabilities.venue, "bitget");
  assert.equal(context.requiresLinkedMarketData, true);
  assert.equal(context.paperContext?.executionVenue, "paper");
  assert.equal(context.paperContext?.marketType, "perp");
  assert.equal(context.paperContext?.runtimeContract, context.executionVenue.paperRuntime);
  assert.equal(context.paperContext?.runtimeContract.executionVenue, "paper");
  assert.equal(context.paperContext?.runtimeContract.marketDataLinkMode, "linked_live_venue");
  assert.equal(context.paperContext?.linkedMarketData.marketDataVenue, "bitget");
  assert.equal(context.paperContext?.linkedMarketData.exchangeAccountId, "bitget_1");
});

test("buildPerpTradingContext keeps live execution and market-data venue aligned", () => {
  const context = buildPerpTradingContext(
    {
      id: "hl_1",
      userId: "user_1",
      exchange: "hyperliquid",
      label: "HL",
      apiKey: "k",
      apiSecret: "s",
      passphrase: null,
      marketDataExchangeAccountId: null
    },
    {
      id: "hl_1",
      userId: "user_1",
      exchange: "hyperliquid",
      label: "HL",
      apiKey: "k",
      apiSecret: "s",
      passphrase: null,
      marketDataExchangeAccountId: null
    }
  );

  assert.equal(context.executionMode, "live");
  assert.equal(context.executionVenue.kind, "adapter");
  assert.equal(context.marketDataVenue.kind, "adapter");
  assert.equal(context.executionVenue.capabilities.venue, "hyperliquid");
  assert.equal(context.marketDataVenue.capabilities.venue, "hyperliquid");
  assert.equal(context.requiresLinkedMarketData, false);
  assert.equal(context.paperContext, null);
});

test("paper simulator applies taker slippage and fees for market orders", () => {
  const state = createPaperStateSnapshot({
    balanceUsd: 1000
  });
  const fillPrice = resolvePaperTriggeredFillPrice({
    side: "buy",
    type: "market",
    limitPrice: 100,
    marketPrice: 100,
    triggerPrice: null,
    triggerReason: "market_order",
    policy: realisticPaperPolicy
  });
  const fill = applyPaperOrderFillToState({
    state,
    symbol: "BTCUSDT",
    qty: 1,
    side: "buy",
    reduceOnly: false,
    fillPrice,
    isMaker: false,
    policy: realisticPaperPolicy
  });

  assert.equal(fillPrice, 100.1);
  assert.equal(fill.filledQty, 1);
  assert.equal(fill.feeUsd, 0.05005);
  applyPaperBalanceDelta(state, {
    realizedPnlUsd: fill.realizedPnlUsd,
    feeUsd: fill.feeUsd,
    volumeUsd: fill.filledQty * fillPrice
  });
  applyFilledPosition(state, "BTCUSDT", fill.nextPosition);

  assert.equal(state.balanceUsd, 999.94995);
  assert.equal(state.feesPaidUsd, 0.05005);
  assert.equal(state.positions[0]?.entryPrice, 100.1);
});

test("paper simulator keeps a resting limit order open after a partial first touch", () => {
  const state = createPaperStateSnapshot({
    balanceUsd: 1000
  });
  const order = createPaperOrderState({
    orderId: "paper_1",
    symbol: "ETHUSDT",
    side: "buy",
    type: "limit",
    qty: 2,
    price: 99,
    reduceOnly: false,
    triggerPrice: null,
    takeProfitPrice: null,
    stopLossPrice: null,
    status: "open",
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z"
  });

  const firstFillQty = resolvePaperLimitFillQty(order, realisticPaperPolicy);
  assert.equal(firstFillQty, 1);
  const firstFill = applyPaperOrderFillToState({
    state,
    symbol: order.symbol,
    qty: firstFillQty,
    side: order.side,
    reduceOnly: order.reduceOnly,
    fillPrice: 99,
    isMaker: true,
    policy: realisticPaperPolicy
  });
  applyPaperBalanceDelta(state, {
    realizedPnlUsd: firstFill.realizedPnlUsd,
    feeUsd: firstFill.feeUsd,
    volumeUsd: firstFill.filledQty * 99
  });
  applyFilledPosition(state, order.symbol, firstFill.nextPosition);
  recordPaperOrderFill(order, {
    fillQty: firstFill.filledQty,
    fillPrice: 99,
    feeUsd: firstFill.feeUsd,
    nowIso: "2026-03-19T00:01:00.000Z"
  });

  assert.equal(order.status, "open");
  assert.equal(order.remainingQty, 1);
  assert.equal(order.filledQty, 1);
  assert.equal(state.positions[0]?.qty, 1);

  const secondFillQty = resolvePaperLimitFillQty(order, realisticPaperPolicy);
  assert.equal(secondFillQty, 1);
  const secondFill = applyPaperOrderFillToState({
    state,
    symbol: order.symbol,
    qty: secondFillQty,
    side: order.side,
    reduceOnly: order.reduceOnly,
    fillPrice: 99,
    isMaker: true,
    policy: realisticPaperPolicy
  });
  applyPaperBalanceDelta(state, {
    realizedPnlUsd: secondFill.realizedPnlUsd,
    feeUsd: secondFill.feeUsd,
    volumeUsd: secondFill.filledQty * 99
  });
  applyFilledPosition(state, order.symbol, secondFill.nextPosition);
  recordPaperOrderFill(order, {
    fillQty: secondFill.filledQty,
    fillPrice: 99,
    feeUsd: secondFill.feeUsd,
    nowIso: "2026-03-19T00:02:00.000Z"
  });

  assert.equal(order.status, "filled");
  assert.equal(order.remainingQty, 0);
  assert.equal(state.positions[0]?.qty, 2);
});

test("paper simulator triggers stop-market orders only after the stop price is crossed", () => {
  const stopOrder = createPaperOrderState({
    orderId: "paper_stop_1",
    symbol: "BTCUSDT",
    side: "sell",
    type: "market",
    qty: 1,
    price: 95,
    reduceOnly: true,
    triggerPrice: 95,
    takeProfitPrice: null,
    stopLossPrice: null,
    status: "open",
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z"
  });

  assert.equal(isPaperStopTriggered(stopOrder, 96), false);
  assert.equal(isPaperStopTriggered(stopOrder, 95), true);
  const fillPrice = resolvePaperTriggeredFillPrice({
    side: "sell",
    type: "market",
    limitPrice: 95,
    marketPrice: 95,
    triggerPrice: 95,
    triggerReason: "stop_market",
    policy: realisticPaperPolicy
  });
  assert.equal(fillPrice, 94.81);
});

test("paper simulator accrues fixed funding on open positions when enabled", () => {
  const state = createPaperStateSnapshot({
    balanceUsd: 1000,
    positions: [{
      symbol: "BTCUSDT",
      side: "long",
      qty: 2,
      entryPrice: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      lastFundingAccruedAt: "2026-03-19T00:00:00.000Z",
      openedAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z"
    }]
  });

  const changed = accruePaperFunding(
    state,
    new Map([["BTCUSDT", 100]]),
    "2026-03-19T02:00:00.000Z",
    realisticPaperPolicy
  );

  assert.equal(changed, true);
  assert.equal(state.balanceUsd, 999.96);
  assert.equal(state.fundingAccruedUsd, -0.04);
});

test("paper simulator liquidates positions once equity falls through maintenance margin", () => {
  const state = createPaperStateSnapshot({
    balanceUsd: 100,
    nextOrderSeq: 7,
    positions: [{
      symbol: "BTCUSDT",
      side: "long",
      qty: 10,
      entryPrice: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      lastFundingAccruedAt: null,
      openedAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z"
    }]
  });
  const markPrices = new Map([["BTCUSDT", 50]]);
  const before = buildPaperAccountSnapshot(state, markPrices, realisticPaperPolicy);
  assert.equal(before.status, "liquidation");

  const liquidated = liquidatePaperPositionsIfNeeded({
    state,
    markPrices,
    exchangeAccountId: "paper_acc",
    nowIso: "2026-03-19T00:10:00.000Z",
    policy: realisticPaperPolicy
  });

  assert.equal(liquidated, true);
  assert.equal(state.positions.length, 0);
  assert.equal(state.liquidationCount, 1);
  assert.equal(state.orders[0]?.status, "filled");
});
