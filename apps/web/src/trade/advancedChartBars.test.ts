import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdvancedRealtimeTradeKey,
  createAdvancedRealtimeBar,
  isSaneAdvancedChartBar,
  normalizeAdvancedChartTimestampMs,
  rememberAdvancedRealtimeTrade,
  reconcilePolledBarWithLiveBar,
  selectAdvancedHistoryBars,
  toAdvancedChartPrice
} from "./advancedChartBars";

test("createAdvancedRealtimeBar opens a new bucket at the previous close to avoid synthetic gaps", () => {
  const previousBar = {
    time: 1_710_000_000_000,
    open: 100,
    high: 104,
    low: 99,
    close: 103,
    volume: 12
  };

  assert.deepEqual(
    createAdvancedRealtimeBar({
      bucketStartMs: 1_710_000_060_000,
      price: 108,
      qty: null,
      previousBar
    }),
    {
      time: 1_710_000_060_000,
      open: 103,
      high: 108,
      low: 103,
      close: 108,
      volume: undefined
    }
  );
});

test("createAdvancedRealtimeBar falls back to the live price when there is no previous close", () => {
  assert.deepEqual(
    createAdvancedRealtimeBar({
      bucketStartMs: 1_710_000_060_000,
      price: 108,
      qty: 2.5,
      previousBar: null
    }),
    {
      time: 1_710_000_060_000,
      open: 108,
      high: 108,
      low: 108,
      close: 108,
      volume: 2.5
    }
  );
});

test("reconcilePolledBarWithLiveBar keeps a newer live bar when polling is stale", () => {
  const currentBar = {
    time: 1_710_000_060_000,
    open: 101,
    high: 106,
    low: 99,
    close: 105,
    volume: 12
  };
  const fetchedBar = {
    time: 1_710_000_000_000,
    open: 100,
    high: 104,
    low: 98,
    close: 103,
    volume: 20
  };

  assert.deepEqual(
    reconcilePolledBarWithLiveBar({ currentBar, fetchedBar }),
    currentBar
  );
});

test("reconcilePolledBarWithLiveBar keeps the existing open for the active bucket", () => {
  const currentBar = {
    time: 1_710_000_000_000,
    open: 102,
    high: 107,
    low: 101,
    close: 106,
    volume: 8
  };
  const fetchedBar = {
    time: 1_710_000_000_000,
    open: 100,
    high: 105,
    low: 99,
    close: 103,
    volume: 11
  };

  assert.deepEqual(
    reconcilePolledBarWithLiveBar({ currentBar, fetchedBar }),
    {
      time: 1_710_000_000_000,
      open: 102,
      high: 107,
      low: 99,
      close: 103,
      volume: 11
    }
  );
});

test("reconcilePolledBarWithLiveBar keeps a live close when live volume is ahead of polling", () => {
  const currentBar = {
    time: 1_710_000_000_000,
    open: 102,
    high: 107,
    low: 101,
    close: 106,
    volume: 15
  };
  const fetchedBar = {
    time: 1_710_000_000_000,
    open: 100,
    high: 105,
    low: 99,
    close: 103,
    volume: 11
  };

  assert.deepEqual(
    reconcilePolledBarWithLiveBar({ currentBar, fetchedBar }),
    {
      time: 1_710_000_000_000,
      open: 102,
      high: 107,
      low: 99,
      close: 106,
      volume: 15
    }
  );
});

test("reconcilePolledBarWithLiveBar accepts a newer polled bucket", () => {
  const currentBar = {
    time: 1_710_000_000_000,
    open: 100,
    high: 105,
    low: 99,
    close: 103,
    volume: 10
  };
  const fetchedBar = {
    time: 1_710_000_060_000,
    open: 104,
    high: 108,
    low: 103,
    close: 107,
    volume: 4
  };

  assert.deepEqual(
    reconcilePolledBarWithLiveBar({ currentBar, fetchedBar }),
    fetchedBar
  );
});

test("normalizeAdvancedChartTimestampMs converts second timestamps to milliseconds", () => {
  assert.equal(normalizeAdvancedChartTimestampMs(1_710_000_000), 1_710_000_000_000);
  assert.equal(normalizeAdvancedChartTimestampMs(1_710_000_000_123), 1_710_000_000_123);
  assert.equal(normalizeAdvancedChartTimestampMs(null), null);
});

test("buildAdvancedRealtimeTradeKey normalizes second timestamps", () => {
  assert.equal(
    buildAdvancedRealtimeTradeKey({
      ts: 1_710_000_000,
      price: 100.5,
      qty: 2,
      side: "BUY"
    }),
    "1710000000000:100.5:2:buy"
  );
});

test("rememberAdvancedRealtimeTrade rejects duplicate trades", () => {
  const cache = new Map<string, number>();

  assert.equal(
    rememberAdvancedRealtimeTrade(cache, {
      ts: 1_710_000_000_100,
      price: 100.5,
      qty: 2,
      side: "buy"
    }),
    true
  );
  assert.equal(
    rememberAdvancedRealtimeTrade(cache, {
      ts: 1_710_000_000_100,
      price: 100.5,
      qty: 2,
      side: "buy"
    }),
    false
  );
});

test("toAdvancedChartPrice rejects nullish and non-positive values", () => {
  assert.equal(toAdvancedChartPrice(null), null);
  assert.equal(toAdvancedChartPrice(undefined), null);
  assert.equal(toAdvancedChartPrice(0), null);
  assert.equal(toAdvancedChartPrice("-1"), null);
  assert.equal(toAdvancedChartPrice("101.25"), 101.25);
});

test("isSaneAdvancedChartBar rejects zero-wick and inconsistent candles", () => {
  assert.equal(isSaneAdvancedChartBar({
    time: 1_710_000_000_000,
    open: 100,
    high: 105,
    low: 0,
    close: 104
  }), false);

  assert.equal(isSaneAdvancedChartBar({
    time: 1_710_000_000_000,
    open: 100,
    high: 99,
    low: 98,
    close: 101
  }), false);

  assert.equal(isSaneAdvancedChartBar({
    time: 1_710_000_000_000,
    open: 100,
    high: 105,
    low: 98,
    close: 101
  }), true);
});

test("selectAdvancedHistoryBars returns only bars inside the requested window", () => {
  const bars = [
    { time: 1_710_000_000_000 },
    { time: 1_710_000_060_000 },
    { time: 1_710_000_120_000 }
  ];

  assert.deepEqual(
    selectAdvancedHistoryBars(bars, {
      from: 1_710_000_060,
      to: 1_710_000_180,
      countBack: 2,
      firstDataRequest: true
    }),
    bars.slice(1)
  );
});

test("selectAdvancedHistoryBars stops TradingView backfill when the older window is empty", () => {
  const bars = [
    { time: 1_710_000_000_000 },
    { time: 1_710_000_060_000 }
  ];

  assert.deepEqual(
    selectAdvancedHistoryBars(bars, {
      from: 1_709_999_000,
      to: 1_709_999_900,
      countBack: 300,
      firstDataRequest: false
    }),
    []
  );
});

test("selectAdvancedHistoryBars keeps a latest-bars fallback for the first request", () => {
  const bars = [
    { time: 1_710_000_000_000 },
    { time: 1_710_000_060_000 },
    { time: 1_710_000_120_000 }
  ];

  assert.deepEqual(
    selectAdvancedHistoryBars(bars, {
      from: 1_709_999_000,
      to: 1_709_999_900,
      countBack: 2,
      firstDataRequest: true
    }),
    bars.slice(-2)
  );
});
