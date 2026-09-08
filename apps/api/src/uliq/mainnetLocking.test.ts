import assert from "node:assert/strict";
import test from "node:test";
import { getUliqFeatureFlags, getUliqRuntimeConfig } from "./config.js";
import { getUliqMainnetLockingConfig, ULIQ_MAINNET_LOCKING_TOKEN } from "./mainnetLocking.config.js";
import { preflightUliqMainnetLocking } from "./mainnetLocking.preflight.js";
import type { UliqRpcPair } from "./rpc.js";

const LOCKER = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const BLOCK_HASH = `0x${"cd".repeat(32)}`;
const env = {
  ULIQ_MAINNET_LOCKING_CHAIN_ID: "42161",
  ULIQ_MAINNET_LOCKING_LOCKER_ADDRESS: LOCKER,
  ULIQ_MAINNET_LOCKING_DEPLOYMENT_TX_HASH: HASH,
  ULIQ_MAINNET_LOCKING_START_BLOCK: "100",
  ULIQ_MAINNET_LOCKING_RPC_PRIMARY_URL: "https://primary.invalid",
  ULIQ_MAINNET_LOCKING_RPC_SECONDARY_URL: "https://secondary.invalid"
};
const config = getUliqMainnetLockingConfig(env);

type Overrides = {
  chainId?: number;
  head?: bigint;
  blockHash?: string;
  receipt?: Record<string, unknown>;
  code?: string;
  reads?: Record<string, unknown>;
};
function client(overrides: Overrides = {}) {
  return {
    async getChainId() { return overrides.chainId ?? 42161; },
    async getBlock(request: { blockNumber?: bigint }) {
      return { number: request.blockNumber ?? overrides.head ?? 110n, hash: overrides.blockHash ?? BLOCK_HASH, timestamp: 1000n };
    },
    async getTransactionReceipt() {
      return { status: "success", transactionHash: HASH, contractAddress: LOCKER, blockNumber: 100n, blockHash: BLOCK_HASH, ...overrides.receipt };
    },
    async getCode(request: { blockNumber: bigint }) {
      assert.equal(request.blockNumber, 110n);
      return overrides.code ?? "0x6000";
    },
    async readContract(request: { functionName: string; blockNumber: bigint }) {
      assert.equal(request.blockNumber, 110n);
      const values: Record<string, unknown> = {
        token: ULIQ_MAINNET_LOCKING_TOKEN, ULIQ_TOKEN: ULIQ_MAINNET_LOCKING_TOKEN,
        CHAIN_ID: 42161n, ONE_MONTH: 32n * 86400n, SIX_MONTHS: 185n * 86400n,
        TWELVE_MONTHS: 367n * 86400n, decimals: 18, totalLocked: 100n, balanceOf: 100n,
        ...overrides.reads
      };
      return values[request.functionName];
    }
  };
}
function pair(primary: Overrides = {}, secondary: Overrides = {}): UliqRpcPair {
  return { primary: client(primary), secondary: client(secondary) } as unknown as UliqRpcPair;
}

test("Mainnet locking configuration is independent and cannot activate legacy features", () => {
  assert.equal(config.tokenAddress, ULIQ_MAINNET_LOCKING_TOKEN);
  assert.equal(config.startBlock, 100n);
  assert.deepEqual(getUliqFeatureFlags(env), {
    enabled: false, presaleEnabled: false, lockingEnabled: false, discountsEnabled: false, adminEnabled: false
  });
  assert.throws(() => getUliqRuntimeConfig({ ULIQ_ENABLED: "true", ULIQ_CHAIN_ID: "42161" }), /uliq_testnet_chain_required/);
});

