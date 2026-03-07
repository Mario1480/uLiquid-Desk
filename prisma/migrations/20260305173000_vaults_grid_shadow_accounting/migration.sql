-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "VaultLedgerEntryType" AS ENUM ('ALLOCATION', 'REALIZED_PNL', 'PROFIT_SHARE_ACCRUAL', 'WITHDRAWAL', 'ADJUSTMENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "master_vaults" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "total_allocated_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_realized_net_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_profit_share_accrued_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_withdrawn_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "available_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "master_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bot_vaults" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "master_vault_id" TEXT NOT NULL,
  "grid_instance_id" TEXT NOT NULL,
  "allocated_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "realized_gross_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "realized_fees_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "realized_net_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "profit_share_accrued_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "withdrawn_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "available_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "matching_state_json" JSONB,
  "last_accounting_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bot_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "vault_ledger_entries" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "master_vault_id" TEXT NOT NULL,
  "bot_vault_id" TEXT,
  "grid_instance_id" TEXT,
  "entry_type" "VaultLedgerEntryType" NOT NULL,
  "amount_usd" DOUBLE PRECISION NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "source_ts" TIMESTAMP(3),
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vault_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "profit_share_accruals" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "master_vault_id" TEXT NOT NULL,
  "bot_vault_id" TEXT NOT NULL,
  "grid_instance_id" TEXT NOT NULL,
  "fill_event_id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "realized_pnl_usd" DOUBLE PRECISION NOT NULL,
  "fee_rate_pct" DOUBLE PRECISION NOT NULL DEFAULT 30,
  "fee_amount_usd" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'accrued',
  "accrued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "profit_share_accruals_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "grid_bot_fill_events"
  ADD COLUMN IF NOT EXISTS "exchange_fill_id" TEXT,
  ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT,
  ADD COLUMN IF NOT EXISTS "is_accounted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "accounted_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "master_vaults_user_id_key"
  ON "master_vaults"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "bot_vaults_grid_instance_id_key"
  ON "bot_vaults"("grid_instance_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_vaults_user_updated_idx"
  ON "bot_vaults"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_vaults_master_updated_idx"
  ON "bot_vaults"("master_vault_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "vault_ledger_entries_source_key_key"
  ON "vault_ledger_entries"("source_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vault_ledger_user_created_idx"
  ON "vault_ledger_entries"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vault_ledger_bot_created_idx"
  ON "vault_ledger_entries"("bot_vault_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "profit_share_accruals_fill_event_id_key"
  ON "profit_share_accruals"("fill_event_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "profit_share_accruals_source_key_key"
  ON "profit_share_accruals"("source_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "profit_share_accruals_user_created_idx"
  ON "profit_share_accruals"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "profit_share_accruals_bot_created_idx"
  ON "profit_share_accruals"("bot_vault_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "grid_bot_fill_events_dedupe_key_key"
  ON "grid_bot_fill_events"("dedupe_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "grid_bot_fill_events_instance_accounting_idx"
  ON "grid_bot_fill_events"("instance_id", "is_accounted", "fill_ts" ASC);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "master_vaults" ADD CONSTRAINT "master_vaults_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_master_vault_id_fkey"
    FOREIGN KEY ("master_vault_id") REFERENCES "master_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_grid_instance_id_fkey"
    FOREIGN KEY ("grid_instance_id") REFERENCES "grid_bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "vault_ledger_entries" ADD CONSTRAINT "vault_ledger_entries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "vault_ledger_entries" ADD CONSTRAINT "vault_ledger_entries_master_vault_id_fkey"
    FOREIGN KEY ("master_vault_id") REFERENCES "master_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "vault_ledger_entries" ADD CONSTRAINT "vault_ledger_entries_bot_vault_id_fkey"
    FOREIGN KEY ("bot_vault_id") REFERENCES "bot_vaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "profit_share_accruals" ADD CONSTRAINT "profit_share_accruals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "profit_share_accruals" ADD CONSTRAINT "profit_share_accruals_master_vault_id_fkey"
    FOREIGN KEY ("master_vault_id") REFERENCES "master_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "profit_share_accruals" ADD CONSTRAINT "profit_share_accruals_bot_vault_id_fkey"
    FOREIGN KEY ("bot_vault_id") REFERENCES "bot_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
