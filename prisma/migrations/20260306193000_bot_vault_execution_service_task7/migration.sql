-- BotVault execution identity fields
ALTER TABLE IF EXISTS "bot_vaults"
  ADD COLUMN IF NOT EXISTS "execution_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_unit_id" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_status" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_last_synced_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "execution_last_error" TEXT,
  ADD COLUMN IF NOT EXISTS "execution_last_error_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "execution_metadata" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "bot_vaults_execution_unit_id_key"
  ON "bot_vaults"("execution_unit_id");

-- Execution event audit trail
CREATE TABLE IF NOT EXISTS "bot_execution_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "bot_vault_id" TEXT NOT NULL,
  "grid_instance_id" TEXT,
  "bot_id" TEXT,
  "provider_key" TEXT,
  "execution_unit_id" TEXT,
  "action" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT,
  "result" TEXT NOT NULL,
  "reason" TEXT,
  "source_key" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bot_execution_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bot_execution_events_bot_vault_id_fkey"
    FOREIGN KEY ("bot_vault_id") REFERENCES "bot_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "bot_execution_events_source_key_key"
  ON "bot_execution_events"("source_key");

CREATE INDEX IF NOT EXISTS "bot_execution_events_bot_vault_created_idx"
  ON "bot_execution_events"("bot_vault_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "bot_execution_events_user_created_idx"
  ON "bot_execution_events"("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "bot_execution_events_grid_created_idx"
  ON "bot_execution_events"("grid_instance_id", "created_at" DESC);

-- baseline execution status backfill
UPDATE "bot_vaults"
SET "execution_status" = CASE
  WHEN UPPER(COALESCE("status"::text, '')) = 'CLOSED' THEN 'closed'
  ELSE 'created'
END
WHERE "execution_status" IS NULL;
