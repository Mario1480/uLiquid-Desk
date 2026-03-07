-- AlterTable
ALTER TABLE "cash_events"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "cash_events_idempotency_key_uniq"
  ON "cash_events"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
