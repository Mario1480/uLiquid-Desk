-- BotTemplate risk allocation limits (Task 8)
ALTER TABLE IF EXISTS "bot_templates"
  ADD COLUMN IF NOT EXISTS "min_allocation_usd" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "max_allocation_usd" DOUBLE PRECISION;

UPDATE "bot_templates"
SET
  "min_allocation_usd" = COALESCE("min_allocation_usd", 0.01),
  "max_allocation_usd" = COALESCE("max_allocation_usd", 1000000);

ALTER TABLE "bot_templates"
  ALTER COLUMN "min_allocation_usd" SET DEFAULT 0.01,
  ALTER COLUMN "min_allocation_usd" SET NOT NULL,
  ALTER COLUMN "max_allocation_usd" SET DEFAULT 1000000,
  ALTER COLUMN "max_allocation_usd" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "bot_templates" ADD CONSTRAINT "bot_templates_min_allocation_positive_chk"
    CHECK ("min_allocation_usd" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_templates" ADD CONSTRAINT "bot_templates_max_allocation_range_chk"
    CHECK ("max_allocation_usd" >= "min_allocation_usd");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
