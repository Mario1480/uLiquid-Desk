import { randomBytes } from "node:crypto";
import {
  TELEGRAM_CHAT_ID_IN_USE_ERROR,
  findTelegramChatIdConflict,
  normalizeTelegramChatId
} from "./chatIdUniqueness.js";

export const TELEGRAM_LINK_STATUS_VALUES = ["not_connected", "pending", "connected"] as const;
export type TelegramLinkStatusValue = typeof TELEGRAM_LINK_STATUS_VALUES[number];

export type TelegramLinkStatus = {
  status: TelegramLinkStatusValue;
  expiresAt: string | null;
  connectUrl: string | null;
  connectedChatId: string | null;
  telegramUsername: string | null;
  botUsername: string | null;
};

export type TelegramLinkConsumeResult =
  | { ok: true; status: "connected" | "already_connected"; userId: string; chatId: string }
  | { ok: false; status: "invalid" | "expired" | "consumed" | "conflict"; error: string; details?: string };

export const TELEGRAM_START_PAYLOAD_PREFIX = "link_";
const DEFAULT_TELEGRAM_LINK_TTL_MINUTES = 15;
const MIN_TELEGRAM_LINK_TTL_MINUTES = 5;
const MAX_TELEGRAM_LINK_TTL_MINUTES = 30;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function resolveTelegramBotUsername(): string | null {
  const raw =
    (typeof process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME === "string"
      ? process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
      : null)
    ?? (typeof process.env.TELEGRAM_BOT_USERNAME === "string"
      ? process.env.TELEGRAM_BOT_USERNAME
      : null);
  const normalized = String(raw ?? "").trim().replace(/^@+/, "");
  return normalized.length > 0 ? normalized : null;
}

