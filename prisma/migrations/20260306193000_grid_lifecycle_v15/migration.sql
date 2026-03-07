-- Grid lifecycle v1.5: archived terminal state for grid instances

ALTER TYPE "GridBotInstanceState" ADD VALUE IF NOT EXISTS 'archived';

ALTER TABLE "grid_bot_instances"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archived_reason" TEXT;

CREATE INDEX IF NOT EXISTS "grid_bot_instances_state_archived_at_idx"
  ON "grid_bot_instances"("state", "archived_at" DESC);
