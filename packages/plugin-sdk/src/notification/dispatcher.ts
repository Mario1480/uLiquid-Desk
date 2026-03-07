import type {
  NotificationDeliveryResult,
  NotificationDispatchContext,
  NotificationEventEnvelope,
  NotificationProvider
} from "./types.js";

type NotificationIsolationStateEntry = {
  consecutiveFailures: number;
  cooldownUntil?: string;
};

export type NotificationIsolationState = Map<string, NotificationIsolationStateEntry>;

type RunNotificationProviderParams<
  TEvent extends NotificationEventEnvelope = NotificationEventEnvelope,
  TContext extends NotificationDispatchContext = NotificationDispatchContext
> = {
  provider: NotificationProvider<TEvent, TContext>;
  event: TEvent;
  ctx: TContext;
  state: NotificationIsolationState;
  timeoutMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
};

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

function createEventId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const seed = Math.random().toString(16).slice(2);
  return `evt_${Date.now().toString(16)}_${seed}`;
}

function isInCooldown(entry: NotificationIsolationStateEntry, nowMs: number): boolean {
  if (!entry.cooldownUntil) return false;
  const cooldownUntilMs = new Date(entry.cooldownUntil).getTime();
  if (!Number.isFinite(cooldownUntilMs)) return false;
  if (nowMs < cooldownUntilMs) return true;
  entry.cooldownUntil = undefined;
  return false;
}

function withTimeout<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.max(200, Math.trunc(timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | null = null;
  return Promise.race([
    run(),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`notification_timeout_after_${ms}ms`)), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function createNotificationIsolationState(): NotificationIsolationState {
  return new Map<string, NotificationIsolationStateEntry>();
}

export function ensureNotificationEnvelope<T extends Partial<NotificationEventEnvelope>>(
  event: T,
  now: Date = new Date()
): NotificationEventEnvelope & T {
  const occurredAt = typeof event.occurredAt === "string" && event.occurredAt.trim()
    ? event.occurredAt
    : now.toISOString();
  const eventId = typeof event.eventId === "string" && event.eventId.trim()
    ? event.eventId
    : createEventId();
  return {
    ...event,
    occurredAt,
    eventId
  } as NotificationEventEnvelope & T;
}

export async function runNotificationProviderWithIsolation<
  TEvent extends NotificationEventEnvelope = NotificationEventEnvelope,
  TContext extends NotificationDispatchContext = NotificationDispatchContext
>(params: RunNotificationProviderParams<TEvent, TContext>): Promise<NotificationDeliveryResult> {
  const startedAt = Date.now();
  const providerId = params.provider.manifest.id;
  const threshold = Number.isFinite(params.failureThreshold) && (params.failureThreshold ?? 0) > 0
    ? Math.max(1, Math.trunc(params.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD))
    : DEFAULT_FAILURE_THRESHOLD;
  const cooldownMs = Number.isFinite(params.cooldownMs) && (params.cooldownMs ?? 0) > 0
    ? Math.max(1_000, Math.trunc(params.cooldownMs ?? DEFAULT_COOLDOWN_MS))
    : DEFAULT_COOLDOWN_MS;
  const timeoutMs = Number.isFinite(params.timeoutMs) && (params.timeoutMs ?? 0) > 0
    ? Math.max(200, Math.trunc(params.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    : DEFAULT_TIMEOUT_MS;

  const stateEntry = params.state.get(providerId) ?? { consecutiveFailures: 0 };
  params.state.set(providerId, stateEntry);

  if (isInCooldown(stateEntry, startedAt)) {
    return {
      status: "skipped",
      providerId,
      reason: "provider_in_cooldown",
      retryable: true,
      latencyMs: 0
    };
  }

  if (params.provider.canHandle && !params.provider.canHandle(params.event, params.ctx)) {
    return {
      status: "skipped",
      providerId,
      reason: "provider_declined_event",
      retryable: false,
      latencyMs: Date.now() - startedAt
    };
  }

  try {
    const result = await withTimeout(
      () => params.provider.send(params.event, params.ctx),
      timeoutMs
    );
    stateEntry.consecutiveFailures = 0;
    stateEntry.cooldownUntil = undefined;
    return {
      ...result,
      status: result.status,
      providerId,
      latencyMs: Number.isFinite(result.latencyMs)
        ? Math.max(0, Math.trunc(result.latencyMs))
        : Date.now() - startedAt
    };
  } catch (error) {
    stateEntry.consecutiveFailures += 1;
    if (stateEntry.consecutiveFailures >= threshold) {
      stateEntry.cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
    }
    const reason = String(error);
    const timedOut = reason.includes("notification_timeout_after_");
    return {
      status: timedOut ? "timeout" : "failed",
      providerId,
      reason,
      retryable: true,
      latencyMs: Date.now() - startedAt,
      metadata: {
        consecutiveFailures: stateEntry.consecutiveFailures,
        cooldownUntil: stateEntry.cooldownUntil ?? null
      }
    };
  }
}

