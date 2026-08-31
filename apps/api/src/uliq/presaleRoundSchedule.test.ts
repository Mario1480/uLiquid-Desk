import assert from "node:assert/strict";
import test from "node:test";
import {
  getUliqPresaleRoundSchedule,
  saveUliqPresaleRoundSchedule
} from "./presaleRoundSchedule.js";

function memoryDatabase(initialValue?: unknown) {
  let row = initialValue === undefined
    ? null
    : { value: initialValue, updatedAt: new Date("2026-09-01T08:00:00.000Z") };
  return {
    globalSetting: {
      findUnique: async () => row,
      upsert: async ({ create, update }: any) => {
        row = {
          value: row ? update.value : create.value,
          updatedAt: new Date("2026-09-01T09:00:00.000Z")
        };
        return row;
      }
    }
  };
}

test("presale schedule exposes the accepted fixed parameters before dates are configured", async () => {
  const schedule = await getUliqPresaleRoundSchedule(memoryDatabase());

  assert.equal(schedule.status, "NOT_CONFIGURED");
  assert.equal(schedule.onchainStatus, "NOT_BOUND");
  assert.equal(schedule.rounds[0].allocationUliq, "50000000");
  assert.equal(schedule.rounds[0].priceUsdcPerUliq, "0.002");
  assert.equal(schedule.rounds[0].hardCapUsdc, "100000");
  assert.equal(schedule.rounds[0].minPurchaseUsdc, "500");
  assert.equal(schedule.rounds[0].maxPurchaseUsdc, "10000");
  assert.equal(schedule.rounds[1].allocationUliq, "100000000");
  assert.equal(schedule.rounds[1].priceUsdcPerUliq, "0.0035");
  assert.equal(schedule.rounds[1].hardCapUsdc, "350000");
  assert.equal(schedule.rounds[1].minPurchaseUsdc, "100");
  assert.equal(schedule.rounds[1].maxPurchaseUsdc, "5000");
});

test("presale schedule save normalizes timestamps and increments its backend version", async () => {
  const db = memoryDatabase();
  const rounds = [
    { id: "round-1" as const, saleStart: "2027-01-10T09:00:00+01:00", saleEnd: "2027-01-20T18:00:00+01:00" },
    { id: "round-2" as const, saleStart: "2027-02-01T09:00:00+01:00", saleEnd: "2027-02-20T18:00:00+01:00" }
  ];

  const first = await saveUliqPresaleRoundSchedule({
    db,
    rounds,
    reason: "Initial schedule",
    actorUserId: "admin-1"
  });
  const second = await saveUliqPresaleRoundSchedule({
    db,
    rounds,
    reason: "Confirmed schedule",
    actorUserId: "admin-1"
  });

  assert.equal(first.version, 1);
  assert.equal(first.status, "DRAFT_CONFIGURED");
  assert.equal(first.rounds[0].saleStart, "2027-01-10T08:00:00.000Z");
  assert.equal(second.version, 2);
  assert.equal(second.rounds[1].saleEnd, "2027-02-20T17:00:00.000Z");
});

test("presale schedule reports malformed stored data without using it", async () => {
  const schedule = await getUliqPresaleRoundSchedule(memoryDatabase({
    version: 3,
    rounds: [{ id: "round-1", saleStart: "invalid", saleEnd: "invalid" }]
  }));

  assert.equal(schedule.status, "INVALID");
  assert.equal(schedule.version, 0);
  assert.equal(schedule.rounds[0].saleStart, null);
  assert.equal(schedule.rounds[1].saleEnd, null);
});
