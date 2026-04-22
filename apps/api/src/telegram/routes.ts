import express from "express";
import {
  consumeTelegramLinkSession,
  parseTelegramStartToken
} from "./linking.js";
import { sendTelegramMessage } from "./notifications.js";

type TelegramWebhookMessage = {
  text?: unknown;
  chat?: {
    id?: number | string;
    type?: string;
  } | null;
  from?: {
    id?: number | string;
    username?: string | null;
  } | null;
};

export type RegisterTelegramRoutesDeps = {
  db: any;
  now?: () => Date;
  resolveWebhookSecret?: () => string | null;
  resolveBotToken?: () => Promise<string | null>;
  sendTelegramMessage?: (params: { botToken: string; chatId: string; text: string }) => Promise<void>;
  logger?: Pick<Console, "warn" | "info">;
};

function parseTelegramConfigValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTelegramId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function isPrivateChat(message: TelegramWebhookMessage | null | undefined): boolean {
  return String(message?.chat?.type ?? "").trim().toLowerCase() === "private";
}

async function resolveConfiguredTelegramBotToken(db: any): Promise<string | null> {
  const envToken = parseTelegramConfigValue(process.env.TELEGRAM_BOT_TOKEN);
  if (envToken) return envToken;
  const config = await db.alertConfig.findUnique({
    where: { key: "default" },
    select: { telegramBotToken: true }
  });
  return parseTelegramConfigValue(config?.telegramBotToken);
}

export function registerTelegramRoutes(
  app: express.Express,
  deps: RegisterTelegramRoutesDeps
) {
  const resolveWebhookSecret = deps.resolveWebhookSecret ?? (() => parseTelegramConfigValue(process.env.TELEGRAM_WEBHOOK_SECRET));
  const sendMessage = deps.sendTelegramMessage ?? sendTelegramMessage;

  app.post("/telegram/webhook/:secret", async (req, res) => {
    const configuredSecret = resolveWebhookSecret();
    if (!configuredSecret || req.params.secret !== configuredSecret) {
      return res.status(404).json({ error: "not_found" });
    }

    const headerSecret = parseTelegramConfigValue(req.header("x-telegram-bot-api-secret-token"));
    if (headerSecret && headerSecret !== configuredSecret) {
      return res.status(403).json({ error: "telegram_webhook_forbidden" });
    }

    const message = (req.body?.message ?? req.body?.edited_message ?? null) as TelegramWebhookMessage | null;
    const token = parseTelegramStartToken(message?.text);
    if (!token || !isPrivateChat(message)) {
      return res.json({ ok: true, ignored: true });
    }

    const telegramChatId = normalizeTelegramId(message?.chat?.id);
    const telegramUserId = normalizeTelegramId(message?.from?.id);
    const telegramUsername = parseTelegramConfigValue(message?.from?.username);
    const result = await consumeTelegramLinkSession({
      db: deps.db,
      token,
      telegramChatId,
      telegramUserId,
      telegramUsername,
      now: deps.now?.() ?? new Date()
    });

    const botToken = await (deps.resolveBotToken?.() ?? resolveConfiguredTelegramBotToken(deps.db));
    if (botToken && telegramChatId) {
      try {
        if (result.ok) {
          await sendMessage({
            botToken,
            chatId: telegramChatId,
            text: result.status === "already_connected"
              ? "Your Telegram chat is already connected to uLiquid Desk."
              : "Telegram was successfully connected to your uLiquid Desk account."
          });
        } else if (result.status === "expired") {
          await sendMessage({
            botToken,
            chatId: telegramChatId,
            text: "This Telegram connect link has expired. Please start a new connection from uLiquid Desk."
          });
        } else if (result.status === "consumed") {
          await sendMessage({
            botToken,
            chatId: telegramChatId,
            text: "This Telegram connect link has already been used."
          });
        } else if (result.status === "conflict") {
          await sendMessage({
            botToken,
            chatId: telegramChatId,
            text: "This Telegram chat is already connected to another uLiquid Desk account."
          });
        }
      } catch (error) {
        deps.logger?.warn?.("telegram_webhook_reply_failed", {
          reason: error instanceof Error ? error.message : String(error)
        } as any);
      }
    }

    return res.json({
      ok: true,
      linked: result.ok,
      status: result.status
    });
  });
}
