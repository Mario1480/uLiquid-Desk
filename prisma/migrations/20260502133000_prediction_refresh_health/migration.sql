ALTER TABLE "predictions_state"
  ADD COLUMN IF NOT EXISTS "refresh_status" TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS "last_refresh_attempt_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_refresh_error_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_refresh_error" TEXT,
  ADD COLUMN IF NOT EXISTS "refresh_failure_count" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "predictions_state_refresh_status_updated_at_idx"
  ON "predictions_state" ("refresh_status", "updated_at" DESC);
