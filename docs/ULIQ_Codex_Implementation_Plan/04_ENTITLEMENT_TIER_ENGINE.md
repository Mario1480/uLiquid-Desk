# 04 – ULIQ Entitlement & Tier Engine

## Kernregeln

Nur finalisierte Bestände sind eligible:

`eligibleRaw = walletRaw + unreleasedVestingRaw + lockedRaw`

Dabei gilt:

- jeder Token wird exakt einmal gezählt.
- `PENDING_WITHDRAWAL` Presale Allocations zählen mit Faktor 0.
- `WITHDRAWN` Purchases zählen mit Faktor 0.
- erst ein bestätigtes `FINALIZED` Event aktiviert Wallet-/Vesting-Utility.
- Locking erhöht nicht die eligible Menge, sondern kann stärkere Produkt-Benefits freischalten.

## Zustandsübergänge ohne Doppelzählung

### Finalisierter Presale-Kauf

- Wallet: 250.000 ULIQ.
- unreleased Vesting: 750.000 ULIQ.
- Locked: 0 ULIQ.
- Eligible: 1.000.000 ULIQ.

### Claim von 100.000 ULIQ

- Wallet steigt auf 350.000 ULIQ.
- unreleased Vesting sinkt auf 650.000 ULIQ.
- Eligible bleibt 1.000.000 ULIQ.

### Lock von 150.000 Wallet-ULIQ

- Wallet sinkt auf 200.000 ULIQ.
- unreleased Vesting bleibt 650.000 ULIQ.
- Locked steigt auf 150.000 ULIQ.
- Eligible bleibt 1.000.000 ULIQ.

## Blockkonsistenz

Alle Bestandteile eines Snapshots werden gegen denselben finalisierten Block gelesen:

- `asOfBlock`
- `blockHash`
- Wallet `balanceOf` am `asOfBlock`
- Vesting State am `asOfBlock`
- Locker State am `asOfBlock`

Ein Snapshot darf keine Wallet-Balance aus Block 100 mit Vesting aus Block 102 und Locked State aus Block 105 kombinieren. Kann ein historischer Contract Read nicht konsistent ausgeführt werden, wird kein neuer monetärer Entitlement Snapshot erzeugt.

## Service Contract

`UliqEntitlementService.getForUser(userId)` liefert:

- serverseitig verknüpfte Wallet-Adresse.
- `asOfBlock` und `blockHash`.
- wallet, unreleased vesting, locked und eligible balances als Decimal Strings.
- pending presale allocation separat.
- Reference Price, Price Mode und Price Snapshot ID.
- eligible USD-equivalent.
- base tier, lock modifier und effective tier.
- Subscription- und AI-Credit-Discount BPS.
- Feature Flags.
- Config Version.
- Snapshot `computedAt` und `validUntil`.
- Degradation-/Staleness-State.

Das Backend akzeptiert für User-Entitlements keine frei wählbare Wallet-Adresse. Es löst die Wallet über den authentifizierten User auf.

Für Benefits werden zwei Sichten abgeleitet:

- `featureEligibleRaw`: aktueller bestätigter eligible Bestand; Feature Access benötigt keinen Lock.
- `monetaryEligibleRaw`: derselbe blockkonsistente eligible Bestand. Die Autorisierung eines konkreten monetären Discounts erfolgt separat über `LOCK_GATE_V1`, nicht über Holding Age.

## Tier System

Aktueller Arbeitsstand:

| Tier | Mindestwert |
| --- | ---: |
| Basic | unter 100 USD-equivalent |
| Bronze | 100 USD-equivalent |
| Silver | 500 USD-equivalent |
| Gold | 1.500 USD-equivalent |
| Platinum | 5.000 USD-equivalent |

Die Discount-BPS und Feature Flags werden versioniert in `UliqTierConfig` gepflegt. Platform-Fee-Discounts sind kein Bestandteil des MVP.

### Vor DEX Launch

- Für finalisierte Presale Allocations gilt 0,001 USD pro ULIQ als interner Utility-Referenzwert.
- Dieser Wert wird klar als nicht-marktbasierter Referenzwert gekennzeichnet.
- Pending Allocations bleiben unabhängig vom Referenzwert inaktiv.

### Nach DEX Launch

- 30 Tage `MARKET_OBSERVATION`; Tier Engine verwendet weiter 0,001 USD `PRESALE_REFERENCE`.
- keine automatische sofortige Umschaltung auf Spot-Preis.
- `MARKET_REFERENCE` wird erst nach Erfüllung und Admin-Freigabe aller Kriterien aus ADR-005 aktiviert und verwendet ausschließlich 24h TWAP.
- Der konkrete Price Snapshot ist Bestandteil jeder Tier- und Discount-Entscheidung.

