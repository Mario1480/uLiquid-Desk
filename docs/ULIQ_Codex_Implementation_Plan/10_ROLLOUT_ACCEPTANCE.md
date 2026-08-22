# 10 – Rollout, Migration & Acceptance Criteria

## Phasen und Gates

### Phase 0 – Decisions, Legal und ADRs

- ADR-001 Legal Presale Model durch spezialisierten Counsel auflösen.
- Jurisdiktionen, Retail, Withdrawal, Refund, Cancellation, USDC Safeguarding, KYC/AML/Sanktionsprüfung und Sale Terms festlegen.
- ADR-002, ADR-004, ADR-005 und ADR-006 sind technisch `ACCEPTED`; ADR-003 und ADR-007 behalten ihren dokumentierten Scope/Status.
- konkrete DEX-/Pool-Adresse, Fee Tier, TWAP-Implementierung und Failover Source vor Audit finalisieren.
- Ergebnis: formales Legal/Architecture Go für Contract Implementation.

### Phase 1 – Contract Specification

- exakte OpenZeppelin-, Solidity- und EVM-Versionen pinnen.
- Token-, Sale-, Purchase-, Refund-, Vesting-, Locker- und Role-State-Machines finalisieren.
- Contract Invariants und Deployment Address Book festlegen.
- keine Production-Implementierung bei weiterhin blockiertem ADR-001.

### Phase 2 – Data Model und Indexer

- Prisma Migration mit `Decimal(78,0)` für ULIQ uint256 Raw Units.
- bestehende Onchain Event/Cursor Modelle erweitern.
- Lease, Backfill, Reorg, Replay und Reconciliation implementieren.
- Migration Rollback-/Forward-Fix-Plan dokumentieren.

### Phase 3 – Entitlement Engine

- blockkonsistente Snapshots.
- pending Allocations ausgeschlossen.
- Tier Config und Price Mode.
- Feature Access sowie monetäre Benefits mit 24-Stunden-Holding-Cooldown und 10-Minuten-Reservations.
- Wallet-Wechsel/Anti-Reuse.

### Phase 4 – Presale Backend

- Routen unter `/uliq/*`.
- Purchase, Withdrawal, Refund und Finalization Read Models.
- Prepare-only Wallet-/Safe-Aktionen.
- Feature Flags, Audit und Degradation.

### Phase 5 – Billing und AI

- Subscription- und AI-Credit-Discounts im Shadow Mode.
- exakt 10 Minuten Reservation-/Quote-TTL.
- Base/Discount/Final Snapshots.
- bestehender USDC Checkout und `AiCreditLedger` wiederverwendet.
- keine Platform-Fee-Änderung.

### Phase 6 – Frontend und Admin

- ULIQ Overview, Presale, Withdrawal, Vesting und Locking.
- Billing-/AI-Discount UX.
- Admin Health, Config und Safe Preparation.
- DE/EN, mobile, responsive und Accessibility.

### Phase 7 – Arbitrum Testnet

- alle Contracts auf Arbitrum Sepolia mit 6-Decimal-Test-USDC.
- kompletter Purchase -> Withdrawal und Purchase -> Finalization Flow.
- 25/75, 9-Monats-Vesting via Time Warp und 30/90/180 Locks.
- Reorg-, Indexer-Restart-, RPC-Failover- und Reconciliation-Proben.
- Safe-/Role- und Incident-Runbook-Probe.

### Phase 8 – External Smart Contract Audit

- Scope und Bytecode freeze.
- unabhängiger Audit.
- Findings beheben und retesten.
- Deployment Scripts und Address Book im Scope.

### Phase 9 – Legal Final Sign-off

- finale Contracts, Sale Terms, UI Copy, Whitepaper/Notification und Jurisdiktionskontrollen abgleichen.
- keine materielle Änderung nach Sign-off ohne Legal-/Audit-Diff-Review.

### Phase 10 – Mainnet Deployment

