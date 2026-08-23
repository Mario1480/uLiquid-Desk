import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, zeroAddress } from "viem";
import { uliqPaymentCustodyAbi } from "./abi.js";
import type { UliqRuntimeConfig } from "./config.js";
import { UliqTreasuryService } from "./treasury.service.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const PRESALE = "0x2222222222222222222222222222222222222222" as const;
const CUSTODY = "0x3333333333333333333333333333333333333333" as const;
const USDC = "0x4444444444444444444444444444444444444444" as const;
const ACTIVE_TREASURY = "0x5555555555555555555555555555555555555555" as const;
const DESIRED_TREASURY = "0x6666666666666666666666666666666666666666" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

const config = {
  chainId: 421614,
  flags: { enabled: true, presaleEnabled: true, discountsEnabled: false, lockingEnabled: true, adminEnabled: true },
  primaryRpcUrl: "https://primary.example/rpc",
  secondaryRpcUrl: "https://secondary.example/rpc",
  startBlock: 1n,
  confirmations: 12,
  contracts: {
    token: "0x7777777777777777777777777777777777777777",
    presale: PRESALE,
    vesting: "0x8888888888888888888888888888888888888888",
    locker: "0x9999999999999999999999999999999999999999",
    paymentCustody: CUSTODY,
    usdc: USDC
  }
} as UliqRuntimeConfig;

function createDb() {
  let row: any = null;
  return {
    globalSetting: {
      findUnique: async () => row,
      upsert: async ({ create, update }: any) => {
        row = { value: row ? update.value : create.value, updatedAt: new Date("2026-08-23T12:00:00.000Z") };
        return row;
      }
    }
  };
}

function createRpc(state: { pendingTreasury: `0x${string}` }) {
  const client = {
    getBlock: async () => ({ number: 123n, hash: BLOCK_HASH, timestamp: 1_787_418_172n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      const values: Record<string, unknown> = {
        owner: OWNER,
        treasury: ACTIVE_TREASURY,
        pendingTreasury: state.pendingTreasury,
        presale: PRESALE,
        paymentToken: USDC,
        balance: 10_000_000n,
        totalCollected: 30_000_000n,
        totalRefunded: 5_000_000n,
        totalReleased: 15_000_000n,
        paymentCustody: CUSTODY
      };
      if (!(functionName in values)) throw new Error(`unexpected_read_${functionName}`);
      return values[functionName];
    }
  };
  return { primary: client, secondary: client } as any;
}

test("ULIQ treasury service persists a desired wallet and prepares the owner proposal without signing", async () => {
  const db = createDb();
  const rpcState = { pendingTreasury: zeroAddress };
  const service = new UliqTreasuryService(db, config, createRpc(rpcState));
  const state = await service.setDesiredTreasury(DESIRED_TREASURY);
  assert.equal(state.syncStatus, "proposal_required");
  assert.equal(state.integrityStatus, "healthy");

  const prepared = await service.prepareProposal();
  assert.equal(prepared.safeTransaction.expectedSender, OWNER);
  assert.equal(prepared.safeTransaction.to, CUSTODY);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, "signature"), false);
  const decoded = decodeFunctionData({ abi: uliqPaymentCustodyAbi, data: prepared.safeTransaction.data });
  assert.equal(decoded.functionName, "proposeTreasury");
  assert.deepEqual(decoded.args, [DESIRED_TREASURY]);
});

test("ULIQ treasury acceptance must be sent by the proposed treasury", async () => {
  const db = createDb();
  const rpcState = { pendingTreasury: zeroAddress };
  const service = new UliqTreasuryService(db, config, createRpc(rpcState));
  await service.setDesiredTreasury(DESIRED_TREASURY);
  rpcState.pendingTreasury = DESIRED_TREASURY;

  const state = await service.getState();
  assert.equal(state.syncStatus, "acceptance_required");
  const prepared = await service.prepareAcceptance();
  assert.equal(prepared.safeTransaction.expectedSender, DESIRED_TREASURY);
  const decoded = decodeFunctionData({ abi: uliqPaymentCustodyAbi, data: prepared.safeTransaction.data });
  assert.equal(decoded.functionName, "acceptTreasury");
});
