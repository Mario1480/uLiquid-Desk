import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";
import { uliqLockerAbi, uliqPresaleAbi, uliqTokenAbi } from "./abi.js";
import type { UliqRuntimeConfig } from "./config.js";
import { UliqPresaleService } from "./presale.service.js";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const WALLET = "0x2222222222222222222222222222222222222222" as const;
const PAYMENT_CUSTODY = "0x3333333333333333333333333333333333333333" as const;
const OWNER = "0x4444444444444444444444444444444444444444" as const;
const TREASURY = "0x5555555555555555555555555555555555555555" as const;
const LEGACY_LOCKER = "0x6666666666666666666666666666666666666666" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

const config: UliqRuntimeConfig = {
  chainId: 421_614,
  flags: {
    enabled: true,
    presaleEnabled: true,
    discountsEnabled: false,
    lockingEnabled: false,
    adminEnabled: true
  },
  primaryRpcUrl: "https://primary.example/rpc",
  secondaryRpcUrl: "https://secondary.example/rpc",
  startBlock: 1n,
  confirmations: 12,
  contracts: {
    token: ADDRESS,
    presale: ADDRESS,
    vesting: ADDRESS,
    locker: ADDRESS,
    paymentCustody: PAYMENT_CUSTODY,
    usdc: ADDRESS
  }
};

function createRpc(saleState: bigint) {
  const client = {
    getBlock: async () => ({ number: 123n, hash: BLOCK_HASH, timestamp: 1_787_418_172n }),
    readContract: async (request: { functionName: string }) => {
      if (request.functionName === "state") return saleState;
      if (request.functionName === "paymentCustody") return PAYMENT_CUSTODY;
      if (request.functionName === "quotePurchase") return [100n, 100_000n] as const;
      throw new Error(`unexpected_read_${request.functionName}`);
    }
  };
  return { primary: client, secondary: client } as any;
}

function createDb() {
  return {
    user: {
      findUnique: async () => ({ walletAddress: WALLET })
    }
  };
}

test("ULIQ rounds endpoint exposes only the configured Round 1", async () => {
  const values: Record<string, bigint> = {
    state: 2n,
    saleStart: 1n,
    saleEnd: 2n,
    withdrawalPeriodSeconds: 3_600n,
    dexLaunchTimestamp: 0n,
    hardCapUsdcRaw: 120_000_000_000n,
    totalRaisedUsdcRaw: 1_000_000n,
    totalSoldUliqRaw: 1_000_000_000_000_000_000n,
    pendingAllocationUliqRaw: 0n,
    pendingPurchaseCount: 0n,
    maximumPurchasableUsdcRaw: 119_999_000_000n,
    balanceOf: 10n
  };
  const client = {
    getBlock: async () => ({ number: 123n, hash: BLOCK_HASH, timestamp: 1_787_418_172n }),
    readContract: async (request: { functionName: string }) => values[request.functionName] ?? 0n
  };
  const service = new UliqPresaleService(createDb(), config, { primary: client, secondary: client } as any);
  const result = await service.getRounds();
  assert.equal(result.currentRoundId, "round-1");
  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0]?.number, 1);
  assert.equal(result.rounds[0]?.purchaseEnabled, true);
});

test("ULIQ purchase quote and preparation remain disabled until the sale is ACTIVE", async () => {
  const ready = new UliqPresaleService(createDb(), config, createRpc(1n));
  await assert.rejects(() => ready.quotePurchase("100"), /uliq_sale_not_active/);
  await assert.rejects(() => ready.preparePurchase({
    userId: "user-1",
    maxUsdcAmountRaw: "100",
    minUliqAllocationRaw: "100000"
  }), /uliq_sale_not_active/);

  const active = new UliqPresaleService(createDb(), config, createRpc(2n));
  const quote = await active.quotePurchase("100");
  assert.equal(quote.acceptedUsdcRaw, "100");
  assert.equal(quote.uliqAllocationRaw, "100000");

  const prepared = await active.preparePurchase({
    userId: "user-1",
    maxUsdcAmountRaw: "100",
    minUliqAllocationRaw: "100000"
  });
  assert.equal(prepared.approval.expectedSender, WALLET.toLowerCase());
  assert.equal(prepared.approval.to, config.contracts.usdc);
  const approval = decodeFunctionData({ abi: uliqTokenAbi, data: prepared.approval.data });
  assert.equal(approval.functionName, "approve");
  assert.deepEqual(approval.args, [PAYMENT_CUSTODY, 100n]);
  assert.equal(prepared.purchase.expectedSender, WALLET.toLowerCase());
  assert.equal(prepared.purchase.to, config.contracts.presale);
});