- Safe-/Multisig-Adressen verifiziert.
- canonical USDC, Chain ID, Bytecode und Source Verification.
- Allocation-/Inventory-Funding nach ADR-002.
- Monitoring und Alerts aktiv.

### Phase 11 – Presale

- zunächst limitierter Low-Value Canary.
- Purchase, Withdrawal, Refund, Finalization und Entitlement live beobachten.
- anschließend kontrollierte Freigabe nach Evidence Review.

### Phase 12 – DEX Launch und Vesting Start

- Market-/Liquidity-Readiness und ADR-005 prüfen.
- einmalige Safe Transaction für DEX Launch Timestamp.
- Vesting-Start und Price-Mode-Aktivierung sind getrennte Aktionen.

### Phase 13 – spätere Module

- Buyback/Burn und Platform-Fee-Discount nur über neue ADRs, Legal Review, Audit und Freigabe.

## Acceptance Criteria

### A. Purchase während Withdrawal

Ein bestätigter Kauf von 1.000 USDC bei 0,001 USDC pro ULIQ erzeugt:

- Total Allocation: exakt 1.000.000 ULIQ.
- Purchase State: `PENDING_WITHDRAWAL`.
- Wallet received: 0 ULIQ.
- Tatsächliche Wallet Allocation: 0 ULIQ.
- Tatsächliche Vesting Allocation: 0 ULIQ.
- Finalization Preview: 250.000 ULIQ Wallet / 750.000 ULIQ Vesting.
- Vesting Position: noch nicht aktiv/angelegt.
- Eligible: 0 ULIQ.
- ULIQ Tier Benefits: inactive.
- konkrete Withdrawal Deadline gemäß finaler Legal Policy.

Wiederholte Event-Verarbeitung verändert diese Werte nicht.

### B. Erfolgreiche Finalisierung

Nach Ablauf der Withdrawal Period und bestätigter Finalisierung:

- Purchase State: `FINALIZED`.
- Wallet: exakt 250.000 ULIQ.
- Presale Vesting: exakt 750.000 ULIQ.
- Eligible: exakt 1.000.000 ULIQ.
- Benefits: active entsprechend gültiger Tier Config.
- Refund nicht mehr möglich, soweit die finalen Sale Terms dies vorsehen.
- erneute Finalisierung ist wirtschaftlicher No-Op oder revertiert eindeutig.

### C. Withdrawal und Refund

Bei wirksamem Withdrawal vor Deadline:

- Purchase State: `WITHDRAWN`.
- Wallet ULIQ: 0 aus diesem Purchase.
- Vesting: 0 aus diesem Purchase.
- Eligible: 0 aus diesem Purchase.
- Benefits: inactive.
- Allocation vollständig storniert.
- USDC gemäß finalen Sale Terms an das verifizierte Ziel refunded.
- Refund Receipt canonical und ausreichend bestätigt.
- doppeltes Withdrawal/Refund erzeugt keine zweite Auszahlung.
- Finalize-after-Withdrawal ist ausgeschlossen.

### D. Sale Cancellation

- keine neuen Purchases.
- keine unzulässigen neuen Finalisierungen.
- alle pending Purchases werden nach der finalen ADR-001-Policy behandelt.
- Inventory und USDC Accounting bleiben nachvollziehbar.
- Safe Action, Receipt, Indexer und Admin Audit stimmen überein.

### E. Vesting Start und Claim

Vor DEX Launch:

- finalisierte 750.000 Vesting-ULIQ zählen zur Utility.
- claimable/releasable ist 0.

Nach einmaligem DEX Launch Timestamp:

- alle Presale-Käufer verwenden denselben Start.
- Schedule läuft exakt 9 Monate nach finaler Zeitkonvention.
- Timestamp kann nicht geändert werden.

Claim von 100.000 ULIQ:

- vorher: wallet 250k, vesting unreleased 750k, eligible 1m.
- nachher: wallet 350k, vesting unreleased 650k, eligible 1m.
- ein zweiter Claim derselben bereits released Menge ist ausgeschlossen.

