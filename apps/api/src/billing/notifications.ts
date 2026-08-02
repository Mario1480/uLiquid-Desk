import { logger } from "../logger.js";

export type SubscriptionReminderMilestone =
  | "ENDS_IN_7_DAYS"
  | "ENDS_IN_3_DAYS"
  | "ENDS_IN_1_DAY"
  | "GRACE_STARTED"
  | "DOWNGRADED_TO_FREE";

export type SubscriptionNotificationChannel = "EMAIL" | "TELEGRAM" | "BOTH";

type NotificationTerm = {
  id: string;
  userId: string;
  subscriptionId: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  graceEndsAt: Date;
  graceEnteredAt?: Date | null;
  expiredAt?: Date | null;
  user: {
    id: string;
    email: string | null;
    emailVerifiedAt: Date | null;
    telegramChatId: string | null;
    subscriptionNotificationPreference?: {
      channel: SubscriptionNotificationChannel;
      locale: string;
    } | null;
  };
};

type NotificationDeliveryChannel = "EMAIL" | "TELEGRAM";

type SubscriptionNotificationDeps = {
  isBillingEnabled(): Promise<boolean>;
  resolveTelegramConfig(userId: string): Promise<{ botToken: string; chatId: string } | null>;
  sendTelegramMessage(params: { botToken: string; chatId: string; text: string }): Promise<void>;
  sendEmail(params: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB_INTERVAL_MS = 60 * 60 * 1000;
const DELIVERY_LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 8;
const NOTIFICATION_TERM_LOOKBACK_MS = 30 * DAY_MS;

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function normalizeLocale(value: unknown): "de" | "en" {
  return value === "de" ? "de" : "en";
}

function defaultChannel(user: NotificationTerm["user"]): SubscriptionNotificationChannel {
  if (typeof user.telegramChatId === "string" && user.telegramChatId.trim()) return "TELEGRAM";
  return "EMAIL";
}

function hasVerifiedEmail(user: NotificationTerm["user"]): boolean {
  return Boolean(
    typeof user.email === "string"
    && user.email.trim()
    && user.emailVerifiedAt
  );
}

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(8, attemptCount - 1));
  return Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** exponent));
}

export function isPermanentTelegramDeliveryError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("chat not found")
    || message.includes("chat_not_found")
    || message.includes("bot was blocked")
    || message.includes("bot_blocked")
    || message.includes("user is deactivated")
    || message.includes("forbidden: bot")
  );
}

function formatTermDate(value: Date, locale: "de" | "en"): string {
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin"
  }).format(value);
}

export function resolveSubscriptionReminderMilestone(
  term: Pick<NotificationTerm, "status" | "endsAt" | "graceEndsAt" | "expiredAt">,
  now = new Date()
): SubscriptionReminderMilestone | null {
  const endsAt = asDate(term.endsAt);
  const graceEndsAt = asDate(term.graceEndsAt);
  const remainingMs = endsAt.getTime() - now.getTime();

  if (remainingMs > 0 && remainingMs <= DAY_MS) return "ENDS_IN_1_DAY";
  if (remainingMs > DAY_MS && remainingMs <= 3 * DAY_MS) return "ENDS_IN_3_DAYS";
  if (remainingMs > 3 * DAY_MS && remainingMs <= 7 * DAY_MS) return "ENDS_IN_7_DAYS";
  if (now.getTime() >= endsAt.getTime() && now.getTime() < graceEndsAt.getTime()) {
    return "GRACE_STARTED";
  }
  if (term.expiredAt && now.getTime() >= asDate(term.expiredAt).getTime()) {
    return "DOWNGRADED_TO_FREE";
  }
  return null;
}

