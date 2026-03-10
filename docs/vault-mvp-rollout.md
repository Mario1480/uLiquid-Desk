# Vault MVP Rollout Runbook

## Ziel
Stabiler interner Rollout des MasterVault/BotVault-Systems mit nachvollziehbarer Migration, Backfill und Verifikation.

## Preconditions
1. DB-Backup/Snapshot vor Rollout erstellt.
2. Deployment mit aktuellen Vault-Migrationen ist vorbereitet.
3. Team hat Zugriff auf API-Logs (JSON lines).
4. Optional: Lastarmes Wartungsfenster fuer den initialen Backfill.

## Rollout-Reihenfolge
1. Migration deployen:
```bash
npx prisma migrate deploy
```
2. API deployen.
3. Dry-run des Backfills:
```bash
npm -w apps/api run backfill:vaults-mvp -- --dry-run
```
4. Live-Backfill ausfuehren:
```bash
npm -w apps/api run backfill:vaults-mvp -- --process-pending-fills --fill-batch-limit 300
```
5. Jobs sicherstellen:
- `VAULT_ACCOUNTING_ENABLED=1`
- `BOT_VAULT_RISK_GUARD_ENABLED=1`

## Verifikation nach Rollout
1. MasterVault-Abdeckung:
```sql
select count(*) as users_without_master_vault
from users u
left join master_vaults mv on mv.user_id = u.id
where mv.id is null;
```
2. Grid-zu-BotVault-Abdeckung (nicht archivierte Instanzen):
```sql
select count(*) as active_grids_without_bot_vault
from grid_bot_instances g
left join bot_vaults bv on bv.grid_instance_id = g.id
where g.archived_at is null
  and bv.id is null;
```
3. Fee-Engine-Audit (Stichprobe):
```sql
select id, bot_vault_id, event_type, profit_base, fee_amount, created_at
from fee_events
order by created_at desc
limit 50;
```
4. Log-Signale pruefen:
- `vault_master_balance_change`
- `vault_fee_settlement_applied`
- `vault_lifecycle_transition`
- `vault_lifecycle_transition_rejected`

## Rollback/Containment
1. Jobs temporär deaktivieren:
- `VAULT_ACCOUNTING_ENABLED=0`
- `BOT_VAULT_RISK_GUARD_ENABLED=0`
2. API neu starten.
3. Vor Analyse keine manuellen Korrekturen ohne Audit (CashEvent/FeeEvent/Ledger) ausfuehren.
4. Bei kritischem Datenproblem: DB-Snapshot-Restore gemaess Betriebsprozess.

## Hinweise
1. Der Backfill ist idempotent ueber `ensure*`-Pfade.
2. Historische Profit-Share-Daten werden nicht rueckwirkend neu berechnet.
3. `--dry-run` schreibt keine neuen Vault-Objekte und eignet sich fuer Vorabchecks.

## Operations Playbook
### Agent-Secret Rotation
1. Betroffenen BotVault zuerst auf `PAUSED` oder `CLOSE_ONLY` setzen.
2. Neuen Agent-Key ausserhalb der DB erzeugen und verschluesselt fuer den aktiven Secret-Provider hinterlegen:
- lokal/dev: `HYPERLIQUID_AGENT_SECRETS_ENCRYPTED_JSON`
- prod spaeter: KMS/Secret-Manager ueber denselben Provider-Contract
3. In der DB nur Metadaten aktualisieren:
- `agent_wallet`
- `agent_wallet_version`
- optional `agent_secret_ref`
4. Runner innerhalb weniger Sekunden pruefen:
- alter Executor-Handle wird verworfen
- neuer Handle startet mit neuer `agentWalletVersion`
- keine Klartext-Secrets in Logs oder `executionMetadata`

### Kill Switch / Close-only All
1. Global neue Risikoaufnahme stoppen:
- Admin UI: `/admin/vault-safety`
- API: `PUT /admin/settings/vault-safety` mit `haltNewOrders=true`
2. User-weit auf Close-only schalten:
- API: `POST /admin/users/:id/vaults/close-only-all`
- oder `closeOnlyAllUserIds` im Safety-Setting setzen
3. Erwartetes Verhalten:
- neue nicht-reduce-only Orders stoppen innerhalb von ca. 2-3 Sekunden
- bestehende Entry-Orders werden gecancelt
- Exit-/Reduce-only Verhalten bleibt moeglich

