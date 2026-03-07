-- Grid order placement v1.6: dynamic active order window controls

ALTER TABLE "grid_bot_templates"
  ADD COLUMN IF NOT EXISTS "active_order_window_size" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "recenter_drift_levels" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "grid_bot_instances"
  ADD COLUMN IF NOT EXISTS "active_order_window_size" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "recenter_drift_levels" INTEGER NOT NULL DEFAULT 1;

-- Backfill instance snapshots from template values where available.
UPDATE "grid_bot_instances" AS i
SET
  "active_order_window_size" = COALESCE(t."active_order_window_size", i."active_order_window_size", 100),
  "recenter_drift_levels" = COALESCE(t."recenter_drift_levels", i."recenter_drift_levels", 1)
FROM "grid_bot_templates" AS t
WHERE i."template_id" = t."id";

ALTER TABLE "grid_bot_templates"
  DROP CONSTRAINT IF EXISTS "grid_bot_templates_active_window_range_chk";
ALTER TABLE "grid_bot_templates"
  ADD CONSTRAINT "grid_bot_templates_active_window_range_chk"
  CHECK ("active_order_window_size" BETWEEN 40 AND 120);

ALTER TABLE "grid_bot_templates"
  DROP CONSTRAINT IF EXISTS "grid_bot_templates_recenter_drift_range_chk";
ALTER TABLE "grid_bot_templates"
  ADD CONSTRAINT "grid_bot_templates_recenter_drift_range_chk"
  CHECK ("recenter_drift_levels" BETWEEN 1 AND 10);