export function buildSubscriptionReminderMessage(params: {
  milestone: SubscriptionReminderMilestone;
  locale: "de" | "en";
  endsAt: Date;
  graceEndsAt: Date;
}): { subject: string; text: string } {
  const end = formatTermDate(params.endsAt, params.locale);
  const graceEnd = formatTermDate(params.graceEndsAt, params.locale);

  if (params.locale === "de") {
    if (params.milestone === "GRACE_STARTED") {
      return {
        subject: "Dein uLiquid Pro-Abo ist in der Karenzzeit",
        text: [
          "Deine bezahlte Laufzeit ist beendet.",
          `Alle Pro- und Add-on-Rechte bleiben noch bis ${graceEnd} aktiv.`,
          "Du kannst die Laufzeit in den Abo-Einstellungen mit USDC auf Arbitrum verlängern."
        ].join("\n\n")
      };
    }
    if (params.milestone === "DOWNGRADED_TO_FREE") {
      return {
        subject: "Dein uLiquid-Abo wurde auf Free gesetzt",
        text: [
          "Die Karenzzeit deines Pro-Abos ist beendet.",
          "Dein Konto verwendet jetzt den Free-Tarif. Du kannst jederzeit in den Abo-Einstellungen erneut Pro buchen."
        ].join("\n\n")
      };
    }
    const days = params.milestone === "ENDS_IN_7_DAYS" ? 7 : params.milestone === "ENDS_IN_3_DAYS" ? 3 : 1;
    return {
      subject: `Dein uLiquid Pro-Abo endet ${days === 1 ? "morgen" : `in ${days} Tagen`}`,
      text: [
        `Deine aktuelle Pro-Laufzeit endet am ${end}.`,
        `Danach bleiben deine Pro- und Add-on-Rechte während der Karenzzeit bis ${graceEnd} aktiv.`,
        "Eine vorzeitige Verlängerung schließt ohne Überschneidung an deine aktuelle Laufzeit an."
      ].join("\n\n")
    };
  }

  if (params.milestone === "GRACE_STARTED") {
    return {
      subject: "Your uLiquid Pro subscription is in its grace period",
      text: [
        "Your paid term has ended.",
        `All Pro and add-on entitlements remain active until ${graceEnd}.`,
        "You can renew with USDC on Arbitrum in Subscription settings."
      ].join("\n\n")
    };
  }
  if (params.milestone === "DOWNGRADED_TO_FREE") {
    return {
      subject: "Your uLiquid subscription was moved to Free",
      text: [
        "The grace period for your Pro subscription has ended.",
        "Your account now uses the Free plan. You can subscribe to Pro again at any time in Subscription settings."
      ].join("\n\n")
    };
  }
  const days = params.milestone === "ENDS_IN_7_DAYS" ? 7 : params.milestone === "ENDS_IN_3_DAYS" ? 3 : 1;
  return {
    subject: `Your uLiquid Pro subscription ends ${days === 1 ? "tomorrow" : `in ${days} days`}`,
    text: [
      `Your current Pro term ends on ${end}.`,
      `Your Pro and add-on entitlements then remain active during the grace period until ${graceEnd}.`,
      "An early renewal starts after your current term, without overlapping it."
    ].join("\n\n")
  };
}

export async function getSubscriptionNotificationPreference(db: any, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      telegramChatId: true,
      subscriptionNotificationPreference: {
        select: { channel: true, locale: true }
      }
    }
  });
  if (!user) throw new Error("user_not_found");
  const channel = user.subscriptionNotificationPreference?.channel ?? defaultChannel(user);
  return {
    channel,
    locale: normalizeLocale(user.subscriptionNotificationPreference?.locale),
    source: user.subscriptionNotificationPreference ? "stored" : "default",
    emailAvailable: hasVerifiedEmail(user),
    telegramAvailable: Boolean(user.telegramChatId)
  };
}

export async function updateSubscriptionNotificationPreference(
  db: any,
  params: { userId: string; channel: SubscriptionNotificationChannel; locale: "de" | "en" }
) {
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      telegramChatId: true
    }
  });
  if (!user) throw new Error("user_not_found");
  const emailAvailable = hasVerifiedEmail(user);
  const telegramAvailable = Boolean(
    typeof user.telegramChatId === "string" && user.telegramChatId.trim()
  );
  if ((params.channel === "EMAIL" || params.channel === "BOTH") && !emailAvailable) {
    throw new Error("notification_email_unavailable");
  }
  if ((params.channel === "TELEGRAM" || params.channel === "BOTH") && !telegramAvailable) {
    throw new Error("notification_telegram_unavailable");
  }
  await db.subscriptionNotificationPreference.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      channel: params.channel,
      locale: params.locale
    },
    update: {
      channel: params.channel,
      locale: params.locale
    }
  });
  return getSubscriptionNotificationPreference(db, params.userId);
}

async function hasScheduledContinuation(db: any, term: NotificationTerm): Promise<boolean> {
  const continuation = await db.subscriptionTerm.findFirst({
    where: {
      id: { not: term.id },
      subscriptionId: term.subscriptionId,
      startsAt: { gte: term.endsAt },
      status: { in: ["SCHEDULED", "ACTIVE", "GRACE"] }
    },
    select: { id: true }
  });
  return Boolean(continuation);
}

