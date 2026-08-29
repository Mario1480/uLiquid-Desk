import assert from "node:assert/strict";
import test from "node:test";
import type { UliqRuntimeConfig } from "./config.js";
import { UliqActivityService } from "./activity.service.js";

const WALLET = "0x2222222222222222222222222222222222222222";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const config: UliqRuntimeConfig = {
  chainId: 421_614,
  flags: { enabled: true, presaleEnabled: true, discountsEnabled: false, lockingEnabled: true, adminEnabled: true },
  primaryRpcUrl: "https://primary.example/rpc",
  secondaryRpcUrl: "https://secondary.example/rpc",
  startBlock: 1n,
  confirmations: 12,
  contracts: { token: ADDRESS, presale: ADDRESS, vesting: ADDRESS, locker: ADDRESS, paymentCustody: ADDRESS, usdc: ADDRESS }
};

test("ULIQ activity is wallet isolated and reports missing timestamps as partial", async () => {
  const timestampedRows = [
    {
      id: "event-2", eventName: "TokensReleased", transactionHash: `0x${"ab".repeat(32)}`,
      blockNumber: 11n, logIndex: 2, blockTimestamp: new Date("2026-08-28T12:00:00.000Z"),
      payload: { beneficiary: WALLET.toUpperCase(), amount: "900" }
    },
    {
      id: "event-other", eventName: "TokensLocked", transactionHash: `0x${"cd".repeat(32)}`,
      blockNumber: 10n, logIndex: 1, blockTimestamp: new Date("2026-08-27T12:00:00.000Z"),
      payload: { owner: ADDRESS, amount: "100" }
    }
  ];
  const db = {
    user: { findUnique: async () => ({ walletAddress: WALLET }) },
    onchainIndexedEvent: {
      findMany: async (query: any) => query.where.blockTimestamp === null
        ? [{ payload: { buyer: WALLET, usdcAmountRaw: "100" } }]
        : timestampedRows
    }
  };
  const result = await new UliqActivityService(db, config).listForUser({ userId: "user-1", limit: 5 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.type, "VESTING_CLAIMED");
  assert.equal(result.items[0]?.amountRaw, "900");
  assert.equal(result.partial, true);
});
