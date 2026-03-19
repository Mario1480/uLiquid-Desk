ALTER TABLE "grid_bot_templates"
ADD COLUMN "catalog_category" TEXT,
ADD COLUMN "catalog_tags" JSONB,
ADD COLUMN "catalog_difficulty" TEXT NOT NULL DEFAULT 'BEGINNER',
ADD COLUMN "catalog_risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "catalog_image_url" TEXT,
ADD COLUMN "catalog_short_description" TEXT,
ADD COLUMN "catalog_sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "catalog_featured" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "grid_template_favorites" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "grid_template_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "grid_template_favorites_user_template_uniq"
ON "grid_template_favorites"("user_id", "template_id");

CREATE INDEX "grid_template_favorites_user_created_idx"
ON "grid_template_favorites"("user_id", "created_at" DESC);

CREATE INDEX "grid_template_favorites_template_created_idx"
ON "grid_template_favorites"("template_id", "created_at" DESC);

ALTER TABLE "grid_template_favorites"
ADD CONSTRAINT "grid_template_favorites_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "grid_template_favorites"
ADD CONSTRAINT "grid_template_favorites_template_id_fkey"
FOREIGN KEY ("template_id") REFERENCES "grid_bot_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
