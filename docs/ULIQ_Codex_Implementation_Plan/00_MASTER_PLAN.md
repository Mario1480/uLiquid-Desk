# ULIQ Integration – Codex Master Implementation Plan

## Status und Ziel

ULIQ wird als optionaler Utility-, Membership- und Locking-Layer in uLiquid Desk integriert. Das bestehende Arbitrum-USDC-Payment-System bleibt der einzige Settlement-Pfad für Abonnements, AI Credits und weitere Plattformleistungen.

Dieser Ordner ist die einzige Source of Truth für die ULIQ-Umsetzung. Die ADRs in diesem Ordner dokumentieren verbindliche Entscheidungen und verbleibende Blocker; `ADR_INDEX.md` ist der kanonische ADR-Index. Es wird keine parallele zweite ULIQ-Architektur gepflegt.

Aktueller Gate-Status:

- `GO`: ADR-Dokumentation, Contract Interface Design und Specification, Prisma-/Data-Model-Design, Indexer- und Entitlement-Architektur, UI/UX-Design, Testplanung, Threat Modeling und Arbitrum-Sepolia-Deployment-Planung.
- `GO TESTNET / PROVISIONAL`: isolierte Solidity-, Backend-, UI- und Arbitrum-Sepolia-Implementierung. Der direkte Test-USDC-Refund wird ausschließlich über einen austauschbaren Testnet-Custody-Adapter abgebildet und ist keine Legal-/Safeguarding-Entscheidung.
- `NO-GO`: Production-Solidity-Contracts, Mainnet-Deployment, Presale und DEX-Launch, bis die Legal-P0-Blocker aus `ADR_001_LEGAL_PRESALE_MODEL.md` gelöst sind.

## Implementierungsstand 2026-08-22

Der isolierte MVP-Testnet-Scope ist im Branch `codex/uliq-mvp-testnet` implementiert und lokal validiert:

- Testnet-only Token, Presale, Test-USDC-Custody, Presale-Vesting und Locker inklusive Local-/Sepolia-Deploy-Scripts und Chain-ID-Guards.
- Prisma-Migration `20260822090000_uliq_mvp_testnet` mit `Decimal(78,0)` für ULIQ-`uint256`, Domain-Projektionen, Holding-Provenienz, Entitlement-/Price-Snapshots, Reservation-/Ledger-Lifecycle und Reconciliation.
- Dual-RPC-/finalized-head Indexer mit DB-Lease, Cursor-CAS, Retry/Backoff, Reorg-Rebuild und Alerts.
- blockkonsistente Entitlement Engine, Held-Tier-Degradation und 10-Minuten-Benefit-Reservations. ADR-008 ersetzt den bisherigen 24-Stunden-Cooldown als monetäres Gate durch eine finalisierte Betrag-/Laufzeit-Lock-Prüfung.
- explizit opt-in-basierte Billing-Discount-Integration; Settlement bleibt USDC, Platform Fees bleiben unverändert.
- User-UI unter `/uliq`, `/uliq/presale`, `/uliq/vesting`, `/uliq/locking` und Superadmin-UI unter `/admin/uliq`, jeweils DE/EN und Arbitrum-Sepolia-only.

Noch nicht als Testnet-End-to-End-Evidence verifiziert:

- Arbitrum-Sepolia-Deployment und Source Verification, weil RPC-/Deployer-/Safe-/Arbiscan-Konfiguration in der lokalen Umgebung fehlt.
- authentifizierter Browser-E2E gegen deployte Contracts und migrierte Testnet-Datenbank.
- externer unabhängiger Smart-Contract-Audit; Slither 0.11.6 wurde lokal ausgeführt und die Findings sind in `09_SECURITY_TESTING.md` bewertet.

Damit ist die Implementierung lokal deploy-ready, aber noch nicht `READY FOR EXTERNAL AUDIT` und nicht Sepolia-E2E-abgenommen. ADR-001 bleibt davon unverändert `BLOCKED`.

