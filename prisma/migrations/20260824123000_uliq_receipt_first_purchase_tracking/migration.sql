CREATE TYPE "UliqPurchaseTrackingStatus" AS ENUM (
  'SUBMITTED',
  'SOFT_CONFIRMED',
  'SAFE',
  'FINALIZED',
  'FAILED',
  'REORGED',
  'REVIEW_REQUIRED'
);

CREATE TABLE "uliq_purchase_trackings" (
  "id" TEXT NOT NULL,
  "chain_id" INTEGER NOT NULL,
  "presale_contract_address" TEXT NOT NULL,
  "transaction_hash" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "wallet_address" TEXT NOT NULL,
  "status" "UliqPurchaseTrackingStatus" NOT NULL DEFAULT 'SUBMITTED',
  "max_usdc_amount_raw" DECIMAL(78,0) NOT NULL,
  "min_uliq_allocation_raw" DECIMAL(78,0) NOT NULL,
  "actual_usdc_amount_raw" DECIMAL(78,0),
  "actual_uliq_allocation_raw" DECIMAL(78,0),
  "purchase_id_onchain" DECIMAL(78,0),
  "log_index" INTEGER,
  "receipt_block_number" BIGINT,
  "receipt_block_hash" TEXT,
  "status_reason" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receipt_observed_at" TIMESTAMP(3),
  "last_checked_at" TIMESTAMP(3),
  "network_finalized_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "uliq_purchase_trackings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uliq_purchase_tracking_chain_tx_key"
  ON "uliq_purchase_trackings"("chain_id", "transaction_hash");

CREATE UNIQUE INDEX "uliq_purchase_tracking_chain_purchase_key"
  ON "uliq_purchase_trackings"("chain_id", "presale_contract_address", "purchase_id_onchain");

CREATE INDEX "uliq_purchase_tracking_user_status_updated_idx"
  ON "uliq_purchase_trackings"("user_id", "status", "updated_at" DESC);

CREATE INDEX "uliq_purchase_tracking_status_checked_idx"
  ON "uliq_purchase_trackings"("status", "last_checked_at");

ALTER TABLE "uliq_purchase_trackings"
  ADD CONSTRAINT "uliq_purchase_trackings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
