import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidFuturesAdapter } from "./hyperliquid.adapter.js";

test("adapter market poll batches one snapshot for multiple ticker symbols", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`
  });

  let snapshotCalls = 0;
  let singleTickerCalls = 0;
  (adapter as any).marketApi.getMarketSnapshot = async () => {
    snapshotCalls += 1;
    return {
      fetchedAt: Date.now(),
      retryCount: 0,
      degraded: true,
      endpointFailures: [
        {
          endpoint: "getMetaAndAssetCtxs",
          errorCategory: "timeout",
          retryCount: 1,
          message: "temporary timeout"
        }
      ],
      usedCachedSnapshot: false,
      tickers: [
        {
          symbol: "BTC-PERP",
          coin: "BTC",
          lastPr: 70000,
          last: 70000,
          markPrice: 70010,
          indexPrice: 69990,
          bidPr: 70000,
          askPr: 70000,
          ts: Date.now(),
          priceSource: "markPx",
          midPrice: 70000,
          diagnostics: {
            degraded: true,
            endpointFailures: [],
            retryCount: 0,
            snapshotFetchedAt: Date.now(),
            snapshotAgeMs: 0,
            usedCachedSnapshot: false,
            attemptedSources: ["markPx", "mid"],
            errorCategory: null,
            symbolFoundInMids: true,
            symbolFoundInAssetCtxs: true
          }
        },
        {
          symbol: "ETH-PERP",
          coin: "ETH",
          lastPr: 3500,
          last: 3500,
          markPrice: 3501,
          indexPrice: 3499,
          bidPr: 3500,
          askPr: 3500,
          ts: Date.now(),
          priceSource: "markPx",
          midPrice: 3500,
          diagnostics: {
            degraded: true,
            endpointFailures: [],
            retryCount: 0,
            snapshotFetchedAt: Date.now(),
            snapshotAgeMs: 0,
            usedCachedSnapshot: false,
            attemptedSources: ["markPx", "mid"],
            errorCategory: null,
            symbolFoundInMids: true,
            symbolFoundInAssetCtxs: true
          }
        }
      ],
      tickersByCoin: new Map()
        .set("BTC", {
          symbol: "BTC-PERP",
          coin: "BTC",
          lastPr: 70000,
          last: 70000,
          markPrice: 70010,
          indexPrice: 69990,
          bidPr: 70000,
          askPr: 70000,
          ts: Date.now(),
          priceSource: "markPx",
          midPrice: 70000,
          diagnostics: {
            degraded: true,
            endpointFailures: [],
            retryCount: 0,
            snapshotFetchedAt: Date.now(),
            snapshotAgeMs: 0,
            usedCachedSnapshot: false,
            attemptedSources: ["markPx", "mid"],
            errorCategory: null,
            symbolFoundInMids: true,
            symbolFoundInAssetCtxs: true
          }
        })
        .set("ETH", {
          symbol: "ETH-PERP",
          coin: "ETH",
          lastPr: 3500,
          last: 3500,
          markPrice: 3501,
          indexPrice: 3499,
          bidPr: 3500,
          askPr: 3500,
          ts: Date.now(),
          priceSource: "markPx",
          midPrice: 3500,
          diagnostics: {
            degraded: true,
            endpointFailures: [],
            retryCount: 0,
            snapshotFetchedAt: Date.now(),
            snapshotAgeMs: 0,
            usedCachedSnapshot: false,
            attemptedSources: ["markPx", "mid"],
            errorCategory: null,
            symbolFoundInMids: true,
            symbolFoundInAssetCtxs: true
          }
        })
    };
  };
  (adapter as any).marketApi.getTicker = async () => {
    singleTickerCalls += 1;
    throw new Error("per-symbol getTicker should not be used inside batched poll");
  };

  (adapter as any).tickerSymbols.add("BTC-PERP");
  (adapter as any).tickerSymbols.add("ETH-PERP");
  const seenCoins: string[] = [];
  const detach = adapter.onTicker((payload) => {
    seenCoins.push(String(payload?.data?.[0]?.coin ?? ""));
  });

  await (adapter as any).runMarketPoll();

  assert.equal(snapshotCalls, 1);
  assert.equal(singleTickerCalls, 0);
  assert.deepEqual(seenCoins.sort(), ["BTC", "ETH"]);

  detach();
  await adapter.close();
});

test("adapter seeds perp asset map without sdk refresh", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`
  });

  (adapter as any).marketApi.getMetaAndAssetCtxs = async () => [
    {
      universe: [
        { name: "BTC", szDecimals: 3 },
        { name: "ETH", szDecimals: 3 }
      ]
    },
    []
  ];

  const symbolConversion = (adapter.sdk as any).symbolConversion;
  symbolConversion.initialized = false;
  symbolConversion.assetToIndexMap.clear();
  symbolConversion.exchangeToInternalNameMap.clear();
  symbolConversion.refreshAssetMaps = async () => {
    throw new Error("sdk refresh should not be used");
  };

  await (adapter as any).ensureSdkPerpAssetMapReady();

  assert.equal(symbolConversion.initialized, true);
  assert.equal(symbolConversion.assetToIndexMap.get("BTC-PERP"), 0);
  assert.equal(symbolConversion.assetToIndexMap.get("ETH-PERP"), 1);
  assert.equal(symbolConversion.exchangeToInternalNameMap.get("BTC"), "BTC-PERP");
  assert.equal(symbolConversion.exchangeToInternalNameMap.get("ETH"), "ETH-PERP");

  await adapter.close();
});

