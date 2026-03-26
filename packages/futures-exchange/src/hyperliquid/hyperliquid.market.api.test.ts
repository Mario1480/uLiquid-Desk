import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidMarketApi } from "./hyperliquid.market.api.js";

function createSdk(params: {
  getAllMids: () => Promise<unknown>;
  getMetaAndAssetCtxs: () => Promise<unknown>;
}) {
  return {
    info: {
      getAllMids: params.getAllMids,
      getCandleSnapshot: async () => [],
      getL2Book: async () => ({}),
      perpetuals: {
        getMeta: async () => ({ universe: [] }),
        getMetaAndAssetCtxs: params.getMetaAndAssetCtxs
      }
    }
  } as any;
}

function withEnv<T>(patch: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> | T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("market api timeout defaults remain finite when env is unset", () => withEnv({
  HYPERLIQUID_INFO_TIMEOUT_MS: undefined,
  HYPERLIQUID_INFO_RETRY_ATTEMPTS: undefined,
  HYPERLIQUID_INFO_RETRY_BASE_DELAY_MS: undefined,
  HYPERLIQUID_MARKET_SNAPSHOT_MAX_STALE_MS: undefined
}, () => {
  const api = new HyperliquidMarketApi(createSdk({
    getAllMids: async () => ({}),
    getMetaAndAssetCtxs: async () => [{ universe: [] }, []]
  }));

  assert.equal((api as any).timeoutMs, 8000);
  assert.equal((api as any).retryAttempts, 3);
  assert.equal((api as any).retryBaseDelayMs, 300);
  assert.equal((api as any).staleSnapshotMs, 10000);
}));

test("market api parses string env values and tolerates underscore formatting", () => withEnv({
  HYPERLIQUID_INFO_TIMEOUT_MS: "12_000",
  HYPERLIQUID_INFO_RETRY_ATTEMPTS: "5",
  HYPERLIQUID_INFO_RETRY_BASE_DELAY_MS: "450",
  HYPERLIQUID_MARKET_SNAPSHOT_MAX_STALE_MS: "18_000"
}, () => {
  const api = new HyperliquidMarketApi(createSdk({
    getAllMids: async () => ({}),
    getMetaAndAssetCtxs: async () => [{ universe: [] }, []]
  }));

  assert.equal((api as any).timeoutMs, 12000);
  assert.equal((api as any).retryAttempts, 5);
  assert.equal((api as any).retryBaseDelayMs, 450);
  assert.equal((api as any).staleSnapshotMs, 18000);
}));

test("market api falls back safely on invalid timeout configuration", () => withEnv({
  HYPERLIQUID_INFO_TIMEOUT_MS: "not-a-number",
  HYPERLIQUID_INFO_RETRY_ATTEMPTS: "0",
  HYPERLIQUID_INFO_RETRY_BASE_DELAY_MS: "-10",
  HYPERLIQUID_MARKET_SNAPSHOT_MAX_STALE_MS: "bad"
}, () => {
  const api = new HyperliquidMarketApi(createSdk({
    getAllMids: async () => ({}),
    getMetaAndAssetCtxs: async () => [{ universe: [] }, []]
  }));

  assert.equal((api as any).timeoutMs, 8000);
  assert.equal((api as any).retryAttempts, 3);
  assert.equal((api as any).retryBaseDelayMs, 300);
  assert.equal((api as any).staleSnapshotMs, 10000);
}));

test("getTicker falls back to mids when meta/asset ctx fetch fails", async () => {
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => ({ BTC: "70000.5" }),
      getMetaAndAssetCtxs: async () => {
        throw new Error("temporary meta failure");
      }
    }),
    { retryAttempts: 1 }
  );

  const ticker = await api.getTicker("BTCUSDT");

  assert.equal(ticker.markPrice, 70000.5);
  assert.equal(ticker.priceSource, "mid");
  assert.equal(ticker.diagnostics.degraded, true);
  assert.equal(ticker.diagnostics.endpointFailures[0]?.endpoint, "getMetaAndAssetCtxs");
});

