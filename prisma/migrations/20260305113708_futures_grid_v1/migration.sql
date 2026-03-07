-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridBotMode" AS ENUM ('long', 'short', 'neutral', 'cross');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridPriceMode" AS ENUM ('arithmetic', 'geometric');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GridBotInstanceState" AS ENUM ('created', 'running', 'paused', 'stopped', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "grid_bot_templates" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "symbol" TEXT NOT NULL,
  "market_type" TEXT NOT NULL DEFAULT 'perp',
  "mode" "GridBotMode" NOT NULL,
  "grid_mode" "GridPriceMode" NOT NULL,
  "lower_price" DOUBLE PRECISION NOT NULL,
  "upper_price" DOUBLE PRECISION NOT NULL,
  "grid_count" INTEGER NOT NULL,
  "leverage_min" INTEGER NOT NULL DEFAULT 1,
  "leverage_max" INTEGER NOT NULL DEFAULT 3,
  "leverage_default" INTEGER NOT NULL DEFAULT 3,
  "invest_min_usd" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "invest_max_usd" DOUBLE PRECISION NOT NULL DEFAULT 100000,
  "invest_default_usd" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "slippage_default_pct" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  "slippage_min_pct" DOUBLE PRECISION NOT NULL DEFAULT 0.0001,
  "slippage_max_pct" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "tp_default_pct" DOUBLE PRECISION,
  "sl_default_pct" DOUBLE PRECISION,
  "allow_auto_margin" BOOLEAN NOT NULL DEFAULT false,
  "allow_manual_margin_adjust" BOOLEAN NOT NULL DEFAULT true,
  "allow_profit_withdraw" BOOLEAN NOT NULL DEFAULT true,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "grid_bot_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "grid_bot_instances" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "exchange_account_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "bot_id" TEXT NOT NULL,
  "state" "GridBotInstanceState" NOT NULL DEFAULT 'created',
  "invest_usd" DOUBLE PRECISION NOT NULL,
  "leverage" INTEGER NOT NULL DEFAULT 1,
  "extra_margin_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "trigger_price" DOUBLE PRECISION,
  "slippage_pct" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  "tp_pct" DOUBLE PRECISION,
  "sl_pct" DOUBLE PRECISION,
  "auto_margin_enabled" BOOLEAN NOT NULL DEFAULT false,
  "state_json" JSONB,
  "metrics_json" JSONB,
  "last_plan_at" TIMESTAMP(3),
  "last_plan_error" TEXT,
  "last_plan_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "grid_bot_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "grid_bot_order_map" (
  "id" TEXT NOT NULL,
  "instance_id" TEXT NOT NULL,
  "bot_id" TEXT NOT NULL,
  "exchange_order_id" TEXT,
  "client_order_id" TEXT NOT NULL,
  "grid_leg" TEXT NOT NULL,
  "grid_index" INTEGER NOT NULL,
  "intent_type" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "price" DOUBLE PRECISION,
  "qty" DOUBLE PRECISION,
  "reduce_only" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'open',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "grid_bot_order_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "grid_bot_fill_events" (
  "id" TEXT NOT NULL,
  "instance_id" TEXT NOT NULL,
  "bot_id" TEXT NOT NULL,
  "exchange_order_id" TEXT,
  "client_order_id" TEXT,
  "fill_price" DOUBLE PRECISION NOT NULL,
  "fill_qty" DOUBLE PRECISION NOT NULL,
  "fill_notional_usd" DOUBLE PRECISION,
  "fee_usd" DOUBLE PRECISION,
  "side" TEXT NOT NULL,
  "grid_leg" TEXT NOT NULL,
  "grid_index" INTEGER NOT NULL,
  "fill_ts" TIMESTAMP(3) NOT NULL,
  "raw_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "grid_bot_fill_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "grid_bot_templates_workspace_name_version_uniq"
  ON "grid_bot_templates"("workspace_id", "name", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "grid_bot_templates_workspace_published_updated_idx"
  ON "grid_bot_templates"("workspace_id", "is_published", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "grid_bot_instances_bot_id_key"
  ON "grid_bot_instances"("bot_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "grid_bot_instances_user_state_updated_idx"
  ON "grid_bot_instances"("user_id", "state", "updated_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "grid_bot_instances_account_state_idx"
  ON "grid_bot_instances"("exchange_account_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "grid_bot_order_map_instance_client_uniq"
  ON "grid_bot_order_map"("instance_id", "client_order_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "grid_bot_order_map_instance_status_idx"
  ON "grid_bot_order_map"("instance_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "grid_bot_fill_events_instance_fill_ts_idx"
  ON "grid_bot_fill_events"("instance_id", "fill_ts" DESC);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_templates" ADD CONSTRAINT "grid_bot_templates_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_templates" ADD CONSTRAINT "grid_bot_templates_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_instances" ADD CONSTRAINT "grid_bot_instances_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_instances" ADD CONSTRAINT "grid_bot_instances_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_instances" ADD CONSTRAINT "grid_bot_instances_exchange_account_id_fkey"
    FOREIGN KEY ("exchange_account_id") REFERENCES "ExchangeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_instances" ADD CONSTRAINT "grid_bot_instances_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "grid_bot_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_instances" ADD CONSTRAINT "grid_bot_instances_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_order_map" ADD CONSTRAINT "grid_bot_order_map_instance_id_fkey"
    FOREIGN KEY ("instance_id") REFERENCES "grid_bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_order_map" ADD CONSTRAINT "grid_bot_order_map_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_fill_events" ADD CONSTRAINT "grid_bot_fill_events_instance_id_fkey"
    FOREIGN KEY ("instance_id") REFERENCES "grid_bot_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "grid_bot_fill_events" ADD CONSTRAINT "grid_bot_fill_events_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
