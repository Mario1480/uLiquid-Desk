import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubscriptionReminderMessage,
  createSubscriptionReminderJob,
  getSubscriptionNotificationPreference,
  resolveSubscriptionReminderMilestone,
  updateSubscriptionNotificationPreference
} from "./notifications.js";

const END = new Date("2026-08-20T12:00:00.000Z");
const GRACE_END = new Date("2026-08-23T12:00:00.000Z");

function daysBefore(days: number): Date {
  return new Date(END.getTime() - days * 24 * 60 * 60 * 1000);
}

test("subscription reminder thresholds resolve to 7, 3, 1 day, grace, and downgrade milestones", () => {
  const term = { status: "ACTIVE", endsAt: END, graceEndsAt: GRACE_END, expiredAt: null };
  assert.equal(resolveSubscriptionReminderMilestone(term, daysBefore(6.5)), "ENDS_IN_7_DAYS");
  assert.equal(resolveSubscriptionReminderMilestone(term, daysBefore(2.5)), "ENDS_IN_3_DAYS");
  assert.equal(resolveSubscriptionReminderMilestone(term, daysBefore(0.5)), "ENDS_IN_1_DAY");
  assert.equal(
    resolveSubscriptionReminderMilestone(
      { ...term, status: "GRACE" },
      new Date("2026-08-21T12:00:00.000Z")
    ),
    "GRACE_STARTED"
  );
  assert.equal(
    resolveSubscriptionReminderMilestone(
      { ...term, status: "EXPIRED", expiredAt: GRACE_END },
      new Date("2026-08-23T12:00:01.000Z")
    ),
    "DOWNGRADED_TO_FREE"
  );
  assert.equal(resolveSubscriptionReminderMilestone(term, daysBefore(8)), null);
});

test("subscription reminder text is localized and describes grace entitlements", () => {
  const de = buildSubscriptionReminderMessage({
    milestone: "GRACE_STARTED",
    locale: "de",
    endsAt: END,
    graceEndsAt: GRACE_END
  });
  const en = buildSubscriptionReminderMessage({
    milestone: "DOWNGRADED_TO_FREE",
    locale: "en",
    endsAt: END,
    graceEndsAt: GRACE_END
  });
  assert.match(de.subject, /Karenzzeit/);
  assert.match(de.text, /Pro- und Add-on-Rechte/);
  assert.match(en.subject, /Free/);
  assert.match(en.text, /Free plan/);
});

type Delivery = {
  id: string;
  termId: string;
  milestone: string;
  channel: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lockedAt: Date | null;
  sentAt: Date | null;
  lastError: string | null;
};

function createDb(params: {
  preference?: { channel: "EMAIL" | "TELEGRAM" | "BOTH"; locale: string } | null;
  telegramChatId?: string | null;
}) {
  const user: any = {
    id: "user_1",
    email: "user@example.com",
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    telegramChatId: params.telegramChatId ?? null,
    subscriptionNotificationPreference: params.preference ?? null
  };
  const term: any = {
    id: "term_1",
    userId: user.id,
    subscriptionId: "subscription_1",
    status: "ACTIVE",
    startsAt: new Date("2026-07-20T12:00:00.000Z"),
    endsAt: END,
    graceEndsAt: GRACE_END,
    graceEnteredAt: null,
    expiredAt: null,
    user
  };
  const deliveries: Delivery[] = [];

  const db: any = {
    state: { user, term, deliveries },
    user: {
      findUnique: async ({ where }: any) => where.id === user.id ? user : null
    },
    subscriptionNotificationPreference: {
      upsert: async ({ create, update }: any) => {
        user.subscriptionNotificationPreference = user.subscriptionNotificationPreference
          ? { ...user.subscriptionNotificationPreference, ...update }
          : { channel: create.channel, locale: create.locale };
        return user.subscriptionNotificationPreference;
      }
    },
    subscriptionTerm: {
      findMany: async () => [term],
      findFirst: async () => null
    },
    subscriptionNotificationDelivery: {
      upsert: async ({ where, create }: any) => {
        const key = where.termId_milestone_channel;
        let row = deliveries.find((item) => (
          item.termId === key.termId
          && item.milestone === key.milestone
          && item.channel === key.channel
        ));
        if (!row) {
          row = {
            id: `delivery_${deliveries.length + 1}`,
            termId: create.termId,
            milestone: create.milestone,
            channel: create.channel,
            status: create.status,
            attemptCount: 0,
            nextAttemptAt: null,
            lockedAt: null,
            sentAt: null,
            lastError: null
          };
          deliveries.push(row);
        }
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of deliveries) {
          const statusAllowed = typeof where.status === "string"
            ? row.status === where.status
            : where.status?.in?.includes(row.status) ?? true;
          const idAllowed = where.id ? row.id === where.id : true;
          const retryAllowed = Array.isArray(where.OR)
            ? where.OR.some((entry: any) => (
                entry.nextAttemptAt === null
                  ? row.nextAttemptAt === null
                  : row.nextAttemptAt !== null
                    && row.nextAttemptAt.getTime() <= new Date(entry.nextAttemptAt.lte).getTime()
              ))
            : true;
          const lockAllowed = where.lockedAt?.lte
            ? row.lockedAt !== null && row.lockedAt.getTime() <= new Date(where.lockedAt.lte).getTime()
            : true;
          if (!statusAllowed || !idAllowed || !retryAllowed || !lockAllowed) continue;
          count += 1;
          row.status = data.status ?? row.status;
          if (data.attemptCount?.increment) row.attemptCount += Number(data.attemptCount.increment);
          if ("lockedAt" in data) row.lockedAt = data.lockedAt;
          if ("nextAttemptAt" in data) row.nextAttemptAt = data.nextAttemptAt;
          if ("lastError" in data) row.lastError = data.lastError;
        }
        return { count };
      },
      update: async ({ where, data }: any) => {
        const row = deliveries.find((item) => item.id === where.id);
        if (!row) throw new Error("delivery_not_found");
        Object.assign(row, data);
        return row;
      }
    }
  };
  return db;
}

