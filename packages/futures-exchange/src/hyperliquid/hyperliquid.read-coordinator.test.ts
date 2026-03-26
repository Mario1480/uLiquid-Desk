import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHyperliquidReadKey,
  clearHyperliquidReadCoordinatorForTests,
  executeHyperliquidRead,
  HyperliquidReadCoordinatorError
} from "./hyperliquid.read-coordinator.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.afterEach(() => {
  clearHyperliquidReadCoordinatorForTests();
});

test("read coordinator shares concurrent identical upstream reads", async () => {
  let calls = 0;
  const key = buildHyperliquidReadKey({ scope: "test", identity: "wallet", endpoint: "ticker", symbol: "BTC" });
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { price: 70000 };
  };

  const [first, second] = await Promise.all([
    executeHyperliquidRead({ key, ttlMs: 5_000, staleMs: 60_000, read: loader }),
    executeHyperliquidRead({ key, ttlMs: 5_000, staleMs: 60_000, read: loader })
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first.value, { price: 70000 });
  assert.deepEqual(second.value, { price: 70000 });
});

test("read coordinator serves fresh cache inside ttl", async () => {
  let calls = 0;
  const key = buildHyperliquidReadKey({ scope: "test", identity: "wallet", endpoint: "balances" });
  const loader = async () => {
    calls += 1;
    return { equity: 100 };
  };

  const first = await executeHyperliquidRead({ key, ttlMs: 5_000, staleMs: 60_000, read: loader });
  const second = await executeHyperliquidRead({ key, ttlMs: 5_000, staleMs: 60_000, read: loader });

  assert.equal(calls, 1);
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(second.stale, false);
});

test("read coordinator serves stale cache during 429 cooldown", async () => {
  let mode: "success" | "limited" = "success";
  const key = buildHyperliquidReadKey({ scope: "test", identity: "wallet", endpoint: "positions" });

  const read = async () => {
    if (mode === "success") {
      return [{ symbol: "BTCUSDT" }];
    }
    const error = new Error("hyperliquid_info_failed:429:null");
    (error as Error & { status?: number }).status = 429;
    throw error;
  };

  await executeHyperliquidRead({ key, ttlMs: 1, staleMs: 60_000, cooldownMs: 15_000, read });
  await sleep(5);
  mode = "limited";
  const stale = await executeHyperliquidRead({ key, ttlMs: 1, staleMs: 60_000, cooldownMs: 15_000, read });

  assert.equal(stale.fromCache, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.rateLimited, true);
  assert.deepEqual(stale.value, [{ symbol: "BTCUSDT" }]);
});

test("read coordinator retries transient upstream errors then serves stale cache", async () => {
  let calls = 0;
  const key = buildHyperliquidReadKey({ scope: "test", identity: "wallet", endpoint: "summary" });

  await executeHyperliquidRead({
    key,
    ttlMs: 1,
    staleMs: 60_000,
    read: async () => ({ equity: 123 })
  });
  await sleep(5);

  const result = await executeHyperliquidRead({
    key,
    ttlMs: 1,
    staleMs: 60_000,
    retryAttempts: 2,
    retryBaseDelayMs: 1,
    read: async () => {
      calls += 1;
      const error = new Error("upstream exploded");
      (error as Error & { status?: number }).status = 503;
      throw error;
    }
  });

  assert.equal(calls, 2);
  assert.equal(result.fromCache, true);
  assert.equal(result.stale, true);
  assert.equal(result.retryCount, 1);
  assert.deepEqual(result.value, { equity: 123 });
});

test("read coordinator throws typed rate-limit error when no cache exists", async () => {
  const key = buildHyperliquidReadKey({ scope: "test", identity: "wallet", endpoint: "summary" });

  await assert.rejects(
    () =>
      executeHyperliquidRead({
        key,
        ttlMs: 1,
        staleMs: 60_000,
        read: async () => {
          const error = new Error("hyperliquid_info_failed:429:null");
          (error as Error & { status?: number }).status = 429;
          throw error;
        }
      }),
    (error: unknown) => {
      assert.equal(error instanceof HyperliquidReadCoordinatorError, true);
      assert.equal((error as HyperliquidReadCoordinatorError).category, "rate_limited");
      return true;
    }
  );
});