test("ULIQ lock preparation exposes only 1, 6 and 12 month initial terms", async () => {
  const service = new UliqPresaleService(createDb(), config, createRpc(2n));
  const expected = new Map([
    [32, 32n * 24n * 60n * 60n],
    [185, 185n * 24n * 60n * 60n],
    [367, 367n * 24n * 60n * 60n]
  ]);
  for (const [durationDays, durationSeconds] of expected) {
    const prepared = await service.prepareLock({
      userId: "user-1",
      amountRaw: "1000000000000000000",
      durationDays
    });
    const decoded = decodeFunctionData({ abi: uliqLockerAbi, data: prepared.lock.data });
    assert.equal(decoded.functionName, "lock");
    assert.deepEqual(decoded.args, [1_000_000_000_000_000_000n, durationSeconds]);
  }
  for (const unsupportedDurationDays of [30, 31, 184, 366]) {
    await assert.rejects(
      service.prepareLock({ userId: "user-1", amountRaw: "1", durationDays: unsupportedDurationDays }),
      /unsupported_lock_duration/
    );
  }
});

test("ULIQ lock coverage keeps a transaction buffer for a new monthly term", async () => {
  const asOf = new Date("2026-08-27T14:50:00.000Z");
  const startedAt = new Date(asOf.getTime() - 60 * 60 * 1_000);
  const bufferedUnlockAt = new Date(startedAt.getTime() + 32 * 24 * 60 * 60 * 1_000);
  const legacyUnlockAt = new Date(startedAt.getTime() + 31 * 24 * 60 * 60 * 1_000);
  const client = {
    getBlock: async () => ({
      number: 123n,
      hash: BLOCK_HASH,
      timestamp: BigInt(Math.floor(asOf.getTime() / 1_000))
    }),
    readContract: async (request: { functionName: string }) => {
      if (request.functionName === "lockedBalanceOf") return 200n;
      throw new Error(`unexpected_read_${request.functionName}`);
    }
  };
  const lockRow = (id: string, durationDays: number, unlockAt: Date) => ({
    id,
    chainId: config.chainId,
    contractAddress: config.contracts.locker.toLowerCase(),
    lockIdOnchain: id,
    walletAddress: WALLET.toLowerCase(),
    amountRaw: "100",
    durationDays,
    startAt: startedAt,
    originalUnlockAt: unlockAt,
    unlockAt,
    lastExtendedAt: null,
    extensionCount: 0,
    withdrawnAt: null,
    status: "ACTIVE",
    asOfBlock: 123n,
    blockHash: BLOCK_HASH,
    createdAt: startedAt,
    updatedAt: startedAt
  });
  const db = {
    user: { findUnique: async () => ({ walletAddress: WALLET }) },
    uliqLockPosition: {
      findMany: async () => [
        lockRow("1", 32, bufferedUnlockAt),
        lockRow("2", 31, legacyUnlockAt)
      ]
    }
  };
  const service = new UliqPresaleService(db, config, { primary: client, secondary: client } as any);
  const result = await service.getLocks("user-1");

  assert.equal(result.coverageTerms[0].requiredUntil, "2026-09-27T14:50:00.000Z");
  assert.equal(result.positions[0].remainingCoverageSeconds, 32 * 24 * 60 * 60 - 60 * 60);
  assert.equal(result.positions[0].qualifiesFor["1"], true);
  assert.equal(result.positions[1].qualifiesFor["1"], false);
  assert.equal(result.positions[0].qualifiesFor["6"], false);
  assert.equal(result.positions[0].qualifiesFor["12"], false);
});

