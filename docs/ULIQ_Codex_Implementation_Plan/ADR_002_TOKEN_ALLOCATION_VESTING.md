# ADR-002 – Token Allocation & Vesting

> **Superseded in part by ADR-009:** The future production allocation now assigns 50,000,000 ULIQ to Presale Round 1, 100,000,000 ULIQ to Presale Round 2, and 190,000,000 ULIQ to Ecosystem. The single 120,000,000 ULIQ presale and 220,000,000 ULIQ Ecosystem values below remain historical testnet-plan context.

## Status

`ACCEPTED`

## Context

ULIQ hat einen Fixed Supply von 1.000.000.000 Tokens. Der Presale nutzt 120.000.000 ULIQ; die restlichen 880.000.000 ULIQ benötigen vor Deployment eine vollständige Allocation-, Vesting-, Release- und Control-Spezifikation.

Eine nominal freigeschaltete Allocation ist nicht automatisch im Umlauf. `released != distributed` und `unlocked != circulating`: Release Budgets bestimmen nur die maximal verfügbare Menge; tatsächliche Distribution benötigt separate dokumentierte Entscheidungen und Onchain-Nachweise.

## Decision

Finale Allocation:

| Bucket | Anteil | ULIQ |
| --- | ---: | ---: |
| Presale | 12 % | 120.000.000 |
| Liquidity | 8 % | 80.000.000 |
| Ecosystem | 22 % | 220.000.000 |
| Treasury | 30 % | 300.000.000 |
| Team | 15 % | 150.000.000 |
| Marketing / Partnerships | 13 % | 130.000.000 |
| Gesamt | 100 % | 1.000.000.000 |

Max Supply: 1.000.000.000 ULIQ mit 18 Decimals. Der Supply wird beim Deployment einmalig erzeugt; danach existiert keine Mint-Funktion.

Finales Control- und Release-Modell:

- Team: 12 Monate Cliff, danach 36 Monate linear. Vor Ablauf des Cliffs sind 0 Team Tokens verfügbar.
- Treasury: 12 Monate initialer Lock, danach maximales Release Budget über 48 Monate. Keine automatische Distribution; Freigaben sind nur die maximal verfügbare Menge.
- Ecosystem: Release Budget über 60 Monate, keine automatische Distribution und Verwendung nur für definierte Ecosystem-Zwecke.
- Marketing/Partnerships: Release Budget über 48 Monate, keine automatische Distribution; Verwendung für Marketing, Partnerships, Community Growth und strategische Programme.
- Liquidity: keine automatische lineare Freigabe. Bedarfsgerechte, kontrollierte Releases ausschließlich für initiale DEX Liquidity, zusätzliche Liquidity, Market Making oder mögliche spätere Listings.
- Presale: 120.000.000 ULIQ zu 0,001 USDC pro ULIQ, Hard Cap 120.000 USDC, kein Soft Cap. Sale-Ende bei Hard Cap oder `saleEnd`. Pending Withdrawal, danach 25 % Wallet und 75 % globales 9-Monats-Vesting ab DEX Launch.
- getrennte Safes: `ULIQ Treasury Safe`, `ULIQ Ecosystem Safe`, `ULIQ Marketing Safe` und `ULIQ Liquidity Safe`.
- Team Tokens liegen in Vesting Contracts; Presale Tokens in Presale-/Vesting-Contracts.
- alle zentralen Bucket-Adressen liegen auf Safe/Multisig oder auditierten Vesting-/Distribution-Contracts.
- keine persönliche EOA ist zentrale Treasury oder alleiniger Allocation Controller.

## Alternatives considered

### Gesamten Supply an ein Treasury Safe minten

Einfach, aber ohne on-chain Vesting/Release Controls weniger transparent und stärker governance-/operational-risk-behaftet.

### Separate Vesting Contracts pro Bucket

Bessere Isolation und Auditierbarkeit, aber mehr Deployments, Rollen und Monitoring.

### Ein universeller Allocation Controller

Weniger Contracts, aber größere Blast Radius und komplexere State Machine.

### Token Mint direkt an finale Ziel-Safes/Contracts

Reduziert spätere Transfer-Schritte und kann Supply-Verteilung transparent machen. Benötigt vollständig finalisierte Adressen vor Deployment.

## Consequences

- Token Constructor/Deployment kann erst nach verifizierten Zieladressen eingefroren werden; die fachlichen Zieltypen sind mit dieser ADR final.
- Release Budgets benötigen Admin UI, Safe Preparation, Audit Events und Circulating-Supply-Reporting.
- Market-Making-/Liquidity-Releases müssen getrennt von Marketing-/Treasury-Ausgaben berichtet werden.
- Änderungen nach Deployment sind nur innerhalb vorab auditierten Rollen und Limits möglich.
- Whitepaper und öffentliche Tokenomics müssen exakt denselben Stand verwenden.

## Security implications

- zentrale Safes benötigen Signer Matrix, Threshold, Hardware-Wallet-Policy und Recovery-Prozess.
- Vesting-/Distribution-Contracts benötigen eigene Invariants und Audit Scope.
- Release Functions müssen Bucket Cap, Zeitfenster, Recipient und bereits released Amount erzwingen.
- kein Backend-Key und keine unbeaufsichtigte automatische Distribution.
- Monitoring muss unerwartete Transfers, Role Changes und Budget Exhaustion melden.

## Legal implications

- Team-/Treasury-/Marketing-Allokationen, Lockups und Fund Use müssen mit Whitepaper und Marketing übereinstimmen.
- Liquidity/Market-Making-Arrangements und verbundene Parteien müssen offengelegt und auf Marktmissbrauch-/Konfliktregeln geprüft werden.
- steuerliche und bilanzielle Behandlung der Buckets ist durch Legal/Tax zu klären.

## Open questions

- konkrete Safe-Adressen, Signer und Thresholds.
- konkrete Contract-Aufteilung innerhalb der akzeptierten Safe-/Vesting-Architektur.
- genaue Release-Frequenz und Rundung innerhalb der festgelegten Budgets.
- Timelock und Vier-Augen-Policy.
- wer genehmigt Ecosystem-/Marketing-Releases und anhand welcher Nachweise.
- Regeln für ungenutzte Release Budgets.
- Liquidity-Ziel, Pool, initiale Menge, Gegenasset und Market-Making-Partner.
- Behandlung verlorener/kompromittierter Recipient Keys.
- öffentliches Circulating-Supply-Verfahren.

## Acceptance criteria

- Summe aller Buckets ist exakt 1.000.000.000 ULIQ.
- Token besitzt 18 Decimals und nach Deployment keinen Mint-Pfad.
- jeder Bucket besitzt eine eindeutige Zieladresse oder einen eindeutigen Ziel-Contract.
- keine Release-Funktion kann Bucket Cap oder Zeitbudget überschreiten.
- alle zentralen Ziele sind Safe-/Contract-Adressen, keine persönliche Treasury-EOA.
- Deployment, Whitepaper und Admin Reporting verwenden dieselbe versionierte Allocation.
- Treasury-, Ecosystem-, Marketing- und Liquidity-Bestände werden durch getrennte Safes kontrolliert.
