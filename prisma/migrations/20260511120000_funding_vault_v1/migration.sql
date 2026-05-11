CREATE TABLE "funding_vaults" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "onchain_address" TEXT,
  "factory_address" TEXT,
  "contract_version" TEXT NOT NULL DEFAULT 'v1',
  "operator_address" TEXT,
  "operator_version" INTEGER NOT NULL DEFAULT 1,
  "operator_secret_ref" TEXT,
  "free_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reserved_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_deposited" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_withdrawn" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_synced_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "funding_vaults_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "funding_vaults_user_id_key" ON "funding_vaults"("user_id");
CREATE UNIQUE INDEX "funding_vaults_onchain_address_key" ON "funding_vaults"("onchain_address");
CREATE INDEX "funding_vaults_status_updated_idx" ON "funding_vaults"("status", "updated_at" DESC);

ALTER TABLE "funding_vaults"
  ADD CONSTRAINT "funding_vaults_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bot_vaults"
  ADD COLUMN "funding_vault_id" TEXT,
  ADD COLUMN "funding_source" TEXT NOT NULL DEFAULT 'wallet_direct';

CREATE INDEX "bot_vaults_funding_vault_updated_idx" ON "bot_vaults"("funding_vault_id", "updated_at" DESC);

ALTER TABLE "bot_vaults"
  ADD CONSTRAINT "bot_vaults_funding_vault_id_fkey"
  FOREIGN KEY ("funding_vault_id") REFERENCES "funding_vaults"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "onchain_actions"
  ADD COLUMN "funding_vault_id" TEXT;

CREATE INDEX "onchain_actions_funding_vault_created_idx" ON "onchain_actions"("funding_vault_id", "created_at" DESC);

ALTER TABLE "onchain_actions"
  ADD CONSTRAINT "onchain_actions_funding_vault_id_fkey"
  FOREIGN KEY ("funding_vault_id") REFERENCES "funding_vaults"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
