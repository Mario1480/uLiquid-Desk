ALTER TABLE "grid_bot_templates"
  DROP COLUMN IF EXISTS "invest_min_usd";

ALTER TABLE "grid_bot_templates"
  RENAME COLUMN "sl_default_pct" TO "sl_default_price";

ALTER TABLE "grid_bot_instances"
  RENAME COLUMN "sl_pct" TO "sl_price";
