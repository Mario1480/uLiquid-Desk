import assert from "node:assert/strict";
import test from "node:test";
import { createEconomicCalendarDailyTelegramJob } from "./economicCalendarDailyTelegramJob.js";

test("daily economic calendar job delivers due settings and records the local day", async () => {
  const updates: any[] = [];
  const now = new Date("2026-08-12T08:05:00.000Z");
  const row = {
    key: "settings.alerts.dailyEconomicCalendar.v1:user_1",
    value: {
      enabled: true,
      currencies: ["USD"],
      impacts: ["high"],
      sendTimeLocal: "08:00",
      timezoneMode: "manual",
      timezone: "Europe/Berlin",
      lastSentLocalDate: null,
      lastSentAt: null
    }
  };
  const db = {
    globalSetting: {
      findMany: async () => [row],
      upsert: async (input: any) => {
        updates.push(input);
        return input;
      }
    }
  };
  const RealDate = Date;
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate {
    constructor(value?: any) {
      super(value ?? now.toISOString());
    }
    static now() {
      return now.getTime();
    }
  } as DateConstructor;

  try {
    const job = createEconomicCalendarDailyTelegramJob(db, {
      sendDigest: async () => ({
        sent: true,
        eventCount: 2,
        localDate: "2026-08-12"
      })
    });
    await job.runCycle("manual");

    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.update?.value?.lastSentLocalDate, "2026-08-12");
    assert.equal(job.getStatus().lastDeliveredCount, 1);
    assert.equal(job.getStatus().lastDeliveredAt, now.toISOString());
  } finally {
    // eslint-disable-next-line no-global-assign
    Date = RealDate;
  }
});
