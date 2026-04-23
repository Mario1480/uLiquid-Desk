import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdvancedRealtimeBar,
  normalizeAdvancedChartTimestampMs,
  reconcilePolledBarWithLiveBar
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
