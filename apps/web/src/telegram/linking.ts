export type TelegramLinkStatus = {
  status: "not_connected" | "pending" | "connected";
  expiresAt: string | null;
  connectUrl: string | null;
  connectedChatId: string | null;
  telegramUsername: string | null;
  botUsername: string | null;
};

export function formatTelegramLinkExpiry(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}
