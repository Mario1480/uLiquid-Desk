import assert from "node:assert/strict";
import test from "node:test";
import {
  PLATFORM_ALERT_RETENTION_SETTING_KEY
} from "../admin/platformAlertRetention.js";
import { createPlatformAlertCleanupJob } from "./platformAlertCleanupJob.js";

test("platformAlertCleanupJob deletes alerts older than 30 days when retention is enabled", async () => {
  const globalSettings = new Map<string, unknown>([
    [PLATFORM_ALERT_RETENTION_SETTING_KEY, { autoDeleteOlderThan30Days: true }]
  ]);
  const deleteCalls: any[] = [];

  const db: any = {
    globalSetting: {
      findUnique: async ({ where }: any) => (
        globalSettings.has(where.key)
          ? { value: globalSettings.get(where.key), updatedAt: new Date("2026-03-25T08:00:00.000Z") }
          : null
      )
    },
    platformAlert: {
      deleteMany: async ({ where }: any) => {
        deleteCalls.push(where);
        return { count: 4 };
      }
    }
  };

  const job = createPlatformAlertCleanupJob(db);
  await job.runCycle("manual");

  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0]?.createdAt?.lt instanceof Date, true);

  const status = job.getStatus();
  assert.equal(status.totalCycles, 1);
  assert.equal(status.totalDeleted, 4);
  assert.equal(status.lastDeletedCount, 4);
  assert.equal(status.lastSkippedDisabledBySetting, false);
});

test("platformAlertCleanupJob skips deletion when retention is disabled", async () => {
  const globalSettings = new Map<string, unknown>([
    [PLATFORM_ALERT_RETENTION_SETTING_KEY, { autoDeleteOlderThan30Days: false }]
  ]);
  let deleteCalled = false;

  const db: any = {
    globalSetting: {
      findUnique: async ({ where }: any) => (
        globalSettings.has(where.key)
          ? { value: globalSettings.get(where.key), updatedAt: new Date("2026-03-25T08:00:00.000Z") }
          : null
      )
    },
    platformAlert: {
      deleteMany: async () => {
        deleteCalled = true;
        return { count: 99 };
      }
    }
  };

  const job = createPlatformAlertCleanupJob(db);
  await job.runCycle("manual");

  assert.equal(deleteCalled, false);
  const status = job.getStatus();
  assert.equal(status.totalCycles, 1);
  assert.equal(status.lastDeletedCount, 0);
  assert.equal(status.lastSkippedDisabledBySetting, true);
});
