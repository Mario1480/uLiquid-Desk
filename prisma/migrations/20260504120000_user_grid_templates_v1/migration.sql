DO $$ BEGIN
  CREATE TYPE "GridTemplateVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "grid_bot_templates"
  ADD COLUMN IF NOT EXISTS "template_visibility" "GridTemplateVisibility" NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN IF NOT EXISTS "creator_profit_share_pct" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "grid_bot_templates"
SET
  "template_visibility" = COALESCE("template_visibility", 'PUBLIC'::"GridTemplateVisibility"),
  "creator_profit_share_pct" = COALESCE("creator_profit_share_pct", 0);

DROP INDEX IF EXISTS "grid_bot_templates_workspace_name_version_uniq";

CREATE UNIQUE INDEX IF NOT EXISTS "grid_bot_templates_workspace_creator_name_version_uniq"
  ON "grid_bot_templates"("workspace_id", "created_by_user_id", "name", "version");

CREATE INDEX IF NOT EXISTS "grid_bot_templates_visibility_creator_published_idx"
  ON "grid_bot_templates"("template_visibility", "created_by_user_id", "is_published", "updated_at" DESC);
