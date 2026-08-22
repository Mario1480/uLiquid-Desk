-- CreateEnum
CREATE TYPE "OnchainCanonicalStatus" AS ENUM ('OBSERVED', 'CONFIRMED', 'FINALIZED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "UliqPresalePurchaseStatus" AS ENUM ('PENDING_WITHDRAWAL', 'WITHDRAWN', 'FINALIZED');

-- CreateEnum
CREATE TYPE "UliqLockPositionStatus" AS ENUM ('ACTIVE', 'MATURED', 'WITHDRAWN', 'ORPHANED');

-- CreateEnum
CREATE TYPE "UliqPriceMode" AS ENUM ('PRESALE_REFERENCE', 'MARKET_OBSERVATION', 'MARKET_REFERENCE');

-- CreateEnum
CREATE TYPE "UliqPriceQualityStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'STALE', 'INVALID');

-- CreateEnum
CREATE TYPE "UliqBenefitReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED', 'REVERSED');

-- CreateEnum
CREATE TYPE "UliqBenefitType" AS ENUM ('SUBSCRIPTION_DISCOUNT', 'AI_CREDIT_DISCOUNT');

-- CreateEnum
CREATE TYPE "UliqBenefitLedgerEntryType" AS ENUM ('CONSUMED', 'REVERSED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "UliqHoldingProvenanceType" AS ENUM ('PRESALE_FINALIZED', 'VESTING_CLAIM', 'WALLET_TRANSFER', 'LOCK_RETURN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "UliqReconciliationStatus" AS ENUM ('OK', 'MISMATCH', 'FAILED');

-- AlterTable
ALTER TABLE "billing_orders" ADD COLUMN     "base_amount_cents" INTEGER,
ADD COLUMN     "discount_amount_cents" INTEGER,
ADD COLUMN     "final_amount_cents" INTEGER,
ADD COLUMN     "uliq_as_of_block" BIGINT,
ADD COLUMN     "uliq_benefit_reservation_id" TEXT,
ADD COLUMN     "uliq_discount_bps" INTEGER,
ADD COLUMN     "uliq_entitlement_snapshot_id" TEXT,
ADD COLUMN     "uliq_price_snapshot_id" TEXT,
ADD COLUMN     "uliq_tier_config_version" INTEGER,
ADD COLUMN     "uliq_tier_snapshot" TEXT,
ADD COLUMN     "uliq_wallet_address" TEXT;

-- AlterTable
ALTER TABLE "billing_order_items" ADD COLUMN     "base_amount_cents" INTEGER,
ADD COLUMN     "discount_amount_cents" INTEGER,
ADD COLUMN     "final_amount_cents" INTEGER;

-- AlterTable
ALTER TABLE "onchain_indexed_events" ADD COLUMN     "block_hash" TEXT,
ADD COLUMN     "canonical_status" "OnchainCanonicalStatus" NOT NULL DEFAULT 'OBSERVED',
ADD COLUMN     "confirmations" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "finalized_at" TIMESTAMP(3),
ADD COLUMN     "orphaned_at" TIMESTAMP(3),
ADD COLUMN     "parent_block_hash" TEXT;

-- AlterTable
ALTER TABLE "onchain_sync_cursors" ADD COLUMN     "contract_address" TEXT,
ADD COLUMN     "failure_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "heartbeat_at" TIMESTAMP(3),
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "last_finalized_block" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "last_processed_block_hash" TEXT,
ADD COLUMN     "last_successful_at" TIMESTAMP(3),
ADD COLUMN     "lease_expires_at" TIMESTAMP(3),
ADD COLUMN     "lease_owner" TEXT,
ADD COLUMN     "next_retry_at" TIMESTAMP(3),
ADD COLUMN     "start_block" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "uliq_presale_purchases" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "presale_contract_address" TEXT NOT NULL,
    "purchase_id_onchain" DECIMAL(78,0) NOT NULL,
    "user_id" TEXT,
    "wallet_address" TEXT NOT NULL,
    "buyer_address" TEXT NOT NULL,
    "purchase_timestamp" TIMESTAMP(3) NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "log_index" INTEGER NOT NULL,
    "usdc_amount_raw" DECIMAL(78,0) NOT NULL,
    "uliq_allocation_raw" DECIMAL(78,0) NOT NULL,
    "finalization_wallet_raw" DECIMAL(78,0) NOT NULL,
    "finalization_vesting_raw" DECIMAL(78,0) NOT NULL,
    "status" "UliqPresalePurchaseStatus" NOT NULL DEFAULT 'PENDING_WITHDRAWAL',
    "withdrawal_deadline" TIMESTAMP(3) NOT NULL,
    "purchase_block_number" BIGINT NOT NULL,
    "purchase_block_hash" TEXT NOT NULL,
    "withdraw_tx_hash" TEXT,
    "refund_tx_hash" TEXT,
    "finalize_tx_hash" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "legal_terms_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uliq_presale_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_vesting_positions" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "contract_address" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "allocated_raw" DECIMAL(78,0) NOT NULL,
    "released_raw" DECIMAL(78,0) NOT NULL,
    "vesting_start" TIMESTAMP(3),
    "vesting_end" TIMESTAMP(3),
    "as_of_block" BIGINT NOT NULL,
    "block_hash" TEXT NOT NULL,
    "last_reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uliq_vesting_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_lock_positions" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "contract_address" TEXT NOT NULL,
    "lock_id_onchain" DECIMAL(78,0) NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "amount_raw" DECIMAL(78,0) NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "unlock_at" TIMESTAMP(3) NOT NULL,
    "withdrawn_at" TIMESTAMP(3),
    "status" "UliqLockPositionStatus" NOT NULL DEFAULT 'ACTIVE',
    "as_of_block" BIGINT NOT NULL,
    "block_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uliq_lock_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_price_snapshots" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "pool_address" TEXT,
    "base_token_address" TEXT NOT NULL,
    "quote_token_address" TEXT NOT NULL,
    "price_usd" DECIMAL(38,18) NOT NULL,
    "mode" "UliqPriceMode" NOT NULL,
    "source" TEXT NOT NULL,
    "twap_window_seconds" INTEGER,
    "spot_price_usd" DECIMAL(38,18),
    "spot_twap_deviation_bps" INTEGER,
    "liquidity_usd" DECIMAL(38,2),
    "pool_age_seconds" INTEGER,
    "block_number" BIGINT NOT NULL,
    "block_hash" TEXT NOT NULL,
    "quality_status" "UliqPriceQualityStatus" NOT NULL,
    "degradation_reason" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uliq_price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_entitlement_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "as_of_block" BIGINT NOT NULL,
    "block_hash" TEXT NOT NULL,
    "wallet_raw" DECIMAL(78,0) NOT NULL,
    "vesting_raw" DECIMAL(78,0) NOT NULL,
    "locked_raw" DECIMAL(78,0) NOT NULL,
    "eligible_raw" DECIMAL(78,0) NOT NULL,
    "feature_eligible_raw" DECIMAL(78,0) NOT NULL,
    "monetary_eligible_raw" DECIMAL(78,0) NOT NULL,
    "holding_cooldown_seconds" INTEGER NOT NULL DEFAULT 86400,
    "holding_qualified_at" TIMESTAMP(3),
    "presale_cooldown_exempt_raw" DECIMAL(78,0) NOT NULL,
    "pending_presale_raw" DECIMAL(78,0) NOT NULL,
    "reference_price_usd" DECIMAL(38,18) NOT NULL,
    "price_mode" "UliqPriceMode" NOT NULL,
    "price_quality_status" "UliqPriceQualityStatus" NOT NULL,
    "degradation_reason" TEXT,
    "eligible_usd" DECIMAL(38,18) NOT NULL,
    "base_tier" TEXT NOT NULL,
    "lock_modifier" TEXT,
    "effective_tier" TEXT NOT NULL,
    "tier_config_version" INTEGER NOT NULL,
    "price_snapshot_id" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uliq_entitlement_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_benefit_reservations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "entitlement_snapshot_id" TEXT NOT NULL,
    "config_version" INTEGER NOT NULL,
    "price_snapshot_id" TEXT NOT NULL,
    "as_of_block" BIGINT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "benefit_type" "UliqBenefitType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "base_amount" DECIMAL(38,8) NOT NULL,
    "discount_amount" DECIMAL(38,8) NOT NULL,
    "final_amount" DECIMAL(38,8) NOT NULL,
    "status" "UliqBenefitReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uliq_benefit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_benefit_ledger" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "wallet_address" TEXT NOT NULL,
    "benefit_type" "UliqBenefitType" NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "tier_snapshot" TEXT NOT NULL,
    "config_version" INTEGER NOT NULL,
    "price_snapshot_id" TEXT NOT NULL,
    "entitlement_snapshot_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "base_amount" DECIMAL(38,8) NOT NULL,
    "discount_amount" DECIMAL(38,8) NOT NULL,
    "final_amount" DECIMAL(38,8) NOT NULL,
    "entry_type" "UliqBenefitLedgerEntryType" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uliq_benefit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_holding_lots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "chain_id" INTEGER NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "provenance" "UliqHoldingProvenanceType" NOT NULL,
    "source_event_key" TEXT NOT NULL,
    "lineage_root" TEXT NOT NULL,
    "amount_raw" DECIMAL(78,0) NOT NULL,
    "remaining_raw" DECIMAL(78,0) NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "monetary_eligible_at" TIMESTAMP(3) NOT NULL,
    "as_of_block" BIGINT NOT NULL,
    "block_hash" TEXT NOT NULL,
    "canonical" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uliq_holding_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_tier_configs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "min_usd_value" DECIMAL(38,18) NOT NULL,
    "minimum_lock_duration_days" INTEGER,
    "feature_flags" JSONB NOT NULL,
    "ai_discount_bps" INTEGER NOT NULL DEFAULT 0,
    "subscription_discount_bps" INTEGER NOT NULL DEFAULT 0,
    "monetary_benefit_caps" JSONB,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uliq_tier_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uliq_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "as_of_block" BIGINT NOT NULL,
    "block_hash" TEXT NOT NULL,
    "status" "UliqReconciliationStatus" NOT NULL,
    "mismatch_count" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uliq_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uliq_presale_purchases_wallet_status_deadline_idx" ON "uliq_presale_purchases"("wallet_address", "status", "withdrawal_deadline");

-- CreateIndex
CREATE INDEX "uliq_presale_purchases_user_created_idx" ON "uliq_presale_purchases"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uliq_presale_purchases_chain_contract_purchase_key" ON "uliq_presale_purchases"("chain_id", "presale_contract_address", "purchase_id_onchain");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_presale_purchases_chain_tx_log_key" ON "uliq_presale_purchases"("chain_id", "transaction_hash", "log_index");

-- CreateIndex
CREATE INDEX "uliq_vesting_positions_wallet_block_idx" ON "uliq_vesting_positions"("wallet_address", "as_of_block");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_vesting_positions_chain_contract_wallet_key" ON "uliq_vesting_positions"("chain_id", "contract_address", "wallet_address");

-- CreateIndex
CREATE INDEX "uliq_lock_positions_wallet_status_unlock_idx" ON "uliq_lock_positions"("wallet_address", "status", "unlock_at");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_lock_positions_chain_contract_lock_key" ON "uliq_lock_positions"("chain_id", "contract_address", "lock_id_onchain");

-- CreateIndex
CREATE INDEX "uliq_price_snapshots_chain_mode_observed_idx" ON "uliq_price_snapshots"("chain_id", "mode", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "uliq_price_snapshots_quality_valid_idx" ON "uliq_price_snapshots"("quality_status", "valid_until");

-- CreateIndex
CREATE INDEX "uliq_entitlement_snapshots_user_computed_idx" ON "uliq_entitlement_snapshots"("user_id", "computed_at" DESC);

-- CreateIndex
CREATE INDEX "uliq_entitlement_snapshots_wallet_valid_idx" ON "uliq_entitlement_snapshots"("wallet_address", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_entitlement_snapshots_user_wallet_chain_block_key" ON "uliq_entitlement_snapshots"("user_id", "wallet_address", "chain_id", "as_of_block");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_benefit_reservations_idempotency_key_key" ON "uliq_benefit_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "uliq_benefit_reservations_user_status_expiry_idx" ON "uliq_benefit_reservations"("user_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "uliq_benefit_reservations_wallet_status_idx" ON "uliq_benefit_reservations"("wallet_address", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_benefit_reservations_reference_benefit_key" ON "uliq_benefit_reservations"("reference_type", "reference_id", "benefit_type");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_benefit_ledger_idempotency_key_key" ON "uliq_benefit_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "uliq_benefit_ledger_user_created_idx" ON "uliq_benefit_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "uliq_benefit_ledger_reservation_created_idx" ON "uliq_benefit_ledger"("reservation_id", "created_at");

-- CreateIndex
CREATE INDEX "uliq_holding_lots_wallet_eligible_idx" ON "uliq_holding_lots"("wallet_address", "canonical", "monetary_eligible_at");

-- CreateIndex
CREATE INDEX "uliq_holding_lots_lineage_canonical_idx" ON "uliq_holding_lots"("lineage_root", "canonical");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_holding_lots_chain_source_event_key" ON "uliq_holding_lots"("chain_id", "source_event_key");

-- CreateIndex
CREATE INDEX "uliq_tier_configs_effective_idx" ON "uliq_tier_configs"("enabled", "effective_from", "effective_until");

-- CreateIndex
CREATE UNIQUE INDEX "uliq_tier_configs_code_version_key" ON "uliq_tier_configs"("code", "version");

-- CreateIndex
CREATE INDEX "uliq_reconciliation_runs_chain_scope_started_idx" ON "uliq_reconciliation_runs"("chain_id", "scope", "started_at" DESC);

-- CreateIndex
CREATE INDEX "uliq_reconciliation_runs_status_started_idx" ON "uliq_reconciliation_runs"("status", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "billing_orders_uliq_benefit_reservation_id_key" ON "billing_orders"("uliq_benefit_reservation_id");

-- CreateIndex
CREATE INDEX "onchain_indexed_events_chain_status_block_idx" ON "onchain_indexed_events"("chain_id", "canonical_status", "block_number");

-- Fail closed instead of deleting or merging pre-existing event duplicates.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "onchain_indexed_events"
        GROUP BY "chain_id", "transaction_hash", "log_index"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate onchain event identities require manual reconciliation before ULIQ migration';
    END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "onchain_indexed_events_chain_tx_log_key" ON "onchain_indexed_events"("chain_id", "transaction_hash", "log_index");

-- CreateIndex
CREATE INDEX "onchain_sync_cursors_chain_lease_idx" ON "onchain_sync_cursors"("chain_id", "lease_expires_at");

-- AddForeignKey
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_uliq_entitlement_snapshot_id_fkey" FOREIGN KEY ("uliq_entitlement_snapshot_id") REFERENCES "uliq_entitlement_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_uliq_benefit_reservation_id_fkey" FOREIGN KEY ("uliq_benefit_reservation_id") REFERENCES "uliq_benefit_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_uliq_price_snapshot_id_fkey" FOREIGN KEY ("uliq_price_snapshot_id") REFERENCES "uliq_price_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_presale_purchases" ADD CONSTRAINT "uliq_presale_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_entitlement_snapshots" ADD CONSTRAINT "uliq_entitlement_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_entitlement_snapshots" ADD CONSTRAINT "uliq_entitlement_snapshots_price_snapshot_id_fkey" FOREIGN KEY ("price_snapshot_id") REFERENCES "uliq_price_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_benefit_reservations" ADD CONSTRAINT "uliq_benefit_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_benefit_reservations" ADD CONSTRAINT "uliq_benefit_reservations_entitlement_snapshot_id_fkey" FOREIGN KEY ("entitlement_snapshot_id") REFERENCES "uliq_entitlement_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_benefit_reservations" ADD CONSTRAINT "uliq_benefit_reservations_price_snapshot_id_fkey" FOREIGN KEY ("price_snapshot_id") REFERENCES "uliq_price_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_benefit_ledger" ADD CONSTRAINT "uliq_benefit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_benefit_ledger" ADD CONSTRAINT "uliq_benefit_ledger_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "uliq_benefit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_holding_lots" ADD CONSTRAINT "uliq_holding_lots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uliq_tier_configs" ADD CONSTRAINT "uliq_tier_configs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- uint256/raw-unit and lifecycle guards that Prisma cannot express directly.
ALTER TABLE "uliq_presale_purchases"
    ADD CONSTRAINT "uliq_presale_purchases_raw_nonnegative" CHECK (
        "purchase_id_onchain" >= 0 AND "usdc_amount_raw" >= 0 AND "uliq_allocation_raw" >= 0
        AND "finalization_wallet_raw" >= 0 AND "finalization_vesting_raw" >= 0
    ),
    ADD CONSTRAINT "uliq_presale_purchases_split_matches" CHECK (
        "finalization_wallet_raw" + "finalization_vesting_raw" = "uliq_allocation_raw"
    );

ALTER TABLE "uliq_vesting_positions"
    ADD CONSTRAINT "uliq_vesting_positions_raw_valid" CHECK (
        "allocated_raw" >= 0 AND "released_raw" >= 0 AND "released_raw" <= "allocated_raw"
    );

ALTER TABLE "uliq_lock_positions"
    ADD CONSTRAINT "uliq_lock_positions_raw_nonnegative" CHECK ("lock_id_onchain" >= 0 AND "amount_raw" >= 0),
    ADD CONSTRAINT "uliq_lock_positions_duration_allowed" CHECK ("duration_days" IN (30, 90, 180));

ALTER TABLE "uliq_entitlement_snapshots"
    ADD CONSTRAINT "uliq_entitlement_snapshots_raw_nonnegative" CHECK (
        "wallet_raw" >= 0 AND "vesting_raw" >= 0 AND "locked_raw" >= 0 AND "eligible_raw" >= 0
        AND "feature_eligible_raw" >= 0 AND "monetary_eligible_raw" >= 0
        AND "presale_cooldown_exempt_raw" >= 0 AND "pending_presale_raw" >= 0
    ),
    ADD CONSTRAINT "uliq_entitlement_snapshots_eligible_sum" CHECK (
        "eligible_raw" = "wallet_raw" + "vesting_raw" + "locked_raw"
    ),
    ADD CONSTRAINT "uliq_entitlement_snapshots_monetary_lte_feature" CHECK (
        "monetary_eligible_raw" <= "feature_eligible_raw" AND "feature_eligible_raw" = "eligible_raw"
    );

ALTER TABLE "uliq_holding_lots"
    ADD CONSTRAINT "uliq_holding_lots_raw_valid" CHECK (
        "amount_raw" >= 0 AND "remaining_raw" >= 0 AND "remaining_raw" <= "amount_raw"
    );

ALTER TABLE "uliq_benefit_reservations"
    ADD CONSTRAINT "uliq_benefit_reservations_amounts_valid" CHECK (
        "base_amount" >= 0 AND "discount_amount" >= 0 AND "final_amount" >= 0
        AND "base_amount" - "discount_amount" = "final_amount"
    );

ALTER TABLE "uliq_benefit_ledger"
    ADD CONSTRAINT "uliq_benefit_ledger_amounts_valid" CHECK (
        "base_amount" >= 0 AND "discount_amount" >= 0 AND "final_amount" >= 0
        AND "base_amount" - "discount_amount" = "final_amount"
    );

-- Version 1 establishes only the accepted tier thresholds. Monetary benefits
-- deliberately start at zero BPS and require a separately audited/admin-authored
-- config version before the testnet discount flag can have an economic effect.
INSERT INTO "uliq_tier_configs" (
    "id", "code", "version", "enabled", "min_usd_value",
    "feature_flags", "ai_discount_bps", "subscription_discount_bps",
    "effective_from", "reason", "created_at"
) VALUES
    ('uliq-tier-v1-basic', 'BASIC', 1, TRUE, 0, '{}'::jsonb, 0, 0, NOW(), 'ULIQ MVP testnet threshold baseline', NOW()),
    ('uliq-tier-v1-bronze', 'BRONZE', 1, TRUE, 100, '{}'::jsonb, 0, 0, NOW(), 'ULIQ MVP testnet threshold baseline', NOW()),
    ('uliq-tier-v1-silver', 'SILVER', 1, TRUE, 500, '{}'::jsonb, 0, 0, NOW(), 'ULIQ MVP testnet threshold baseline', NOW()),
    ('uliq-tier-v1-gold', 'GOLD', 1, TRUE, 1500, '{}'::jsonb, 0, 0, NOW(), 'ULIQ MVP testnet threshold baseline', NOW()),
    ('uliq-tier-v1-platinum', 'PLATINUM', 1, TRUE, 5000, '{}'::jsonb, 0, 0, NOW(), 'ULIQ MVP testnet threshold baseline', NOW());
