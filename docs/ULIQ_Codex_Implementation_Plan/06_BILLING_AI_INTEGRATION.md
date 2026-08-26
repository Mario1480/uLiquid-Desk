# 06 – Billing & AI Credits Integration

## Grundsatz

ULIQ ist niemals Payment Asset. Das bestehende direkte Arbitrum-USDC-Billing bleibt Settlement Layer und Source of Truth für Payment Verification, Order Lifecycle und Aktivierung von Subscription-/AI-Credit-Produkten.

ULIQ modifiziert ausschließlich den finalen USDC-Preis über servervalidierte Benefits.

Platform-Fee-Discounts sind vollständig aus dem MVP entfernt.

## Eligibility Gate

Ein Discount ist nur zulässig, wenn:

- Purchase-/Wallet-/Vesting-/Locker-Events ausreichend bestätigt sind.
- Presale Purchase `FINALIZED` ist.
- Entitlement Snapshot blockkonsistent und nicht stale ist.
- Price und Tier Config gültig sind.
- Wallet im Snapshot weiterhin die serverseitig verknüpfte User-Wallet ist.
- ein finalisierter kanonischer Lock mindestens 25 % des aktuellen Tier-Minimums abdeckt.
- die Summe qualifizierender Locks einen `unlockAt`-Timestamp am oder nach dem exakten Produktlaufzeitende besitzt.
- eine monetäre `UliqBenefitReservation` erfolgreich angelegt wurde.

Pending oder withdrawn Presale Allocations erhalten niemals einen Discount.

## Subscription Checkout

1. bestehende aktive `BillingPackage`-Preise und Cart Lines auflösen.
2. Base Amount in Cents berechnen.
3. exaktes `plannedTerm` mit der bestehenden UTC-Kalendermonatslogik berechnen; frühe Renewals hängen am Ende der Term-Kette an.
4. frischen ULIQ Entitlement Snapshot erzeugen.
5. Subscription Discount BPS aus versionierter Tier Config bestimmen.
6. finalisierte Lock-Abdeckung bis `plannedTerm.endsAt` prüfen.
7. Discount mit definierter Integer-Rundung berechnen.
8. ULIQ Benefit Reservation atomar anlegen.
9. Final Amount in Cents und USDC Raw Units berechnen.
10. bestehende Arbitrum-USDC-Billing-Order mit unveränderlichem Planned-Term-/Lock-Snapshot erstellen.
11. bestehenden USDC Submit-, Confirmation-, Review- und Reconciliation-Flow verwenden.
12. Reservation bei erfolgreicher Aktivierung `CONSUMED` setzen und Benefit Ledger schreiben.
13. bei Ablauf/Cancel/Fehler `RELEASED`, bei wirtschaftlicher Rückabwicklung `REVERSED` setzen.

Rabattierte Plan-Käufe unterstützen ausschließlich insgesamt 1, 6 oder 12 Billing-Monate. Scheitert das ULIQ-Gate, bleibt derselbe Kauf ohne ULIQ zum normalen aktiven `BillingPackage`-Preis möglich.

## AI Credits

Der gleiche Ablauf gilt für AI-Credit-Pakete:

- aktive Subscription, deren Order eine konsumierte ULIQ-Subscription-Discount-Reservation besitzt.
- Lock-Abdeckung bis zum Ende genau dieser Subscription.
- gültiger versionierter Monats-Cap; ohne Cap wird der AI-Discount fail-closed abgelehnt.
- Basispreis des bestehenden Credit Packs.
- AI Discount laut effective ULIQ Tier.
- finaler Preis ausschließlich in USDC.
- bestehender `AiCreditLedger` schreibt nach bestätigter Zahlung die Credits gut.
- keine ULIQ Credits und kein `AiTokenLedger`.

Beispiel:

- AI-Credit-Paket: 10,00 USDC.
- Gold Tier: 15 % Discount.
- Discount: 1,50 USDC.
- Final: 8,50 USDC.
- Settlement: 8,50 USDC über den bestehenden Checkout.

## Quote TTL und bestehende Orders

- ULIQ Discount Quotes verwenden nicht die bestehende 24-Stunden-Billing-TTL als Discount-Gültigkeit.
- Benefit Reservation TTL beträgt exakt 10 Minuten.
- nach Ablauf muss Entitlement neu berechnet werden.
- eine normale Billing Order darf nach bestehender Logik weiter existieren, aber ein abgelaufener ULIQ Discount darf nicht still wiederverwendet werden.
- Cart Fingerprint beziehungsweise Order-Reuse muss Tier Config, Entitlement/Reservation und finalen Preis berücksichtigen.

