import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_HEALTH_STATE_SETTING_KEY,
  createSystemHealthTelegramJob
} from "./systemHealthTelegramJob.js";

function createSnapshot(state: "healthy" | "unhealthy" | "skipped", message: string) {
  const checkedAt = new Date("2026-03-24T10:00:00.000Z").toISOString();
  return {
    ai: { state, message, checkedAt },
    saladRuntime: { state: "skipped" as const, message: "Salad skipped", checkedAt },
    fmp: { state: "skipped" as const, message: "FMP skipped", checkedAt },
    ccpay: { state: "skipped" as const, message: "CCPay skipped", checkedAt }
  };
}

test("systemHealthTelegramJob alerts once on incident and once on recovery", async () => {
  const previousUnhealthyStreak = process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED;
  const previousHealthyStreak = process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED;
  process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED = "1";
  process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED = "1";

  const globalSettings = new Map<string, unknown>();
  const platformAlerts: Array<Record<string, unknown>> = [];
  const telegramMessages: string[] = [];
  let currentSnapshot = createSnapshot("unhealthy", "AI upstream failed");

  const db: any = {
    globalSetting: {
      findUnique: async ({ where }: any) => (
        globalSettings.has(where.key)
          ? { value: globalSettings.get(where.key) }
          : null
      ),
      upsert: async ({ where, create, update }: any) => {
        globalSettings.set(where.key, globalSettings.has(where.key) ? update.value : create.value);
        return { key: where.key, value: globalSettings.get(where.key) };
      }
    },
    platformAlert: {
      findFirst: async ({ where }: any) => (
        platformAlerts.find((alert) => (
          alert.source === where.source
          && alert.type === where.type
          && alert.title === where.title
          && ["open", "acknowledged"].includes(String(alert.status))
        )) ?? null
      ),
      create: async ({ data }: any) => {
        const row = { id: `alert_${platformAlerts.length + 1}`, ...data };
        platformAlerts.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const index = platformAlerts.findIndex((alert) => alert.id === where.id);
        if (index >= 0) {
          platformAlerts[index] = { ...platformAlerts[index], ...data };
        }
        return platformAlerts[index];
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (let index = 0; index < platformAlerts.length; index += 1) {
          const alert = platformAlerts[index];
          if (
            alert.source === where.source
            && alert.type === where.type
            && alert.title === where.title
            && ["open", "acknowledged"].includes(String(alert.status))
          ) {
            platformAlerts[index] = { ...alert, ...data };
            count += 1;
          }
        }
        return { count };
      }
    }
  };

  const job = createSystemHealthTelegramJob(db, {
    externalHealthService: {
      checkAll: async () => currentSnapshot
    },
    resolveSystemTelegramConfig: async () => ({
      botToken: "bot-token",
      telegramChatId: "-100system"
    }),
    sendTelegramMessage: async ({ text }: any) => {
      telegramMessages.push(String(text));
    }
  });

  try {
    await job.runCycle("manual");
    await job.runCycle("manual");

    assert.equal(telegramMessages.length, 1);
    assert.equal(platformAlerts.length, 1);
    assert.equal(platformAlerts[0]?.status, "open");
    assert.equal(globalSettings.has(SYSTEM_HEALTH_STATE_SETTING_KEY), true);

    currentSnapshot = createSnapshot("healthy", "AI connection is healthy.");
    await job.runCycle("manual");

    assert.equal(telegramMessages.length, 2);
    assert.equal(String(telegramMessages[0]).includes("system health alert"), true);
    assert.equal(String(telegramMessages[1]).includes("system health recovered"), true);
    assert.equal(platformAlerts[0]?.status, "resolved");

    const status = job.getStatus();
    assert.equal(status.totalCycles, 3);
    assert.equal(status.totalFailedCycles, 0);
    assert.equal(status.lastTransitionCount, 1);
    assert.equal(status.lastResolvedCount, 1);
  } finally {
    if (previousUnhealthyStreak === undefined) delete process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED;
    else process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED = previousUnhealthyStreak;
    if (previousHealthyStreak === undefined) delete process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED;
    else process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED = previousHealthyStreak;
  }
});

test("systemHealthTelegramJob suppresses single unhealthy blips before alerting", async () => {
  const previousUnhealthyStreak = process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED;
  const previousHealthyStreak = process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED;
  process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED = "2";
  process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED = "2";

  const globalSettings = new Map<string, unknown>();
  const platformAlerts: Array<Record<string, unknown>> = [];
  const telegramMessages: string[] = [];
  let currentSnapshot = createSnapshot("healthy", "ollama connection is healthy.");

  const db: any = {
    globalSetting: {
      findUnique: async ({ where }: any) => (
        globalSettings.has(where.key)
          ? { value: globalSettings.get(where.key) }
          : null
      ),
      upsert: async ({ where, create, update }: any) => {
        globalSettings.set(where.key, globalSettings.has(where.key) ? update.value : create.value);
        return { key: where.key, value: globalSettings.get(where.key) };
      }
    },
    platformAlert: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const row = { id: `alert_${platformAlerts.length + 1}`, ...data };
        platformAlerts.push(row);
        return row;
      },
      update: async () => null,
      updateMany: async () => ({ count: 0 })
    }
  };

  const job = createSystemHealthTelegramJob(db, {
    externalHealthService: {
      checkAll: async () => currentSnapshot
    },
    resolveSystemTelegramConfig: async () => ({
      botToken: "bot-token",
      telegramChatId: "-100system"
    }),
    sendTelegramMessage: async ({ text }: any) => {
      telegramMessages.push(String(text));
    }
  });

  try {
    await job.runCycle("manual");
    currentSnapshot = createSnapshot("unhealthy", "Connection timed out.");
    await job.runCycle("manual");

    assert.equal(telegramMessages.length, 0);
    assert.equal(platformAlerts.length, 0);

    await job.runCycle("manual");

    assert.equal(telegramMessages.length, 1);
    assert.equal(platformAlerts.length, 1);

    currentSnapshot = createSnapshot("healthy", "ollama connection is healthy.");
    await job.runCycle("manual");
    assert.equal(telegramMessages.length, 1);

    await job.runCycle("manual");
    assert.equal(telegramMessages.length, 2);
  } finally {
    if (previousUnhealthyStreak === undefined) delete process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED;
    else process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED = previousUnhealthyStreak;
    if (previousHealthyStreak === undefined) delete process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED;
    else process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED = previousHealthyStreak;
  }
});
