-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BotVaultStatus" AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED', 'CLOSED', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BotTemplateStrategyType" AS ENUM ('FUTURES_GRID', 'DCA', 'COPY_TRADE', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BotRiskProfile" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FeeEventType" AS ENUM ('PROFIT_SHARE', 'PERFORMANCE_FEE', 'ADJUSTMENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CashEventType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'ALLOCATE_TO_BOT', 'RETURN_FROM_BOT', 'FEE_DEBIT', 'ADJUSTMENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BotOrderSide" AS ENUM ('BUY', 'SELL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BotOrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BotOrderStatus" AS ENUM ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "bot_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "strategy_type" "BotTemplateStrategyType" NOT NULL,
  "allowed_symbols" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "max_leverage" INTEGER NOT NULL,
  "risk_profile" "BotRiskProfile" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bot_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fee_events" (
  "id" TEXT NOT NULL,
  "bot_vault_id" TEXT NOT NULL,
  "event_type" "FeeEventType" NOT NULL,
  "profit_base" DOUBLE PRECISION NOT NULL,
  "fee_amount" DOUBLE PRECISION NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cash_events" (
  "id" TEXT NOT NULL,
  "master_vault_id" TEXT NOT NULL,
  "bot_vault_id" TEXT,
  "event_type" "CashEventType" NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bot_orders" (
  "id" TEXT NOT NULL,
  "bot_vault_id" TEXT NOT NULL,
  "exchange" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" "BotOrderSide" NOT NULL,
  "order_type" "BotOrderType" NOT NULL,
  "status" "BotOrderStatus" NOT NULL DEFAULT 'OPEN',
  "client_order_id" TEXT,
  "exchange_order_id" TEXT,
  "price" DOUBLE PRECISION,
  "qty" DOUBLE PRECISION NOT NULL,
  "reduce_only" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bot_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bot_fills" (
  "id" TEXT NOT NULL,
  "bot_vault_id" TEXT NOT NULL,
  "bot_order_id" TEXT,
  "exchange_fill_id" TEXT,
  "exchange_order_id" TEXT,
  "side" "BotOrderSide" NOT NULL,
  "symbol" TEXT NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "notional" DOUBLE PRECISION NOT NULL,
  "fee_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "realized_pnl" DOUBLE PRECISION,
  "fill_ts" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_fills_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "master_vaults"
  ADD COLUMN IF NOT EXISTS "free_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reserved_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_deposited" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_withdrawn" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "bot_vaults"
  ADD COLUMN IF NOT EXISTS "template_id" TEXT,
  ADD COLUMN IF NOT EXISTS "vault_address" TEXT,
  ADD COLUMN IF NOT EXISTS "agent_wallet" TEXT,
  ADD COLUMN IF NOT EXISTS "principal_allocated" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "principal_returned" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "realized_pnl_net" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "fee_paid_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "high_water_mark" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Convert legacy text status to enum when needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bot_vaults'
      AND column_name = 'status'
      AND udt_name <> 'BotVaultStatus'
  ) THEN
    ALTER TABLE "bot_vaults"
      ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "bot_vaults"
      ALTER COLUMN "status" TYPE "BotVaultStatus"
      USING (
        CASE UPPER(COALESCE("status"::text, 'ACTIVE'))
          WHEN 'PAUSED' THEN 'PAUSED'::"BotVaultStatus"
          WHEN 'STOPPED' THEN 'STOPPED'::"BotVaultStatus"
          WHEN 'CLOSED' THEN 'CLOSED'::"BotVaultStatus"
          WHEN 'ERROR' THEN 'ERROR'::"BotVaultStatus"
          ELSE 'ACTIVE'::"BotVaultStatus"
        END
      );
  END IF;
END $$;

-- Seed legacy template
INSERT INTO "bot_templates" (
  "id",
  "name",
  "strategy_type",
  "allowed_symbols",
  "max_leverage",
  "risk_profile",
  "is_active",
  "created_at",
  "updated_at"
)
VALUES (
  'legacy_grid_default',
  'Legacy Grid Template',
  'FUTURES_GRID'::"BotTemplateStrategyType",
  ARRAY[]::TEXT[],
  125,
  'MEDIUM'::"BotRiskProfile",
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- Backfill defaults
UPDATE "bot_vaults"
SET "template_id" = 'legacy_grid_default'
WHERE "template_id" IS NULL OR BTRIM("template_id") = '';

UPDATE "bot_vaults"
SET
  "principal_allocated" = CASE WHEN COALESCE("principal_allocated", 0) = 0 THEN COALESCE("allocated_usd", 0) ELSE "principal_allocated" END,
  "principal_returned" = CASE WHEN COALESCE("principal_returned", 0) = 0 THEN COALESCE("withdrawn_usd", 0) ELSE "principal_returned" END,
  "realized_pnl_net" = CASE WHEN COALESCE("realized_pnl_net", 0) = 0 THEN COALESCE("realized_net_usd", 0) ELSE "realized_pnl_net" END,
  "fee_paid_total" = CASE WHEN COALESCE("fee_paid_total", 0) = 0 THEN COALESCE("profit_share_accrued_usd", 0) ELSE "fee_paid_total" END,
  "high_water_mark" = CASE WHEN COALESCE("high_water_mark", 0) = 0 THEN GREATEST(COALESCE("realized_net_usd", 0), 0) ELSE "high_water_mark" END;

UPDATE "master_vaults"
SET
  "free_balance" = CASE WHEN COALESCE("free_balance", 0) = 0 THEN COALESCE("available_usd", 0) ELSE "free_balance" END,
  "total_withdrawn" = CASE WHEN COALESCE("total_withdrawn", 0) = 0 THEN COALESCE("total_withdrawn_usd", 0) ELSE "total_withdrawn" END;

ALTER TABLE "bot_vaults"
  ALTER COLUMN "template_id" SET DEFAULT 'legacy_grid_default',
  ALTER COLUMN "template_id" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE',
  ALTER COLUMN "status" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_templates_active_strategy_idx"
  ON "bot_templates"("is_active", "strategy_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_vaults_template_idx"
  ON "bot_vaults"("template_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_vaults_status_updated_idx"
  ON "bot_vaults"("status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fee_events_bot_vault_created_idx"
  ON "fee_events"("bot_vault_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cash_events_master_vault_created_idx"
  ON "cash_events"("master_vault_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cash_events_bot_vault_created_idx"
  ON "cash_events"("bot_vault_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_orders_bot_vault_created_idx"
  ON "bot_orders"("bot_vault_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_orders_exchange_order_idx"
  ON "bot_orders"("exchange_order_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_fills_bot_vault_fill_ts_idx"
  ON "bot_fills"("bot_vault_id", "fill_ts" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_fills_bot_order_idx"
  ON "bot_fills"("bot_order_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bot_fills_exchange_fill_idx"
  ON "bot_fills"("exchange_fill_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "bot_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_bot_vault_id_fkey"
    FOREIGN KEY ("bot_vault_id") REFERENCES "bot_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_master_vault_id_fkey"
    FOREIGN KEY ("master_vault_id") REFERENCES "master_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_bot_vault_id_fkey"
    FOREIGN KEY ("bot_vault_id") REFERENCES "bot_vaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_bot_vault_id_fkey"
    FOREIGN KEY ("bot_vault_id") REFERENCES "bot_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "bot_fills" ADD CONSTRAINT "bot_fills_bot_vault_id_fkey"
    FOREIGN KEY ("bot_vault_id") REFERENCES "bot_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "bot_fills" ADD CONSTRAINT "bot_fills_bot_order_id_fkey"
    FOREIGN KEY ("bot_order_id") REFERENCES "bot_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Constraints (base validation)
DO $$ BEGIN
  ALTER TABLE "master_vaults" ADD CONSTRAINT "master_vaults_free_balance_non_negative_chk"
    CHECK ("free_balance" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "master_vaults" ADD CONSTRAINT "master_vaults_reserved_balance_non_negative_chk"
    CHECK ("reserved_balance" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "master_vaults" ADD CONSTRAINT "master_vaults_total_deposited_non_negative_chk"
    CHECK ("total_deposited" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "master_vaults" ADD CONSTRAINT "master_vaults_total_withdrawn_non_negative_chk"
    CHECK ("total_withdrawn" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_templates" ADD CONSTRAINT "bot_templates_max_leverage_positive_chk"
    CHECK ("max_leverage" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_principal_allocated_non_negative_chk"
    CHECK ("principal_allocated" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_principal_returned_non_negative_chk"
    CHECK ("principal_returned" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_fee_paid_total_non_negative_chk"
    CHECK ("fee_paid_total" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_high_water_mark_non_negative_chk"
    CHECK ("high_water_mark" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_vault_address_format_chk"
    CHECK ("vault_address" IS NULL OR "vault_address" ~* '^0x[0-9a-f]{40}$');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_vaults" ADD CONSTRAINT "bot_vaults_agent_wallet_format_chk"
    CHECK ("agent_wallet" IS NULL OR "agent_wallet" ~* '^0x[0-9a-f]{40}$');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_profit_base_non_negative_chk"
    CHECK ("profit_base" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_fee_amount_non_negative_chk"
    CHECK ("fee_amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_amount_positive_chk"
    CHECK ("amount" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_qty_positive_chk"
    CHECK ("qty" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_orders" ADD CONSTRAINT "bot_orders_price_positive_when_present_chk"
    CHECK ("price" IS NULL OR "price" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_fills" ADD CONSTRAINT "bot_fills_qty_positive_chk"
    CHECK ("qty" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_fills" ADD CONSTRAINT "bot_fills_price_positive_chk"
    CHECK ("price" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_fills" ADD CONSTRAINT "bot_fills_notional_non_negative_chk"
    CHECK ("notional" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bot_fills" ADD CONSTRAINT "bot_fills_fee_amount_non_negative_chk"
    CHECK ("fee_amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
