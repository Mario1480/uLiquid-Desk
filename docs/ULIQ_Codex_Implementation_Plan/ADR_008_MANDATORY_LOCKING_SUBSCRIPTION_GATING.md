# ADR-008 – Mandatory Locking & Subscription-Term Gating

## Status

`ACCEPTED FOR TESTNET MVP`

ADR-001 bleibt `BLOCKED / LEGAL REVIEW REQUIRED`. Diese Entscheidung autorisiert weder Production Contracts noch Arbitrum-One-Deployment.

## Context

Der bisherige Entwurf verwendete 30/90/180-Tage-Locks und einen 24-Stunden-Holding-Cooldown als zusätzliche Voraussetzung für monetäre ULIQ-Benefits. Die Dauer eines Locks war nicht an die tatsächlich gekaufte Subscription-Laufzeit gebunden. Dadurch konnte ein Lock vor dem Ende des rabattierten Produktzeitraums auslaufen, obwohl der Discount bereits verbraucht war.

Holding und Locking haben unterschiedliche Aufgaben: Der finalisierte Bestand bestimmt das Tier und damit Feature Access sowie die mögliche Discount-Stufe. Ein kanonisch finalisierter Lock aktiviert den monetären Discount nur dann, wenn Betrag und verbleibende Laufzeit die konkrete Bestellung vollständig abdecken.

## Decision

### Entitlement und Feature Access

- `eligibleRaw = walletRaw + unreleasedFinalizedVestingRaw + lockedRaw`; jeder Token zählt exakt einmal.
- Holding bestimmt `baseTier` und Feature Access. Feature Benefits benötigen keinen Lock.
- Pending oder withdrawn Presale Purchases zählen nicht.
- Ein Lock erzeugt keine zusätzlichen eligible ULIQ und keinen Tier-, Laufzeit- oder Discount-Multiplikator.

### Monetäre Benefits

- Subscription- und AI-Credit-Discounts benötigen neben dem gültigen Entitlement eine kanonisch finalisierte Lock-Entscheidung und die bestehende exakt zehn Minuten gültige `UliqBenefitReservation`.
- Der 24-Stunden-Holding-Cooldown ist ab ADR-008 keine Autorisierungsvoraussetzung für monetäre Benefits. Reservation, Idempotenz, Wallet-Wechsel-, Reorg- und Ledger-Regeln aus ADR-004 bleiben verbindlich.
- Der erforderliche Lock-Betrag beträgt 25 % des Minimums des aktuellen Tiers unter demselben Price-/Config-Snapshot:

  `requiredLockedRaw = ceil(currentTierMinimumRaw * 0.25)`

- Es zählen ausschließlich aktive, nicht withdrawn, kanonische Locks mit:

  `lock.unlockAt >= requiredBenefitUntil`

- Mehrere qualifizierende Locks werden addiert. Ein Lock, der eine Sekunde vor `requiredBenefitUntil` endet, zählt nicht; die exakte Gleichheit zählt.
- Ein abgelaufener, noch nicht withdrawn Lock darf im Holding-Tier-Bestand bleiben, qualifiziert nach `unlockAt` aber keinen neuen monetären Benefit.

### Laufzeiten und Verlängerung

- Unterstützte initiale Laufzeiten sind 31, 184 und 366 Tage und werden im Produkt als 1, 6 und 12 Kalendermonate dargestellt.
- Die tatsächlichen Timestamps sind autoritativ. Die Auswahl einer nominellen Laufzeit allein beweist keine Abdeckung.
- `extendLock(lockId, newUnlockAt)` darf ausschließlich durch den Owner für eine existierende, nicht withdrawn Position aufgerufen werden.
- `newUnlockAt` muss strikt größer als der aktuelle Wert sein. Startzeit, ursprünglicher Ablauf, Betrag, `lockedBalanceOf` und `totalLocked` bleiben unverändert.

### Subscription-Laufzeit

- Rabattierte Plan-Käufe sind ausschließlich für insgesamt 1, 6 oder 12 Billing-Monate zulässig.
- `plannedTerm.startsAt`, `plannedTerm.endsAt` und Grace-Ende werden vor der Discount-Reservation mit der bestehenden UTC-Kalendermonatslogik berechnet und unveränderlich im Order-/Reservation-Snapshot gebunden.
- Eine frühe oder wiederholte Verlängerung hängt am Ende der bereits bezahlten beziehungsweise vorgemerkten Term-Kette an.
- `plannedTerm.endsAt` ist `requiredBenefitUntil`. Die spätere Aktivierung darf die Laufzeit nicht still neu und länger berechnen.
- Scheitert das Lock-Gate, bleibt der normale USDC-Checkout zum Standardpreis verfügbar.