### F. Locking

Lock von 150.000 Wallet-ULIQ für 30, 90 oder 180 Tage:

- vorher: wallet 350k, vesting 650k, locked 0, eligible 1m.
- nachher: wallet 200k, vesting 650k, locked 150k, eligible 1m.
- vorzeitiger Withdraw ist ausgeschlossen.
- nach regulärem Withdraw sinkt locked und steigt wallet um denselben Raw Amount.
- kein APY, Reward oder Revenue Share wird erzeugt.

### G. Blockkonsistenz

- Wallet, Vesting und Locked State stammen vom selben `asOfBlock` und `blockHash`.
- gemischte Blocks erzeugen keinen gültigen monetären Snapshot.
- Snapshot Raw Amounts werden ohne JS `number`/Float verarbeitet.
- 1 Milliarde ULIQ beziehungsweise `10^27` Raw Units werden verlustfrei gespeichert und gelesen.

### H. Tier und Price Mode

- vor DEX Launch nutzt ein finalisierter Purchase den klar gekennzeichneten Presale Utility Reference Price von 0,001 USD.
- bei diesem Referenzpreis entsprechen Bronze/Silver/Gold/Platinum exakt 100.000/500.000/1.500.000/5.000.000 ULIQ.
- pending Purchase bleibt trotz Reference Price inaktiv.
- Market Price Mode aktiviert sich nicht automatisch beim DEX Launch.
- nach DEX Launch bleiben 30 Tage `MARKET_OBSERVATION` bei 0,001 USD Utility Reference aktiv.
- `MARKET_REFERENCE` nutzt 24h TWAP und ist nur bei Pool Age >= 30 Tagen, ausreichender TWAP-Historie, TVL >= 50.000 USD und healthy Feed möglich.
- Spot/TWAP-Abweichung > 25 %, Price Age > 30 Minuten oder Feed Failure erzeugt kein Upgrade, keinen Forced Downgrade und hält das bestehende Tier mit Operations Alert.

### I. Subscription- und AI-Credit-Discount

- Settlement bleibt USDC.
- Base-, Discount- und Final Amount sind rekonstruierbar.
- `base - discount = final`.
- erwarteter USDC Raw Amount entspricht dem Final Amount.
- Benefit Reservation gehört zu exakt einer Order.
- erfolgreiche Zahlung konsumiert die Reservation und aktiviert Produkt/AI Credits genau einmal.
- Cancel/Expire/Failure released die Reservation; wirtschaftliche Rückabwicklung erzeugt Reversal Ledger.
- pending/withdrawn Purchase erhält keinen Discount.
- Platform Fees und bestehende BotVaultV4 bleiben unverändert.

### J. Quote TTL und Wallet-Wechsel

- ULIQ Discount Reservation läuft exakt nach 10 Minuten ab.
- nach Ablauf ist eine neue Entitlement-Berechnung erforderlich.
- Wallet-Wechsel setzt alle offenen monetären ULIQ Reservations von `RESERVED` auf `RELEASED`.
- alte Wallet-Entitlements werden nicht übertragen.
- rabattierte Quote kann nicht mit neuer Wallet wiederverwendet werden.
- historische Purchases bleiben an die ursprüngliche Wallet gebunden.

### K. Holding Cooldown und Presale-Ausnahme

- Feature Benefits benötigen keinen Holding Cooldown und folgen dem nächsten validierten Entitlement Refresh.
- regulär erworbene oder frei übertragene ULIQ erzeugen vor 24 Stunden Holding Age keinen Subscription-/AI-Credit-Discount.
- nach 24 Stunden canonical belegter Holding Age kann die qualifizierte Menge für monetäre Benefits verwendet werden.
- Wallet A nutzt einen Discount und transferiert danach zu Wallet B: Wallet B erhält nicht unmittelbar einen monetären Benefit aus derselben Menge.
- eine canonical finalisierte Presale Allocation ist unmittelbar nach `FINALIZED` ohne zusätzliche 24 Stunden für Benefits aktiv.
- Claim oder Lock derselben wirtschaftlichen Menge darf Holding Age oder eligible ULIQ nicht vervielfachen.

