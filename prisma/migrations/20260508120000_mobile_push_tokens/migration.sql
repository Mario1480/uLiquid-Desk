CREATE TABLE "mobile_push_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'ios',
  "environment" TEXT NOT NULL DEFAULT 'production',
  "bundle_id" TEXT NOT NULL,
  "device_id" TEXT,
  "app_version" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mobile_push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_push_tokens_token_hash_key" ON "mobile_push_tokens"("token_hash");
CREATE INDEX "mobile_push_tokens_user_enabled_idx" ON "mobile_push_tokens"("user_id", "enabled", "revoked_at");
CREATE INDEX "mobile_push_tokens_env_bundle_idx" ON "mobile_push_tokens"("environment", "bundle_id");

ALTER TABLE "mobile_push_tokens"
  ADD CONSTRAINT "mobile_push_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
