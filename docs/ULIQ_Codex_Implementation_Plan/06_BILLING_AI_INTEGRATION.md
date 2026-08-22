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
- regulär erworbene/frei übertragbare ULIQ für die benötigte monetäre Tier-Menge seit mindestens 24 Stunden gehalten werden.
- oder die benötigte Menge aus einer canonical finalisierten Presale Allocation stammt, die vom zusätzlichen Cooldown ausgenommen ist.
- eine monetäre `UliqBenefitReservation` erfolgreich angelegt wurde.

Pending oder withdrawn Presale Allocations erhalten niemals einen Discount.

## Subscription Checkout

1. bestehende aktive `BillingPackage`-Preise und Cart Lines auflösen.
2. Base Amount in Cents berechnen.
3. frischen ULIQ Entitlement Snapshot erzeugen.
4. Subscription Discount BPS aus versionierter Tier Config bestimmen.
5. Discount mit definierter Integer-Rundung berechnen.
6. ULIQ Benefit Reservation atomar anlegen.
7. Final Amount in Cents und USDC Raw Units berechnen.
8. bestehende Arbitrum-USDC-Billing-Order mit Snapshot erstellen.
9. bestehenden USDC Submit-, Confirmation-, Review- und Reconciliation-Flow verwenden.
10. Reservation bei erfolgreicher Aktivierung `CONSUMED` setzen und Benefit Ledger schreiben.
11. bei Ablauf/Cancel/Fehler `RELEASED`, bei wirtschaftlicher Rückabwicklung `REVERSED` setzen.

## AI Credits

Der gleiche Ablauf gilt für AI-Credit-Pakete:

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
- Fehlt dagegen ein gültiger Entitlement-/Holding-Nachweis, gilt Standardpreis ohne ULIQ Discount.
- kein automatisches Nachgewähren eines Discounts nach bereits abgeschlossener Standardpreis-Zahlung.
- UI zeigt Grund und Zeitpunkt der letzten gültigen ULIQ-Prüfung.
- Feature Access Grace und monetärer Discount Fallback sind getrennte Policies.

## Tests

- pending/withdrawn/finalized Purchase Eligibility.
- exakte BPS- und Cent-Rundung.
- Reservation Race und Idempotenz.
- Quote Expiry.
- regulär erworbene ULIQ vor/nach 24-Stunden-Holding-Cooldown.
- finalisierte Presale Allocation ohne zusätzlichen Cooldown.
- Rotation Wallet A -> Wallet B ohne unmittelbaren zweiten monetären Benefit.
- Wallet-Wechsel während offener Quote.
- Token-Transfer nach Snapshot.
- Order Cancel, Expire, Fail, Review Required und Late Payment Recovery.
- Reorg nach Reservation beziehungsweise vor Payment Finalization.
- AI-Credit-Gutschrift exakt einmal.
- Base/Discount/Final- und USDC-Raw-Invariants.
- bestehende USDC Billing Regression Suite unverändert grün.
