-- ADR-008: canonical lock coverage for monetary ULIQ benefits.
-- Additive testnet-only schema; no feature flag or discount is enabled here.

ALTER TABLE "uliq_lock_positions"
  ADD COLUMN "original_unlock_at" TIMESTAMP(3),
  ADD COLUMN "last_extended_at" TIMESTAMP(3),
  ADD COLUMN "extension_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "uliq_lock_positions"
SET "original_unlock_at" = "unlock_at"
WHERE "original_unlock_at" IS NULL;

ALTER TABLE "uliq_lock_positions"
  ALTER COLUMN "original_unlock_at" SET NOT NULL;

ALTER TABLE "uliq_benefit_reservations"
  ADD COLUMN "lock_gate_version" TEXT,
  ADD COLUMN "lock_contract_address" TEXT,
  ADD COLUMN "required_benefit_until" TIMESTAMP(3),
  ADD COLUMN "required_locked_raw" DECIMAL(78,0),
  ADD COLUMN "qualifying_locked_raw" DECIMAL(78,0),
  ADD COLUMN "qualifying_lock_ids" JSONB;

ALTER TABLE "billing_orders"
  ADD COLUMN "planned_term_starts_at" TIMESTAMP(3),
  ADD COLUMN "planned_term_ends_at" TIMESTAMP(3),
  ADD COLUMN "planned_term_grace_ends_at" TIMESTAMP(3);

-- ADR-008 supersedes the old 24-hour holding gate. Holding lots remain for
-- provenance/reorg audit, but their timestamp no longer delays authorization.
UPDATE "uliq_holding_lots"
SET "monetary_eligible_at" = "acquired_at"
WHERE "monetary_eligible_at" <> "acquired_at";

ALTER TABLE "uliq_entitlement_snapshots"
  ALTER COLUMN "holding_cooldown_seconds" SET DEFAULT 0;

ALTER TABLE "uliq_lock_positions"
  ADD CONSTRAINT "uliq_lock_positions_extension_count_nonnegative"
  CHECK ("extension_count" >= 0),
  ADD CONSTRAINT "uliq_lock_positions_expiry_not_shortened"
  CHECK ("unlock_at" >= "original_unlock_at");

ALTER TABLE "uliq_benefit_reservations"
  ADD CONSTRAINT "uliq_benefit_reservations_lock_amounts_valid"
  CHECK (
    ("required_locked_raw" IS NULL AND "qualifying_locked_raw" IS NULL)
    OR (
      "required_locked_raw" >= 0
      AND "qualifying_locked_raw" >= 0
      AND "lock_gate_version" IS NOT NULL
      AND "lock_contract_address" IS NOT NULL
      AND "required_benefit_until" IS NOT NULL
    )
  );

CREATE INDEX "uliq_lock_positions_wallet_expiry_status_idx"
  ON "uliq_lock_positions"("wallet_address", "unlock_at", "status");

CREATE INDEX "uliq_benefit_reservations_lock_gate_idx"
  ON "uliq_benefit_reservations"("wallet_address", "required_benefit_until", "status");
