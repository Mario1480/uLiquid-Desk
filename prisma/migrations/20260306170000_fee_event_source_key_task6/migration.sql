-- FeeEvent idempotency key per settlement source
ALTER TABLE IF EXISTS "fee_events"
  ADD COLUMN IF NOT EXISTS "source_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "fee_events_source_key_uniq"
  ON "fee_events"("source_key")
  WHERE "source_key" IS NOT NULL;
