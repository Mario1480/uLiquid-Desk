-- Direct cutover: the previous token balance was never used in production.
-- No token values or ledger entries are carried into the credit system.
DELETE FROM "ai_token_ledger";

UPDATE "user_subscriptions"
SET "ai_token_balance" = 0,
    "ai_token_used_lifetime" = 0,
    "monthly_ai_tokens_included" = 0;

UPDATE "billing_packages"
SET "monthly_ai_tokens" = 0,
    "ai_credits" = 0;

UPDATE "subscription_terms"
SET "monthly_ai_tokens" = 0;

ALTER TABLE "user_subscriptions" RENAME COLUMN "ai_token_balance" TO "ai_credit_balance";
ALTER TABLE "user_subscriptions" RENAME COLUMN "ai_token_used_lifetime" TO "ai_credits_used_lifetime";
ALTER TABLE "user_subscriptions" RENAME COLUMN "monthly_ai_tokens_included" TO "monthly_ai_credits_included";
ALTER TABLE "user_subscriptions"
  ADD COLUMN "ai_credits_reserved" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "ai_daily_limit_credits" BIGINT,
  ADD COLUMN "ai_monthly_limit_credits" BIGINT,
  ADD COLUMN "ai_max_run_credits" BIGINT;

ALTER TABLE "billing_packages" RENAME COLUMN "monthly_ai_tokens" TO "monthly_ai_credits";
ALTER TABLE "subscription_terms" RENAME COLUMN "monthly_ai_tokens" TO "monthly_ai_credits";

UPDATE "billing_packages"
SET "monthly_ai_credits" = 10000
WHERE "code" = 'pro_monthly';

UPDATE "billing_packages"
SET "is_active" = false,
    "ai_credits" = 0
WHERE "code" = 'ai_topup_250k';

ALTER TYPE "AiLedgerReason" RENAME TO "AiLedgerReason_legacy";
CREATE TYPE "AiLedgerReason" AS ENUM (
  'MONTHLY_GRANT',
  'TOPUP',
  'USAGE_RESERVE',
  'USAGE_SETTLE',
  'USAGE_RELEASE',
  'USAGE_REFUND',
  'ADMIN_ADJUST',
  'PROMO_GRANT'
);
ALTER TABLE "ai_token_ledger"
  ALTER COLUMN "reason" TYPE "AiLedgerReason"
  USING ('ADMIN_ADJUST'::"AiLedgerReason");
DROP TYPE "AiLedgerReason_legacy";

ALTER TABLE "ai_token_ledger" RENAME TO "ai_credit_ledger";
ALTER TABLE "ai_credit_ledger" RENAME COLUMN "delta_tokens" TO "delta_credits";
ALTER TABLE "ai_credit_ledger" RENAME COLUMN "balance_after" TO "balance_after_credits";
ALTER TABLE "ai_credit_ledger"
  ADD COLUMN "agent_run_id" TEXT,
  ADD COLUMN "reservation_id" TEXT,
  ADD COLUMN "pricing_revision_id" TEXT,
  ADD COLUMN "reserved_after_credits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "provider_cost_microusd" BIGINT,
  ADD COLUMN "retail_cost_microusd" BIGINT;

ALTER INDEX "ai_token_ledger_pkey" RENAME TO "ai_credit_ledger_pkey";
ALTER INDEX "ai_token_ledger_idempotency_key_key" RENAME TO "ai_credit_ledger_idempotency_key_key";
ALTER INDEX "ai_token_ledger_user_created_idx" RENAME TO "ai_credit_ledger_user_created_idx";
ALTER INDEX "ai_token_ledger_reason_created_idx" RENAME TO "ai_credit_ledger_reason_created_idx";

