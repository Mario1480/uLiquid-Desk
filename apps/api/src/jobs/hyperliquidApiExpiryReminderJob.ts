import { logger } from "../logger.js";
import {
  deriveHyperliquidCredentialExpiryState,
  HYPERLIQUID_CREDENTIAL_ROTATION_DAYS,
  HYPERLIQUID_CREDENTIAL_WARNING_DAYS,
  shouldSendHyperliquidCredentialExpiryReminder
} from "../exchange-accounts/hyperliquidCredentialExpiry.js";

const HYPERLIQUID_API_EXPIRY_REMINDER_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.HYPERLIQUID_API_EXPIRY_REMINDER_ENABLED ?? "1").trim().toLowerCase()
);
const HYPERLIQUID_API_EXPIRY_REMINDER_POLL_MS =
  Math.max(3600, Number(process.env.HYPERLIQUID_API_EXPIRY_REMINDER_INTERVAL_SECONDS ?? "86400")) * 1000;

export type HyperliquidApiExpiryReminderJobStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  totalCycles: number;
  totalCandidates: number;
  totalNotificationsSent: number;
  lastCandidateCount: number;
  lastNotificationCount: number;
};

type CreateHyperliquidApiExpiryReminderJobDeps = {
  resolveTelegramConfig(userId: string): Promise<{ botToken: string; chatId: string } | null>;
  sendTelegramMessage(params: { botToken: string; chatId: string; text: string }): Promise<void>;
  sendEmail(params: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }>;
};

function buildReminderMessage(params: {
  label: string;
  expiresAt: string | null;
  expiresInDays: number | null;
  state: "warning" | "expired";
}): { subject: string; text: string } {
  const headline =
    params.state === "expired"
      ? "Hyperliquid API rotation overdue"
      : "Hyperliquid API rotation due soon";
  const detail =
    params.state === "expired"
      ? "Your Hyperliquid API credentials are past the 180-day rotation window."
      : `Your Hyperliquid API credentials will expire within ${HYPERLIQUID_CREDENTIAL_WARNING_DAYS} days.`;
  const statusLine =
    params.state === "expired"
      ? `Status: expired${typeof params.expiresInDays === "number" ? ` (${Math.abs(params.expiresInDays)} day(s) overdue)` : ""}`
      : `Status: due in ${params.expiresInDays ?? "n/a"} day(s)`;
  return {
    subject: headline,
    text: [
      headline,
      "",
      `Account: ${params.label}`,
      detail,
      statusLine,
      `Rotation interval: ${HYPERLIQUID_CREDENTIAL_ROTATION_DAYS} days`,
      ...(params.expiresAt ? [`Expires at: ${params.expiresAt}`] : []),
      "",
      "Rotate the Hyperliquid API key/secret in Settings to reset the timer."
    ].join("\n")
  };
}

export function createHyperliquidApiExpiryReminderJob(
  db: any,
  deps: CreateHyperliquidApiExpiryReminderJobDeps
) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let totalCycles = 0;
  let totalCandidates = 0;
  let totalNotificationsSent = 0;
  let lastCandidateCount = 0;
  let lastNotificationCount = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (!HYPERLIQUID_API_EXPIRY_REMINDER_ENABLED) return;
    if (running) return;
    running = true;
    lastStartedAt = new Date();
    totalCycles += 1;

    let candidateCount = 0;
    let notificationCount = 0;

    try {
      const now = new Date();
      const accounts = await db.exchangeAccount.findMany({
        where: {
          exchange: "hyperliquid"
        },
        select: {
          id: true,
          label: true,
          exchange: true,
          createdAt: true,
          credentialsRotatedAt: true,
          credentialsExpiryNoticeSentAt: true,
          user: {
            select: {
              id: true,
              email: true
            }
          }
        }
      });

      for (const account of accounts) {
        if (!shouldSendHyperliquidCredentialExpiryReminder({
          exchange: account.exchange,
          credentialsRotatedAt: account.credentialsRotatedAt,
          credentialsExpiryNoticeSentAt: account.credentialsExpiryNoticeSentAt,
          createdAt: account.createdAt,
          now
        })) {
          continue;
        }

        const meta = deriveHyperliquidCredentialExpiryState({
          exchange: account.exchange,
          credentialsRotatedAt: account.credentialsRotatedAt,
          createdAt: account.createdAt,
          now
        });
        if (meta.credentialExpiryState !== "warning" && meta.credentialExpiryState !== "expired") continue;
        candidateCount += 1;

        const message = buildReminderMessage({
          label: String(account.label ?? account.id),
          expiresAt: meta.credentialsExpiresAt,
          expiresInDays: meta.credentialsExpiresInDays,
          state: meta.credentialExpiryState
        });

        let delivered = false;

        const emailTo = typeof account.user?.email === "string" ? account.user.email.trim() : "";
        if (emailTo) {
          const result = await deps.sendEmail({
            to: emailTo,
            subject: message.subject,
            text: message.text
          });
          if (result.ok) delivered = true;
          else logger.warn("hyperliquid_api_expiry_email_failed", {
            accountId: account.id,
            userId: account.user?.id ?? null,
            reason: result.error ?? "unknown"
          });
        }

        const telegramConfig = account.user?.id
          ? await deps.resolveTelegramConfig(String(account.user.id))
          : null;
        if (telegramConfig) {
          try {
            await deps.sendTelegramMessage({
              botToken: telegramConfig.botToken,
              chatId: telegramConfig.chatId,
              text: message.text
            });
            delivered = true;
          } catch (error) {
            logger.warn("hyperliquid_api_expiry_telegram_failed", {
              accountId: account.id,
              userId: account.user?.id ?? null,
              reason: String(error)
            });
          }
        }

        if (!delivered) continue;

        await db.exchangeAccount.update({
          where: { id: account.id },
          data: {
            credentialsExpiryNoticeSentAt: now
          }
        });
        notificationCount += 1;
      }

      lastError = null;
      lastErrorAt = null;
      totalCandidates += candidateCount;
      totalNotificationsSent += notificationCount;
      logger.info("hyperliquid_api_expiry_reminder_cycle", {
        reason,
        candidate_count: candidateCount,
        notification_count: notificationCount
      });
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      logger.warn("hyperliquid_api_expiry_reminder_cycle_failed", {
        reason,
        error: lastError
      });
    } finally {
      lastCandidateCount = candidateCount;
      lastNotificationCount = notificationCount;
      lastFinishedAt = new Date();
      running = false;
    }
  }

  function start() {
    if (!HYPERLIQUID_API_EXPIRY_REMINDER_ENABLED) return;
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, HYPERLIQUID_API_EXPIRY_REMINDER_POLL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): HyperliquidApiExpiryReminderJobStatus {
    return {
      enabled: HYPERLIQUID_API_EXPIRY_REMINDER_ENABLED,
      running,
      pollMs: HYPERLIQUID_API_EXPIRY_REMINDER_POLL_MS,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      totalCycles,
      totalCandidates,
      totalNotificationsSent,
      lastCandidateCount,
      lastNotificationCount
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
