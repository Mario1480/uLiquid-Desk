# BotVault V4 Rollout

Dieses Dokument beschreibt den empfohlenen Rollout fuer `BotVaultV4` mit per-vault eingefrorenem Profitshare-Satz.

## Ziel

- neue Grid-/BotVaults nutzen `BotVaultV4`
- bestehende `BotVaultV3`-Vaults laufen unveraendert weiter
- Affiliate-/Platform-Fee wird pro neuem Vault bei Erstellung eingefroren

## Voraussetzungen

- API-Stand mit `BotVaultV4` ist deployed
- Migration fuer das Affiliate-Programm ist eingespielt
- Controller-Adresse bleibt weiter `BOT_VAULT_V3_CONTROLLER_ADDRESS`
- HyperEVM-USDC-Adresse ist verifiziert

## 1) V4 Factory deployen

Auf dem Zielsystem:

```bash
cd /opt/uliquid-desk
./scripts/deploy_contracts_vps.sh --mode devnet --target botvaultv4 --env-file .env.prod
```

Alternativ direkt:

```bash
npm -w packages/contracts run deploy:botvaultv4:devnet
```

## 2) Deployment pruefen

Nach dem Broadcast muessen diese Werte stimmen:

- `BotVaultFactoryV4.usdc()`
- `BotVaultFactoryV4.coreDepositWallet()`
- `BotVaultFactoryV4.treasuryRecipient()`
- `BotVaultFactoryV4.owner()`

## 3) Produktions-ENV umstellen

In `.env.prod` setzen:

```env
BOT_VAULT_ONCHAIN_CONTRACT_VERSION=v4
BOT_VAULT_V4_FACTORY_ADDRESS=0x...
BOT_VAULT_V3_CONTROLLER_ADDRESS=0x...
```

Optional fuer Sim-/Staging:

```env
BOT_VAULT_V4_SIM_FACTORY_ADDRESS=0x...
```

Wichtig:

- `BOT_VAULT_V3_FACTORY_ADDRESS` fuer alte Vaults vorerst nicht loeschen
- neue Vault-Erstellung laeuft ueber `BOT_VAULT_ONCHAIN_CONTRACT_VERSION=v4`
- bestehende Vaults behalten ihren alten Contract und werden nicht migriert

## 4) API/Runner neu starten

Nach dem Env-Switch:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build api runner
```

## 5) Smoke-Test fuer neue Vaults

Mit einem Testnutzer:

1. neuen Grid-Bot anlegen
2. pruefen, dass im `botVault.executionMetadata` steht:
   - `onchainContractVersion: "v4"`
   - `feeConfig.totalFeeRatePct`
   - `feeConfig.feeConfigLockedAt`
3. pruefen, dass der Create-Action-Record `contractVersion: "v4"` enthaelt
4. pruefen, dass die erzeugte Vault-Adresse aus der V4-Factory kommt

## 6) Wirtschaftliche Validierung

Fuer einen neuen V4-Vault:

1. Fund / Margin Add
2. Profit Claim
3. Close / Recovery

Pruefen:

- onchain `profitShareFeeRatePct()` auf dem Vault entspricht dem eingefrorenen Satz
- `FeeEvent.metadata.totalFeeRatePct` passt zum Vault-Satz
- `AffiliateAccrual` wird nur fuer neue passend konfigurierte Vaults erzeugt

## 7) Migrationsregel

Es gibt keine In-Place-Migration bestehender V3-Vaults.

- laufende V3-Vaults bleiben V3
- neue Vaults ab Env-Switch werden V4
- Affiliate-Overrides wirken nur fuer neue Vaults ab Erstellung

## 8) Rollback

Wenn der V4-Rollout Probleme macht:

```env
BOT_VAULT_ONCHAIN_CONTRACT_VERSION=v3
BOT_VAULT_V3_FACTORY_ADDRESS=0x...
```

Dann API/Runner neu starten. Bereits erzeugte V4-Vaults bleiben bestehen; nur die Neuanlage faellt wieder auf V3 zurueck.
