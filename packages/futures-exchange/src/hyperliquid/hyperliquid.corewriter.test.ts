import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoreWriterOrderId,
  HyperliquidCoreWriterClient,
  parseCoreWriterOrderId
} from "./hyperliquid.corewriter.js";

test("corewriter client encodes bot vault limit order tx and returns cloid order id", async () => {
  let capturedTo: string | null = null;
  let capturedData: string | null = null;
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async (input) => {
      capturedTo = input.to;
      capturedData = input.data;
      return `0x${"a".repeat(64)}`;
    }
  });

  const result = await client.placeLimitOrder({
    asset: 7,
    isBuy: true,
    limitPx: 66600,
    sz: 0.001,
    reduceOnly: false,
    encodedTif: 2,
    clientOrderId: "grid-btc-1"
  });

  assert.equal(capturedTo, `0x${"2".repeat(40)}`);
  if (capturedData === null) {
    throw new Error("captured_data_missing");
  }
  assert.match(capturedData, /^0x/);
  assert.match(result.orderId, /^cloid:7:\d+$/);
});

test("corewriter order ids round-trip through parser", () => {
  const orderId = buildCoreWriterOrderId(9, 12345678901234567890n);
  const parsed = parseCoreWriterOrderId(orderId);
  assert.deepEqual(parsed, {
    asset: 9,
    cloid: 12345678901234567890n
  });
});

test("corewriter client retries once with refreshed nonce when chain rejects stale nonce", async () => {
  const attempts: number[] = [];
  let nonceReads = 0;
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    getTransactionCount: async () => {
      nonceReads += 1;
      return nonceReads === 1 ? 5846 : 5847;
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
    sendTransaction: async (input) => {
      attempts.push(Number(input.nonce ?? -1));
      if (input.nonce === 5846) {
        throw new Error("nonce too low: next nonce 5847, tx nonce 5846");
      }
      return `0x${"b".repeat(64)}`;
    }
  });

  const result = await client.placeLimitOrder({
    asset: 0,
    isBuy: false,
    limitPx: 80000,
    sz: 0.00008,
    reduceOnly: true,
    encodedTif: 2,
    clientOrderId: "grid-btc-retry-1"
  });

  assert.equal(result.txHash, `0x${"b".repeat(64)}`);
  assert.deepEqual(attempts, [5846, 5847]);
  assert.equal(nonceReads, 2);
});

test("corewriter client surfaces reverted transaction receipts", async () => {
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async () => `0x${"c".repeat(64)}`,
    waitForTransactionReceipt: async () => ({ status: "reverted" })
  });

  await assert.rejects(
    () => client.placeLimitOrder({
      asset: 7,
      isBuy: true,
      limitPx: 66600,
      sz: 0.001,
      reduceOnly: false,
      encodedTif: 2,
      clientOrderId: "grid-btc-reverted-1"
    }),
    /hyperliquid_corewriter_tx_reverted/
  );
});

test("corewriter client sends usd class transfer and returns tx hash", async () => {
  let capturedTo: string | null = null;
  let capturedData: string | null = null;
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async (input) => {
      capturedTo = input.to;
      capturedData = input.data;
      return `0x${"d".repeat(64)}`;
    },
    waitForTransactionReceipt: async () => ({ status: "success" })
  });

  const result = await client.sendUsdClassTransfer({
    amountUsd: 73,
    toPerp: true
  });

  assert.equal(capturedTo, `0x${"2".repeat(40)}`);
  assert.match(String(capturedData), /^0x/);
  assert.equal(result.txHash, `0x${"d".repeat(64)}`);
});

test("corewriter client deposits vault usdc to hypercore and returns tx hash", async () => {
  let capturedTo: string | null = null;
  let capturedData: string | null = null;
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async (input) => {
      capturedTo = input.to;
      capturedData = input.data;
      return `0x${"e".repeat(64)}`;
    },
    waitForTransactionReceipt: async () => ({ status: "success" })
  });

  const result = await client.depositUsdcToHyperCore({
    amountUsd: 73
  });

  assert.equal(capturedTo, `0x${"2".repeat(40)}`);
  assert.match(String(capturedData), /^0x/);
  assert.equal(result.txHash, `0x${"e".repeat(64)}`);
});