## Verbindliche Produktregeln

- Chain: Arbitrum One.
- Token: ERC-20, Symbol `ULIQ`, Fixed Supply von 1.000.000.000 ULIQ, 18 Decimals.
- Payments und Settlement: ausschließlich USDC.
- ULIQ ist kein Payment Asset für Abonnements, AI Credits oder andere Plattformleistungen.
- Haupt-Presale: direkt im uLiquid Desk über die verknüpfte User-Wallet.
- Presale Allocation: 120.000.000 ULIQ.
- Presale-Preis: 0,001 USDC pro ULIQ.
- Hard Cap: 120.000 USDC.
- Kein Soft Cap und deshalb kein Soft-Cap-Refund.
- Sale-Ende: Hard Cap erreicht oder `saleEnd` Timestamp erreicht.
- Gesetzliche, vertragliche oder Emergency-bedingte Withdrawal-/Refund-Pfade bleiben davon unberührt.
- Ein Kauf erzeugt zunächst eine `PENDING_WITHDRAWAL` Allocation und noch keine frei verfügbaren ULIQ.
- Modellierte Withdrawal Period: 14 Kalendertage; finale rechtliche Definition ist Legal Gate.
- Während `PENDING_WITHDRAWAL`: 0 Wallet-ULIQ, keine Vesting-Position, 0 eligible ULIQ, keine Benefits.
- Nach Finalisierung: 25 % an die Käufer-Wallet, 75 % in eine Presale-Vesting-Position.
- Finalisierung ist nach Deadline permissionless, atomar und immer zugunsten des unveränderlichen Buyers.
- Presale-Vesting startet global zum einmalig on-chain gesetzten DEX-Launch-Timestamp und läuft 9 Monate linear.
- DEX Launch ist erst bei `pendingPurchaseCount == 0` zulässig.
- Finalisierte, noch nicht freigegebene Presale-Vesting-ULIQ zählen für Utility.
- Eligible ULIQ nach Finalisierung: `wallet + unreleased vesting + locked`, wobei jeder Token exakt einmal zählt.
- Initiale Lock-Zeiträume im MVP: 31, 184 oder 366 Tage, dargestellt als 1, 6 oder 12 Monate; der exakte `unlockAt`-Timestamp ist autoritativ. Locks dürfen nur verlängert, nie verkürzt werden. Kein APY und keine Rewards.
- ERC20Permit wird verwendet.
- Optionaler externer Launchpad-Sale ist nicht Teil des MVP.

Testnet-V2-Nachweis (kein Production-Entscheid): Auf Arbitrum Sepolia wird jeder tUSDC-Eingang purchase-gebunden im provisional Escrow geführt. Withdrawal erstattet exakt diesen Betrag an den Buyer; Finalisierung gibt ihn in derselben atomaren Transaktion an die aktive Testnet-Treasury frei. Die Testnet-Deployment-Sperre verlangt mindestens 3.600 Sekunden Withdrawal Period. Dies simuliert den vollständigen E2E-Accounting-Flow, ersetzt aber weder die 14-Tage-Working-Assumption noch die durch ADR-001 blockierte Production-Safeguarding-/Treasury-Entscheidung. Implementierungsstand 2026-08-23: lokal implementiert und getestet; neue Contract-Adressen, Migration, Runtime-Konfiguration und Staging-Deploy sind noch nicht ausgeführt.

