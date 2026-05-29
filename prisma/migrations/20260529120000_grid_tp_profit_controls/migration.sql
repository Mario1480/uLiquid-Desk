ALTER TABLE "grid_bot_instances"
  ADD COLUMN "tp_target_type" TEXT NOT NULL DEFAULT 'pct',
  ADD COLUMN "tp_profit_usd" DOUBLE PRECISION,
  ADD COLUMN "tp_action" TEXT NOT NULL DEFAULT 'stop';

UPDATE "grid_bot_instances"
SET "tp_target_type" = 'pct',
    "tp_action" = 'stop'
WHERE "tp_pct" IS NOT NULL;
