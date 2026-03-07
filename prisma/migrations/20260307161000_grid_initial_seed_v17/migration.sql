-- Grid Initial-Seed v1.7
ALTER TABLE "grid_bot_templates"
  ADD COLUMN IF NOT EXISTS "initial_seed_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "initial_seed_pct" DOUBLE PRECISION NOT NULL DEFAULT 30;

ALTER TABLE "grid_bot_instances"
  ADD COLUMN IF NOT EXISTS "initial_seed_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "initial_seed_pct" DOUBLE PRECISION NOT NULL DEFAULT 30;

UPDATE "grid_bot_templates"
SET "initial_seed_enabled" = COALESCE("initial_seed_enabled", true),
    "initial_seed_pct" = COALESCE("initial_seed_pct", 30)
WHERE "initial_seed_enabled" IS NULL OR "initial_seed_pct" IS NULL;

UPDATE "grid_bot_instances" i
SET "initial_seed_enabled" = COALESCE(i."initial_seed_enabled", t."initial_seed_enabled", true),
    "initial_seed_pct" = COALESCE(i."initial_seed_pct", t."initial_seed_pct", 30)
FROM "grid_bot_templates" t
WHERE i."template_id" = t."id"
  AND (i."initial_seed_enabled" IS NULL OR i."initial_seed_pct" IS NULL);