test("notification preference defaults to Telegram when linked and persists channel plus locale", async () => {
  const db = createDb({ telegramChatId: "12345" });
  const initial = await getSubscriptionNotificationPreference(db, "user_1");
  assert.equal(initial.channel, "TELEGRAM");
  assert.equal(initial.telegramAvailable, true);

  const saved = await updateSubscriptionNotificationPreference(db, {
    userId: "user_1",
    channel: "BOTH",
    locale: "de"
  });
  assert.equal(saved.channel, "BOTH");
  assert.equal(saved.locale, "de");
});

test("notification preferences reject unavailable selected channels", async () => {
  const db = createDb({ telegramChatId: null });
  await assert.rejects(
    updateSubscriptionNotificationPreference(db, {
      userId: "user_1",
      channel: "TELEGRAM",
      locale: "en"
    }),
    /notification_telegram_unavailable/
  );

  db.state.user.emailVerifiedAt = null;
  await assert.rejects(
    updateSubscriptionNotificationPreference(db, {
      userId: "user_1",
      channel: "EMAIL",
      locale: "en"
    }),
    /notification_email_unavailable/
  );
});

test("Telegram loss falls back to verified email and delivery is deduplicated", async () => {
  const db = createDb({
    preference: { channel: "TELEGRAM", locale: "de" },
    telegramChatId: "disconnected"
  });
  const emails: string[] = [];
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => null,
    sendTelegramMessage: async () => {
      throw new Error("unexpected_telegram_send");
    },
    sendEmail: async ({ text }) => {
      emails.push(text);
      return { ok: true };
    }
  });

  const first = await job.runCycle("manual", daysBefore(6.5));
  const second = await job.runCycle("manual", daysBefore(6.4));
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(emails.length, 1);
  assert.equal(db.state.deliveries.find((row: Delivery) => row.channel === "EMAIL")?.status, "SENT");
  assert.equal(db.state.deliveries.find((row: Delivery) => row.channel === "TELEGRAM")?.status, "RETRY");
});

test("a permanently blocked Telegram destination fails once and immediately falls back to verified email", async () => {
  const db = createDb({
    preference: { channel: "TELEGRAM", locale: "en" },
    telegramChatId: "12345"
  });
  let telegramAttempts = 0;
  let emailAttempts = 0;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => ({ botToken: "bot", chatId: "12345" }),
    sendTelegramMessage: async () => {
      telegramAttempts += 1;
      throw new Error("Forbidden: bot was blocked by the user");
    },
    sendEmail: async () => {
      emailAttempts += 1;
      return { ok: true };
    }
  });

  const result = await job.runCycle("manual", daysBefore(2.5));
  assert.equal(result.sent, 1);
  assert.equal(telegramAttempts, 1);
  assert.equal(emailAttempts, 1);
  assert.equal(db.state.deliveries.find((row: Delivery) => row.channel === "TELEGRAM")?.status, "FAILED");
  assert.equal(db.state.deliveries.find((row: Delivery) => row.channel === "EMAIL")?.status, "SENT");
});

