CREATE TABLE IF NOT EXISTS bot_funding_events (
  id TEXT PRIMARY KEY,
  bot_vault_id TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'hyperliquid',
  symbol TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  position_side TEXT,
  source_key TEXT NOT NULL,
  funding_ts TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bot_funding_events_source_key_key
  ON bot_funding_events(source_key);

CREATE INDEX IF NOT EXISTS bot_funding_events_bot_vault_funding_ts_idx
  ON bot_funding_events(bot_vault_id, funding_ts DESC);

CREATE INDEX IF NOT EXISTS bot_funding_events_exchange_funding_ts_idx
  ON bot_funding_events(exchange, funding_ts DESC);

ALTER TABLE bot_funding_events
  ADD CONSTRAINT bot_funding_events_bot_vault_fk
  FOREIGN KEY (bot_vault_id) REFERENCES bot_vaults(id)
  ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS bot_vault_pnl_aggregates (
  bot_vault_id TEXT PRIMARY KEY,
  gross_realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  trading_fees_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  funding_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  realized_pnl_net DOUBLE PRECISION NOT NULL DEFAULT 0,
  net_withdrawable_profit DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_flat BOOLEAN NOT NULL DEFAULT TRUE,
  open_position_count INTEGER NOT NULL DEFAULT 0,
  last_fill_ts TIMESTAMPTZ,
  last_funding_ts TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  source_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_vault_pnl_aggregates_flat_updated_idx
  ON bot_vault_pnl_aggregates(is_flat, updated_at DESC);

ALTER TABLE bot_vault_pnl_aggregates
  ADD CONSTRAINT bot_vault_pnl_aggregates_bot_vault_fk
  FOREIGN KEY (bot_vault_id) REFERENCES bot_vaults(id)
  ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS bot_vault_reconciliation_cursors (
  id TEXT PRIMARY KEY,
  bot_vault_id TEXT NOT NULL,
  stream_type TEXT NOT NULL,
  cursor_ts TIMESTAMPTZ,
  cursor_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_vault_reconciliation_cursors_bot_stream_idx
  ON bot_vault_reconciliation_cursors(bot_vault_id, stream_type);

ALTER TABLE bot_vault_reconciliation_cursors
  ADD CONSTRAINT bot_vault_reconciliation_cursors_bot_vault_fk
  FOREIGN KEY (bot_vault_id) REFERENCES bot_vaults(id)
  ON DELETE CASCADE;
