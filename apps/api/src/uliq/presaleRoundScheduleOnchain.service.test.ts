import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeEventTopics } from "viem";
import { uliqPresaleRoundAbi } from "./abi.js";
import type { UliqPublicPresaleConfig } from "./publicPresale.config.js";
import { UliqPresaleRoundScheduleOnchainService } from "./presaleRoundScheduleOnchain.service.js";

const OWNER = "0x0000000000000000000000000000000000000099" as const;
const ROUND_ONE = "0x0000000000000000000000000000000000000011" as const;
const ROUND_TWO = "0x0000000000000000000000000000000000000021" as const;
const BLOCK_HASH = `0x${"2".repeat(64)}` as const;
const START_ONE = "2027-01-10T08:00:00.000Z";
const END_ONE = "2027-01-20T17:00:00.000Z";
const START_TWO = "2027-02-01T08:00:00.000Z";
const END_TWO = "2027-02-20T17:00:00.000Z";

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
    { id: "round-1", number: 1, contractAddress: ROUND_ONE, vestingAddress: "0x0000000000000000000000000000000000000012", paymentCustodyAddress: "0x0000000000000000000000000000000000000013", expected },
    { id: "round-2", number: 2, contractAddress: ROUND_TWO, vestingAddress: "0x0000000000000000000000000000000000000022", paymentCustodyAddress: "0x0000000000000000000000000000000000000023", expected }
  ],
  terms: { version: null, textHash: null, url: "/presale/terms", ready: false }
};

function createDb() {
  const actions: any[] = [];
  return {
    actions,
    globalSetting: {
      async findUnique() {
        return {
          value: {
            version: 3,
            reason: "Approved schedule",
            updatedByUserId: "admin-1",
            rounds: [
              { id: "round-1", saleStart: START_ONE, saleEnd: END_ONE },
              { id: "round-2", saleStart: START_TWO, saleEnd: END_TWO }
            ]
          },
          updatedAt: new Date("2026-12-01T00:00:00.000Z")
        };
      }
    },
    onchainAction: {
      async findFirst() { return null; },
      async findUnique({ where }: any) {
        return actions.find((action) => action.id === where.id) ?? null;
      },
      async upsert({ where, create }: any) {
        const existing = actions.find((action) => action.actionKey === where.actionKey);
        if (existing) return existing;
        const action = { id: `action-${actions.length + 1}`, ...create };
        actions.push(action);
        return action;
      },
      async update({ where, data }: any) {
        const action = actions.find((candidate) => candidate.id === where.id);
        if (!action) throw new Error("action_not_found");
        Object.assign(action, data);
        return action;
      }
    }
  };
}

function createRpc(matchesDraft: boolean) {
  const values = new Map([
    [ROUND_ONE, { start: BigInt(Date.parse(START_ONE) / 1_000), end: BigInt(Date.parse(END_ONE) / 1_000) }],
    [ROUND_TWO, { start: BigInt(Date.parse(START_TWO) / 1_000), end: BigInt(Date.parse(END_TWO) / 1_000) }]
  ]);
  const client = {
    async getBlock() {
      return { number: 100n, hash: BLOCK_HASH, timestamp: 1_700_000_000n };
    },
    async getBytecode() { return "0x6001"; },
    async readContract({ address, functionName }: any) {
      const window = values.get(address as typeof ROUND_ONE)!;
      if (functionName === "owner") return OWNER;
      if (functionName === "state") return 0;
      if (functionName === "saleWindowVersion") return matchesDraft ? 1n : 0n;
      if (functionName === "saleStart") return matchesDraft ? window.start : 0n;
      if (functionName === "saleEnd") return matchesDraft ? window.end : 0n;
      if (functionName === "uliq" || functionName === "token") return config.tokenAddress;
      if (functionName === "usdc" || functionName === "paymentToken") return config.usdcAddress;
      if (functionName === "paymentCustody") return address === ROUND_ONE
        ? config.rounds[0].paymentCustodyAddress
        : config.rounds[1].paymentCustodyAddress;
      if (functionName === "vesting") return address === ROUND_ONE
        ? config.rounds[0].vestingAddress
        : config.rounds[1].vestingAddress;
      if (functionName === "globalListing") return config.globalListingAddress;
      if (functionName === "predecessor") return address === ROUND_ONE
        ? "0x0000000000000000000000000000000000000000"
        : ROUND_ONE;
      if (functionName === "allocationCapUliqRaw" || functionName === "balanceOf") return 1n;
      if (functionName === "presale") return [
        config.rounds[0].vestingAddress,
        config.rounds[0].paymentCustodyAddress
      ].includes(address) ? ROUND_ONE : ROUND_TWO;
      if (functionName === "roundOne") return ROUND_ONE;
      if (functionName === "roundTwo") return ROUND_TWO;
      throw new Error(`unexpected_${functionName}`);
    }
  };
  return { primary: client, secondary: client } as any;
}