test("ULIQ lock extension preparation uses finalized owner/expiry and returns unsigned calldata", async () => {
  const currentUnlockAt = 1_800_000_000n;
  const newUnlockAt = currentUnlockAt + 31n * 24n * 60n * 60n;
  const client = {
    getBlock: async () => ({ number: 123n, hash: BLOCK_HASH, timestamp: 1_787_418_172n }),
    readContract: async (request: { functionName: string }) => {
      if (request.functionName === "locks") return [WALLET, 500n, 1_700_000_000n, currentUnlockAt, false] as const;
      throw new Error(`unexpected_read_${request.functionName}`);
    }
  };
  const service = new UliqPresaleService(createDb(), config, { primary: client, secondary: client } as any);
  const prepared = await service.prepareLockExtension({
    userId: "user-1",
    lockId: "7",
    contractAddress: config.contracts.locker,
    newUnlockAt: newUnlockAt.toString()
  });
  assert.equal(prepared.transaction.expectedSender, WALLET.toLowerCase());
  assert.equal(prepared.asOfBlock, "123");
  const decoded = decodeFunctionData({ abi: uliqLockerAbi, data: prepared.transaction.data });
  assert.equal(decoded.functionName, "extendLock");
  assert.deepEqual(decoded.args, [7n, newUnlockAt]);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, "signature"), false);

  await assert.rejects(
    service.prepareLockExtension({
      userId: "user-1",
      lockId: "7",
      contractAddress: config.contracts.locker,
      newUnlockAt: currentUnlockAt.toString()
    }),
    /lock_expiry_not_increasing/
  );
});

test("ULIQ legacy locks remain visible and transactions target their exact locker", async () => {
  const legacyConfig: UliqRuntimeConfig = { ...config, legacyLockers: [LEGACY_LOCKER] };
  const currentUnlockAt = 1_800_000_000n;
  const readAddresses: string[] = [];
  const client = {
    getBlock: async () => ({ number: 123n, hash: BLOCK_HASH, timestamp: 1_787_418_172n }),
    readContract: async (request: { address: string; functionName: string }) => {
      readAddresses.push(request.address.toLowerCase());
      if (request.functionName === "lockedBalanceOf") {
        return request.address.toLowerCase() === LEGACY_LOCKER.toLowerCase() ? 200n : 100n;
      }
      if (request.functionName === "locks") {
        return [WALLET, 200n, 1_700_000_000n, currentUnlockAt, false] as const;
      }
      throw new Error(`unexpected_read_${request.functionName}`);
    }
  };
  const startedAt = new Date("2026-08-01T00:00:00.000Z");
  const db = {
    user: { findUnique: async () => ({ walletAddress: WALLET }) },
    uliqLockPosition: {
      findMany: async () => [{
        id: "legacy-1",
        chainId: config.chainId,
        contractAddress: LEGACY_LOCKER.toLowerCase(),
        lockIdOnchain: "1",
        walletAddress: WALLET.toLowerCase(),
        amountRaw: "200",
        durationDays: 31,
        startAt: startedAt,
        originalUnlockAt: new Date(Number(currentUnlockAt) * 1_000),
        unlockAt: new Date(Number(currentUnlockAt) * 1_000),
        extensionCount: 0,
        status: "ACTIVE",
        asOfBlock: 123n,
        blockHash: BLOCK_HASH
      }]
    }
  };
  const service = new UliqPresaleService(db, legacyConfig, { primary: client, secondary: client } as any);

  const locks = await service.getLocks("user-1");
  assert.equal(locks.lockedBalanceRaw, "300");
  assert.equal(locks.activeLockerAddress, config.contracts.locker);
  assert.deepEqual(locks.legacyLockerAddresses, [LEGACY_LOCKER]);
  assert.equal(locks.positions[0].contractAddress, LEGACY_LOCKER.toLowerCase());
  assert.ok(readAddresses.includes(config.contracts.locker.toLowerCase()));
  assert.ok(readAddresses.includes(LEGACY_LOCKER.toLowerCase()));

  const preparedUnlock = await service.prepareUnlock({
    userId: "user-1",
    lockId: "1",
    contractAddress: LEGACY_LOCKER
  });
  assert.equal(preparedUnlock.to, LEGACY_LOCKER);
  const decodedUnlock = decodeFunctionData({ abi: uliqLockerAbi, data: preparedUnlock.data });
  assert.equal(decodedUnlock.functionName, "unlock");
  assert.deepEqual(decodedUnlock.args, [1n]);

  await assert.rejects(
    service.prepareUnlock({
      userId: "user-1",
      lockId: "1",
      contractAddress: "0x7777777777777777777777777777777777777777"
    }),
    /invalid_locker_contract_address/
  );
});

