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