test("getTicker falls back to mid when markPx is empty", async () => {
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => ({ BTC: "70123.4" }),
      getMetaAndAssetCtxs: async () => [
        { universe: [{ name: "BTC" }] },
        [{ markPx: "", oraclePx: "69999.9" }]
      ]
    }),
    { retryAttempts: 1 }
  );

  const ticker = await api.getTicker("BTCUSDT");

  assert.equal(ticker.markPrice, 70123.4);
  assert.equal(ticker.priceSource, "mid");
  assert.equal(ticker.midPrice, 70123.4);
  assert.equal(ticker.indexPrice, 69999.9);
});

test("getTicker still succeeds when symbol is missing from asset contexts but mids are present", async () => {
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => ({ ETH: "3450.1" }),
      getMetaAndAssetCtxs: async () => [
        { universe: [{ name: "BTC" }] },
        [{ markPx: "70000", oraclePx: "69990" }]
      ]
    }),
    { retryAttempts: 1 }
  );

  const ticker = await api.getTicker("ETHUSDT");

  assert.equal(ticker.coin, "ETH");
  assert.equal(ticker.markPrice, 3450.1);
  assert.equal(ticker.priceSource, "mid");
  assert.equal(ticker.diagnostics.symbolFoundInAssetCtxs, false);
});

test("market reads retry transient timeouts and recover", async () => {
  let midCalls = 0;
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => {
        midCalls += 1;
        if (midCalls === 1) {
          const error = new Error("timed out");
          (error as Error & { code?: string }).code = "ETIMEDOUT";
          throw error;
        }
        return { BTC: "70200" };
      },
      getMetaAndAssetCtxs: async () => [
        { universe: [{ name: "BTC" }] },
        [{ markPx: "70210", oraclePx: "70205" }]
      ]
    }),
    { retryAttempts: 2, retryBaseDelayMs: 1, timeoutMs: 50 }
  );

  const ticker = await api.getTicker("BTCUSDT");

  assert.equal(midCalls, 2);
  assert.equal(ticker.markPrice, 70210);
  assert.equal(ticker.priceSource, "markPx");
  assert.equal(ticker.diagnostics.retryCount, 1);
});

test("non-retryable client errors do not loop retries when mids already provide a price", async () => {
  let metaCalls = 0;
  const api = new HyperliquidMarketApi(
    createSdk({
      getAllMids: async () => ({ BTC: "70300" }),
      getMetaAndAssetCtxs: async () => {
        metaCalls += 1;
        const error = new Error("unauthorized");
        (error as Error & { status?: number }).status = 401;
        throw error;
      }
    }),
    { retryAttempts: 3, retryBaseDelayMs: 1 }
  );

  const ticker = await api.getTicker("BTCUSDT");

  assert.equal(metaCalls, 1);
  assert.equal(ticker.markPrice, 70300);
  assert.equal(ticker.diagnostics.endpointFailures[0]?.errorCategory, "client");
});

test("getCandles uses direct info request without sdk symbol conversion", async () => {
  const originalFetch = globalThis.fetch;
  const sdk = createSdk({
    getAllMids: async () => ({}),
    getMetaAndAssetCtxs: async () => [{ universe: [] }, []]
  }) as any;
  sdk.baseUrl = "https://api.hyperliquid.xyz";
  sdk.info.getCandleSnapshot = async () => {
    throw new Error("sdk candle path should not be used");
  };

  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify([{ t: 1, c: "70000" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const api = new HyperliquidMarketApi(sdk);
    const rows = await api.getCandles({
      symbol: "BTCUSDT",
      granularity: "1m",
      limit: 1
    });
    assert.deepEqual(rows, [{ t: 1, c: "70000" }]);
    assert.equal((requestBody as Record<string, unknown> | null)?.type, "candleSnapshot");
    assert.equal(((requestBody as Record<string, unknown> | null)?.req as Record<string, unknown> | undefined)?.coin, "BTC");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