### L. Reorg und Indexer Recovery

- orphaned Events werden markiert und aus Domain-Projektionen zurückgerollt.
- canonical Events werden replayt.
- Entitlement Snapshots werden invalidiert und neu erzeugt.
- kein Purchase, Refund, Finalization oder Benefit wird doppelt gezählt.
- Worker-Crash und Lease-Übernahme setzen sicher vom committed Cursor fort.
- Reconciliation-Abweichung erzeugt Alert und keine stille Überschreibung.

### M. Admin und Safe

- Backend besitzt keine Multisig Private Keys.
- `setDexLaunchTimestamp()` wird nur als Safe Transaction vorbereitet.
- Chain, Target, Selector, Parameter und erwarteter State sind im Preflight sichtbar.
- Superadmin, Reauth, Vier-Augen-Approval und Audit Event sind vorhanden.
- UI-Vorbereitung gilt nicht als Ausführung; erst canonical Receipt bestätigt den State.
- DEX Launch kann nur bei `pendingPurchaseCount == 0` vorbereitet und ausgeführt werden.
- Treasury-, Ecosystem-, Marketing- und Liquidity-Safes sind getrennt und keine persönliche EOA kontrolliert relevante Bestände zentral.

### N. State Machine, Pause und Sale-Ende

- Käufe sind ausschließlich in `ACTIVE` möglich.
- `PAUSED` sperrt neue Käufe, lässt aber zulässige Withdrawals, permissionless Finalisierungen und Reads zu.
- Sale endet bei Hard Cap oder `saleEnd`; mehr als 120.000.000 ULIQ können nie verkauft werden.
- Rounding-/Partial-Fill-Policy für den letzten Hard-Cap-Restbetrag ist vor Audit spezifiziert und getestet.
- permissionless Finalisierung durch eine fremde Adresse zahlt ausschließlich an Buyer/Vesting und erzeugt keinen Caller-Benefit.
- vollständige Cancellation bereits finalisierter Purchases bleibt vor ADR-001 Legal Sign-off unimplementiert.

### O. Allocation und Release Budgets

- Allocation summiert sich exakt auf 1.000.000.000 ULIQ, 18 Decimals, ohne Minting nach Deployment.
- Team: vor 12-Monats-Cliff 0 verfügbar, danach 36 Monate linear.
- Treasury: 12 Monate Lock plus höchstens 48 Monate Release Budget; `released != distributed`.
- Ecosystem: 60 Monate, Marketing/Partnerships: 48 Monate Release Budget; keine automatische Distribution.
- Liquidity: nur bedarfsgerechte Safe-Freigabe, keine automatische lineare Freigabe.
- `unlocked` wird im Reporting nie automatisch als `circulating` gezählt.

### P. Regression und Evidence

- bestehende Arbitrum-USDC-Billing-, AI-Credit-, Auth-, Wallet-, Vault- und Admin-Tests bleiben grün.
- Foundry Unit/Fuzz/Invariant/Fork Suite ist grün.
- Web Typecheck und i18n Check sind grün.
- API Typecheck und gezielte ULIQ/Billing Tests sind grün.
- `git diff --check` ist grün.
- Audit, Legal Sign-off, Deployment, Safe Ownership und Smoke Evidence sind releasebezogen dokumentiert.

## Mainnet No-Go Conditions