## Locking Benefits

- unterstützte initiale Laufzeiten: 31, 184 und 366 Tage, dargestellt als 1, 6 und 12 Monate.
- Locking erzeugt keine zusätzlichen eligible ULIQ.
- Locking verändert weder Tier noch Discount-Stufe. Es aktiviert den vorhandenen Tier-Discount nur für den konkreten Produktzeitraum.
- keine APY-, Reward- oder Revenue-Share-Semantik.
- der exakte `unlockAt`-Timestamp ist autoritativ; eine nominelle Laufzeit allein beweist keine Abdeckung.
- der erforderliche Raw-Betrag ist `ceil(currentTierMinimumRaw * 25 %)`, berechnet unter demselben Price-/Config-Snapshot.
- nur nicht withdrawn kanonische Locks mit `unlockAt >= requiredBenefitUntil` werden addiert.
- ein abgelaufener, aber noch nicht withdrawn Lock kann im Holding-Tier-Bestand bleiben, verliert ab `unlockAt` aber die monetäre Qualifikation.
- Extensions dürfen `unlockAt` nur erhöhen und verändern weder Start noch Betrag oder Locked Balances.

## Feature Access vs. monetäre Benefits

### Feature Access

- aktueller bestätigter Entitlement Snapshot genügt.
- kein Holding Cooldown erforderlich.
- kurze Cache-TTL und Event-basierte Invalidierung.
- entfällt das Entitlement, kann der Benefit beim nächsten validierten Refresh entfallen.
- bei Price-Feed-Degradation wird das bestehende Tier gehalten; neue Upgrades bleiben gesperrt.

### Monetäre Benefits

- benötigen zusätzlich eine `UliqBenefitReservation`.
- benötigen ein gültiges Entitlement sowie einen kanonisch finalisierten Lock mit ausreichendem Betrag und `unlockAt >= requiredBenefitUntil`.
- der frühere 24-Stunden-Holding-Cooldown autorisiert ab ADR-008 keinen monetären Benefit mehr.
- Zustände: `RESERVED`, `CONSUMED`, `RELEASED`, `REVERSED`.
- Reservation bindet User, Wallet, Entitlement Snapshot, Price Snapshot, Config Version, Reference, Discount Amount und die vollständige versionierte Lock-Entscheidung.
- Idempotency Key verhindert Doppelverbrauch.
- Reservation TTL: exakt 10 Minuten.
- abgelaufene, stornierte oder fehlgeschlagene Orders releasen beziehungsweise reversen die Reservation transaktional.

## Anti-Reuse und Wallet-Wechsel

- Beim Linken, Ersetzen oder Entkoppeln der User-Wallet wechseln alle offenen ULIQ Discount Reservations transaktional von `RESERVED` auf `RELEASED`.
- Alte Wallet-Entitlements werden nicht auf die neue Wallet übertragen.
- Neue Wallet-Entitlements werden vollständig neu berechnet.
- Historische Purchases und Benefit Ledger bleiben an die ursprüngliche Wallet gebunden.
- dieselbe Reservation kann nicht für mehrere Billing Orders oder Accounts konsumiert werden.
- Transferierte ULIQ gewähren auf der neuen Wallet allein keinen monetären Benefit; die neue Wallet benötigt eine eigene finalisierte Lock-Abdeckung und Reservation.

## Cache und Invalidierung

- kurze, dokumentierte TTL.
- Invalidierung bei confirmed/finalized ULIQ Transfer-, Vesting-, Lock-, Purchase-, Withdrawal-, Finalization- und Reorg-Events.
- vor monetärer Quote serverseitig neu validieren.
- Billing Order speichert Snapshot und Reservation.
- regelmäßige Reconciliation kann Snapshots als stale markieren, überschreibt aber Abweichungen nicht still.

## Degradation

- kein Upgrade auf stale, manipulierten oder nicht blockkonsistenten Daten.
- bestehendes Tier wird bei Price Feed Failure, Staleness oder >25-%-Deviation gehalten; neue Upgrades und automatische Downgrades sind deaktiviert.
- monetäre Reservations dürfen nur auf dem gehaltenen oder einem frischen qualifizierten Tier entstehen und dokumentieren den Degradation-State.
- jeder Degradation-State wird in API, UI, Logs und Admin Health sichtbar.
