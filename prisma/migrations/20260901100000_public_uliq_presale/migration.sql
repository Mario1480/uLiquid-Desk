CREATE TABLE "uliq_presale_sessions" (
  "id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "wallet_address" TEXT NOT NULL,
  "chain_id" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uliq_presale_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uliq_presale_sessions_token_hash_key"
  ON "uliq_presale_sessions"("token_hash");
CREATE INDEX "uliq_presale_sessions_wallet_chain_expiry_idx"
  ON "uliq_presale_sessions"("wallet_address", "chain_id", "expires_at");
CREATE INDEX "uliq_presale_sessions_expiry_revoked_idx"
  ON "uliq_presale_sessions"("expires_at", "revoked_at");

CREATE TABLE "uliq_presale_legal_acknowledgements" (
  "id" TEXT NOT NULL,
  "wallet_address" TEXT NOT NULL,
  "chain_id" INTEGER NOT NULL,
  "version" TEXT NOT NULL,
  "text_hash" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uliq_presale_legal_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uliq_presale_legal_wallet_chain_version_hash_key"
  ON "uliq_presale_legal_acknowledgements"("wallet_address", "chain_id", "version", "text_hash");
CREATE INDEX "uliq_presale_legal_wallet_chain_accepted_idx"
  ON "uliq_presale_legal_acknowledgements"("wallet_address", "chain_id", "accepted_at" DESC);

ALTER TABLE "uliq_purchase_trackings"
  DROP CONSTRAINT IF EXISTS "uliq_purchase_trackings_user_id_fkey";
ALTER TABLE "uliq_purchase_trackings"
  ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "uliq_purchase_trackings"
  ADD CONSTRAINT "uliq_purchase_trackings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "uliq_purchase_tracking_wallet_status_updated_idx"
  ON "uliq_purchase_trackings"("wallet_address", "status", "updated_at" DESC);
