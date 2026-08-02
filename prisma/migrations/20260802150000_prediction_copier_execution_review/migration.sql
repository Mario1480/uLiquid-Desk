CREATE TABLE "prediction_copier_executions" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "exchange_account_id" TEXT NOT NULL,
    "prediction_state_id" TEXT NOT NULL,
    "prediction_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "side" TEXT,
    "symbol" TEXT NOT NULL,
    "market_type" TEXT NOT NULL DEFAULT 'perp',
    "status" TEXT NOT NULL DEFAULT 'reviewed',
    "order_type" TEXT NOT NULL,
    "requested_qty" DOUBLE PRECISION,
    "requested_notional_usd" DOUBLE PRECISION,
    "reference_price" DOUBLE PRECISION,
    "limit_price" DOUBLE PRECISION,
    "stop_loss_price" DOUBLE PRECISION,
    "take_profit_price" DOUBLE PRECISION,
    "leverage" INTEGER,
    "order_id" TEXT,
    "failure_reason" TEXT,
    "prediction_json" JSONB NOT NULL,
    "rule_snapshot_json" JSONB NOT NULL,
    "gate_snapshot_json" JSONB NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prediction_copier_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prediction_copier_executions_idempotency_key_key"
ON "prediction_copier_executions"("idempotency_key");

CREATE INDEX "prediction_copier_execution_bot_created_idx"
ON "prediction_copier_executions"("bot_id", "created_at" DESC);

CREATE INDEX "prediction_copier_execution_user_created_idx"
ON "prediction_copier_executions"("user_id", "created_at" DESC);

CREATE INDEX "prediction_copier_execution_prediction_created_idx"
ON "prediction_copier_executions"("prediction_state_id", "created_at" DESC);

ALTER TABLE "prediction_copier_executions"
ADD CONSTRAINT "prediction_copier_executions_bot_id_fkey"
FOREIGN KEY ("bot_id") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
