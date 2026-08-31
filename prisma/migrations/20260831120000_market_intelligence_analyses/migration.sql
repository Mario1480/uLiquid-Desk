CREATE TABLE "market_intelligence_analyses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "response_language" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "overall_risk" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "source_cluster_hash" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_intelligence_analyses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_intelligence_analyses_user_request_key"
ON "market_intelligence_analyses"("user_id", "request_id");

CREATE INDEX "market_intelligence_analyses_user_created_idx"
ON "market_intelligence_analyses"("user_id", "created_at" DESC);

ALTER TABLE "market_intelligence_analyses"
ADD CONSTRAINT "market_intelligence_analyses_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