test("adapter uses signing sdk for account writes when apiSecret is configured", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`
  });

  assert.equal((adapter as any).accountApi.sdk, (adapter as any).sdk);
  assert.equal(typeof (adapter as any).accountApi.sdk.exchange.updateLeverage, "function");

  await adapter.close();
});

test("adapter depositUsdcToHyperCore submits requested amount when core spot is empty and evm usdc is funded", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let depositedAmountUsd: number | null = null;
  let coreBalanceReads = 0;
  (adapter as any).getCoreUsdcSpotBalance = async () => ({
    amountUsd: 0,
    token: "USDC",
    tokenIndex: 0,
    systemAddress: `0x${"4".repeat(40)}`,
    weiDecimals: 8
  });
  (adapter as any).readCoreUsdcSpotBalanceForDepositReconciliation = async () => {
    coreBalanceReads += 1;
    return 0;
  };
  (adapter as any).getEvmUsdcBalance = async () => ({
    amountUsd: 10,
    amountAtomic: 10_000_000n,
    holderAddress: `0x${"3".repeat(40)}`,
    tokenAddress: `0x${"5".repeat(40)}`,
    decimals: 6
  });
  (adapter as any).coreWriter.depositUsdcToHyperCore = async ({ amountUsd }: { amountUsd: number }) => {
    depositedAmountUsd = amountUsd;
    return {
      status: "pending_timeout",
      submitted: true,
      confirmationSource: "none",
      receiptStatus: "unknown",
      amountUsd,
      txHash: "0xabc",
      errorCode: "receipt_timeout",
      errorMessage: "timed out while waiting for transaction receipt"
    };
  };

  const result = await adapter.depositUsdcToHyperCore({ amountUsd: 6 });

  assert.equal(depositedAmountUsd, 6);
  assert.equal(coreBalanceReads, 2);
  assert.deepEqual(result, {
    status: "pending_timeout",
    submitted: true,
    confirmationSource: "none",
    receiptStatus: "unknown",
    txHash: "0xabc",
    amountUsd: 6,
    errorCode: "deposit_submitted",
    errorMessage: "deposit_submitted"
  });

  await adapter.close();
});

test("adapter depositUsdcToHyperCore returns insufficient_evm_usdc when vault evm usdc is too low", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let depositCalls = 0;
  (adapter as any).readCoreUsdcSpotBalanceForDepositReconciliation = async () => 0;
  (adapter as any).getEvmUsdcBalance = async () => ({
    amountUsd: 3,
    amountAtomic: 3_000_000n,
    holderAddress: `0x${"3".repeat(40)}`,
    tokenAddress: `0x${"5".repeat(40)}`,
    decimals: 6
  });
  (adapter as any).coreWriter.depositUsdcToHyperCore = async () => {
    depositCalls += 1;
    throw new Error("deposit should not be submitted");
  };

  const result = await adapter.depositUsdcToHyperCore({ amountUsd: 6 });

  assert.equal(depositCalls, 0);
  assert.deepEqual(result, {
    status: "failed",
    submitted: false,
    confirmationSource: "none",
    receiptStatus: "unknown",
    amountUsd: 6,
    errorCode: "insufficient_evm_usdc",
    errorMessage: "insufficient_evm_usdc"
  });

  await adapter.close();
});

test("adapter depositUsdcToHyperCore waits for core balance reconciliation after receipt success", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  const coreBalances = [0, 0];
  (adapter as any).readCoreUsdcSpotBalanceForDepositReconciliation = async () => coreBalances.shift() ?? 0;
  (adapter as any).getEvmUsdcBalance = async () => ({
    amountUsd: 10,
    amountAtomic: 10_000_000n,
    holderAddress: `0x${"3".repeat(40)}`,
    tokenAddress: `0x${"5".repeat(40)}`,
    decimals: 6
  });
  (adapter as any).coreWriter.depositUsdcToHyperCore = async ({ amountUsd }: { amountUsd: number }) => ({
    status: "confirmed",
    submitted: true,
    confirmationSource: "receipt",
    receiptStatus: "success",
    amountUsd,
    txHash: "0xabc"
  });

  const result = await adapter.depositUsdcToHyperCore({ amountUsd: 6 });

  assert.deepEqual(result, {
    status: "pending_timeout",
    submitted: true,
    confirmationSource: "receipt",
    receiptStatus: "success",
    txHash: "0xabc",
    amountUsd: 6,
    errorCode: "deposit_pending_reconciliation",
    errorMessage: "deposit_pending_reconciliation"
  });

  await adapter.close();
});

test("adapter depositUsdcToHyperCore confirms only after core balance increases", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  const coreBalances = [0, 6];
  (adapter as any).readCoreUsdcSpotBalanceForDepositReconciliation = async () => coreBalances.shift() ?? 0;
  (adapter as any).getEvmUsdcBalance = async () => ({
    amountUsd: 10,
    amountAtomic: 10_000_000n,
    holderAddress: `0x${"3".repeat(40)}`,
    tokenAddress: `0x${"5".repeat(40)}`,
    decimals: 6
  });
  (adapter as any).coreWriter.depositUsdcToHyperCore = async ({ amountUsd }: { amountUsd: number }) => ({
    status: "confirmed",
    submitted: true,
    confirmationSource: "receipt",
    receiptStatus: "success",
    amountUsd,
    txHash: "0xabc"
  });

  const result = await adapter.depositUsdcToHyperCore({ amountUsd: 6 });

  assert.deepEqual(result, {
    status: "confirmed",
    submitted: true,
    confirmationSource: "receipt",
    receiptStatus: "success",
    txHash: "0xabc",
    amountUsd: 6,
    errorCode: "deposit_confirmed",
    errorMessage: "deposit_confirmed"
  });

  await adapter.close();
});

test("adapter transferUsdcSpotToEvm uses the corewriter spot exit path", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let forwardedInput: any = null;
  (adapter as any).getCoreUsdcSpotBalance = async () => ({
    amountUsd: 5,
    token: "USDC:0",
    tokenIndex: 0,
    systemAddress: `0x${"4".repeat(40)}`,
    weiDecimals: 8
  });
  (adapter as any).coreWriter.sendSpotAsset = async (input: any) => {
    forwardedInput = input;
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "receipt",
      receiptStatus: "success",
      txHash: "0xabc"
    };
  };

  const result = await adapter.transferUsdcSpotToEvm({ amountUsd: 2 });

  assert.deepEqual(result, {
    status: "confirmed",
    submitted: true,
    confirmationSource: "receipt",
    receiptStatus: "success",
    txHash: "0xabc"
  });
  assert.deepEqual(forwardedInput, {
    destination: `0x${"4".repeat(40)}`,
    token: 0,
    weiAmount: 200_000_000n
  });

  await adapter.close();
});

test("adapter getCoreUsdcSpotBalance falls back to direct info spot reads when sdk spot endpoints fail", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiPassphrase: `0x${"3".repeat(40)}`
  });

  const originalFetch = globalThis.fetch;
  (adapter as any).sdk.info.spot.getSpotMeta = async () => {
    throw new Error("sdk spot meta unavailable");
  };
  (adapter as any).sdk.info.spot.getSpotClearinghouseState = async () => {
    throw new Error("sdk spot state unavailable");
  };

  globalThis.fetch = async (_input: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    if (payload.type === "spotMeta") {
      return {
        ok: true,
        json: async () => ({
          tokens: [{ name: "USDC" }]
        })
      } as any;
    }
    if (payload.type === "spotClearinghouseState") {
      return {
        ok: true,
        json: async () => ({
          balances: [{ coin: "USDC", total: "5.939281" }]
        })
      } as any;
    }
    throw new Error(`unexpected payload:${JSON.stringify(payload)}`);
  };

  try {
    const balance = await adapter.getCoreUsdcSpotBalance();

    assert.equal(balance.amountUsd, 5.939281);
    assert.equal(balance.tokenIndex, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await adapter.close();
  }
});

test("adapter getCoreUsdcSpotBalance uses explicit spot token indexes from metadata", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiPassphrase: `0x${"3".repeat(40)}`
  });

  const originalFetch = globalThis.fetch;
  (adapter as any).sdk.info.spot.getSpotMeta = async () => {
    throw new Error("sdk spot meta unavailable");
  };
  (adapter as any).sdk.info.spot.getSpotClearinghouseState = async () => {
    throw new Error("sdk spot state unavailable");
  };

  globalThis.fetch = async (_input: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    if (payload.type === "spotMeta") {
      return {
        ok: true,
        json: async () => ({
          tokens: [{ index: 42, name: "USDC" }]
        })
      } as any;
    }
    if (payload.type === "spotClearinghouseState") {
      return {
        ok: true,
        json: async () => ({
          tokenBalances: [{ token: 42, balance: "5.939281" }]
        })
      } as any;
    }
    throw new Error(`unexpected payload:${JSON.stringify(payload)}`);
  };

  try {
    const balance = await adapter.getCoreUsdcSpotBalance();

    assert.equal(balance.amountUsd, 5.939281);
    assert.equal(balance.tokenIndex, 42);
    assert.equal(balance.systemAddress, `0x20${"0".repeat(36)}2a`);
    assert.equal(balance.weiDecimals, 8);
  } finally {
    globalThis.fetch = originalFetch;
    await adapter.close();
  }
});

test("adapter getCoreUsdcSpotBalance retries direct info spot reads after rate limit", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiPassphrase: `0x${"3".repeat(40)}`
  });

  const originalFetch = globalThis.fetch;
  let spotMetaCalls = 0;
  (adapter as any).sdk.info.spot.getSpotMeta = async () => {
    throw new Error("sdk spot meta unavailable");
  };
  (adapter as any).sdk.info.spot.getSpotClearinghouseState = async () => {
    throw new Error("sdk spot state unavailable");
  };

  globalThis.fetch = async (_input: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    if (payload.type === "spotMeta") {
      spotMetaCalls += 1;
      if (spotMetaCalls === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => ""
        } as any;
      }
      return {
        ok: true,
        json: async () => ({
          tokens: [{ name: "USDC" }]
        })
      } as any;
    }
    if (payload.type === "spotClearinghouseState") {
      return {
        ok: true,
        json: async () => ({
          balances: [{ coin: "USDC", total: "5.939281" }]
        })
      } as any;
    }
    throw new Error(`unexpected payload:${JSON.stringify(payload)}`);
  };

  try {
    const balance = await adapter.getCoreUsdcSpotBalance();

    assert.equal(spotMetaCalls, 2);
    assert.equal(balance.amountUsd, 5.939281);
    assert.equal(balance.tokenIndex, 0);
    assert.equal(balance.weiDecimals, 8);
  } finally {
    globalThis.fetch = originalFetch;
    await adapter.close();
  }
});

test("adapter placeOrder rejects clientOid-only acknowledgements", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`
  });

  (adapter as any).requireTradeableContract = async () => ({
    exchangeSymbol: "BTC",
    stepSize: 0.001,
    raw: { universe: { szDecimals: 3 } }
  });
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  (adapter as any).tradeApi.placeOrder = async () => ({
    clientOid: "grid-btc-1"
  });

  await assert.rejects(
    () => adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      qty: 0.01,
      price: 70000,
      clientOrderId: "grid-btc-1",
      marginMode: "cross"
    }),
    /hyperliquid_place_order_missing_order_id/
  );

  await adapter.close();
});

