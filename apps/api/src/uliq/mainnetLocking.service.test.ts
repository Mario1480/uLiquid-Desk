import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";
import { uliqLockerAbi, uliqTokenAbi } from "./abi.js";
import { UliqMainnetLockingService } from "./mainnetLocking.service.js";
import { getUliqMainnetLockingFlags, mainnetLockingCursorId, ULIQ_MAINNET_LOCKING_TOKEN } from "./mainnetLocking.config.js";
import { createMainnetLockingReadiness } from "./mainnetLocking.runtime.js";

const wallet = "0x1111111111111111111111111111111111111111";
const locker = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}`;
const config = { chainId: 42161 as const, tokenAddress: ULIQ_MAINNET_LOCKING_TOKEN, lockerAddress: locker as `0x${string}`, deploymentTransactionHash: hash as `0x${string}`, startBlock: 100n, primaryRpcUrl: "https://one.invalid", secondaryRpcUrl: "https://two.invalid" };

function fixture(options: { owner?: string; withdrawn?: boolean; expiry?: bigint; balance?: bigint; noWallet?: boolean; disagreement?: boolean; failReady?: boolean } = {}) {
  const queries: any[] = [];
  const db = {
    user: { findUnique: async () => ({ walletAddress: options.noWallet ? null : wallet }) },
    onchainSyncCursor: { findUnique: async (query: any) => { assert.equal(query.where.id, mainnetLockingCursorId(config)); return { lastProcessedBlock: 109n, lastProcessedBlockHash: hash }; } },
    uliqLockPosition: { findMany: async (query: any) => { queries.push(query); return [{ lockIdOnchain: "9007199254740993" }]; } }
  };
  const clients = [0,1].map(source => ({
    getBlock: async ({ blockNumber }: any) => ({ number: blockNumber ?? 110n, hash, timestamp: 1000n }),
    readContract: async ({ functionName, blockNumber, address }: any) => {
      assert.equal(blockNumber, 110n);
      assert.ok([locker, ULIQ_MAINNET_LOCKING_TOKEN].includes(address));
      if (functionName === "balanceOf") return options.disagreement && source ? 999n : options.balance ?? 100n;
      if (functionName === "lockedBalanceOf") return 50n;
      return [options.owner ?? wallet, 50n, 1n, options.expiry ?? 1000n, options.withdrawn ?? false];
    }
  }));
  const service = new UliqMainnetLockingService(db, config, { primary: clients[0], secondary: clients[1] } as any, async () => { if (options.failReady) throw new Error("not_verified"); });
  return { service, queries };
}
async function flags(values: Record<string, string>, run: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  Object.assign(process.env, values);
  try { await run(); } finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

test("Mainnet feature switches fail closed and keep withdrawals independent of deposits", async () => {
  assert.deepEqual(getUliqMainnetLockingFlags({}), { enabled: false, depositsEnabled: false, extensionsEnabled: false, indexerEnabled: false });
  await flags({ ULIQ_MAINNET_LOCKING_ENABLED: "true", ULIQ_MAINNET_LOCKING_DEPOSITS_ENABLED: "false", ULIQ_MAINNET_LOCKING_EXTENSIONS_ENABLED: "false" }, async () => {
    const f = fixture();
    await assert.rejects(f.service.prepareLock("user", "1", 32), /deposits_disabled/);
    await assert.rejects(f.service.preparePosition("user", "1", locker, "1100"), /extensions_disabled/);
    const tx = await f.service.preparePosition("user", "1", locker);
    assert.equal(tx.chainId, 42161); assert.equal(tx.expectedSender, wallet); assert.equal(tx.to, locker);
    assert.equal(decodeFunctionData({ abi: uliqLockerAbi, data: tx.data }).functionName, "unlock");
  });
});

test("lock preparation validates balance and produces an exact approval for the configured locker", async () => {
  await flags({ ULIQ_MAINNET_LOCKING_ENABLED: "true", ULIQ_MAINNET_LOCKING_DEPOSITS_ENABLED: "true" }, async () => {
    const f = fixture();
    const result = await f.service.prepareLock("user", "75", 185);
    assert.equal(result.approval.to, ULIQ_MAINNET_LOCKING_TOKEN);
    assert.deepEqual(decodeFunctionData({ abi: uliqTokenAbi, data: result.approval.data }).args, [locker, 75n]);
    assert.deepEqual(decodeFunctionData({ abi: uliqLockerAbi, data: result.transaction.data }).args, [75n, 185n * 86400n]);
    for (const amount of ["0", "101", "-1", "1.2", (1n << 256n).toString()]) await assert.rejects(f.service.prepareLock("user", amount, 32));
    await assert.rejects(f.service.prepareLock("user", "1", 30), /unsupported_lock_duration/);
    await assert.rejects(fixture({ disagreement: true }).service.prepareLock("user", "1", 32), /rpc_state_mismatch/);
    await assert.rejects(fixture({ failReady: true }).service.prepareLock("user", "1", 32), /not_verified/);
  });
});

test("withdrawals reject another locker, wallet, an active lock and a second withdrawal", async () => {
  await assert.rejects(fixture().service.preparePosition("user", "1", wallet), /invalid_locker/);
  await assert.rejects(fixture({ owner: locker }).service.preparePosition("user", "1", locker), /lock_wallet_mismatch/);
  await assert.rejects(fixture({ expiry: 1001n }).service.preparePosition("user", "1", locker), /lock_still_active/);
  await assert.rejects(fixture({ withdrawn: true }).service.preparePosition("user", "1", locker), /lock_already_withdrawn/);
  await assert.rejects(fixture({ noWallet: true }).service.preparePosition("user", "1", locker), /wallet_not_linked/);
});

test("extension requires a strictly increasing uint64 expiry", async () => {
  await flags({ ULIQ_MAINNET_LOCKING_ENABLED: "true", ULIQ_MAINNET_LOCKING_EXTENSIONS_ENABLED: "true" }, async () => {
    const f = fixture();
    for (const expiry of ["999", "1000", (1n << 64n).toString()]) await assert.rejects(f.service.preparePosition("user", "1", locker, expiry));
    const tx = await f.service.preparePosition("user", "1", locker, "1001");
    assert.deepEqual(decodeFunctionData({ abi: uliqLockerAbi, data: tx.data }).args, [1n, 1001n]);
  });
});

test("position reads scope chain, contract and wallet, retain uint256 IDs and expose indexer lag", async () => {
  const f = fixture();
  const state = await f.service.getForUser("user", "9007199254740994");
  assert.deepEqual(f.queries[0].where, { chainId: 42161, contractAddress: locker, walletAddress: wallet, lockIdOnchain: { lt: "9007199254740994" } });
  assert.equal(state.positions[0].lockId, "9007199254740993");
  assert.equal(state.positions[0].canUnlock, true); assert.equal(state.partial, true);
  assert.equal(state.balanceRaw, "100"); assert.equal(state.lockedBalanceRaw, "50");
});

test("runtime refuses to trust getter identity without a reviewed bytecode hash", async () => {
  await assert.rejects(createMainnetLockingReadiness(config, {} as any)(), /verified_code_hash_required/);
});
