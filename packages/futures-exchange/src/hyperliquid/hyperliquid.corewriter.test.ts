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
  assert.equal(result.status, "pending_timeout");
  assert.match(capturedData, /^0x/);
  assert.match(String(result.candidateOrderId), /^cloid:7:\d+$/);
  assert.equal(result.clientOrderId, "grid-btc-1");
});

test("corewriter order ids round-trip through parser", () => {
  const orderId = buildCoreWriterOrderId(9, 12345678901234567890n);
  const parsed = parseCoreWriterOrderId(orderId);
  assert.deepEqual(parsed, {
    asset: 9,
    cloid: 12345678901234567890n
  });
});

test("corewriter parser keeps legacy corewriter-prefixed ids backward compatible", () => {
  const parsed = parseCoreWriterOrderId("corewriter:9:12345678901234567890");
  assert.deepEqual(parsed, {
    asset: 9,
    cloid: 12345678901234567890n
  });
});

test("corewriter client retries once with refreshed nonce when chain rejects stale nonce", async () => {
  const attempts: number[] = [];
  let nonceReads = 0;
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"4".repeat(64)}`,
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

  assert.equal(result.status, "confirmed");
  assert.equal(result.txHash, `0x${"b".repeat(64)}`);
  assert.deepEqual(attempts, [5846, 5847]);
  assert.equal(nonceReads, 2);
});

test("corewriter client retries rate-limited nonce and send requests", async () => {
  const attempts: number[] = [];
  let nonceReads = 0;
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"5".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    getTransactionCount: async () => {
      nonceReads += 1;
      if (nonceReads === 1) {
        throw new Error("LimitExceededRpcError: Request exceeds defined limit. Details: rate limited");
      }
      return 8705;
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
    sendTransaction: async (input) => {
      attempts.push(Number(input.nonce ?? -1));
      if (attempts.length === 1) {
        throw new Error("TransactionExecutionError: Request exceeds defined limit. Details: rate limited");
      }
      return `0x${"f".repeat(64)}`;
    }
  });

  const result = await client.placeLimitOrder({
    asset: 0,
    isBuy: true,
    limitPx: 67500,
    sz: 0.00008,
    reduceOnly: false,
    encodedTif: 2,
    clientOrderId: "grid-btc-rate-limit-1"
  });

  assert.equal(result.status, "confirmed");
  assert.equal(result.txHash, `0x${"f".repeat(64)}`);
  assert.equal(nonceReads, 2);
  assert.deepEqual(attempts, [8705, 8705]);
});

test("corewriter client serializes nonces across concurrent clients sharing the same signer", async () => {
  const attempts: Array<{ to: string; nonce: number; gas: string | null }> = [];
  const txHashes = [
    `0x${"7".repeat(64)}`,
    `0x${"8".repeat(64)}`
  ] as const;
  let nonceReads = 0;
  let firstSendRelease: () => void = () => {
    throw new Error("first_send_release_missing");
  };
  let firstSendEnteredResolve: (() => void) | null = null;
  const firstSendEntered = new Promise<void>((resolve) => {
    firstSendEnteredResolve = resolve;
  });
  let sendCount = 0;

  const buildClient = (botVaultAddress: `0x${string}`) => new HyperliquidCoreWriterClient({
    privateKey: `0x${"6".repeat(64)}`,
    botVaultAddress,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    getTransactionCount: async () => {
      nonceReads += 1;
      return 4100;
    },
    waitForTransactionReceipt: async ({ hash }) => ({ status: hash === txHashes[0] || hash === txHashes[1] ? "success" : "reverted" }),
    sendTransaction: async (input) => {
      attempts.push({
        to: input.to,
        nonce: Number(input.nonce ?? -1),
        gas: input.gas?.toString() ?? null
      });
      sendCount += 1;
      if (sendCount === 1) {
        firstSendEnteredResolve?.();
        await new Promise<void>((resolve) => {
          firstSendRelease = resolve;
        });
      }
      return txHashes[sendCount - 1] as `0x${string}`;
    }
  });

  const clientA = buildClient(`0x${"2".repeat(40)}`);
  const clientB = buildClient(`0x${"3".repeat(40)}`);

  const first = clientA.placeLimitOrder({
    asset: 1,
    isBuy: true,
    limitPx: 70000,
    sz: 0.001,
    reduceOnly: false,
    encodedTif: 2,
    clientOrderId: "grid-btc-concurrent-a"
  });
  await firstSendEntered;
  const second = clientB.cancelByOid({
    asset: 2,
    oid: 123456
  });
  firstSendRelease();

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.status, "confirmed");
  assert.equal(secondResult.status, "confirmed");
  assert.equal(nonceReads, 1);
  assert.deepEqual(attempts, [
    { to: `0x${"2".repeat(40)}`, nonce: 4100, gas: "950000" },
    { to: `0x${"3".repeat(40)}`, nonce: 4101, gas: "950000" }
  ]);
});

test("corewriter client invalidates cached nonce after ambiguous submission failure", async () => {
  const attempts: number[] = [];
  let nonceReads = 0;
  let sendCount = 0;
  let firstSendRelease: () => void = () => {
    throw new Error("first_send_release_missing");
  };
  let firstSendEnteredResolve: (() => void) | null = null;
  const firstSendEntered = new Promise<void>((resolve) => {
    firstSendEnteredResolve = resolve;
  });
  const buildClient = (botVaultAddress: `0x${string}`) => new HyperliquidCoreWriterClient({
    privateKey: `0x${"7".repeat(64)}`,
    botVaultAddress,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    getTransactionCount: async () => {
      nonceReads += 1;
      return nonceReads === 1 ? 7200 : 7201;
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
    sendTransaction: async (input) => {
      attempts.push(Number(input.nonce ?? -1));
      sendCount += 1;
      if (sendCount === 1) {
        firstSendEnteredResolve?.();
        await new Promise<void>((resolve) => {
          firstSendRelease = resolve;
        });
        throw new Error("socket hang up while broadcasting raw transaction");
      }
      return `0x${"9".repeat(64)}`;
    }
  });

  const clientA = buildClient(`0x${"4".repeat(40)}`);
  const clientB = buildClient(`0x${"5".repeat(40)}`);

  const failed = clientA.placeLimitOrder({
    asset: 3,
    isBuy: false,
    limitPx: 80000,
    sz: 0.002,
    reduceOnly: true,
    encodedTif: 2,
    clientOrderId: "grid-btc-ambiguous-failure"
  });
  await firstSendEntered;
  const confirmed = clientB.cancelByOid({
    asset: 3,
    oid: 654321
  });
  firstSendRelease();

  const [failedResult, confirmedResult] = await Promise.all([failed, confirmed]);

  assert.equal(failedResult.status, "failed");
  assert.equal(confirmedResult.status, "confirmed");
  assert.equal(nonceReads, 2);
  assert.deepEqual(attempts, [7200, 7201]);
});

test("corewriter client classifies reverted transaction receipts as failed", async () => {
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async () => `0x${"c".repeat(64)}`,
    waitForTransactionReceipt: async () => ({ status: "reverted" })
  });

  const result = await client.placeLimitOrder({
    asset: 7,
    isBuy: true,
    limitPx: 66600,
    sz: 0.001,
    reduceOnly: false,
    encodedTif: 2,
    clientOrderId: "grid-btc-reverted-1"
  });

  assert.equal(result.status, "failed");
  assert.equal(result.receiptStatus, "reverted");
  assert.match(String(result.errorMessage), /hyperliquid_corewriter_tx_reverted/);
});

test("corewriter client classifies receipt wait timeouts as pending_timeout", async () => {
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async () => `0x${"1".repeat(64)}`,
    waitForTransactionReceipt: async () => {
      throw new Error("timed out while waiting for transaction receipt");
    }
  });

  const result = await client.placeLimitOrder({
    asset: 7,
    isBuy: true,
    limitPx: 66600,
    sz: 0.001,
    reduceOnly: false,
    encodedTif: 2,
    clientOrderId: "grid-btc-timeout-1"
  });

  assert.equal(result.status, "pending_timeout");
  assert.equal(result.submitted, true);
  assert.equal(result.receiptStatus, "unknown");
  assert.match(String(result.errorMessage), /timed out/i);
  assert.match(String(result.candidateOrderId), /^cloid:7:\d+$/);
});

test("corewriter client waits for successful cancelByCloid receipts", async () => {
  const receiptHashes: string[] = [];
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async () => `0x${"d".repeat(64)}`,
    waitForTransactionReceipt: async ({ hash }) => {
      receiptHashes.push(hash);
      return { status: "success" };
    }
  });

  const result = await client.cancelByCloid({
    asset: 7,
    cloid: 12345678901234567890n
  });

  assert.equal(result.status, "confirmed");
  assert.equal(result.txHash, `0x${"d".repeat(64)}`);
  assert.deepEqual(receiptHashes, [`0x${"d".repeat(64)}`]);
});

test("corewriter client classifies reverted cancelByOid receipts as failed", async () => {
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async () => `0x${"e".repeat(64)}`,
    waitForTransactionReceipt: async () => ({ status: "reverted" })
  });

  const result = await client.cancelByOid({
    asset: 7,
    oid: 12345
  });

  assert.equal(result.status, "failed");
  assert.equal(result.receiptStatus, "reverted");
  assert.match(String(result.errorMessage), /hyperliquid_corewriter_tx_reverted/);
});

test("corewriter client classifies cancel receipt wait timeouts as pending_timeout", async () => {
  const client = new HyperliquidCoreWriterClient({
    privateKey: `0x${"1".repeat(64)}`,
    botVaultAddress: `0x${"2".repeat(40)}`,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    sendTransaction: async () => `0x${"4".repeat(64)}`,
    waitForTransactionReceipt: async () => {
      throw new Error("timed out while waiting for transaction receipt");
    }
  });

  const result = await client.cancelByOid({
    asset: 7,
    oid: 12345
  });

  assert.equal(result.status, "pending_timeout");
  assert.equal(result.submitted, true);
  assert.equal(result.receiptStatus, "unknown");
  assert.match(String(result.errorMessage), /timed out/i);
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

  assert.equal(result.status, "confirmed");
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

  assert.equal(result.status, "confirmed");
  assert.equal(capturedTo, `0x${"2".repeat(40)}`);
  assert.match(String(capturedData), /^0x/);
  assert.equal(result.txHash, `0x${"e".repeat(64)}`);
});

test("corewriter client sends spot asset exit and returns tx hash", async () => {
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
      return `0x${"f".repeat(64)}`;
    },
    waitForTransactionReceipt: async () => ({ status: "success" })
  });

  const result = await client.sendSpotAsset({
    destination: `0x${"3".repeat(40)}`,
    token: 0,
    weiAmount: 73_000_000n
  });

  assert.equal(result.status, "confirmed");
  assert.equal(capturedTo, `0x${"2".repeat(40)}`);
  assert.match(String(capturedData), /^0x/);
  assert.equal(result.txHash, `0x${"f".repeat(64)}`);
});