### AI-Credit-Discount

- Ein AI-Credit-Discount erfordert eine aktive Subscription, deren Order eine konsumierte `SUBSCRIPTION_DISCOUNT`-Reservation besitzt.
- Das Ende dieser aktiven Subscription ist `requiredBenefitUntil`.
- Zusätzlich gelten dieselbe 25-%-Lock-Abdeckung und ein versionierter monatlicher Cap aus `monetaryBenefitCaps`.
- Fehlt ein gültiger Cap, wird ausschließlich der AI-Discount fail-closed abgelehnt; der Standardpreis-Checkout bleibt verfügbar.
- `RESERVED` und `CONSUMED` werden gemeinsam gegen den Monats-Cap gerechnet.

### Ausgeschlossene Mechaniken

- kein Platform-Fee-Discount; wirksamer Wert bleibt 0 BPS.
- keine APY-, Reward-, Revenue-Share-, Lock-Multiplier- oder automatische Buyback-Semantik.
- ULIQ bleibt Utility-/Gate-Asset; Settlement bleibt ausschließlich USDC.

## Persistence, Indexer und Audit

- `LockExtended` wird idempotent indexiert. Die Projektion ändert nur `unlockAt`, Extension-Auditfelder und finalisierte Blockmetadaten.
- Originaler Start, ursprünglicher Ablauf und Betrag bleiben erhalten. Reorg-Replay rekonstruiert den kanonischen Ablauf.
- Reconciliation vergleicht Amount, Expiry und Withdrawn-State von Contract und Projektion.
- Neue monetäre Reservations werden bei stale/non-finalized Cursor, orphaned Lock-Evidence oder fehlender Laufzeit-/Betragsdeckung verweigert.
- Die Reservation bindet Lock-Gate-Version, Locker-Adresse, `requiredBenefitUntil`, erforderlichen und qualifizierenden Raw-Betrag sowie qualifizierende Lock-IDs.
- Änderungen an Discount-BPS und AI-Caps erzeugen eine neue vollständige Tier-Config-Version und einen atomaren Admin-Audit-Eintrag mit Actor, Reason, Old/New Value und Version.

## Consequences

- Ein höheres Holding-Tier allein gewährt Features, aber keinen monetären Discount.
- Nutzer müssen den Lock bei frühen Verlängerungen gegebenenfalls vor dem Checkout verlängern und dessen kanonische Finalisierung abwarten.
- Die Produktanzeige muss den exakten Ablauf, die verbleibende Abdeckung, den benötigten Betrag und das benötigte Datum zeigen.
- Alte 30/90/180-Tage-Testnet-Contracts erfüllen ADR-008 nicht und benötigen vor Aktivierung dieser Regeln einen separat freigegebenen Testnet-Neudeploy.
- Migration, Contract-Deployment, Runtime-Aktivierung und Staging-Rollout sind separate Operations-Gates.

## Security implications

- Amount- und Term-Gate werden serverseitig aus demselben finalisierten kanonischen Zustand entschieden.
- Bigint/Decimal-String-Mathematik und Aufrundung verhindern Unterdeckung durch Float- oder Rundungsfehler.
- Nicht verkürzbare Locks machen eine einmal finalisierte Abdeckung stabil; Reorg und Contract-Rotation werden dennoch beim Reservation-Commit und Consumption validiert.
- Unique Keys, CAS und transaktionale Cap-Zählung verhindern mehrfachen Benefit-Verbrauch durch parallele Tabs oder Retries.

## Acceptance criteria

- Holding ohne Lock lässt Feature Access bestehen, lehnt aber einen rabattierten Checkout strukturiert ab.
- Der qualifizierende Betrag erreicht mindestens 25 % des aktuellen Tier-Minimums.
- Kein rabattierter Subscription-Zeitraum endet nach dem qualifizierenden Lock.
- 1/6/12-Monats-Käufe verwenden kalendarische Term-Enden; initiale Locks bleiben 31/184/366 Tage.
- Extension kann niemals verkürzen oder Locked Balances verändern.
- AI-Discount ohne aktive rabattierte Subscription oder gültigen Monats-Cap wird fail-closed abgelehnt.
- Platform-Fee-Discount bleibt 0; Standardpreis-USDC-Checkout bleibt verfügbar.
- ADR-001 bleibt blockiert und es erfolgt durch diese ADR kein Production-/Mainnet-Deployment.
