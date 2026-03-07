import { prisma } from "@mm/db";
import type { NotificationDeliveryResult, NotificationEventEnvelope } from "@mm/plugin-sdk";

const db = prisma as any;
const NOTIFICATION_DELIVERY_AUDIT_KEY_PREFIX = "notifications.delivery.v1:";

export type RunnerNotificationDeliveryAuditEntry = {
  eventId: string;
  providerId: string;
  status: NotificationDeliveryResult["status"];
  reason: string;
  retryable: boolean;
  latencyMs: number;
  createdAt: string;
  scope: NotificationEventEnvelope["scope"];
  type: string;
  category: NotificationEventEnvelope["category"];
  source: NotificationEventEnvelope["source"];
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
};

function buildAuditKey(eventId: string, providerId: string): string {
  return `${NOTIFICATION_DELIVERY_AUDIT_KEY_PREFIX}${eventId}:${providerId}`;
}

export async function writeRunnerNotificationDeliveryAudit(
  entry: RunnerNotificationDeliveryAuditEntry
): Promise<void> {
  await db.globalSetting.upsert({
    where: {
      key: buildAuditKey(entry.eventId, entry.providerId)
    },
    update: {
      value: entry
    },
    create: {
      key: buildAuditKey(entry.eventId, entry.providerId),
      value: entry
    }
  });
}