test("adapter placeOrder preserves step-aligned market qty on the corewriter path", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let placedInput: any = null;
  (adapter as any).requireTradeableContract = async () => ({
    exchangeSymbol: "BTC-PERP",
    assetIndex: 0,
    stepSize: 0.00001,
    raw: { universe: { szDecimals: 5 } }
  });
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  (adapter as any).marketApi.getTicker = async () => ({
    markPrice: 69781,
    midPrice: 69781,
    lastPr: 69781,
    last: 69781,
    indexPrice: 69781
  });
  (adapter as any).coreWriter.placeLimitOrder = async (input: any) => {
    placedInput = input;
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "receipt",
      receiptStatus: "success",
      orderId: "cloid:0:123",
      clientOrderId: input.clientOrderId,
      txHash: "0xabc"
    };
  };

  const result = await adapter.placeOrder({
    symbol: "BTCUSDT",
    side: "buy",
    type: "market",
    qty: 0.00015,
    reduceOnly: false,
    marginMode: "cross"
  });

  assert.equal(placedInput?.limitPx, 69990);
  assert.equal(placedInput?.sz, 0.00015);
  assert.deepEqual(result, {
    status: "confirmed",
    submitted: true,
    confirmationSource: "receipt",
    receiptStatus: "success",
    orderId: "cloid:0:123",
    clientOrderId: result.clientOrderId,
    txHash: "0xabc"
  });

  await adapter.close();
});