async function resolveDeliveryChannels(
  term: NotificationTerm,
  deps: SubscriptionNotificationDeps
): Promise<Array<{
  channel: NotificationDeliveryChannel;
  email?: string;
  telegram?: { botToken: string; chatId: string };
  resolutionError?: string;
}>> {
  const preference = term.user.subscriptionNotificationPreference?.channel ?? defaultChannel(term.user);
  const verifiedEmail = hasVerifiedEmail(term.user) ? String(term.user.email).trim() : null;
  const wantsTelegram = preference === "TELEGRAM" || preference === "BOTH";
  let telegram: { botToken: string; chatId: string } | null = null;
  let telegramResolutionError: string | null = null;
  if (wantsTelegram) {
    try {
      telegram = await deps.resolveTelegramConfig(term.userId);
      if (!telegram) telegramResolutionError = "telegram_destination_unavailable";
    } catch (error) {
      telegramResolutionError = "telegram_configuration_unavailable";
      logger.warn("subscription_reminder_telegram_config_failed", {
        userId: term.userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  const channels: Array<{
    channel: NotificationDeliveryChannel;
    email?: string;
    telegram?: { botToken: string; chatId: string };
    resolutionError?: string;
  }> = [];

  if (preference === "EMAIL" || preference === "BOTH") {
    if (verifiedEmail) channels.push({ channel: "EMAIL", email: verifiedEmail });
    else channels.push({ channel: "EMAIL", resolutionError: "notification_email_unavailable" });
  }
  if (telegram) channels.push({ channel: "TELEGRAM", telegram });
  else if (wantsTelegram && telegramResolutionError) {
    channels.push({ channel: "TELEGRAM", resolutionError: telegramResolutionError });
  }

  // A disconnected Telegram destination falls back to the verified email address.
  if (wantsTelegram && !telegram && verifiedEmail && !channels.some((item) => item.channel === "EMAIL")) {
    channels.push({ channel: "EMAIL", email: verifiedEmail });
  }
  return channels;
}

async function claimDelivery(db: any, params: {
  termId: string;
  milestone: SubscriptionReminderMilestone;
  channel: NotificationDeliveryChannel;
  now: Date;
}): Promise<{ id: string; attemptCount: number } | null> {
  const row = await db.subscriptionNotificationDelivery.upsert({
    where: {
      termId_milestone_channel: {
        termId: params.termId,
        milestone: params.milestone,
        channel: params.channel
      }
    },
    create: {
      termId: params.termId,
      milestone: params.milestone,
      channel: params.channel,
      status: "PENDING"
    },
    update: {}
  });
  if (row.status === "SENT") return null;
  if (row.nextAttemptAt && asDate(row.nextAttemptAt).getTime() > params.now.getTime()) return null;

  const claimed = await db.subscriptionNotificationDelivery.updateMany({
    where: {
      id: row.id,
      status: { in: ["PENDING", "RETRY"] },
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: params.now } }
      ]
    },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
      lockedAt: params.now,
      lastError: null
    }
  });
  if (Number(claimed?.count ?? 0) !== 1) return null;
  return {
    id: row.id,
    attemptCount: Number(row.attemptCount ?? 0) + 1
  };
}

