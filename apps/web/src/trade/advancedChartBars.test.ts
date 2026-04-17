import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePolledBarWithLiveBar } from "./advancedChartBars";

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

test("reconcilePolledBarWithLiveBar merges same-bucket polling without rolling back the live close", () => {
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
      open: 100,
      high: 107,
      low: 99,
      close: 106,
      volume: 11
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
