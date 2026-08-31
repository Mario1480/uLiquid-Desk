import assert from "node:assert/strict";
import test from "node:test";
import {
  isUliqPresaleScheduleValid,
  presaleScheduleIsoToLocalValue,
  presaleScheduleLocalValueToIso
} from "./presaleSchedule";

test("presale schedule date-time conversion preserves the represented instant", () => {
  const iso = "2027-01-10T08:30:00.000Z";
  const local = presaleScheduleIsoToLocalValue(iso);
  assert.equal(presaleScheduleLocalValueToIso(local), iso);
});

test("presale schedule requires both rounds and an end after each start", () => {
  const now = new Date("2027-01-01T00:00:00.000Z").getTime();
  assert.equal(isUliqPresaleScheduleValid([
    { id: "round-1", saleStart: "2027-01-10T09:00", saleEnd: "2027-01-20T18:00" },
    { id: "round-2", saleStart: "2027-02-01T09:00", saleEnd: "2027-02-20T18:00" }
  ], now), true);
  assert.equal(isUliqPresaleScheduleValid([
    { id: "round-1", saleStart: "2027-01-20T18:00", saleEnd: "2027-01-10T09:00" },
    { id: "round-2", saleStart: "2027-02-01T09:00", saleEnd: "2027-02-20T18:00" }
  ], now), false);
});

test("presale schedule rejects a past end and invalid local input", () => {
  assert.equal(isUliqPresaleScheduleValid([
    { id: "round-1", saleStart: "2026-01-10T09:00", saleEnd: "2026-01-20T18:00" },
    { id: "round-2", saleStart: "2026-02-01T09:00", saleEnd: "2026-02-20T18:00" }
  ], new Date("2027-01-01T00:00:00.000Z").getTime()), false);
  assert.throws(() => presaleScheduleLocalValueToIso("not-a-date"), /invalid_presale_schedule/);
});