async function deliverMilestone(params: {
  db: any;
  deps: SubscriptionNotificationDeps;
  term: NotificationTerm;
  milestone: SubscriptionReminderMilestone;
  now: Date;
}): Promise<number> {
  const locale = normalizeLocale(params.term.user.subscriptionNotificationPreference?.locale);
  const message = buildSubscriptionReminderMessage({
    milestone: params.milestone,
    locale,
    endsAt: asDate(params.term.endsAt),
    graceEndsAt: asDate(params.term.graceEndsAt)
  });
  const channels = await resolveDeliveryChannels(params.term, params.deps);
  const deliveryTargets = [...channels];
  let sent = 0;

  for (let index = 0; index < deliveryTargets.length; index += 1) {
    const target = deliveryTargets[index]!;
    const claim = await claimDelivery(params.db, {
      termId: params.term.id,
      milestone: params.milestone,
      channel: target.channel,
      now: params.now
    });
    if (!claim) continue;

    let error: string | null = null;
    try {
      if (target.resolutionError) {
        throw new Error(target.resolutionError);
      } else if (target.channel === "EMAIL" && target.email) {
        const result = await params.deps.sendEmail({
          to: target.email,
          subject: message.subject,
          text: message.text
        });
        if (!result.ok) throw new Error(result.error ?? "email_delivery_failed");
      } else if (target.channel === "TELEGRAM" && target.telegram) {
        await params.deps.sendTelegramMessage({
          ...target.telegram,
          text: `${message.subject}\n\n${message.text}`
        });
      } else {
        throw new Error("notification_channel_unavailable");
      }
    } catch (caught) {
      error = String((caught as any)?.message ?? caught).slice(0, 500);
    }

    if (!error) {
      await params.db.subscriptionNotificationDelivery.update({
        where: { id: claim.id },
        data: {
          status: "SENT",
          sentAt: params.now,
          nextAttemptAt: null,
          lockedAt: null,
          lastError: null
        }
      });
      sent += 1;
      continue;
    }

    const telegramUnavailable =
      target.channel === "TELEGRAM"
      && isPermanentTelegramDeliveryError(error);
    const exhausted = telegramUnavailable || claim.attemptCount >= MAX_DELIVERY_ATTEMPTS;
    await params.db.subscriptionNotificationDelivery.update({
      where: { id: claim.id },
      data: {
        status: exhausted ? "FAILED" : "RETRY",
        nextAttemptAt: exhausted
          ? null
          : new Date(params.now.getTime() + retryDelayMs(claim.attemptCount)),
        lockedAt: null,
        lastError: error
      }
    });

    if (telegramUnavailable && hasVerifiedEmail(params.term.user)) {
      const email = String(params.term.user.email).trim();
      if (!deliveryTargets.some((item) => item.channel === "EMAIL")) {
        deliveryTargets.push({ channel: "EMAIL", email });
      }
    }
  }
  return sent;
}

export function createSubscriptionReminderJob(db: any, deps: SubscriptionNotificationDeps) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled", now = new Date()) {
    if (running) return { candidates: 0, sent: 0 };
    running = true;
    let candidates = 0;
    let sent = 0;
    try {
      await db.subscriptionNotificationDelivery.updateMany({
        where: {
          status: "PROCESSING",
          lockedAt: { lte: new Date(now.getTime() - DELIVERY_LOCK_TIMEOUT_MS) }
        },
        data: {
          status: "RETRY",
          lockedAt: null,
          nextAttemptAt: now,
          lastError: "delivery_lock_timeout"
        }
      });

      const pageSize = 500;
      let cursorId: string | null = null;
      while (true) {
        const lookbackStart = new Date(now.getTime() - NOTIFICATION_TERM_LOOKBACK_MS);
        const terms = await db.subscriptionTerm.findMany({
          where: {
            OR: [
              {
                status: { in: ["ACTIVE", "GRACE"] },
                endsAt: {
                  gte: lookbackStart,
                  lte: new Date(now.getTime() + 7 * DAY_MS)
                }
              },
              {
                status: "EXPIRED",
                expiredAt: { gte: lookbackStart, lte: now }
              }
            ]
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                emailVerifiedAt: true,
                telegramChatId: true,
                subscriptionNotificationPreference: {
                  select: { channel: true, locale: true }
                }
              }
            }
          },
          orderBy: [{ endsAt: "desc" }, { id: "asc" }],
          take: pageSize,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
        }) as NotificationTerm[];

        for (const term of terms) {
          try {
            const milestone = resolveSubscriptionReminderMilestone(term, now);
            if (!milestone) continue;
            if (await hasScheduledContinuation(db, term)) continue;
            candidates += 1;
            sent += await deliverMilestone({ db, deps, term, milestone, now });
          } catch (error) {
            logger.warn("subscription_reminder_term_failed", {
              reason,
              termId: term.id,
              userId: term.userId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        if (terms.length < pageSize) break;
        cursorId = terms.at(-1)?.id ?? null;
        if (!cursorId) break;
      }

      logger.info("subscription_reminder_cycle", { reason, candidates, sent });
      return { candidates, sent };
    } catch (error) {
      logger.warn("subscription_reminder_cycle_failed", {
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled").catch(() => undefined);
    }, JOB_INTERVAL_MS);
    void runCycle("startup").catch(() => undefined);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { runCycle, start, stop };
}
