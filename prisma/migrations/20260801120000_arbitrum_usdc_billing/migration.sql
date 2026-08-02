CREATE TYPE "SubscriptionTermStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'GRACE', 'EXPIRED');
CREATE TYPE "SubscriptionNotificationChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'BOTH');
CREATE TYPE "SubscriptionNotificationDeliveryChannel" AS ENUM ('EMAIL', 'TELEGRAM');
CREATE TYPE "SubscriptionNotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'FAILED');

ALTER TABLE "billing_orders"
  ADD COLUMN "cart_fingerprint" TEXT;

ALTER TABLE "user_subscriptions"
  ADD COLUMN "entitlement_sync_pending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "entitlement_sync_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "entitlement_sync_last_error" TEXT,
  ADD COLUMN "entitlement_synced_at" TIMESTAMP(3);

ALTER TABLE "subscription_capacity_grants"
  ADD COLUMN "term_id" TEXT,
  ADD COLUMN "source_key" TEXT;

ALTER TABLE "ai_token_ledger"
  ADD COLUMN "idempotency_key" TEXT;

CREATE TABLE "billing_payment_configurations" (
  "id" TEXT NOT NULL,
  "chain_id" INTEGER NOT NULL,
  "token_address" TEXT NOT NULL,
  "token_decimals" INTEGER NOT NULL,
  "treasury_address" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "last_rpc_block_number" BIGINT,
  "last_rpc_check_at" TIMESTAMP(3),
  "last_rpc_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "billing_payment_configurations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_onchain_payments" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "chain_id" INTEGER NOT NULL,
  "token_address" TEXT NOT NULL,
  "token_decimals" INTEGER NOT NULL,
  "expected_sender_address" TEXT NOT NULL,
  "treasury_address" TEXT NOT NULL,
  "treasury_config_revision" INTEGER NOT NULL,
  "expected_amount_raw" BIGINT NOT NULL,
  "tx_hash" TEXT,
  "scan_from_block" BIGINT,
  "block_number" BIGINT,
  "block_hash" TEXT,
  "confirmations" INTEGER NOT NULL DEFAULT 0,
  "verification_attempts" INTEGER NOT NULL DEFAULT 0,
  "last_checked_at" TIMESTAMP(3),
  "next_retry_at" TIMESTAMP(3),
  "last_error" TEXT,
  "verified_at" TIMESTAMP(3),
  "discovered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "billing_onchain_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_onchain_scan_cursors" (
  "id" TEXT NOT NULL,
  "chain_id" INTEGER NOT NULL,
  "token_address" TEXT NOT NULL,
  "treasury_address" TEXT NOT NULL,
  "last_scanned_block" BIGINT NOT NULL,
  "last_successful_at" TIMESTAMP(3),
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "billing_onchain_scan_cursors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_terms" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "order_id" TEXT,
  "status" "SubscriptionTermStatus" NOT NULL DEFAULT 'SCHEDULED',
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "grace_ends_at" TIMESTAMP(3) NOT NULL,
  "entitlement_snapshot" JSONB NOT NULL,
  "monthly_ai_tokens" BIGINT NOT NULL DEFAULT 0,
  "next_ai_grant_at" TIMESTAMP(3),
  "ai_grant_cycles_applied" INTEGER NOT NULL DEFAULT 0,
  "activated_at" TIMESTAMP(3),
  "grace_entered_at" TIMESTAMP(3),
  "expired_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscription_terms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_notification_preferences" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "channel" "SubscriptionNotificationChannel" NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscription_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_notification_deliveries" (
  "id" TEXT NOT NULL,
  "term_id" TEXT NOT NULL,
  "milestone" TEXT NOT NULL,
  "channel" "SubscriptionNotificationDeliveryChannel" NOT NULL,
  "status" "SubscriptionNotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "locked_at" TIMESTAMP(3),
  "next_attempt_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscription_notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_onchain_payments_order_id_key" ON "billing_onchain_payments"("order_id");
CREATE UNIQUE INDEX "billing_onchain_payments_tx_hash_key" ON "billing_onchain_payments"("tx_hash");
CREATE INDEX "billing_onchain_payments_scan_idx" ON "billing_onchain_payments"("chain_id", "token_address", "treasury_address");
CREATE INDEX "billing_onchain_payments_retry_idx" ON "billing_onchain_payments"("next_retry_at", "created_at");
CREATE UNIQUE INDEX "billing_onchain_scan_cursors_scope_key" ON "billing_onchain_scan_cursors"("chain_id", "token_address", "treasury_address");
CREATE INDEX "billing_onchain_scan_cursors_retry_idx" ON "billing_onchain_scan_cursors"("next_retry_at");
CREATE UNIQUE INDEX "subscription_terms_order_id_key" ON "subscription_terms"("order_id");
CREATE INDEX "subscription_terms_user_window_idx" ON "subscription_terms"("user_id", "starts_at", "ends_at");
CREATE INDEX "subscription_terms_status_start_idx" ON "subscription_terms"("status", "starts_at");
CREATE INDEX "subscription_terms_status_grace_idx" ON "subscription_terms"("status", "grace_ends_at");
CREATE UNIQUE INDEX "subscription_notification_preferences_user_id_key" ON "subscription_notification_preferences"("user_id");
CREATE UNIQUE INDEX "subscription_notification_deliveries_key" ON "subscription_notification_deliveries"("term_id", "milestone", "channel");
CREATE INDEX "subscription_notification_deliveries_retry_idx" ON "subscription_notification_deliveries"("status", "next_attempt_at");
CREATE UNIQUE INDEX "subscription_capacity_grants_source_key_key" ON "subscription_capacity_grants"("source_key");
CREATE INDEX "subscription_capacity_grants_term_idx" ON "subscription_capacity_grants"("term_id");
CREATE UNIQUE INDEX "ai_token_ledger_idempotency_key_key" ON "ai_token_ledger"("idempotency_key");
CREATE INDEX "user_subscriptions_entitlement_sync_pending_idx" ON "user_subscriptions"("entitlement_sync_pending", "updated_at");

-- The new onchain checkout is intentionally deployed disabled. Preserve unrelated flags,
-- but prevent a previously enabled legacy billing flag from activating the cutover.
UPDATE "GlobalSetting"
SET
  "value" = (
    (CASE
      WHEN jsonb_typeof("value") = 'object' THEN "value"
      ELSE '{}'::jsonb
    END - 'billingWebhookEnabled')
    || '{"billingEnabled": false}'::jsonb
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'admin.billingFeatureFlags.v1';

-- Enforce one payable Arbitrum-USDC order per user, including concurrent checkout requests.
CREATE UNIQUE INDEX "billing_orders_one_open_arbitrum_usdc_user_idx"
  ON "billing_orders"("user_id")
  WHERE "provider" = 'ARBITRUM_USDC' AND "status" IN ('PENDING', 'CONFIRMING');

ALTER TABLE "billing_onchain_payments"
  ADD CONSTRAINT "billing_onchain_payments_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_terms"
  ADD CONSTRAINT "subscription_terms_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_terms"
  ADD CONSTRAINT "subscription_terms_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_terms"
  ADD CONSTRAINT "subscription_terms_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subscription_capacity_grants"
  ADD CONSTRAINT "subscription_capacity_grants_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "subscription_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subscription_notification_preferences"
  ADD CONSTRAINT "subscription_notification_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_notification_deliveries"
  ADD CONSTRAINT "subscription_notification_deliveries_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "subscription_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill only currently active legacy Pro subscriptions. Historical terms cannot be reconstructed reliably.
INSERT INTO "subscription_terms" (
  "id",
  "user_id",
  "subscription_id",
  "status",
  "starts_at",
  "ends_at",
  "grace_ends_at",
  "entitlement_snapshot",
  "monthly_ai_tokens",
  "next_ai_grant_at",
  "ai_grant_cycles_applied",
  "activated_at",
  "created_at",
  "updated_at"
)
SELECT
  'legacy_' || md5("id" || ':' || "user_id"),
  "user_id",
  "id",
  'ACTIVE'::"SubscriptionTermStatus",
  LEAST("created_at", CURRENT_TIMESTAMP),
  "pro_valid_until",
  "pro_valid_until" + INTERVAL '3 days',
  jsonb_build_object(
    'source', 'legacy_backfill',
    'plan', 'PRO',
    'maxRunningBots', "max_running_bots",
    'maxRunningPredictionsAi', "max_running_predictions_ai",
    'maxRunningPredictionsComposite', "max_running_predictions_composite",
    'allowedExchanges', "allowed_exchanges",
    'monthlyAiTokens', "monthly_ai_tokens_included"::text,
    'lines', '[]'::jsonb
  ),
  "monthly_ai_tokens_included",
  NULL,
  1,
  LEAST("created_at", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "user_subscriptions"
WHERE "effective_plan" = 'PRO'
  AND "pro_valid_until" IS NOT NULL
  AND "pro_valid_until" > CURRENT_TIMESTAMP;

-- Associate active legacy capacity grants with the backfilled term without changing
-- independently managed lifetimes. Only billing-backed grants that previously ended
-- exactly with the paid term inherit its three-day grace window.
UPDATE "subscription_capacity_grants" AS grant_row
SET
  "term_id" = term_row."id",
  "valid_until" = term_row."grace_ends_at"
FROM "subscription_terms" AS term_row
WHERE term_row."subscription_id" = grant_row."subscription_id"
  AND term_row."id" LIKE 'legacy_%'
  AND grant_row."order_id" IS NOT NULL
  AND grant_row."valid_until" = term_row."ends_at";

-- Retain the old provider-health audit trail while closing alerts that can no longer recover.
UPDATE "platform_alerts"
SET
  "status" = 'resolved',
  "resolved_at" = CURRENT_TIMESTAMP,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "type" = 'system_health'
  AND "source" = 'system'
  AND "title" = 'System health incident: ccpay'
  AND "status" IN ('open', 'acknowledged');