test("both channels are logged independently and temporary email errors retry with backoff", async () => {
  const db = createDb({
    preference: { channel: "BOTH", locale: "en" },
    telegramChatId: "12345"
  });
  let emailAttempts = 0;
  let telegramAttempts = 0;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => ({ botToken: "bot", chatId: "12345" }),
    sendTelegramMessage: async () => {
      telegramAttempts += 1;
    },
    sendEmail: async () => {
      emailAttempts += 1;
      return emailAttempts === 1 ? { ok: false, error: "smtp_timeout" } : { ok: true };
    }
  });

  const now = daysBefore(2.5);
  const first = await job.runCycle("manual", now);
  assert.equal(first.sent, 1);
  assert.equal(emailAttempts, 1);
  assert.equal(telegramAttempts, 1);
  assert.equal(db.state.deliveries.find((row: Delivery) => row.channel === "EMAIL")?.status, "RETRY");

  const retry = await job.runCycle("manual", new Date(now.getTime() + 6 * 60 * 1000));
  assert.equal(retry.sent, 1);
  assert.equal(emailAttempts, 2);
  assert.equal(telegramAttempts, 1);
  assert.equal(db.state.deliveries.find((row: Delivery) => row.channel === "EMAIL")?.status, "SENT");
});

test("a Telegram configuration failure cannot suppress verified email delivery", async () => {
  const db = createDb({
    preference: { channel: "BOTH", locale: "en" },
    telegramChatId: "12345"
  });
  let emails = 0;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => {
      throw new Error("telegram_config_unavailable");
    },
    sendTelegramMessage: async () => {
      throw new Error("unexpected_telegram_send");
    },
    sendEmail: async () => {
      emails += 1;
      return { ok: true };
    }
  });

  const result = await job.runCycle("manual", daysBefore(2.5));
  assert.equal(result.sent, 1);
  assert.equal(emails, 1);
  assert.equal(db.state.deliveries.length, 2);
  assert.equal(db.state.deliveries.find((row: Delivery) => row.channel === "EMAIL")?.status, "SENT");
  assert.equal(db.state.deliveries.find((row: Delivery) => row.channel === "TELEGRAM")?.status, "RETRY");
  assert.equal(
    db.state.deliveries.find((row: Delivery) => row.channel === "TELEGRAM")?.lastError,
    "telegram_configuration_unavailable"
  );
});

test("channel drift without a fallback is persisted as a retryable delivery", async () => {
  const db = createDb({
    preference: { channel: "TELEGRAM", locale: "en" },
    telegramChatId: null
  });
  db.state.user.emailVerifiedAt = null;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => null,
    sendTelegramMessage: async () => {
      throw new Error("unexpected_telegram_send");
    },
    sendEmail: async () => {
      throw new Error("unexpected_email_send");
    }
  });

  const result = await job.runCycle("manual", daysBefore(0.5));
  assert.equal(result.sent, 0);
  assert.equal(db.state.deliveries.length, 1);
  assert.equal(db.state.deliveries[0]?.channel, "TELEGRAM");
  assert.equal(db.state.deliveries[0]?.status, "RETRY");
  assert.equal(db.state.deliveries[0]?.lastError, "telegram_destination_unavailable");
});

test("lost email verification is persisted as a retryable delivery", async () => {
  const db = createDb({
    preference: { channel: "EMAIL", locale: "en" },
    telegramChatId: null
  });
  db.state.user.emailVerifiedAt = null;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => null,
    sendTelegramMessage: async () => undefined,
    sendEmail: async () => {
      throw new Error("unexpected_email_send");
    }
  });

  const result = await job.runCycle("manual", daysBefore(0.5));
  assert.equal(result.sent, 0);
  assert.equal(db.state.deliveries.length, 1);
  assert.equal(db.state.deliveries[0]?.channel, "EMAIL");
  assert.equal(db.state.deliveries[0]?.status, "RETRY");
  assert.equal(db.state.deliveries[0]?.lastError, "notification_email_unavailable");
});

