import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex
} from "viem";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_USDC_ADDRESS,
  BILLING_PAYMENT_CONFIRMATIONS,
  ERC20_TRANSFER_EVENT,
  formatArbitrumUsdcAmount,
  normalizeBillingTreasuryAddress,
  verifyArbitrumUsdcTransaction,
  type BillingOnchainClient
} from "./onchain.js";

const SENDER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"ab".repeat(32)}`;
const AMOUNT = 29_000_000n;

function transferLog(params?: {
  from?: string;
  to?: string;
  value?: bigint;
  address?: string;
}) {
  const from = params?.from ?? SENDER;
  const to = params?.to ?? RECIPIENT;
  return {
    address: params?.address ?? ARBITRUM_USDC_ADDRESS,
    topics: encodeEventTopics({
      abi: [ERC20_TRANSFER_EVENT],
      eventName: "Transfer",
      args: { from, to }
    }) as readonly Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [params?.value ?? AMOUNT]),
    transactionHash: HASH
  };
}

function client(overrides: Partial<BillingOnchainClient> = {}): BillingOnchainClient {
  return {
    async getChainId() {
      return ARBITRUM_ONE_CHAIN_ID;
    },
    async getBlockNumber() {
      return 111n;
    },
    async getBytecode() {
      return "0x6000";
    },
    async readContract() {
      return 6;
    },
    async getTransaction() {
      return { from: SENDER, to: ARBITRUM_USDC_ADDRESS, value: 0n };
    },
    async getTransactionReceipt() {
      return {
        status: "success",
        blockNumber: 100n,
        blockHash: `0x${"cd".repeat(32)}`,
        logs: [transferLog()]
      };
    },
    async getLogs() {
      return [];
    },
    ...overrides
  };
}

async function verify(overrides: Partial<Parameters<typeof verifyArbitrumUsdcTransaction>[0]> = {}) {
  return verifyArbitrumUsdcTransaction({
    client: client(),
    txHash: HASH,
    expectedSenderAddress: SENDER,
    recipientAddress: RECIPIENT,
    expectedAmountRaw: AMOUNT,
    minimumBlockNumber: 100n,
    ...overrides
  });
}

test("confirms a direct native-USDC transfer after exactly 12 confirmations", async () => {
  const result = await verify();
  assert.equal(result.kind, "confirmed");
  assert.equal("confirmations" in result ? result.confirmations : null, BILLING_PAYMENT_CONFIRMATIONS);
  assert.equal(formatArbitrumUsdcAmount(AMOUNT), "29");
});

test("keeps a valid transfer confirming below the 12-confirmation boundary", async () => {
  const result = await verify({
    client: client({ async getBlockNumber() { return 110n; } })
  });
  assert.equal(result.kind, "confirming");
  assert.equal("confirmations" in result ? result.confirmations : null, 11);
});

test("binds a submitted transaction to the checkout block window", async () => {
  const beforeCheckout = await verify({ minimumBlockNumber: 101n });
  assert.deepEqual(
    beforeCheckout.kind === "review_required" && beforeCheckout.reason,
    "transaction_before_checkout"
  );

  const atMinimumBlock = await verify({ minimumBlockNumber: 100n });
  assert.equal(atMinimumBlock.kind, "confirmed");

  const missingSnapshot = await verify({ minimumBlockNumber: null });
  assert.deepEqual(
    missingSnapshot.kind === "review_required" && missingSnapshot.reason,
    "missing_checkout_block"
  );
});

test("rejects wrong chain, linked wallet, token and treasury", async (t) => {
  await t.test("wrong chain", async () => {
    const result = await verify({ client: client({ async getChainId() { return 1; } }) });
    assert.deepEqual(result.kind === "review_required" && result.reason, "wrong_chain");
  });
  await t.test("wrong linked wallet", async () => {
    const result = await verify({ expectedSenderAddress: OTHER });
    assert.deepEqual(result.kind === "review_required" && result.reason, "sender_mismatch");
  });
  await t.test("wrong token contract", async () => {
    const result = await verify({
      client: client({ async getTransaction() { return { from: SENDER, to: OTHER, value: 0n }; } })
    });
    assert.deepEqual(result.kind === "review_required" && result.reason, "wrong_token");
  });
  await t.test("wrong treasury", async () => {
    const result = await verify({ recipientAddress: OTHER });
    assert.deepEqual(result.kind === "review_required" && result.reason, "transfer_not_found");
  });
});

test("routes underpayment, overpayment and ambiguous transfers to manual review", async (t) => {
  for (const [name, value] of [["underpayment", AMOUNT - 1n], ["overpayment", AMOUNT + 1n]] as const) {
    await t.test(name, async () => {
      const result = await verify({
        client: client({
          async getTransactionReceipt() {
            return {
              status: "success",
              blockNumber: 100n,
              blockHash: `0x${"cd".repeat(32)}`,
              logs: [transferLog({ value })]
            };
          }
        })
      });
      assert.deepEqual(result.kind === "review_required" && result.reason, "amount_mismatch");
    });
  }
  const ambiguous = await verify({
    client: client({
      async getTransactionReceipt() {
        return {
          status: "success",
          blockNumber: 100n,
          blockHash: `0x${"cd".repeat(32)}`,
          logs: [transferLog(), transferLog()]
        };
      }
    })
  });
  assert.deepEqual(ambiguous.kind === "review_required" && ambiguous.reason, "ambiguous_transfers");
});

test("routes reverted receipts to review and RPC/not-found failures to retry", async () => {
  const reverted = await verify({
    client: client({
      async getTransactionReceipt() {
        return {
          status: "reverted",
          blockNumber: 100n,
          blockHash: `0x${"cd".repeat(32)}`,
          logs: []
        };
      }
    })
  });
  assert.deepEqual(reverted.kind === "review_required" && reverted.reason, "transaction_reverted");

  const unavailable = await verify({
    client: client({
      async getTransactionReceipt() {
        throw new Error("transaction not found");
      }
    })
  });
  assert.equal(unavailable.kind, "retry");
});

test("rejects an unexpected native-value transfer even when the USDC log matches", async () => {
  const result = await verify({
    client: client({
      async getTransaction() {
        return { from: SENDER, to: ARBITRUM_USDC_ADDRESS, value: 1n };
      }
    })
  });
  assert.deepEqual(result.kind === "review_required" && result.reason, "unexpected_native_value");
});

test("rejects zero-address and USDC-contract treasury configurations", () => {
  assert.throws(
    () => normalizeBillingTreasuryAddress("0x0000000000000000000000000000000000000000"),
    /invalid_treasury_address/
  );
  assert.throws(
    () => normalizeBillingTreasuryAddress(ARBITRUM_USDC_ADDRESS),
    /invalid_treasury_address/
  );
});

test("routes a sender-to-self Treasury payment to manual review without calling RPC", async () => {
  let rpcCalled = false;
  const result = await verify({
    recipientAddress: SENDER,
    client: client({
      async getChainId() {
        rpcCalled = true;
        return ARBITRUM_ONE_CHAIN_ID;
      }
    })
  });
  assert.equal(rpcCalled, false);
  assert.deepEqual(
    result.kind === "review_required" && result.reason,
    "sender_treasury_conflict"
  );
});
