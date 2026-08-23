ALTER TABLE "uliq_presale_purchases"
  ADD COLUMN "treasury_recipient" TEXT,
  ADD COLUMN "treasury_released_usdc_raw" DECIMAL(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN "treasury_release_tx_hash" TEXT,
  ADD COLUMN "treasury_released_at" TIMESTAMP(3);

CREATE INDEX "uliq_presale_purchases_treasury_release_idx"
  ON "uliq_presale_purchases"("treasury_recipient", "treasury_released_at");