ALTER TABLE "ai_credit_ledger" RENAME CONSTRAINT "ai_token_ledger_user_id_fkey" TO "ai_credit_ledger_user_id_fkey";
ALTER TABLE "ai_credit_ledger" RENAME CONSTRAINT "ai_token_ledger_subscription_id_fkey" TO "ai_credit_ledger_subscription_id_fkey";
ALTER TABLE "ai_credit_ledger" RENAME CONSTRAINT "ai_token_ledger_order_id_fkey" TO "ai_credit_ledger_order_id_fkey";

CREATE TYPE "AiCreditReservationStatus" AS ENUM (
  'ACTIVE',
  'SETTLED',
  'RELEASED',
  'EXPIRED',
  'FAILED',
  'RECONCILIATION_REQUIRED'
);

CREATE TYPE "AiUsageRecordStatus" AS ENUM (
  'COMPLETED',
  'FAILED',
  'RECONCILIATION_REQUIRED'
);

CREATE TABLE "ai_model_pricing" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "service_tier" TEXT NOT NULL DEFAULT 'default',
  "processing_region" TEXT NOT NULL DEFAULT 'global',
  "input_microusd_per_million" BIGINT NOT NULL,
  "cached_input_microusd_per_million" BIGINT NOT NULL,
  "cache_write_microusd_per_million" BIGINT,
  "output_microusd_per_million" BIGINT NOT NULL,
  "long_context_threshold_tokens" INTEGER,
  "long_input_multiplier_bps" INTEGER,
  "long_output_multiplier_bps" INTEGER,
  "markupBps" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_until" TIMESTAMP(3),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_model_pricing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_credit_reservations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "agent_run_id" TEXT NOT NULL,
  "status" "AiCreditReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "reserved_credits" BIGINT NOT NULL,
  "settled_credits" BIGINT NOT NULL DEFAULT 0,
  "idempotency_key" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "settled_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "reconciliation_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_credit_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_records" (
  "id" TEXT NOT NULL,
  "agent_run_id" TEXT NOT NULL,
  "call_index" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "model_class" TEXT NOT NULL,
  "service_tier" TEXT NOT NULL DEFAULT 'default',
  "processing_region" TEXT NOT NULL DEFAULT 'global',
  "response_id" TEXT,
  "request_id" TEXT,
  "input_tokens" BIGINT NOT NULL DEFAULT 0,
  "cached_input_tokens" BIGINT NOT NULL DEFAULT 0,
  "cache_write_tokens" BIGINT NOT NULL DEFAULT 0,
  "output_tokens" BIGINT NOT NULL DEFAULT 0,
  "reasoning_tokens" BIGINT NOT NULL DEFAULT 0,
  "provider_cost_microusd" BIGINT NOT NULL DEFAULT 0,
  "retail_cost_microusd" BIGINT NOT NULL DEFAULT 0,
  "pricing_revision_id" TEXT NOT NULL,
  "pricing_snapshot" JSONB NOT NULL,
  "status" "AiUsageRecordStatus" NOT NULL DEFAULT 'COMPLETED',
  "error_code" TEXT,
  "latency_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_agent_runs" DROP CONSTRAINT "ai_agent_runs_conversation_id_fkey";
ALTER TABLE "ai_agent_runs" ALTER COLUMN "conversation_id" DROP NOT NULL;
ALTER TABLE "ai_agent_runs"
  ADD COLUMN "model_class" TEXT,
  ADD COLUMN "routing_decision" JSONB,
  ADD COLUMN "reserved_credits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "charged_credits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "provider_cost_microusd" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "retail_cost_microusd" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "model_call_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "idempotency_key" TEXT;

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_agent_conversations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_trace_logs" ADD COLUMN "agent_run_id" TEXT;