Testnet-V3-Contract-Follow-up (kein Deployment- oder Production-Entscheid): Der Übergang `ENDED -> DEX_PENDING` ist erst bei `pendingPurchaseCount == 0` möglich und gibt dann atomar exakt die unverkaufte Presale-Allokation an `paymentCustody.treasury()` frei. `cancelEmptySale()` verwendet dieselbe aktive Treasury und ist für einen leeren Sale aus `READY`, `ACTIVE` oder `PAUSED` verfügbar, damit eine bereits finanzierte, aber nie aktivierte Instanz ihr Inventar nicht dauerhaft bindet. Dies ist kein generischer Sweep: zusätzliche, nicht zur Presale-Allokation gehörende ULIQ werden nicht mitübertragen. Das Indexer-Event erzeugt für die Treasury einen regulären `WALLET_TRANSFER`-Provenienz-Lot; dessen Alter autorisiert ab ADR-008 keinen monetären Benefit. Implementierungsstand 2026-08-24: lokal implementiert und getestet; das bestehende V2-Testnet-Deployment bleibt unverändert und ein neuer Contract-Deploy benötigt eine separate Freigabe.

Testnet-ADR-008-Follow-up (kein Deployment- oder Production-Entscheid): Locker, API, Indexer, Billing-Gating und UI unterstützen 31/184/366 Tage, nicht verkürzbare Extensions und die 25-%-Abdeckung bis zum exakten Produktlaufzeitende. Migration, Contract-Neudeploy, Runtime-Aktivierung und Staging-E2E benötigen weiterhin jeweils separate Freigaben.

## MVP Utility

Enthalten:

- AI-Credit-Discount.
- Subscription-Discount.
- Premium AI Features.
- Premium Product Features.
- Early Access und Feature Access.
- USD-equivalentes ULIQ-Tier-System.
- Locking-basierte Produkt-Benefits.

Benefit-Regeln:

- Feature Benefits benötigen einen aktuellen bestätigten Entitlement Snapshot, aber keinen Lock.
- Subscription- und AI-Credit-Discounts benötigen ein gültiges Entitlement, einen kanonisch finalisierten Lock über mindestens 25 % des aktuellen Tier-Minimums bis zum exakten Benefit-Ende und eine 10 Minuten gültige Benefit Reservation.
- Der frühere 24-Stunden-Holding-Cooldown ist kein monetäres Gate mehr; die übrigen Anti-Reuse-Regeln aus ADR-004 bleiben erhalten.
- AI-Credit-Discounts benötigen zusätzlich eine aktive, mit ULIQ-Discount gekaufte Subscription und einen gültigen versionierten Monats-Cap.
- Wallet-Wechsel/-Unlink setzt offene ULIQ Reservations von `RESERVED` auf `RELEASED` und erzwingt eine vollständige Neuberechnung.

Nicht enthalten:

- Platform-Fee-Discount.
- Earn oder APY.
- Token-, USDC- oder Revenue-Sharing-Rewards.
- Governance.
- automatischer Buyback.

Platform-Fee-Discounts werden ausschließlich in `ADR_003_PLATFORM_FEE_DISCOUNT.md` für eine spätere Version untersucht. BotVault-V4-Gebühren werden im ULIQ-MVP nicht verändert.

## Token Allocation – final

| Bucket | Anteil | ULIQ |
| --- | ---: | ---: |
| Presale | 12 % | 120.000.000 |
| Liquidity | 8 % | 80.000.000 |
| Ecosystem | 22 % | 220.000.000 |
| Treasury | 30 % | 300.000.000 |
| Team | 15 % | 150.000.000 |
| Marketing / Partnerships | 13 % | 130.000.000 |
| Gesamt | 100 % | 1.000.000.000 |

Verbindliches Release-/Control-Modell:

- Team: 12 Monate Cliff plus 36 Monate linear über Vesting Contracts.
- Treasury: 12 Monate Lock plus 48 Monate Maximum Release Budget.
- Ecosystem: 60 Monate Release Budget.
- Marketing/Partnerships: 48 Monate Release Budget.
- Liquidity: bedarfsgerechte, nicht lineare Freigabe.
- getrennte Treasury-, Ecosystem-, Marketing- und Liquidity-Safes; keine zentrale persönliche EOA.
- `released != distributed` und `unlocked != circulating`; keine automatische Distribution.

