CREATE TABLE "TelegramLinkSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "telegramChatId" TEXT,
  "telegramUserId" TEXT,
  "telegramUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TelegramLinkSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramLinkSession_token_key" ON "TelegramLinkSession"("token");
CREATE INDEX "TelegramLinkSession_userId_consumedAt_expiresAt_idx"
  ON "TelegramLinkSession"("userId", "consumedAt", "expiresAt");
CREATE INDEX "TelegramLinkSession_expiresAt_idx" ON "TelegramLinkSession"("expiresAt");

ALTER TABLE "TelegramLinkSession"
ADD CONSTRAINT "TelegramLinkSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
