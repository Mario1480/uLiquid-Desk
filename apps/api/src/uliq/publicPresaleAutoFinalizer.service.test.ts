import assert from "node:assert/strict";
import test from "node:test";
import type { UliqPublicPresaleConfig } from "./publicPresale.config.js";
import {
  getUliqPublicPresaleAutoFinalizerSettings,
  UliqPublicPresaleAutoFinalizerService,
  type UliqPublicPresaleAutoFinalizerSettings
} from "./publicPresaleAutoFinalizer.service.js";

const ROUND_ONE = "0x0000000000000000000000000000000000000011" as const;
const ROUND_TWO = "0x0000000000000000000000000000000000000021" as const;
const BLOCK_HASH = `0x${"2".repeat(64)}` as const;

const expected = {
  allocationUliqRaw: 1n,
  priceUsdcRawPerUliq: 1n,
  hardCapUsdcRaw: 1n,
  minPurchaseUsdcRaw: 1n,
  maxPurchaseUsdcRaw: 1n,
  initialUnlockBps: 1n,
  cliffSeconds: 1n,
  linearVestingDurationSeconds: 1n
};

const config: UliqPublicPresaleConfig = {
  enabled: true,
  purchasesEnabled: false,
  chainId: 42161,
  startBlock: 1n,
  primaryRpcUrl: "https://primary.invalid/",
  secondaryRpcUrl: "https://secondary.invalid/",
  tokenAddress: "0x0000000000000000000000000000000000000001",
  usdcAddress: "0x0000000000000000000000000000000000000002",
  globalListingAddress: "0x0000000000000000000000000000000000000003",
  explorerUrl: "https://arbiscan.io",
  rounds: [
    {
      id: "round-1",
      number: 1,
      contractAddress: ROUND_ONE,
      vestingAddress: "0x0000000000000000000000000000000000000012",
      paymentCustodyAddress: "0x0000000000000000000000000000000000000013",
      inventorySourceAddress: "0x0000000000000000000000000000000000000099",
      expected
    },
    {
      id: "round-2",
      number: 2,
      contractAddress: ROUND_TWO,
      vestingAddress: "0x0000000000000000000000000000000000000022",
      paymentCustodyAddress: "0x0000000000000000000000000000000000000023",
      inventorySourceAddress: "0x0000000000000000000000000000000000000099",
      expected
    }
  ],
  terms: { version: null, textHash: null, url: "/presale/terms", ready: false }
};

function settings(mode: UliqPublicPresaleAutoFinalizerSettings["mode"]): UliqPublicPresaleAutoFinalizerSettings {
  return {
    mode,
    intervalMs: 900_000,
    drainIntervalMs: 5_000,
    batchSize: 25,
    retryBaseMs: 60_000,
    retryMaxMs: 1_800_000,
    submissionStaleMs: 1_800_000
  };
}

test("public Presale finalizer defaults to OFF with a 15 minute interval", () => {
  const result = getUliqPublicPresaleAutoFinalizerSettings({});
  assert.equal(result.mode, "OFF");
  assert.equal(result.intervalMs, 900_000);
  assert.equal(result.drainIntervalMs, 5_000);
  assert.equal(result.batchSize, 25);
});

test("public Presale finalizer remains fail-closed in OFF mode", async () => {
  let calls = 0;
  const service = new UliqPublicPresaleAutoFinalizerService({}, {
    config,
    settings: settings("OFF"),
    createRoundService: () => ({ async runOnce() { calls += 1; return {}; } })
  });
  assert.deepEqual(await service.runOnce(), { mode: "OFF", enabled: false, hasMore: false });
  assert.equal(calls, 0);
});

test("OBSERVE mode reports eligible purchases without creating actions", async () => {
  const queries: string[] = [];
  const db = {
    uliqPresalePurchase: {
      async findMany({ where }: any) {
        queries.push(where.presaleContractAddress);
        return where.presaleContractAddress === ROUND_ONE ? [{ id: "one" }] : [];
      }
    }
  };
  const rpc = {
    primary: { async getBlock() { return { number: 100n, hash: BLOCK_HASH, timestamp: 200n }; } },
    secondary: { async getBlock() { return { number: 100n, hash: BLOCK_HASH, timestamp: 200n }; } }
  } as any;
  const service = new UliqPublicPresaleAutoFinalizerService(db, {
    config,
    settings: settings("OBSERVE"),
    rpc,
    createRoundService: () => ({ async runOnce() { throw new Error("unexpected"); } })
  });
  const result: any = await service.runOnce();
  assert.equal(result.mode, "OBSERVE");
  assert.deepEqual(result.rounds, [
    { roundId: "round-1", eligible: 1 },
    { roundId: "round-2", eligible: 0 }
  ]);
  assert.deepEqual(queries, [ROUND_ONE, ROUND_TWO]);
});

test("ACTIVE mode runs both isolated rounds and requests an immediate drain when needed", async () => {
  const calls: string[] = [];
  const service = new UliqPublicPresaleAutoFinalizerService({}, {
    config,
    settings: settings("ACTIVE"),
    privateKey: `0x${"1".repeat(64)}`,
    createRoundService: (roundAddress) => ({
      async runOnce() {
        calls.push(roundAddress);
        return { enabled: true, submitted: 25, hasMore: roundAddress === ROUND_ONE };
      }
    })
  });
  const result: any = await service.runOnce();
  assert.equal(result.mode, "ACTIVE");
  assert.equal(result.hasMore, true);
  assert.deepEqual(calls, [ROUND_ONE, ROUND_TWO]);
});

test("public Presale finalizer rejects unsafe mode and interval settings", () => {
  assert.throws(
    () => getUliqPublicPresaleAutoFinalizerSettings({ ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_MODE: "invalid" }),
    /invalid_mode/
  );
  assert.throws(
    () => getUliqPublicPresaleAutoFinalizerSettings({ ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_INTERVAL_SECONDS: "59" }),
    /invalid_interval_seconds/
  );
});