test("adapter placeOrder keeps corewriter orders pending until receipt confirmation", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  (adapter as any).requireTradeableContract = async () => ({
    exchangeSymbol: "BTC-PERP",
    assetIndex: 0,
    stepSize: 0.00001,
    raw: { universe: { szDecimals: 5 } }
  });
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  (adapter as any).marketApi.getTicker = async () => ({
    markPrice: 69781,
    midPrice: 69781,
    lastPr: 69781,
    last: 69781,
    indexPrice: 69781
  });
  (adapter as any).coreWriter.placeLimitOrder = async (input: any) => ({
    status: "pending_timeout",
    submitted: true,
    confirmationSource: "none",
    receiptStatus: "unknown",
    candidateOrderId: "cloid:0:456",
    clientOrderId: input.clientOrderId,
    txHash: "0xdef",
    errorCode: "receipt_timeout",
    errorMessage: "timed out while waiting for transaction receipt"
  });

  const result = await adapter.placeOrder({
    symbol: "BTCUSDT",
    side: "buy",
    type: "market",
    qty: 0.00015,
    reduceOnly: false,
    marginMode: "cross"
  });

  assert.equal(result.status, "pending_timeout");
  assert.equal(result.orderId, undefined);
  assert.equal(result.candidateOrderId, "cloid:0:456");
  assert.equal(result.txHash, "0xdef");

  await adapter.close();
});

