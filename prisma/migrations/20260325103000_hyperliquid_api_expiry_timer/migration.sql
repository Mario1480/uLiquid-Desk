ALTER TABLE "ExchangeAccount"
  ADD COLUMN "credentialsRotatedAt" TIMESTAMP(3),
  ADD COLUMN "credentialsExpiryNoticeSentAt" TIMESTAMP(3);

UPDATE "ExchangeAccount"
SET
  "credentialsRotatedAt" = "createdAt",
  "credentialsExpiryNoticeSentAt" = NULL
WHERE lower(coalesce("exchange", '')) = 'hyperliquid';
