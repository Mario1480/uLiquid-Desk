ALTER TABLE "grid_bot_templates"
  ADD COLUMN IF NOT EXISTS "cross_long_lower_price" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "cross_long_upper_price" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "cross_long_grid_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "cross_short_lower_price" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "cross_short_upper_price" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "cross_short_grid_count" INTEGER;

UPDATE "grid_bot_templates"
SET
  "cross_long_lower_price" = COALESCE("cross_long_lower_price", "lower_price"),
  "cross_long_upper_price" = COALESCE("cross_long_upper_price", "upper_price"),
  "cross_long_grid_count" = COALESCE("cross_long_grid_count", "grid_count"),
  "cross_short_lower_price" = COALESCE("cross_short_lower_price", "lower_price"),
  "cross_short_upper_price" = COALESCE("cross_short_upper_price", "upper_price"),
  "cross_short_grid_count" = COALESCE("cross_short_grid_count", "grid_count")
WHERE "mode" = 'cross'::"GridBotMode";
