import assert from "node:assert/strict";
import test from "node:test";
import { createHyperliquidApiExpiryReminderJob } from "./hyperliquidApiExpiryReminderJob.js";

test("hyperliquidApiExpiryReminderJob sends once in warning window and marks notice sent", async () => {
  const updates: any[] = [];
  const telegramMessages: string[] = [];
  const emailMessages: string[] = [];
  const now = new Date("2026-03-25T10:00:00.000Z");
  const rotatedAt = new Date("2025-09-29T10:00:00.000Z");

  const db: any = {
    exchangeAccount: {
      findMany: async () => [
        {
          id: "acc_1",
          label: "HL Main",
          exchange: "hyperliquid",
          createdAt: rotatedAt,
          credentialsRotatedAt: rotatedAt,
          credentialsExpiryNoticeSentAt: null,
          user: {
            id: "user_1",
            email: "user_1@example.com"
          }
        }
      ],
      update: async ({ data }: any) => {
        updates.push(data);
        return { ok: true };
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
    const job = createHyperliquidApiExpiryReminderJob(db, {
      resolveTelegramConfig: async () => ({
        botToken: "bot-token",
        chatId: "-100user"
      }),
      sendTelegramMessage: async ({ text }) => {
        telegramMessages.push(String(text));
      },
      sendEmail: async ({ text }) => {
        emailMessages.push(String(text));
        return { ok: true };
      }
    });

    await job.runCycle("manual");

    assert.equal(telegramMessages.length, 1);
    assert.equal(emailMessages.length, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.credentialsExpiryNoticeSentAt instanceof RealDate, true);
  } finally {
    // eslint-disable-next-line no-global-assign
    Date = RealDate;
  }
});

test("hyperliquidApiExpiryReminderJob does not mark notice sent when no channel succeeds", async () => {
  const updates: any[] = [];
  const now = new Date("2026-03-25T10:00:00.000Z");
  const rotatedAt = new Date("2025-09-20T10:00:00.000Z");

  const db: any = {
    exchangeAccount: {
      findMany: async () => [
        {
          id: "acc_1",
          label: "HL Main",
          exchange: "hyperliquid",
          createdAt: rotatedAt,
          credentialsRotatedAt: rotatedAt,
          credentialsExpiryNoticeSentAt: null,
          user: {
            id: "user_1",
            email: "user_1@example.com"
          }
        }
      ],
      update: async ({ data }: any) => {
        updates.push(data);
        return { ok: true };
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
    const job = createHyperliquidApiExpiryReminderJob(db, {
      resolveTelegramConfig: async () => null,
      sendTelegramMessage: async () => undefined,
      sendEmail: async () => ({ ok: false, error: "smtp_not_configured" })
    });

    await job.runCycle("manual");

    assert.equal(updates.length, 0);
    const status = job.getStatus();
    assert.equal(status.lastCandidateCount, 1);
    assert.equal(status.lastNotificationCount, 0);
  } finally {
    // eslint-disable-next-line no-global-assign
    Date = RealDate;
  }
});
