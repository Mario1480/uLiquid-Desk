-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridAutoReservePolicy" AS ENUM ('FIXED_RATIO', 'LIQ_GUARD_MAX_GRID');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "grid_bot_templates"
  ADD COLUMN IF NOT EXISTS "auto_reserve_policy" "GridAutoReservePolicy" NOT NULL DEFAULT 'LIQ_GUARD_MAX_GRID',
  ADD COLUMN IF NOT EXISTS "auto_reserve_fixed_grid_pct" DOUBLE PRECISION NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS "auto_reserve_target_liq_distance_pct" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "auto_reserve_max_preview_iterations" INTEGER NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "grid_bot_instances"
  ADD COLUMN IF NOT EXISTS "auto_reserve_policy" "GridAutoReservePolicy" NOT NULL DEFAULT 'LIQ_GUARD_MAX_GRID',
  ADD COLUMN IF NOT EXISTS "auto_reserve_fixed_grid_pct" DOUBLE PRECISION NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS "auto_reserve_target_liq_distance_pct" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "auto_reserve_max_preview_iterations" INTEGER NOT NULL DEFAULT 8;

-- Backfill template defaults for older rows
UPDATE "grid_bot_templates"
SET
  "auto_reserve_policy" = COALESCE("auto_reserve_policy", 'LIQ_GUARD_MAX_GRID'::"GridAutoReservePolicy"),
  "auto_reserve_fixed_grid_pct" = COALESCE("auto_reserve_fixed_grid_pct", 70),
  "auto_reserve_target_liq_distance_pct" = "auto_reserve_target_liq_distance_pct",
  "auto_reserve_max_preview_iterations" = COALESCE("auto_reserve_max_preview_iterations", 8);

-- Backfill instance snapshot from template (immediate rollout for existing instances)
UPDATE "grid_bot_instances" i
SET
  "auto_reserve_policy" = t."auto_reserve_policy",
  "auto_reserve_fixed_grid_pct" = t."auto_reserve_fixed_grid_pct",
  "auto_reserve_target_liq_distance_pct" = t."auto_reserve_target_liq_distance_pct",
  "auto_reserve_max_preview_iterations" = t."auto_reserve_max_preview_iterations"
FROM "grid_bot_templates" t
WHERE i."template_id" = t."id";