- ADR-001 blockiert oder Legal Sign-off fehlt.
- Refund/Safeguarding/Cancellation-Semantik nicht final.
- Ziel-Safe-Adressen, Signer oder Thresholds nicht deployment-ready/verifiziert.
- OpenZeppelin-/Compiler-Version nicht eingefroren.
- Audit Findings offen.
- Contract Inventory oder Address Book nicht verifiziert.
- Indexer/Reconciliation/Alerts nicht production-ready.
- Market Reference ohne konkrete DEX-/Pool-Adresse, Fee Tier, TWAP-Implementierung oder Failover Source.
- keine getestete Pause-/Incident-/Refund-Runbook-Probe.

## Arbitrum-Sepolia-Deployment-Nachweis 2026-08-22

Netzwerk und Rollen:

- Chain ID: `421614`.
- Deployment-/Testnet-Admin: `0x4165Df9092aD2adffFE6A63ad10863F696cac125`.
- Erster Deployment-Block und kanonischer Indexer-Startblock: `300866779`.
- Testnet Withdrawal Period: `300` Sekunden; die Production-Spezifikation von 14 Tagen bleibt unverändert.

Address Book:

| Contract | Adresse | Deployment Tx | Source Verification |
| --- | --- | --- | --- |
| `ULIQMockUSDC` | `0xA59C569041Ec4c735776FA8D0f46D19c2ef87220` | `0x7f86f2cf93efee73f0f9c02960660e3ca313ec338e05c49605068ecf59e72aa0` | Sourcify `exact_match` |
| `ULIQToken` | `0xCBd2D8a404FF371e36afCDF619123D5f1d62c23D` | `0x3127eecf93c1fcd321be1a7594594c155621259b507cc749a793467585229450` | Sourcify `exact_match` |
| `ULIQPresaleVesting` | `0x05D3d445e2793a982d75D813FFbc1EF18c4346E2` | `0x8db848428cc1919b32b9aa2628157dbfd5b811445faf4a6c7143ac7b848633b1` | Sourcify `exact_match` |
| `ULIQTestnetEscrow` | `0x25890c163C2B66fA1d1ca9a488c545466d6e09c8` | `0xe677999ad2c8654f5c835dbbfbc36c38ab0db4a08b4885eb2a2e96038540ee27` | Sourcify `exact_match` |
| `ULIQPresale` | `0x6203E5085df25435E94059d1427b7010A07A8cD3` | `0x58537182c56d0063d3cc5d12b053d2ddd15354b6e600ec5098d28235517004d0` | Sourcify `exact_match` |
| `ULIQLocker` | `0x98627918528ADa3B08d0a35fF4360B829e1095Cc` | `0xb63ebde080dd6cde6a84f465a233351ecc3d10d514e03408ad697bf84b26a79d` | Sourcify `exact_match` |

Stage 2 wurde in vier getrennten Admin-Transaktionen ausgeführt und anschließend gegen den Arbitrum-Sepolia-RPC finalitätsgeprüft:

- Vesting mit Presale verbunden: `0x1bbef4bcd93b0f607cbd64e61f460113bba2fba8e4ac1ab4313ed900b54cf335`.
- Testnet Escrow mit Presale verbunden: `0x64894f8fec250ccc7b8afa5d6e541694b4461132adb1a4c785229830f6ebb708`.
- `120,000,000 ULIQ` Presale Inventory übertragen: `0xdc7e44db19ad7954fcd99a5769d4ced554198a85498286796e531544659dc19d`.
- Presale auf `READY` gesetzt: `0xbcfe6cea4d18e9f6286b4bb12d5a96766427189759ac4f70610d6df101914339`.

Alle vier Receipts hatten Status `1`; ihre kanonischen Blockhashes stimmten beim Recheck überein. Der letzte Stage-2-Block `300872135` lag beim Recheck unter dem vom RPC gemeldeten finalisierten Block `300875669`. Live Reads bestätigten danach `READY`, die vollständige Contract-Verkabelung und exakt `120,000,000 ULIQ` Presale Inventory. `activateSale()` bleibt eine getrennt freizugebende Testnet-Onchain-Aktion.

