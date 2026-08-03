-- Provider-neutral economic calendar defaults. Existing FMP rows remain readable.
ALTER TABLE "economic_calendar_config"
  ALTER COLUMN "provider" SET DEFAULT 'official';

ALTER TABLE "economic_events"
  ALTER COLUMN "source" SET DEFAULT 'official',
  ADD COLUMN "source_name" TEXT,
  ADD COLUMN "source_url" TEXT,
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'economic_release',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'scheduled',
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "period" TEXT,
  ADD COLUMN "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "original_timezone" TEXT,
  ADD COLUMN "time_confidence" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "economic_event_revisions" (
  "id" TEXT NOT NULL,
  "economic_event_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "actual" DOUBLE PRECISION,
  "previous" DOUBLE PRECISION,
  "released_at" TIMESTAMP(3) NOT NULL,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "economic_event_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "economic_event_revisions_economic_event_id_fkey"
    FOREIGN KEY ("economic_event_id") REFERENCES "economic_events"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "economic_event_revisions_economic_event_id_revision_key"
  ON "economic_event_revisions"("economic_event_id", "revision");
CREATE INDEX "economic_event_revisions_released_at_idx"
  ON "economic_event_revisions"("released_at" DESC);

CREATE TABLE "market_news_items" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "canonical_url" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "published_at" TIMESTAMP(3) NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "language" TEXT,
  "symbols" JSONB NOT NULL DEFAULT '[]',
  "categories" JSONB NOT NULL DEFAULT '[]',
  "content_hash" TEXT NOT NULL,
  "license_status" TEXT NOT NULL DEFAULT 'approved',
  "terms_reviewed_at" TIMESTAMP(3),
  "retention_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_news_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_news_items_provider_source_id_key"
  ON "market_news_items"("provider", "source_id");
CREATE INDEX "market_news_items_published_at_idx"
  ON "market_news_items"("published_at" DESC);
CREATE INDEX "market_news_items_provider_published_at_idx"
  ON "market_news_items"("provider", "published_at" DESC);
CREATE INDEX "market_news_items_content_hash_idx"
  ON "market_news_items"("content_hash");

CREATE TABLE "market_summary_cache" (
  "id" TEXT NOT NULL,
  "source_cluster_hash" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "horizon" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_summary_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_summary_cache_identity_key"
  ON "market_summary_cache"("source_cluster_hash", "prompt_version", "model", "horizon");
CREATE INDEX "market_summary_cache_expires_at_idx"
  ON "market_summary_cache"("expires_at");
