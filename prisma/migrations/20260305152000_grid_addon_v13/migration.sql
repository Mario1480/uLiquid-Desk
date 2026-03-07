-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridAllocationMode" AS ENUM ('EQUAL_NOTIONAL_PER_GRID', 'EQUAL_BASE_QTY_PER_GRID', 'WEIGHTED_NEAR_PRICE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridBudgetSplitPolicy" AS ENUM ('FIXED_50_50', 'FIXED_CUSTOM', 'DYNAMIC_BY_PRICE_POSITION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridMarginPolicy" AS ENUM ('MANUAL_ONLY', 'AUTO_ALLOWED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridAutoMarginTriggerType" AS ENUM ('LIQ_DISTANCE_PCT_BELOW', 'MARGIN_RATIO_ABOVE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridInstanceMarginMode" AS ENUM ('MANUAL', 'AUTO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "grid_bot_templates"
  ADD COLUMN IF NOT EXISTS "allocation_mode" "GridAllocationMode" NOT NULL DEFAULT 'EQUAL_NOTIONAL_PER_GRID',
  ADD COLUMN IF NOT EXISTS "budget_split_policy" "GridBudgetSplitPolicy" NOT NULL DEFAULT 'FIXED_50_50',
  ADD COLUMN IF NOT EXISTS "long_budget_pct" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "short_budget_pct" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "margin_policy" "GridMarginPolicy" NOT NULL DEFAULT 'MANUAL_ONLY',
  ADD COLUMN IF NOT EXISTS "auto_margin_max_usdt" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "auto_margin_trigger_type" "GridAutoMarginTriggerType",
  ADD COLUMN IF NOT EXISTS "auto_margin_trigger_value" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "auto_margin_step_usdt" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "auto_margin_cooldown_sec" INTEGER;

-- AlterTable
ALTER TABLE "grid_bot_instances"
  ADD COLUMN IF NOT EXISTS "allocation_mode" "GridAllocationMode" NOT NULL DEFAULT 'EQUAL_NOTIONAL_PER_GRID',
  ADD COLUMN IF NOT EXISTS "budget_split_policy" "GridBudgetSplitPolicy" NOT NULL DEFAULT 'FIXED_50_50',
  ADD COLUMN IF NOT EXISTS "long_budget_pct" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "short_budget_pct" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "margin_policy" "GridMarginPolicy" NOT NULL DEFAULT 'MANUAL_ONLY',
  ADD COLUMN IF NOT EXISTS "margin_mode" "GridInstanceMarginMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "auto_margin_max_usdt" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "auto_margin_trigger_type" "GridAutoMarginTriggerType",
  ADD COLUMN IF NOT EXISTS "auto_margin_trigger_value" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "auto_margin_step_usdt" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "auto_margin_cooldown_sec" INTEGER,
  ADD COLUMN IF NOT EXISTS "auto_margin_used_usdt" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_auto_margin_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "grid_venue_constraint_cache" (
  "id" TEXT NOT NULL,
  "exchange" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "min_qty" DOUBLE PRECISION,
  "qty_step" DOUBLE PRECISION,
  "price_tick" DOUBLE PRECISION,
  "min_notional_usdt" DOUBLE PRECISION,
  "fee_rate_taker" DOUBLE PRECISION,
  "fee_rate_maker" DOUBLE PRECISION,
  "mark_price" DOUBLE PRECISION,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grid_venue_constraint_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "grid_venue_constraints_exchange_symbol_uniq"
  ON "grid_venue_constraint_cache"("exchange", "symbol");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "grid_venue_constraints_updated_idx"
  ON "grid_venue_constraint_cache"("updated_at" DESC);

-- Backfill Template defaults/policies
UPDATE "grid_bot_templates"
SET
  "allocation_mode" = 'EQUAL_NOTIONAL_PER_GRID'::"GridAllocationMode",
  "budget_split_policy" = 'FIXED_50_50'::"GridBudgetSplitPolicy",
  "long_budget_pct" = 50,
  "short_budget_pct" = 50,
  "margin_policy" = CASE WHEN "allow_auto_margin" = true THEN 'AUTO_ALLOWED'::"GridMarginPolicy" ELSE 'MANUAL_ONLY'::"GridMarginPolicy" END,
  "auto_margin_max_usdt" = CASE WHEN "allow_auto_margin" = true AND "auto_margin_max_usdt" IS NULL THEN 0 ELSE "auto_margin_max_usdt" END,
  "auto_margin_trigger_type" = CASE WHEN "allow_auto_margin" = true AND "auto_margin_trigger_type" IS NULL THEN 'LIQ_DISTANCE_PCT_BELOW'::"GridAutoMarginTriggerType" ELSE "auto_margin_trigger_type" END,
  "auto_margin_trigger_value" = CASE WHEN "allow_auto_margin" = true AND "auto_margin_trigger_value" IS NULL THEN 3 ELSE "auto_margin_trigger_value" END,
  "auto_margin_step_usdt" = CASE WHEN "allow_auto_margin" = true AND "auto_margin_step_usdt" IS NULL THEN 25 ELSE "auto_margin_step_usdt" END,
  "auto_margin_cooldown_sec" = CASE WHEN "allow_auto_margin" = true AND "auto_margin_cooldown_sec" IS NULL THEN 300 ELSE "auto_margin_cooldown_sec" END;

-- Backfill Instance snapshots from template
UPDATE "grid_bot_instances" i
SET
  "allocation_mode" = t."allocation_mode",
  "budget_split_policy" = t."budget_split_policy",
  "long_budget_pct" = t."long_budget_pct",
  "short_budget_pct" = t."short_budget_pct",
  "margin_policy" = t."margin_policy",
  "margin_mode" = CASE WHEN i."auto_margin_enabled" = true THEN 'AUTO'::"GridInstanceMarginMode" ELSE 'MANUAL'::"GridInstanceMarginMode" END,
  "auto_margin_max_usdt" = t."auto_margin_max_usdt",
  "auto_margin_trigger_type" = t."auto_margin_trigger_type",
  "auto_margin_trigger_value" = t."auto_margin_trigger_value",
  "auto_margin_step_usdt" = t."auto_margin_step_usdt",
  "auto_margin_cooldown_sec" = t."auto_margin_cooldown_sec",
  "auto_margin_used_usdt" = COALESCE(i."auto_margin_used_usdt", 0)
FROM "grid_bot_templates" t
WHERE i."template_id" = t."id";