test("a scheduled continuation suppresses end-of-term reminders", async () => {
  const db = createDb({ preference: { channel: "EMAIL", locale: "en" } });
  db.subscriptionTerm.findFirst = async () => ({ id: "term_2" });
  let sends = 0;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => null,
    sendTelegramMessage: async () => undefined,
    sendEmail: async () => {
      sends += 1;
      return { ok: true };
    }
  });
  const result = await job.runCycle("manual", daysBefore(0.5));
  assert.equal(result.candidates, 0);
  assert.equal(result.sent, 0);
  assert.equal(sends, 0);
});

test("checkout disablement does not suppress already owed expiry reminders", async () => {
  const db = createDb({ preference: { channel: "EMAIL", locale: "en" } });
  let sends = 0;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => false,
    resolveTelegramConfig: async () => null,
    sendTelegramMessage: async () => undefined,
    sendEmail: async () => {
      sends += 1;
      return { ok: true };
    }
  });
  const result = await job.runCycle("manual", daysBefore(6.5));
  assert.equal(result.sent, 1);
  assert.equal(sends, 1);
});

test("one poisoned notification term cannot block later users", async () => {
  const db = createDb({ preference: { channel: "EMAIL", locale: "en" } });
  const healthy = db.state.term;
  const poisoned = {
    ...healthy,
    id: "term_poisoned",
    userId: "user_poisoned",
    subscriptionId: "subscription_poisoned",
    user: {
      ...healthy.user,
      id: "user_poisoned",
      telegramChatId: "12345",
      subscriptionNotificationPreference: { channel: "TELEGRAM", locale: "en" }
    }
  };
  db.subscriptionTerm.findMany = async () => [poisoned, healthy];
  db.subscriptionTerm.findFirst = async ({ where }: any) => {
    if (where.subscriptionId === poisoned.subscriptionId) {
      throw new Error("corrupt continuation row");
    }
    return null;
  };
  let emails = 0;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => null,
    sendTelegramMessage: async () => undefined,
    sendEmail: async () => {
      emails += 1;
      return { ok: true };
    }
  });
  const result = await job.runCycle("manual", daysBefore(6.5));
  assert.equal(result.sent, 1);
  assert.equal(emails, 1);
});

test("notification pagination reaches candidates after the first 2000 terms", async () => {
  const db = createDb({ preference: { channel: "EMAIL", locale: "en" } });
  const base = db.state.term;
  const terms = Array.from({ length: 2_001 }, (_, index) => ({
    ...base,
    id: `term_${String(index).padStart(4, "0")}`,
    userId: `user_${index}`,
    subscriptionId: `subscription_${index}`,
    user: { ...base.user, id: `user_${index}` }
  }));
  let pages = 0;
  db.subscriptionTerm.findMany = async ({ cursor, take }: any) => {
    pages += 1;
    const start = cursor
      ? terms.findIndex((term) => term.id === cursor.id) + 1
      : 0;
    return terms.slice(start, start + take);
  };
  db.subscriptionTerm.findFirst = async ({ where }: any) => (
    where.subscriptionId === "subscription_2000" ? null : { id: "scheduled_continuation" }
  );
  let emails = 0;
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => null,
    sendTelegramMessage: async () => undefined,
    sendEmail: async () => {
      emails += 1;
      return { ok: true };
    }
  });
  const result = await job.runCycle("manual", daysBefore(6.5));
  assert.equal(pages, 5);
  assert.equal(result.sent, 1);
  assert.equal(emails, 1);
});

test("notification scans bound historical active and expired terms", async () => {
  const db = createDb({ preference: { channel: "EMAIL", locale: "en" } });
  let observedWhere: any = null;
  db.subscriptionTerm.findMany = async ({ where }: any) => {
    observedWhere = where;
    return [];
  };
  const job = createSubscriptionReminderJob(db, {
    isBillingEnabled: async () => true,
    resolveTelegramConfig: async () => null,
    sendTelegramMessage: async () => undefined,
    sendEmail: async () => ({ ok: true })
  });
  const now = new Date("2026-08-20T12:00:00.000Z");
  await job.runCycle("manual", now);

  const expectedLookback = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  assert.equal(new Date(observedWhere.OR[0].endsAt.gte).getTime(), expectedLookback);
  assert.equal(new Date(observedWhere.OR[1].expiredAt.gte).getTime(), expectedLookback);
});
