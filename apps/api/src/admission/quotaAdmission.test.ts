import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_BOT_CAPACITY_STATUSES,
  admitBotStart,
  buildActiveBotCapacityWhere,
  buildRealExchangeAccountCapacityWhere,
  createExchangeAccountWithQuota,
  isActiveBotCapacityStatus,
  mutatePredictionScheduleWithQuota
} from "./quotaAdmission.js";

function createSerializedFakeDatabase() {
  const bots = new Map([
    ["bot_1", { id: "bot_1", userId: "user_1", exchange: "bitget", status: "stopped" }],
    ["bot_2", { id: "bot_2", userId: "user_1", exchange: "bitget", status: "stopped" }]
  ]);
  const accounts: Array<{ id: string; userId: string; exchange: string }> = [];
  const predictionStates = new Map([
    ["state_1", { id: "state_1", userId: "user_1", autoScheduleEnabled: false, autoSchedulePaused: false }],
    ["state_2", { id: "state_2", userId: "user_1", autoScheduleEnabled: false, autoSchedulePaused: false }]
  ]);
  const lockKeys: string[] = [];
  const lockQueries: string[] = [];
  const isolationLevels: string[] = [];
  let transactionTail = Promise.resolve();

  const tx = {
    async $queryRaw(query: TemplateStringsArray, lockKey: string) {
      lockKeys.push(lockKey);
      lockQueries.push(query.join("?"));
      return [{ lock_result: "" }];
    },
    bot: {
      async findFirst({ where }: any) {
        const row = bots.get(where.id);
        return row?.userId === where.userId ? { ...row } : null;
      },
      async count({ where }: any) {
        return [...bots.values()].filter((row) => (
          row.userId === where.userId && where.status.in.includes(row.status)
        )).length;
      },
      async update({ where, data }: any) {
        const current = bots.get(where.id)!;
        const updated = { ...current, ...data };
        bots.set(where.id, updated);
        return { ...updated };
      }
    },
    exchangeAccount: {
      async count({ where }: any) {
        return accounts.filter((row) => (
          row.userId === where.userId && row.exchange.toLowerCase() !== "paper"
        )).length;
      },
      async create({ data }: any) {
        const row = { id: `account_${accounts.length + 1}`, ...data };
        accounts.push(row);
        return { ...row };
      }
    },
    predictionState: {
      async findFirst({ where }: any) {
        const row = predictionStates.get(where.id);
        return row?.userId === where.userId ? { ...row } : null;
      },
      async update({ where, data }: any) {
        const current = predictionStates.get(where.id)!;
        const updated = { ...current, ...data };
        predictionStates.set(where.id, updated);
        return { ...updated };
      }
    }
  };

  return {
    bots,
    accounts,
    predictionStates,
    lockKeys,
    lockQueries,
    isolationLevels,
    async $transaction(work: (transaction: typeof tx) => Promise<any>, options: any) {
      isolationLevels.push(String(options?.isolationLevel ?? ""));
      const run = transactionTail.then(() => work(tx));
      transactionTail = run.then(() => undefined, () => undefined);
      return run;
    }
  };
}

test("active bot capacity is defined centrally as exactly running", () => {
  assert.deepEqual(ACTIVE_BOT_CAPACITY_STATUSES, ["running"]);
  assert.equal(isActiveBotCapacityStatus("running"), true);
  for (const status of ["draft", "created", "stopped", "paused", "archived", "error", "RUNNING", null]) {
    assert.equal(isActiveBotCapacityStatus(status), false);
  }
  assert.deepEqual(buildActiveBotCapacityWhere("user_1"), {
    userId: "user_1",
    status: { in: ["running"] }
  });
});

test("two concurrent bot starts with one free slot admit exactly one", async () => {
  const database = createSerializedFakeDatabase();
  const start = (botId: string) => admitBotStart({
    database,
    userId: "user_1",
    botId,
    bypass: false,
    check: async ({ runningBots, alreadyRunning }) => ({
      allowed: alreadyRunning || runningBots < 1,
      reason: "max_running_bots_exceeded"
    }),
    transition: (tx, bot) => tx.bot.update({
      where: { id: bot.id },
      data: { status: "running" }
    })
  });

  const results = await Promise.all([start("bot_1"), start("bot_2")]);
  assert.equal(results.filter((result) => result.outcome === "allowed").length, 1);
  assert.equal(results.filter((result) => result.outcome === "denied").length, 1);
  assert.equal([...database.bots.values()].filter((row) => row.status === "running").length, 1);
  assert.deepEqual(database.isolationLevels, ["ReadCommitted", "ReadCommitted"]);
  assert.deepEqual(database.lockKeys, [
    "quota-admission:bot:user_1",
    "quota-admission:bot:user_1"
  ]);
  assert.deepEqual(database.lockQueries, [
    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text AS lock_result",
    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text AS lock_result"
  ]);
});

test("real exchange account admission excludes paper and serializes concurrent creates", async () => {
  const database = createSerializedFakeDatabase();
  const create = (exchange: string) => createExchangeAccountWithQuota({
    database,
    userId: "user_1",
    exchange,
    resolveLimit: async () => 1,
    create: (tx) => tx.exchangeAccount.create({
      data: { userId: "user_1", exchange }
    })
  });

  const realResults = await Promise.all([create("bitget"), create("hyperliquid")]);
  assert.equal(realResults.filter((result) => result.outcome === "allowed").length, 1);
  assert.equal(realResults.filter((result) => result.outcome === "denied").length, 1);

  const paperResult = await create("paper");
  assert.equal(paperResult.outcome, "allowed");
  if (paperResult.outcome === "allowed") {
    assert.equal(paperResult.counted, false);
    assert.equal(paperResult.usage, 1);
  }
  assert.equal(database.accounts.filter((row) => row.exchange !== "paper").length, 1);
  assert.equal(database.accounts.filter((row) => row.exchange === "paper").length, 1);
  assert.deepEqual(buildRealExchangeAccountCapacityWhere("user_1"), {
    userId: "user_1",
    exchange: { not: "paper", mode: "insensitive" }
  });
});

test("prediction schedule admission serializes each user and quota bucket", async () => {
  const database = createSerializedFakeDatabase();
  const enable = (targetStateId: string) => mutatePredictionScheduleWithQuota({
    database,
    userId: "user_1",
    kind: "ai",
    targetStateId,
    bypass: false,
    enforceLimit: true,
    check: async ({ currentlyEnabled, currentlyPaused }) => {
      const running = [...database.predictionStates.values()].filter((row) => (
        row.autoScheduleEnabled && !row.autoSchedulePaused
      )).length;
      const nextRunning = currentlyEnabled && !currentlyPaused ? running : running + 1;
      return { allowed: nextRunning <= 1, running };
    },
    mutate: (tx) => tx.predictionState.update({
      where: { id: targetStateId },
      data: { autoScheduleEnabled: true, autoSchedulePaused: false }
    })
  });

  const results = await Promise.all([enable("state_1"), enable("state_2")]);
  assert.equal(results.filter((result) => result.outcome === "allowed").length, 1);
  assert.equal(results.filter((result) => result.outcome === "denied").length, 1);
  assert.equal(
    [...database.predictionStates.values()].filter((row) => row.autoScheduleEnabled && !row.autoSchedulePaused).length,
    1
  );
  assert.deepEqual(database.lockKeys, [
    "quota-admission:prediction_ai:user_1",
    "quota-admission:prediction_ai:user_1"
  ]);
  assert.deepEqual(database.lockQueries, [
    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text AS lock_result",
    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text AS lock_result"
  ]);
});