test("Mainnet locking rejects absent and unsafe configuration", () => {
  const invalid: Array<[string, string]> = [
    ["ULIQ_MAINNET_LOCKING_CHAIN_ID", "421614"],
    ["ULIQ_MAINNET_LOCKING_LOCKER_ADDRESS", "0x" + "0".repeat(40)],
    ["ULIQ_MAINNET_LOCKING_LOCKER_ADDRESS", ULIQ_MAINNET_LOCKING_TOKEN],
    ["ULIQ_MAINNET_LOCKING_DEPLOYMENT_TX_HASH", "0x" + "0".repeat(64)],
    ["ULIQ_MAINNET_LOCKING_START_BLOCK", "0"],
    ["ULIQ_MAINNET_LOCKING_START_BLOCK", "1e2"],
    ["ULIQ_MAINNET_LOCKING_RPC_PRIMARY_URL", "file:///tmp/rpc"],
    ["ULIQ_MAINNET_LOCKING_RPC_SECONDARY_URL", "https://primary.invalid/"]
  ];
  for (const [key, value] of invalid) assert.throws(() => getUliqMainnetLockingConfig({ ...env, [key]: value }), /uliq_mainnet_locking_/);
  for (const key of Object.keys(env)) assert.throws(() => getUliqMainnetLockingConfig({ ...env, [key]: "" }), /uliq_mainnet_locking_/);
});

test("preflight reconciles finalized deployment without claiming audit or activation", async () => {
  const result = await preflightUliqMainnetLocking(config, pair());
  assert.equal(result.status, "deployment_reconciled");
  assert.equal(result.finalizedBlock, "110");
  assert.equal(result.totalLockedRaw, "100");
  assert.equal(result.sourceVerification, "required_separately");
  assert.equal(result.runtimeActivation, "not_performed");
  assert.match(result.runtimeCodeHash, /^0x[0-9a-f]{64}$/);
});

test("preflight rejects wrong chain and RPC disagreement", async () => {
  await assert.rejects(preflightUliqMainnetLocking(config, pair({}, { chainId: 421614 })), /uliq_rpc_chain_mismatch/);
  await assert.rejects(preflightUliqMainnetLocking(config, pair({}, { blockHash: HASH })), /uliq_rpc_finalized_head_mismatch/);
  await assert.rejects(preflightUliqMainnetLocking(config, pair({}, { code: "0x6001" })), /uliq_mainnet_locking_rpc_state_mismatch/);
});

test("preflight waits for finality instead of accepting a fresh receipt", async () => {
  await assert.rejects(preflightUliqMainnetLocking(config, pair({ head: 99n }, { head: 99n })), /deployment_not_finalized/);
});

test("preflight rejects failed, wrong-address, wrong-block and noncanonical receipts", async () => {
  for (const receipt of [
    { status: "reverted" }, { contractAddress: ULIQ_MAINNET_LOCKING_TOKEN }, { contractAddress: null },
    { transactionHash: BLOCK_HASH }, { blockNumber: 99n }, { blockHash: HASH }
  ]) {
    await assert.rejects(preflightUliqMainnetLocking(config, pair({}, { receipt })), /deployment_receipt_mismatch/);
  }
});

test("preflight rejects missing code and incompatible token identity", async () => {
  await assert.rejects(preflightUliqMainnetLocking(config, pair({ code: "0x" })), /code_missing/);
  for (const reads of [{ token: LOCKER }, { ULIQ_TOKEN: LOCKER }, { CHAIN_ID: 421614n }, { decimals: 6 }]) {
    await assert.rejects(preflightUliqMainnetLocking(config, pair({ reads })), /identity_mismatch/);
  }
});

test("preflight rejects altered durations and undercollateralized locking", async () => {
  for (const key of ["ONE_MONTH", "SIX_MONTHS", "TWELVE_MONTHS"]) {
    await assert.rejects(preflightUliqMainnetLocking(config, pair({ reads: { [key]: 30n * 86400n } })), /duration_mismatch/);
  }
  await assert.rejects(preflightUliqMainnetLocking(config, pair({ reads: { balanceOf: 99n } })), /insolvent/);
  const donation = { reads: { balanceOf: 101n } };
  assert.equal((await preflightUliqMainnetLocking(config, pair(donation, donation))).balanceRaw, "101");
});