Sourcify bestätigte für alle sechs Adressen sowohl Runtime- als auch Creation-Bytecode als `exact_match`. Noch offen: Staging-Runtime-Aktivierung, Indexer-/Reconciliation-Smoke und authentifizierte Browser-E2E-Flows.

## Acceptance-Status 2026-08-22

Die folgenden Bewertungen unterscheiden lokale Test-Evidence, den oben dokumentierten Arbitrum-Sepolia-Nachweis und weiterhin offene externe Gates ausdrücklich. Keine Testnet-Evidence ist ein Production-Nachweis.

| Kriterium | Status | Evidence / Restpunkt |
| --- | --- | --- |
| A Purchase während Withdrawal | PASS lokal | Pending ohne Token-/Vesting-/Benefit-Aktivierung ist in Contract und Projektion getestet. |
| B Finalisierung 25/75 | PASS lokal | atomare, permissionless Finalisierung und Rundung sind Unit-/Fuzz-getestet. |
| C Withdrawal/Refund | PASS lokal / BLOCKED legal | Testnet-Escrow-Refund ist getestet; Production-Safeguarding bleibt ADR-001-blockiert. |
| D Sale Cancellation | BLOCKED | finale Cancellation-Policy bleibt ADR-001-blockiert und wurde nicht irreversibel vorimplementiert. |
| E Vesting Start/Claim | PASS lokal | globaler einmaliger Start, 270-Tage-Testnet-Vesting und Claim-Accounting getestet. |
| F Locking | PASS lokal | nur 30/90/180 Tage, kein Early Withdraw, keine Rewards. |
| G Blockkonsistenz | PASS lokal | finalized Dual-RPC-Head und ein Block-Snapshot; `uint256` als Decimal/String. |
| H Tier/Price Mode | PASS lokal / BLOCKED DEX | Referenz-, Observation-, Degradation- und Held-Tier-Gates getestet; echte Pool-/TWAP-Quelle fehlt. |
| I Subscription-/AI-Discount | PASS lokal | Opt-in, exakte Cent-Mathematik, Reservation und USDC-Settlement integriert; Platform Fee unverändert. |
| J Quote TTL/Wallet-Wechsel | PASS lokal | 10-Minuten-TTL und Reservation Release getestet. |
| K Holding Cooldown | PASS lokal | Provenienz, Presale-Ausnahme, Locker-Lineage und 24-Stunden-Cooldown getestet. |
| L Reorg/Indexer Recovery | PASS lokal | Lease, Retry, Reorg-Rebuild, Reservation-Reversal und Alert getestet. |
| M Admin/Safe | PASS prepare-only / BLOCKED external | Superadmin vor Reauth, Audit und Safe-Calldata vorhanden; reale Safe-Signer/Threshold/Receipt-Evidence fehlt. |
| N State/Pause/Sale-Ende | PASS lokal / BLOCKED legal | Testnet-State-Machine getestet; Production-Cancellation bleibt blockiert. |
| O Allocation/Release Budgets | PARTIAL | Fixed Supply und Presale-Budget vorhanden; Mainnet-Safes und übrige Release-Contracts sind nicht Teil dieses Testnet-MVP. |
| P Regression/Evidence | PASS lokal / PARTIAL Sepolia | Stage 1 und Stage 2 sind deployed, konfiguriert, finalitätsgeprüft und bei Sourcify exakt verifiziert. Staging-Runtime-/Indexer-Evidence, Browser-E2E und externer Audit fehlen. |

Releaseurteil: `NOT READY`. Für die nächste Gate-Stufe fehlen mindestens Staging-Runtime-/Indexer-/Reconciliation-Evidence, authentifizierte E2E-/Recovery-Proben und ein unabhängiger Audit. Die verbleibenden Slither-Findings sind lokal bewertet, müssen aber im unabhängigen Review mitgeprüft werden. Mainnet bleibt zusätzlich durch ADR-001, reale DEX-/Pool-Konfiguration und verifizierte Safe-Struktur blockiert.