CREATE UNIQUE INDEX "ai_model_pricing_revision_key" ON "ai_model_pricing"("provider", "model", "service_tier", "processing_region", "revision");
CREATE INDEX "ai_model_pricing_effective_idx" ON "ai_model_pricing"("provider", "model", "service_tier", "processing_region", "effective_from");
CREATE INDEX "ai_model_pricing_active_window_idx" ON "ai_model_pricing"("is_active", "effective_from", "effective_until");
CREATE UNIQUE INDEX "ai_credit_reservations_agent_run_id_key" ON "ai_credit_reservations"("agent_run_id");
CREATE UNIQUE INDEX "ai_credit_reservations_idempotency_key_key" ON "ai_credit_reservations"("idempotency_key");
CREATE INDEX "ai_credit_reservations_user_status_expiry_idx" ON "ai_credit_reservations"("user_id", "status", "expires_at");
CREATE INDEX "ai_credit_reservations_status_expiry_idx" ON "ai_credit_reservations"("status", "expires_at");
CREATE UNIQUE INDEX "ai_usage_records_response_id_key" ON "ai_usage_records"("response_id");
CREATE UNIQUE INDEX "ai_usage_records_run_call_key" ON "ai_usage_records"("agent_run_id", "call_index");
CREATE INDEX "ai_usage_records_provider_model_created_idx" ON "ai_usage_records"("provider", "model", "created_at" DESC);
CREATE INDEX "ai_usage_records_status_created_idx" ON "ai_usage_records"("status", "created_at" DESC);
CREATE UNIQUE INDEX "ai_agent_runs_idempotency_key_key" ON "ai_agent_runs"("idempotency_key");
CREATE INDEX "ai_credit_ledger_agent_run_idx" ON "ai_credit_ledger"("agent_run_id");
CREATE INDEX "ai_credit_ledger_reservation_idx" ON "ai_credit_ledger"("reservation_id");
CREATE INDEX "ai_trace_logs_agent_run_idx" ON "ai_trace_logs"("agent_run_id");

ALTER TABLE "ai_credit_reservations" ADD CONSTRAINT "ai_credit_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_reservations" ADD CONSTRAINT "ai_credit_reservations_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_reservations" ADD CONSTRAINT "ai_credit_reservations_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "ai_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "ai_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_pricing_revision_id_fkey" FOREIGN KEY ("pricing_revision_id") REFERENCES "ai_model_pricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "ai_agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ai_credit_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_pricing_revision_id_fkey" FOREIGN KEY ("pricing_revision_id") REFERENCES "ai_model_pricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_trace_logs" ADD CONSTRAINT "ai_trace_logs_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "ai_agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ai_model_pricing" (
  "id", "provider", "model", "service_tier", "processing_region",
  "input_microusd_per_million", "cached_input_microusd_per_million",
  "cache_write_microusd_per_million", "output_microusd_per_million",
  "long_context_threshold_tokens", "long_input_multiplier_bps",
  "long_output_multiplier_bps", "markupBps", "revision",
  "effective_from", "updated_at"
) VALUES
  ('pricing_openai_gpt5nano_default_global_r1', 'openai', 'gpt-5-nano', 'default', 'global', 50000, 5000, NULL, 400000, NULL, NULL, NULL, 25000, 1, '2026-08-03T00:00:00.000Z', CURRENT_TIMESTAMP),
  ('pricing_openai_gpt56luna_default_global_r1', 'openai', 'gpt-5.6-luna', 'default', 'global', 200000, 20000, 250000, 1200000, 272000, 20000, 15000, 22000, 1, '2026-08-03T00:00:00.000Z', CURRENT_TIMESTAMP),
  ('pricing_openai_gpt56terra_default_global_r1', 'openai', 'gpt-5.6-terra', 'default', 'global', 2000000, 200000, 2500000, 12000000, 272000, 20000, 15000, 21000, 1, '2026-08-03T00:00:00.000Z', CURRENT_TIMESTAMP),
  ('pricing_openai_gpt56sol_default_global_r1', 'openai', 'gpt-5.6-sol', 'default', 'global', 5000000, 500000, 6250000, 30000000, 272000, 20000, 15000, 20000, 1, '2026-08-03T00:00:00.000Z', CURRENT_TIMESTAMP);
