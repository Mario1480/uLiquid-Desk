# ULIQ Staging Indexer Decimal Recovery – Nachweis

Datum: 2026-08-22  
Umgebung: isoliertes Staging, Arbitrum Sepolia (`421614`)  
Anwendungscommit: `04552d24ec645ee60dedb1af19bba38a56c3f75b`

## Ausgangslage

Der ULIQ-Indexer blieb vor den Stage-2-Transaktionen bei Block `300871778` stehen. Der gespeicherte initiale Token-Lot entspricht `10^27` Raw Units. Prisma `Decimal(78,0)` stellte diesen Wert beim direkten String-Cast als `1e+27` dar; `BigInt("1e+27")` schlug mit `Cannot convert 1e+27 to a BigInt` fehl. Vor dem Fix waren `failure_count=19` und der genannte Fehler im committed Cursor gespeichert.

Die Transaktion wurde bei jedem Fehler zurückgerollt. Es wurde kein Cursor manuell verschoben und keine Projektion manuell korrigiert.

## Implementierung und lokale Prüfung

- Datenbank-Decimals werden über `toFixed()` in eine ausgeschriebene Integer-Darstellung überführt und danach weiterhin gegen den strikten `uint256`-Parser geprüft.
- Externe API-Eingaben wie `1e+27` bleiben unzulässig.
- Die zentrale Konvertierung wird in Indexer, Entitlements, Reconciliation, Presale-Responses und ULIQ-Benefit-Reservierungen verwendet.
- Regression mit einer echten `Prisma.Decimal("1e27")` ergänzt; Fraktionen werden weiter abgelehnt.

Erfolgreiche Checks:

- `npm -w apps/api run test:uliq`: 26/26 Tests.
- `npm -w apps/api run typecheck`.
- `npm -w apps/api run test:auth`: 48/48 Tests.
- `npm -w apps/api run test:billing`: 100/100 Tests.
- `git diff --check`.

## Staging-Deploy

Der geprüfte Commit wurde auf `origin/codex/uliq-mvp-testnet` gepusht und auf dem VPS als exakter detached Commit ausgecheckt. Deployment-Befehl:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build --no-deps api
```

Nur der API-Container wurde neu erstellt. Postgres, Web, Runner, Redis, Salad Proxy und Python Strategy Service behielten ihre Container-IDs und meldeten weiterhin `healthy`. Die API meldete `healthy`, `/health` lieferte `{"ok":true}`; 104 Migrationen wurden erkannt und keine Migration war ausstehend.

## Live Recovery Evidence

Prüfzeitpunkt: `2026-08-22T19:38:41Z`.

- Cursor vor erfolgreichem Replay: `300871778`.
- Cursor nach erstem erfolgreichen Replay: `300872278`.
- Cursor nach zwei weiteren erfolgreichen Abschnitten: `300873278`.
- Letzter Stage-2-Block: `300872135`.
- `failure_count`: `0`.
- `last_error`: leer.
- `next_retry_at`: leer.
- Stage-2-Inventory-Transfer `0xdc7e44db19ad7954fcd99a5769d4ced554198a85498286796e531544659dc19d`: `FINALIZED` indexiert.
- Stage-2-`SaleStateChanged` `0xbcfe6cea4d18e9f6286b4bb12d5a96766427189759ac4f70610d6df101914339`: `FINALIZED` indexiert.
- Initialer Admin-Lot: `1000000000000000000000000000` Raw Units.
- Restbestand nach dem Transfer von 120 Millionen ULIQ: `880000000000000000000000000` Raw Units.
- Frische Reconciliation bei Block `300914114`: `OK`, `mismatch_count=0`.
- Kein ULIQ-Alert vorhanden.
- Öffentliche Presale-API: `READY`, `0` Raised/Purchases, `120000000000000000000000000` Raw Inventory, Dual-RPC-Agreement `true`.

## Grenzen des Nachweises

- Der vollständige historische Catch-up war noch nicht abgeschlossen; nach den dokumentierten Folgeabschnitten verblieben `40836` Blöcke zum damaligen finalisierten Head.
- Dies ist Staging-/Testnet-Evidence und kein Production- oder Mainnet-Nachweis.
- Es wurde keine Onchain-Transaktion ausgelöst und `activateSale()` nicht aufgerufen; der Sale blieb `READY`.
- Transaktionale Wallet-E2E-Flows, Reorg-/Restart-Langlauf, Audit und Legal Gate bleiben separat offen.