function createDexPendingRpc(params: {
  state?: bigint;
  pendingPurchaseCount?: bigint;
  finalizedAllocationUliqRaw?: bigint;
  allocationCapUliqRaw?: bigint;
  inventoryUliqRaw?: bigint;
} = {}) {
  let simulations = 0;
  const values = {
    state: params.state ?? 4n,
    pendingPurchaseCount: params.pendingPurchaseCount ?? 0n,
    finalizedAllocationUliqRaw: params.finalizedAllocationUliqRaw ?? 120_000_000n,
    allocationCapUliqRaw: params.allocationCapUliqRaw ?? 120_000_000n,
    inventoryUliqRaw: params.inventoryUliqRaw ?? 0n
  };
  const client = {
    getBlock: async () => ({ number: 123n, hash: BLOCK_HASH, timestamp: 1_787_418_172n }),
    readContract: async (request: { functionName: string }) => {
      if (request.functionName === "state") return values.state;
      if (request.functionName === "pendingPurchaseCount") return values.pendingPurchaseCount;
      if (request.functionName === "owner") return OWNER;
      if (request.functionName === "paymentCustody") return PAYMENT_CUSTODY;
      if (request.functionName === "treasury") return TREASURY;
      if (request.functionName === "finalizedAllocationUliqRaw") return values.finalizedAllocationUliqRaw;
      if (request.functionName === "allocationCapUliqRaw") return values.allocationCapUliqRaw;
      if (request.functionName === "balanceOf") return values.inventoryUliqRaw;
      throw new Error(`unexpected_read_${request.functionName}`);
    },
    simulateContract: async (request: { functionName: string; account: string }) => {
      simulations += 1;
      assert.equal(request.functionName, "markDexPending");
      assert.equal(request.account, OWNER);
      return { request, result: undefined };
    }
  };
  return {
    rpc: { primary: client, secondary: client } as any,
    simulations: () => simulations
  };
}

test("ULIQ DEX_PENDING preparation uses finalized preflight data and returns unsigned calldata", async () => {
  const mock = createDexPendingRpc();
  const service = new UliqPresaleService(createDb(), config, mock.rpc);
  const prepared = await service.prepareMarkDexPending();

  assert.equal(prepared.safeTransaction.to, config.contracts.presale);
  assert.equal(prepared.safeTransaction.expectedSender, OWNER);
  assert.equal(prepared.safeTransaction.operation, 0);
  assert.equal(prepared.preflight.state, "ENDED");
  assert.equal(prepared.preflight.pendingPurchaseCount, "0");
  assert.equal(prepared.preflight.treasury, TREASURY);
  assert.equal(prepared.preflight.unsoldUliqRaw, "0");
  assert.equal(prepared.preflight.simulation, "success");
  assert.equal(mock.simulations(), 1);

  const decoded = decodeFunctionData({ abi: uliqPresaleAbi, data: prepared.safeTransaction.data });
  assert.equal(decoded.functionName, "markDexPending");
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, "signature"), false);
});

test("ULIQ DEX_PENDING preparation fails closed while purchases remain", async () => {
  const mock = createDexPendingRpc({ pendingPurchaseCount: 1n });
  const service = new UliqPresaleService(createDb(), config, mock.rpc);
  await assert.rejects(() => service.prepareMarkDexPending(), /uliq_pending_purchases_remain/);
  assert.equal(mock.simulations(), 0);
});