export function resolveTelegramLinkTtlMinutes(): number {
  const parsed = Number.parseInt(String(process.env.TELEGRAM_LINK_TTL_MINUTES ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TELEGRAM_LINK_TTL_MINUTES;
  return clamp(parsed, MIN_TELEGRAM_LINK_TTL_MINUTES, MAX_TELEGRAM_LINK_TTL_MINUTES);
}

export function maskTelegramChatId(value: string | null | undefined): string | null {
  const normalized = normalizeTelegramChatId(value);
  if (!normalized) return null;
  if (normalized.length <= 6) return normalized;
  return `${normalized.slice(0, 3)}***${normalized.slice(-3)}`;
}

export function generateTelegramLinkToken(size = 24): string {
  return randomBytes(size).toString("base64url");
}

export function buildTelegramStartPayload(token: string): string {
  return `${TELEGRAM_START_PAYLOAD_PREFIX}${token}`;
}

export function buildTelegramConnectUrl(params: {
  botUsername: string | null;
  token: string;
}): string | null {
  const botUsername = String(params.botUsername ?? "").trim().replace(/^@+/, "");
  if (!botUsername) return null;
  const payload = buildTelegramStartPayload(params.token);
  return `https://t.me/${botUsername}?start=${encodeURIComponent(payload)}`;
}

export function parseTelegramStartToken(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const [command, payload] = trimmed.split(/\s+/, 2);
  const normalizedCommand = command.toLowerCase();
  if (normalizedCommand !== "/start" && !normalizedCommand.startsWith("/start@")) return null;
  if (!payload?.startsWith(TELEGRAM_START_PAYLOAD_PREFIX)) return null;
  const token = payload.slice(TELEGRAM_START_PAYLOAD_PREFIX.length).trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(token) ? token : null;
}

export function createTelegramLinkStatus(input: {
  botUsername: string | null;
  connectedChatId: string | null;
  pendingToken?: string | null;
  pendingExpiresAt?: Date | null;
  telegramUsername?: string | null;
}): TelegramLinkStatus {
  const connectedChatId = normalizeTelegramChatId(input.connectedChatId);
  if (connectedChatId) {
    return {
      status: "connected",
      expiresAt: null,
      connectUrl: null,
      connectedChatId: maskTelegramChatId(connectedChatId),
      telegramUsername: input.telegramUsername ?? null,
      botUsername: input.botUsername ?? null
    };
  }
  const connectUrl = input.pendingToken
    ? buildTelegramConnectUrl({
        botUsername: input.botUsername,
        token: input.pendingToken
      })
    : null;
  if (connectUrl && input.pendingExpiresAt) {
    return {
      status: "pending",
      expiresAt: input.pendingExpiresAt.toISOString(),
      connectUrl,
      connectedChatId: null,
      telegramUsername: null,
      botUsername: input.botUsername ?? null
    };
  }
  return {
    status: "not_connected",
    expiresAt: null,
    connectUrl: null,
    connectedChatId: null,
    telegramUsername: null,
    botUsername: input.botUsername ?? null
  };
}

export async function invalidateOpenTelegramLinkSessions(params: {
  db: any;
  userId: string;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  await params.db.telegramLinkSession.updateMany({
    where: {
      userId: params.userId,
      consumedAt: null,
      expiresAt: { gt: now }
    },
    data: {
      expiresAt: now
    }
  });
}

export async function createTelegramLinkSession(params: {
  db: any;
  userId: string;
  now?: Date;
  ttlMinutes?: number;
  botUsername?: string | null;
}): Promise<TelegramLinkStatus> {
  const now = params.now ?? new Date();
  const ttlMinutes = clamp(
    params.ttlMinutes ?? resolveTelegramLinkTtlMinutes(),
    MIN_TELEGRAM_LINK_TTL_MINUTES,
    MAX_TELEGRAM_LINK_TTL_MINUTES
  );
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  const token = generateTelegramLinkToken();

  await params.db.$transaction(async (tx: any) => {
    await invalidateOpenTelegramLinkSessions({
      db: tx,
      userId: params.userId,
      now
    });
    await tx.telegramLinkSession.create({
      data: {
        userId: params.userId,
        token,
        expiresAt
      }
    });
  });

  return createTelegramLinkStatus({
    botUsername: params.botUsername ?? resolveTelegramBotUsername(),
    connectedChatId: null,
    pendingToken: token,
    pendingExpiresAt: expiresAt
  });
}

export async function getTelegramLinkStatus(params: {
  db: any;
  userId: string;
  now?: Date;
  botUsername?: string | null;
}): Promise<TelegramLinkStatus> {
  const now = params.now ?? new Date();
  const [user, pending] = await Promise.all([
    params.db.user.findUnique({
      where: { id: params.userId },
      select: {
        telegramChatId: true
      }
    }),
    params.db.telegramLinkSession.findFirst({
      where: {
        userId: params.userId,
        consumedAt: null,
        expiresAt: { gt: now }
      },
      orderBy: { createdAt: "desc" },
      select: {
        token: true,
        expiresAt: true,
        telegramUsername: true
      }
    })
  ]);

  return createTelegramLinkStatus({
    botUsername: params.botUsername ?? resolveTelegramBotUsername(),
    connectedChatId: user?.telegramChatId ?? null,
    pendingToken: pending?.token ?? null,
    pendingExpiresAt: pending?.expiresAt ?? null,
    telegramUsername: pending?.telegramUsername ?? null
  });
}

export async function consumeTelegramLinkSession(params: {
  db: any;
  token: string;
  telegramChatId: string | null;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
  now?: Date;
}): Promise<TelegramLinkConsumeResult> {
  const now = params.now ?? new Date();
  const telegramChatId = normalizeTelegramChatId(params.telegramChatId);
  if (!telegramChatId) {
    return {
      ok: false,
      status: "invalid",
      error: "telegram_chat_id_invalid"
    };
  }

  return params.db.$transaction(async (tx: any) => {
    const session = await tx.telegramLinkSession.findUnique({
      where: { token: params.token },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        consumedAt: true
      }
    });

    if (!session) {
      return {
        ok: false,
        status: "invalid",
        error: "telegram_link_invalid"
      } satisfies TelegramLinkConsumeResult;
    }
    if (session.consumedAt) {
      return {
        ok: false,
        status: "consumed",
        error: "telegram_link_already_used"
      } satisfies TelegramLinkConsumeResult;
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      return {
        ok: false,
        status: "expired",
        error: "telegram_link_expired"
      } satisfies TelegramLinkConsumeResult;
    }

    const currentUser = await tx.user.findUnique({
      where: { id: session.userId },
      select: {
        telegramChatId: true
      }
    });

    const conflict = await findTelegramChatIdConflict({
      chatId: telegramChatId,
      currentUserId: session.userId,
      includeGlobal: true,
      deps: {
        findUserByChatId: async (input) =>
          tx.user.findFirst({
            where: {
              telegramChatId: input.chatId,
              ...(input.excludingUserId ? { id: { not: input.excludingUserId } } : {})
            },
            select: { id: true }
          }),
        getGlobalChatId: async () => {
          const config = await tx.alertConfig.findUnique({
            where: { key: "default" },
            select: { telegramChatId: true }
          });
          return normalizeTelegramChatId(config?.telegramChatId);
        }
      }
    });
    if (conflict) {
      await tx.telegramLinkSession.update({
        where: { id: session.id },
        data: {
          telegramChatId,
          telegramUserId: params.telegramUserId ?? null,
          telegramUsername: params.telegramUsername ?? null
        }
      });
      return {
        ok: false,
        status: "conflict",
        error: TELEGRAM_CHAT_ID_IN_USE_ERROR.error,
        details: TELEGRAM_CHAT_ID_IN_USE_ERROR.details
      } satisfies TelegramLinkConsumeResult;
    }

    const alreadyConnected = normalizeTelegramChatId(currentUser?.telegramChatId) === telegramChatId;
    await tx.user.update({
      where: { id: session.userId },
      data: {
        telegramChatId
      }
    });
    await tx.telegramLinkSession.update({
      where: { id: session.id },
      data: {
        consumedAt: now,
        telegramChatId,
        telegramUserId: params.telegramUserId ?? null,
        telegramUsername: params.telegramUsername ?? null
      }
    });
    await tx.telegramLinkSession.updateMany({
      where: {
        userId: session.userId,
        id: { not: session.id },
        consumedAt: null,
        expiresAt: { gt: now }
      },
      data: {
        expiresAt: now
      }
    });

    return {
      ok: true,
      status: alreadyConnected ? "already_connected" : "connected",
      userId: session.userId,
      chatId: telegramChatId
    } satisfies TelegramLinkConsumeResult;
  });
}