### Live Mode Switch Checklist
1. Vor dem Umschalten auf `onchain_simulated` oder `onchain_live` pruefen:
- WalletConnect/Web3-Flow im Frontend funktioniert
- `factoryAddress`, `usdcAddress`, `rpcUrl`, `confirmations` sind gesetzt
- `vaultOnchainIndexer` und `botVaultTradingReconciliation` laufen ohne Fehler
2. Erst `onchain_simulated` aktivieren und einen kompletten Happy Path durchspielen:
- create master vault
- deposit
- create bot vault
- claim/close
3. Danach `onchain_live` nur freischalten, wenn:
- keine offenen Health-Fehler in `/admin/vault-operations`
- keine `laggingVaults`
- keine `pendingOnchainActions`, die schon ueberfaellig sind
4. Nach dem Umschalten:
- `/health` pruefen
- `/admin/vault-operations` auf `mode`, `provider`, Job-Gesundheit und letzte Actions pruefen

### Expected Reconciliation Delays
1. Trading-Reconciliation:
- normal: innerhalb von 30-60 Sekunden
- Warnschwelle: `BOT_VAULT_TRADING_RECONCILIATION_LAG_ALERT_SECONDS`
2. Onchain-Indexer:
- normal: wenige Bloecke bzw. unter 60 Sekunden
- Warnschwelle: `VAULT_ONCHAIN_INDEXER_LAG_ALERT_SECONDS` und `VAULT_ONCHAIN_INDEXER_LAG_ALERT_BLOCKS`
3. Bei Pending- oder Lag-Zustaenden immer zuerst auf `/admin/vault-operations` und die strukturierten Warnlogs schauen, bevor man manuell eingreift.

### Targeted Reconcile / Recovery Tooling
1. Einzelnen BotVault gezielt neu reconciliieren:
```bash
npm -w apps/api run vaults:reconcile:bot -- --bot-vault-id <BOT_VAULT_ID>
```
2. Nur aktuellen Report/Audit ohne neue Fetch-Mutationen lesen:
```bash
npm -w apps/api run vaults:reconcile:bot -- --bot-vault-id <BOT_VAULT_ID> --report-only --audit-limit 100
```
3. Batch-Reconcile fuer mehrere Hyperliquid-BotVaults:
```bash
npm -w apps/api run vaults:reconcile:all -- --limit 50
```
4. Erwartung:
- Re-Runs sind idempotent
- keine doppelten Fills/Funding-Events
- Report/Audit koennen nach einem Incident gezielt fuer einen Vault neu aufgebaut werden

### Force-Close Decision Guide
1. **Nicht force-closen**, wenn:
- der BotVault noch offene Positionen sauber abbauen kann
- Reconciliation nur leicht hinterherhaengt
- der Indexer noch pending, aber gesund ist
2. **Force-close erwägen**, wenn:
- Positionen fachlich bereits manuell/exchange-seitig geschlossen sind
- normale Close-Pfade wiederholt blockieren
- ein Incident dokumentiert ist und Operator die Abweichung verstanden hat
3. Nach jedem Force-Close:
- sofort gezielten Reconcile fuer den BotVault fahren
- PnL-Report und Audit pruefen
- `recentExecutionIssues` und `recentOnchainActions` in `/admin/vault-operations` kontrollieren

### Alerting / Health Checks
1. Kritische API-Signale:
- `vault_reconciliation_lag`
- `vault_reconciliation_stalled`
- `vault_event_indexing_lag`
- `api_rate_limit_blocked`
2. Kritische Runner-Signale:
- `runner_nonce_stuck`
- `runner_failed_signing`
- `runner_repeated_order_rejects`
- `runner_exchange_divergence`
3. Health-Endpunkte nach Deploy pruefen:
- API `/health` fuer `vaultSafety`, `vaultOnchainIndexer`, `botVaultTradingReconciliation`
- Runner `/healthz` fuer `botVaultExecutionSupervisor`
4. Correlation:
- `x-request-id` und `x-correlation-id` bei manuellen Ops-Calls mitschicken, damit API- und Runner-Logs zusammenhaengen

## Production-Hardening TODO
1. Echte Hyperliquid-ExecutionProvider-Implementierung inkl. Signierung und robustem Timeout/Retry.
2. Zusätzliche Security-Pruefungen:
- Rate Limits fuer Deposit/Withdraw/Lifecycle Mutations.
- Serverseitige Idempotency-Key-Policy (Format, TTL, Replay-Audit).
- Erweiterte AuthZ-Invarianten fuer Cross-Resource-Flows.
3. Reconciliation-Job:
- Abgleich BotVault-Werte gegen Provider-Equity/Positionen.
- Drift-Alerts und Auto-Markierung auf `ERROR`.
4. Retry-/Idempotency-Hardening:
- Outbox/Inbox Muster fuer providerseitige Side-Effects.
- Dead-letter Handling fuer wiederholt fehlgeschlagene Lifecycle-Aktionen.