test("adapter cancelOrder supports corewriter cloid ids without symbol lookup", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let canceledOrderId: string | null = null;
  (adapter as any).tradeApi.cancelOrder = async ({ orderId }: any) => {
    canceledOrderId = orderId;
  };

  await adapter.cancelOrder("cloid:7:123456");

  assert.equal(canceledOrderId, "cloid:7:123456");
  await adapter.close();
});

test("adapter cancelOrder routes numeric oid through corewriter cancel by oid", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let canceledAsset: number | null = null;
  let canceledOid: number | null = null;
  (adapter as any).tradeApi.getPendingOrders = async () => ([
    { orderId: "12345", symbol: "BTC" }
  ]);
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  ((adapter as any).sdk as any).symbolConversion = {
    assetToIndexMap: new Map([["BTC", 0]]),
    exchangeToInternalNameMap: new Map([["BTC", "BTC"]])
  };
  (adapter as any).coreWriter.cancelByOid = async ({ asset, oid }: any) => {
    canceledAsset = asset;
    canceledOid = oid;
  };

  await adapter.cancelOrder("12345");

  assert.equal(canceledAsset, 0);
  assert.equal(canceledOid, 12345);
  await adapter.close();
});

test("adapter cancelOrder resolves numeric oid beyond the first small pending-order page", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let canceledAsset: number | null = null;
  let canceledOid: number | null = null;
  const pendingRows = Array.from({ length: 151 }, (_, index) => ({
    orderId: String(90000 + index),
    symbol: index === 0 ? "ETH" : "BTC"
  }));
  (adapter as any).tradeApi.getPendingOrders = async (params: any = {}) => {
    const pageSize = Math.max(1, Number(params?.pageSize ?? 100));
    const idLessThan = String(params?.idLessThan ?? "").trim();
    const filtered = pendingRows
      .slice()
      .sort((left, right) => Number(right.orderId) - Number(left.orderId))
      .filter((row) => (idLessThan ? Number(row.orderId) < Number(idLessThan) : true));
    return filtered.slice(0, pageSize);
  };
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  ((adapter as any).sdk as any).symbolConversion = {
    assetToIndexMap: new Map([["BTC", 0], ["ETH", 1]]),
    exchangeToInternalNameMap: new Map([["BTC", "BTC"], ["ETH", "ETH"]])
  };
  (adapter as any).coreWriter.cancelByOid = async ({ asset, oid }: any) => {
    canceledAsset = asset;
    canceledOid = oid;
  };

  await adapter.cancelOrder("90000");

  assert.equal(canceledAsset, 1);
  assert.equal(canceledOid, 90000);
  await adapter.close();
});