## Bestehende uLiquid-Bausteine wiederverwenden

- SIWE-verknüpfte User-Wallet und Arbitrum-Wagmi/Viem-Konfiguration.
- direktes Arbitrum-USDC-Billing mit Sender-, Treasury-, Confirmation- und Reconciliation-Prüfung.
- `AiCreditLedger` und bestehende AI-Credit-Pakete.
- Prisma/Postgres und vorhandene generische Modelle `OnchainIndexedEvent` und `OnchainSyncCursor`.
- bestehende API-Job-, Alert-, Admin-Audit-, Reauth- und Feature-Flag-Strukturen.
- Next.js Web App, App Shell, `AppIcon`, Sidebar, i18n und uLiquid Design Tokens.
- Foundry-Contract-Package unter `packages/contracts`.

## Nicht tun

- Kein ULIQ-Payment für Abo, AI Credits oder andere Plattformleistungen.
- Kein zweites Wallet-System.
- Kein zweiter paralleler Onchain-Indexer ohne dokumentierte technische Notwendigkeit.
- Keine Token-Tax, Blacklist, Transfer-Limits oder spätere Mint-Funktion.
- Keine Entitlement-Entscheidung ausschließlich im Browser.
- Keine Utility für pending oder withdrawn Presale Purchases.
- Keine Doppelzählung von Wallet-, Vesting- und Locker-Beständen.
- Keine Platform-Fee-Änderung im MVP.
- Keine Wiedereinführung von CCPayment als ULIQ-Sonderpfad.
- Keine Multisig-, Treasury- oder Owner-Private-Keys im Backend.
- Keine Production-Contract-Implementierung, solange ADR-001 blockiert ist.

## Umsetzungsphasen

0. Decisions, Legal Review und ADRs.
1. Contract Specification; noch keine Production-Implementierung ohne Legal Go.
2. Data Model und Erweiterung des bestehenden Indexers.
3. blockkonsistente Entitlement Engine.
4. Presale Backend, Withdrawal- und Finalization-Orchestrierung.
5. Billing- und AI-Credit-Integration mit 10-Minuten-Benefit-Reservations.
6. Frontend und Admin.
7. Arbitrum-Testnet.
8. externer Smart-Contract-Audit.
9. finaler Legal Sign-off.
10. Mainnet-Deployment.
11. Presale.
12. DEX-Launch und globaler Vesting-Start.
13. Buyback/Burn nur als separat genehmigtes Folgeprojekt.

## P0/P1/P2

### P0 – vor Production Contracts

- ADR-001 mit spezialisiertem Legal Counsel abschließen.
- Withdrawal-, Refund-, Safeguarding-, Cancellation- und Jurisdiktionsmodell festlegen.
- exakte OpenZeppelin-Version pinnen und vor Audit einfrieren.
- konkrete DEX-/Pool-Adresse, Fee Tier, TWAP-Implementierung und Failover Source vor Audit festlegen.
- ADR-006-State-Machine in eine auditierbare Contract Specification überführen, einschließlich Rounding-/Partial-Fill-Policy.

### P1 – vor Testnet Product Integration

- Prisma-Schema, Migration und uint256-Typstrategie implementieren.
- bestehenden Indexer um Block Hash, Canonical Status, Lease, Reorg und Reconciliation erweitern.
- Entitlement Snapshots und Benefit Reservations implementieren.
- Billing-/AI-Discount-Flows inklusive exakt 10 Minuten Quote-TTL integrieren.
- Presale-, Withdrawal-, Vesting-, Locking- und Admin-UI umsetzen.

### P2 – vor breitem Mainnet Rollout

- externe Launchpad-Adapteranalyse.
- zusätzliche Price-Feed-Quellen und fortgeschrittene Manipulationserkennung.
- Platform-Fee-ADR für eine spätere Version neu bewerten.
- Buyback/Burn als separates Legal-, Treasury- und Audit-Projekt bewerten.