## Wallet-Wechsel

- alle offenen ULIQ Benefit Reservations des Users wechseln von `RESERVED` auf `RELEASED`.
- offene rabattierte Quotes können nicht mit der neuen Wallet bezahlt oder wiederverwendet werden.
- bestehende normale Billing Orders werden separat nach ihrer aktuellen Lifecycle-Logik behandelt.
- Senderadresse der Onchain-Zahlung bleibt der im Order Snapshot gespeicherten Wallet zugeordnet.

## Order Snapshot

Billing Order und Line Items speichern rekonstruierbar:

- Base Package/Cart Amount.
- Discount Amount.
- Final Amount.
- Currency und USDC Raw Amount.
- Tier und Discount BPS.
- Wallet-Adresse.
- Entitlement Snapshot ID und `asOfBlock`.
- Price Snapshot ID und Price Mode.
- Tier Config Version.
- Benefit Reservation ID.
- geplantes Subscription-Start-, End- und Grace-Ende.
- Lock-Gate-Version, Locker-Adresse, erforderlicher/qualifizierender Raw-Betrag, qualifizierende Lock-IDs und `requiredBenefitUntil`.
- Base-/Discount-/Final-Aufteilung je Line, wenn mehrere Pakete enthalten sind.

`amountCents` und `BillingOnchainPayment.expectedAmountRaw` entsprechen dem finalen Zahlbetrag.

## Rundung

- alle Discount-Berechnungen in Integer Cents und BPS.
- keine JS-Float-Berechnung.
- Rundung darf den User nicht mehr Discount erhalten lassen als konfiguriert.
- Summe der Line Discounts muss exakt dem Order Discount entsprechen.
- `base - discount = final` ist eine persistierte und getestete Invariant.
- Final Amount darf nicht negativ oder null werden, sofern das bestehende Billing keinen Zero-Amount-Checkout unterstützt.

## Reservation und Ledger

- Reservation-Erstellung und Order-Erstellung erfolgen serialisierbar beziehungsweise mit eindeutigen Idempotency Keys.
- eine Reservation gehört zu exakt einer Reference/Order.
- konkurrierende Requests dürfen denselben Benefit nicht mehrfach reservieren.
- Ledger-Einträge sind append-only.
- Reversal erzeugt einen Gegenposten und löscht keinen historischen Verbrauch.
- Caps, sofern aktiviert, berücksichtigen `RESERVED` und `CONSUMED`, damit Parallelität das Limit nicht überschreitet.

## Degradation

- Price Feed Failure, Staleness > 30 Minuten oder Spot/TWAP-Deviation > 25 %: bestehendes bestätigtes Tier halten, keine neuen Upgrades und keine automatische Herabstufung.
- Fehlt dagegen ein gültiger Entitlement-/Lock-Nachweis, gilt Standardpreis ohne ULIQ Discount.
- kein automatisches Nachgewähren eines Discounts nach bereits abgeschlossener Standardpreis-Zahlung.
- UI zeigt Grund und Zeitpunkt der letzten gültigen ULIQ-Prüfung.
- Feature Access Grace und monetärer Discount Fallback sind getrennte Policies.

## Tests

- pending/withdrawn/finalized Purchase Eligibility.
- exakte BPS- und Cent-Rundung.
- Reservation Race und Idempotenz.
- Quote Expiry.
- Holding-Tier ohne Lock: Feature Access aktiv, monetärer Discount abgelehnt.
- Lock-Betrag unter/auf 25-%-Schwelle sowie Ablauf eine Sekunde vor/exakt am Term-Ende.
- aggregierte Locks, abgelaufene Locks und 31/184/366-Tage-Initiallaufzeiten.
- 1/6/12-Kalendermonatsgrenzen, Leap Year und angehängte Early Renewals.
- Extension qualifiziert erst nach kanonischer Finalisierung; Reorg invalidiert die Evidence.
- AI-Discount ohne aktive rabattierte Subscription beziehungsweise ohne gültigen Monats-Cap.
- Rotation Wallet A -> Wallet B ohne eigene Lock-Abdeckung.
- Wallet-Wechsel während offener Quote.
- Token-Transfer nach Snapshot.
- Order Cancel, Expire, Fail, Review Required und Late Payment Recovery.
- Reorg nach Reservation beziehungsweise vor Payment Finalization.
- AI-Credit-Gutschrift exakt einmal.
- Base/Discount/Final- und USDC-Raw-Invariants.
- bestehende USDC Billing Regression Suite unverändert grün.