test("adapter cancelOrderByParams resolves numeric oid directly from the provided symbol", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let pendingLookupCount = 0;
  let canceledAsset: number | null = null;
  let canceledOid: number | null = null;
  (adapter as any).tradeApi.getPendingOrders = async () => {
    pendingLookupCount += 1;
    return [];
  };
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  ((adapter as any).sdk as any).symbolConversion = {
    assetToIndexMap: new Map([["ETH", 1]]),
    exchangeToInternalNameMap: new Map([["ETH", "ETH"]])
  };
  (adapter as any).toExchangeSymbol = async () => "ETH";
  (adapter as any).coreWriter.cancelByOid = async ({ asset, oid }: any) => {
    canceledAsset = asset;
    canceledOid = oid;
  };

  await (adapter as any).cancelOrderByParams({
    orderId: "90150",
    symbol: "ETHUSDT"
  });

  assert.equal(pendingLookupCount, 0);
  assert.equal(canceledAsset, 1);
  assert.equal(canceledOid, 90150);
  await adapter.close();
});

test("adapter listOpenOrders hydrates oid metadata cache for later numeric cancels", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let pendingLookupCount = 0;
  let canceledAsset: number | null = null;
  let canceledOid: number | null = null;
  (adapter as any).tradeApi.getPendingOrders = async () => {
    pendingLookupCount += 1;
    if (pendingLookupCount === 1) {
      return [{ orderId: "55555", symbol: "ETH" }];
    }
    return [];
  };
  (adapter as any).tradeApi.getPendingPlanOrders = async () => [];
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  ((adapter as any).sdk as any).symbolConversion = {
    assetToIndexMap: new Map([["ETH", 1]]),
    exchangeToInternalNameMap: new Map([["ETH", "ETH"]])
  };
  (adapter as any).coreWriter.cancelByOid = async ({ asset, oid }: any) => {
    canceledAsset = asset;
    canceledOid = oid;
  };

  await adapter.listOpenOrders();
  await adapter.cancelOrder("55555");

  assert.equal(pendingLookupCount, 1);
  assert.equal(canceledAsset, 1);
  assert.equal(canceledOid, 55555);
  await adapter.close();
});

