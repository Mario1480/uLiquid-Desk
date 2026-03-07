ALTER TABLE master_vaults
  ADD COLUMN IF NOT EXISTS onchain_address TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS master_vaults_onchain_address_key
  ON master_vaults(onchain_address)
  WHERE onchain_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS onchain_actions (
  id TEXT PRIMARY KEY,
  action_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared',
  user_id TEXT,
  master_vault_id TEXT,
  bot_vault_id TEXT,
  chain_id INTEGER NOT NULL,
  to_address TEXT NOT NULL,
  data_hex TEXT NOT NULL,
  value_wei TEXT NOT NULL DEFAULT '0',
  tx_hash TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS onchain_actions_action_key_key
  ON onchain_actions(action_key);

CREATE UNIQUE INDEX IF NOT EXISTS onchain_actions_tx_hash_key
  ON onchain_actions(tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS onchain_actions_status_created_idx
  ON onchain_actions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS onchain_actions_user_created_idx
  ON onchain_actions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS onchain_actions_master_created_idx
  ON onchain_actions(master_vault_id, created_at DESC);

CREATE INDEX IF NOT EXISTS onchain_actions_bot_created_idx
  ON onchain_actions(bot_vault_id, created_at DESC);

ALTER TABLE onchain_actions
  ADD CONSTRAINT onchain_actions_user_fk
  FOREIGN KEY (user_id) REFERENCES "User"(id)
  ON DELETE SET NULL;

ALTER TABLE onchain_actions
  ADD CONSTRAINT onchain_actions_master_vault_fk
  FOREIGN KEY (master_vault_id) REFERENCES master_vaults(id)
  ON DELETE SET NULL;

ALTER TABLE onchain_actions
  ADD CONSTRAINT onchain_actions_bot_vault_fk
  FOREIGN KEY (bot_vault_id) REFERENCES bot_vaults(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS onchain_indexed_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS onchain_indexed_events_event_key_key
  ON onchain_indexed_events(event_key);

CREATE INDEX IF NOT EXISTS onchain_indexed_events_chain_block_log_idx
  ON onchain_indexed_events(chain_id, block_number, log_index);

CREATE INDEX IF NOT EXISTS onchain_indexed_events_name_created_idx
  ON onchain_indexed_events(event_name, created_at DESC);

CREATE TABLE IF NOT EXISTS onchain_sync_cursors (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  last_processed_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