test("schedule onchain state reports both matching rounds as BOUND", async () => {
  const service = new UliqPresaleRoundScheduleOnchainService(createDb(), { config, rpc: createRpc(true) });
  const state = await service.getState();
  assert.equal(state.onchainStatus, "BOUND");
  assert.deepEqual(state.rounds.map((round) => round.onchain.bindingStatus), ["BOUND", "BOUND"]);
  assert.equal(state.asOfBlock, "100");
});

test("schedule preparation creates an unsigned version-bound Safe transaction", async () => {
  const db = createDb();
  const service = new UliqPresaleRoundScheduleOnchainService(db, { config, rpc: createRpc(false) });
  const prepared = await service.prepare("round-1", 3);
  const decoded = decodeFunctionData({ abi: uliqPresaleRoundAbi, data: prepared.safeTransaction.data });
  assert.equal(decoded.functionName, "configureSaleWindow");
  assert.deepEqual(decoded.args, [
    0n,
    BigInt(Date.parse(START_ONE) / 1_000),
    BigInt(Date.parse(END_ONE) / 1_000)
  ]);
  assert.equal(prepared.safeTransaction.expectedSender, OWNER);
  assert.equal(Object.prototype.hasOwnProperty.call(prepared, "signature"), false);
  assert.equal(db.actions[0].status, "prepared");
});

test("schedule preparation rejects a stale backend draft version", async () => {
  const service = new UliqPresaleRoundScheduleOnchainService(createDb(), { config, rpc: createRpc(false) });
  await assert.rejects(() => service.prepare("round-1", 2), /schedule_version_stale/);
});

test("schedule preparation fails closed when RPC providers disagree", async () => {
  const rpc = createRpc(false);
  const secondaryRead = rpc.secondary.readContract.bind(rpc.secondary);
  rpc.secondary = {
    ...rpc.secondary,
    async readContract(input: any) {
      if (input.functionName === "saleWindowVersion") return 9n;
      return secondaryRead(input);
    }
  };
  const service = new UliqPresaleRoundScheduleOnchainService(createDb(), { config, rpc });
  await assert.rejects(() => service.prepare("round-1", 3), /schedule_rpc_mismatch/);
});

test("schedule execution is confirmed only after matching receipts, event, and finalized state", async () => {
  const db = createDb();
  const preparationService = new UliqPresaleRoundScheduleOnchainService(db, { config, rpc: createRpc(false) });
  const prepared = await preparationService.prepare("round-1", 3);
  const txHash = `0x${"4".repeat(64)}` as const;
  const receiptBlockHash = `0x${"5".repeat(64)}` as const;
  const start = BigInt(Date.parse(START_ONE) / 1_000);
  const end = BigInt(Date.parse(END_ONE) / 1_000);
  const topics = encodeEventTopics({
    abi: uliqPresaleRoundAbi,
    eventName: "SaleWindowConfigured",
    args: { version: 1n, saleStart: start, saleEnd: end }
  });
  const rpc = createRpc(true);
  const receipt = {
    status: "success",
    blockNumber: 90n,
    blockHash: receiptBlockHash,
    logs: [{ address: ROUND_ONE, data: "0x", topics }]
  };
  rpc.primary.getTransactionReceipt = async () => receipt;
  rpc.secondary.getTransactionReceipt = async () => receipt;

  const service = new UliqPresaleRoundScheduleOnchainService(db, { config, rpc });
  const action = await service.recordExecution(prepared.actionId, txHash);
  assert.equal(action.status, "confirmed");
  assert.equal(action.txHash, txHash);
  assert.equal(action.metadata.confirmedBlockNumber, "90");
});

test("READY preparation verifies bindings and inventory before creating a Safe transaction", async () => {
  const db = createDb();
  const service = new UliqPresaleRoundScheduleOnchainService(db, { config, rpc: createRpc(true) });
  const prepared = await service.prepareMarkReady("round-1", 3);
  const decoded = decodeFunctionData({ abi: uliqPresaleRoundAbi, data: prepared.safeTransaction.data });
  assert.equal(decoded.functionName, "markReady");
  assert.equal(prepared.safeTransaction.expectedSender, OWNER);
  assert.equal(prepared.preflight.custodyBound, true);
  assert.equal(prepared.preflight.vestingBound, true);
  assert.equal(prepared.preflight.listingBound, true);
  assert.equal(db.actions[0].actionType, "uliq_mark_presale_round_ready");
});
