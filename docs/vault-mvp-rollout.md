# BotVaultV4 Rollout Runbook

## Ziel

Stabiler Rollout des aktuellen BotVaultV4-Systems mit nachvollziehbarer Migration, Verifikation und Incident-Handhabung.

## Preconditions

1. DB-Backup/Snapshot vor Rollout erstellt.
2. Deployment mit aktuellen Vault-Migrationen ist vorbereitet.
3. `BOT_VAULT_ONCHAIN_CONTRACT_VERSION=v4` ist gesetzt.
4. `BOT_VAULT_V4_FACTORY_ADDRESS` zeigt auf die aktuelle V4-Factory.
5. API- und Runner-Logs sind erreichbar.

## Rollout-Reihenfolge

1. Migration deployen:

```bash
npx prisma migrate deploy
```

2. BotVaultV4-Factory deployen oder vorhandene Adresse verifizieren:

```bash
./scripts/deploy_contracts_vps.sh --mode devnet --target botvaultv4 --env-file .env.prod
```

3. API und Runner deployen.

4. Jobs sicherstellen:

- `VAULT_ACCOUNTING_ENABLED=1`
- `BOT_VAULT_RISK_GUARD_ENABLED=1`

## Verifikation Nach Rollout

1. Neue BotVaults muessen V4 sein:

```sql
select id, vault_address, execution_metadata
from bot_vaults
where created_at > now() - interval '1 day'
order by created_at desc
limit 20;
```

2. Erwartete Metadata:

- `onchainContractVersion: "v4"`
- `feeConfig.totalFeeRatePct`
- `feeConfig.feeConfigLockedAt`

3. Fee-Engine-Audit:

```sql
select id, bot_vault_id, event_type, profit_base, fee_amount, created_at
from fee_events
order by created_at desc
limit 50;
```

4. Log-Signale pruefen:

- `vault_fee_settlement_applied`
- `vault_lifecycle_transition`
- `vault_lifecycle_transition_rejected`
- `bot_vault_v3_controller_settlement_*` may still appear as backend compatibility log names.

## Operations Playbook

### Agent-Secret Rotation

1. Betroffenen BotVault zuerst auf `PAUSED` oder `CLOSE_ONLY` setzen.
2. Neuen Agent-Key erzeugen und ueber den aktiven Secret-Provider hinterlegen.
3. In der DB nur Metadaten aktualisieren:

- `agent_wallet`
- `agent_wallet_version`
- optional `agent_secret_ref`

4. Runner pruefen:

- alter Executor-Handle wird verworfen
- neuer Handle startet mit neuer `agentWalletVersion`
- keine Klartext-Secrets in Logs oder `executionMetadata`

### Kill Switch / Close-only All

1. Neue Risikoaufnahme stoppen:

- Admin UI: `/admin/vault-safety`
- API: `PUT /admin/settings/vault-safety` mit `haltNewOrders=true`

2. User-weit auf Close-only schalten:

- API: `POST /admin/users/:id/vaults/close-only-all`
- oder `closeOnlyAllUserIds` im Safety-Setting setzen

3. Erwartetes Verhalten:

- neue nicht-reduce-only Orders stoppen innerhalb weniger Sekunden
- bestehende Entry-Orders werden gecancelt
- Exit-/Reduce-only Verhalten bleibt moeglich

### Targeted Reconcile / Recovery

Einzelnen BotVault gezielt neu reconciliieren:

```bash
npm -w apps/api run vaults:reconcile:bot -- --bot-vault-id <BOT_VAULT_ID>
```

Nur Report/Audit lesen:

```bash
npm -w apps/api run vaults:reconcile:bot -- --bot-vault-id <BOT_VAULT_ID> --report-only --audit-limit 100
```

Batch-Reconcile:

```bash
npm -w apps/api run vaults:reconcile:all -- --limit 50
```

## Rollback / Containment

1. Neue BotVault-Erstellung stoppen.
2. Jobs bei Dateninkonsistenz temporaer deaktivieren:

- `VAULT_ACCOUNTING_ENABLED=0`
- `BOT_VAULT_RISK_GUARD_ENABLED=0`

3. API neu starten.
4. Vor manuellen Korrekturen Audit ueber CashEvent/FeeEvent/Ledger pruefen.

Es gibt keinen empfohlenen Rollback auf alte onchain Contract-Varianten aus diesem Workspace. Fehlerhafte Deployments sollten ueber eine korrigierte BotVaultV4-Factory und Konfiguration behoben werden.