test("adapter cancelOrderByParams rejects conflicting symbol hints for cached oids", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  (adapter as any).tradeApi.getPendingOrders = async () => [];
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  ((adapter as any).sdk as any).symbolConversion = {
    assetToIndexMap: new Map([
      ["BTC", 0],
      ["ETH", 1]
    ]),
    exchangeToInternalNameMap: new Map([
      ["BTC", "BTC"],
      ["ETH", "ETH"]
    ])
  };
  (adapter as any).toExchangeSymbol = async (symbol: string) => (symbol.includes("ETH") ? "ETH" : "BTC");

  (adapter as any).orderSymbolIndex.set("12345", "BTC");
  (adapter as any).orderAssetIndex.set("12345", 0);

  await assert.rejects(
    () => (adapter as any).cancelOrderByParams({ orderId: "12345", symbol: "ETHUSDT" }),
    /hyperliquid_order_symbol_conflict:12345/
  );

  await adapter.close();
});

test("adapter cancelOrder resolves numeric oid when pending orders already use internal perp symbols", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiSecret: `0x${"2".repeat(64)}`,
    botVaultAddress: `0x${"3".repeat(40)}`,
    writeMode: "hyperevm_corewriter"
  });

  let canceledAsset: number | null = null;
  let canceledOid: number | null = null;
  (adapter as any).tradeApi.getPendingOrders = async () => ([
    { orderId: "12345", symbol: "BTC-PERP" }
  ]);
  (adapter as any).ensureSdkPerpAssetMapReady = async () => undefined;
  ((adapter as any).sdk as any).symbolConversion = {
    assetToIndexMap: new Map([["BTC-PERP", 0]]),
    exchangeToInternalNameMap: new Map([["BTC", "BTC-PERP"]])
  };
  (adapter as any).coreWriter.cancelByOid = async ({ asset, oid }: any) => {
    canceledAsset = asset;
    canceledOid = oid;
  };

  await adapter.cancelOrder("12345");

  assert.equal(canceledAsset, 0);
  assert.equal(canceledOid, 12345);
  await adapter.close();
});

test("adapter account state falls back to signing wallet when configured read address is empty", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"1".repeat(40)}`,
    apiPassphrase: `0x${"3".repeat(40)}`
  });

  const requestedAddresses: string[] = [];
  (adapter.readSdk.info.perpetuals as any).getClearinghouseState = async (address: string) => {
    requestedAddresses.push(address);
    if (address === `0x${"3".repeat(40)}`) {
      return {
        marginSummary: { accountValue: "0" },
        crossMarginSummary: { accountValue: "0" },
        withdrawable: "0"
      };
    }
    return {
      marginSummary: { accountValue: "123.45" },
      crossMarginSummary: { accountValue: "123.45" },
      withdrawable: "67.89"
    };
  };

  const state = await adapter.getAccountState();

  assert.deepEqual(requestedAddresses, [`0x${"3".repeat(40)}`, `0x${"1".repeat(40)}`]);
  assert.equal(state.equity, 123.45);
  assert.equal(state.availableMargin, 67.89);

  await adapter.close();
});

test("adapter account state falls back to agent master account when configured read address is empty", async () => {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: `0x${"4".repeat(40)}`,
    apiPassphrase: `0x${"5".repeat(40)}`
  });

  const requestedAddresses: string[] = [];
  ((adapter.readSdk.info as any).getUserRole) = async (address: string) => ({
    role: address.toLowerCase() === `0x${"4".repeat(40)}` ? "agent" : "user",
    data: { user: `0x${"6".repeat(40)}` }
  });
  (adapter.readSdk.info.perpetuals as any).getClearinghouseState = async (address: string) => {
    requestedAddresses.push(address.toLowerCase());
    if (address.toLowerCase() === `0x${"6".repeat(40)}`) {
      return {
        marginSummary: { accountValue: "105.0" },
        crossMarginSummary: { accountValue: "105.0" },
        withdrawable: "105.0",
        assetPositions: []
      };
    }
    return {
      marginSummary: { accountValue: "0" },
      crossMarginSummary: { accountValue: "0" },
      withdrawable: "0",
      assetPositions: []
    };
  };

  const state = await adapter.getAccountState();

  assert.deepEqual(requestedAddresses, [
    `0x${"5".repeat(40)}`,
    `0x${"6".repeat(40)}`
  ]);
  assert.equal(state.equity, 105);
  assert.equal(state.availableMargin, 105);

  await adapter.close();
});
