# ADR-004 – Entitlement Anti-Reuse

## Status

`ACCEPTED / SUPERSEDED IN PART BY ADR-008`

## Supersession note

ADR-008 ersetzt ausschließlich die nachfolgend historisch dokumentierte Entscheidung, den 24-Stunden-Holding-Cooldown als monetäres Autorisierungs-Gate zu verwenden. Ab ADR-008 erfordern monetäre Benefits stattdessen einen kanonisch finalisierten Lock mit ausreichendem Betrag und Abdeckung bis zum konkreten Produktlaufzeitende. Reservation TTL, Idempotenz, Wallet-Wechsel, Reorg-Schutz, Ledger und Cap-Schutz aus dieser ADR bleiben verbindlich. Der historische Text wird nicht umgeschrieben.

## Context

ULIQ ist frei übertragbar. Ein User könnte mit Wallet A einen monetären Discount quoten, die Tokens danach an Wallet B übertragen und dort eine weitere Quote erzeugen. Ein einfacher Balance Snapshot verhindert dies nicht. uLiquid erlaubt außerdem das Ersetzen oder Entkoppeln der mit einem User verknüpften SIWE-Wallet.

Feature Access und monetäre Benefits haben unterschiedliche Risikoprofile. Feature Access kann kurzlebig anhand eines aktuellen Snapshots entschieden werden; ein wirtschaftlicher Discount benötigt zusätzliche Reservierungs-, Idempotenz- und Wallet-Lifecycle-Regeln.

## Decision

- Feature Benefits wie Premium AI Features, Advanced Prediction Tools, Early Access, zusätzliche Features und höhere Limits verwenden einen aktuellen bestätigten Entitlement Snapshot. Sie benötigen keinen Holding Cooldown und können beim nächsten validierten Refresh entfallen.
- monetäre Subscription-/AI-Credit-Discounts benötigen ein gültiges Entitlement, einen 24-Stunden-Holding-Cooldown und zusätzlich eine `UliqBenefitReservation`.
- regulär erworbene oder frei übertragene ULIQ zählen für einen monetären Benefit erst, wenn die dafür benötigte eligible Menge seit mindestens 24 Stunden nach canonical Chain-Historie gehalten wird.
- finalisierte Presale Allocations sind vom zusätzlichen 24-Stunden-Cooldown ausgenommen: Nach `PENDING_WITHDRAWAL -> FINALIZED` werden sie unmittelbar monetary-eligible.
- Reservation States: `RESERVED`, `CONSUMED`, `RELEASED`, `REVERSED`.
- Reservation bindet User, Wallet, Entitlement Snapshot, Price Snapshot, Config Version, Reference, Benefit Type und Discount Amount.
- jede Reservation besitzt einen eindeutigen Idempotency-/Reference-Key.
- TTL beträgt exakt 10 Minuten.
- Wallet Link/Replace/Unlink setzt alle offenen monetären ULIQ Reservations des Users von `RESERVED` auf `RELEASED`.
- alte Wallet-Entitlements werden nicht auf eine neue Wallet übertragen.
- erfolgreiche Produktaktivierung konsumiert die Reservation; Cancel/Expire/Fail released sie; wirtschaftliche Rückabwicklung erzeugt Reversal.
- Caps berücksichtigen `RESERVED` und `CONSUMED` transaktional.

Holding-Provenienz und -Kontinuität werden aus canonical Transfer-, Vesting-, Claim- und Lock-Historie konservativ ermittelt. Kann die 24-Stunden-Bedingung für die benötigte Menge nicht eindeutig belegt werden, gibt es keinen neuen monetären Benefit. Positionstransfers wie Vesting Claim oder Lock dürfen das Alter derselben wirtschaftlichen Menge nicht künstlich zurücksetzen oder vervielfachen.

## Alternatives considered

### Snapshot ohne Reservation

Verworfen für monetäre Benefits: Race-, Replay- und Quote-Reuse-Risiko.

### Onchain Lock als zwingende Voraussetzung für jeden monetären Discount

Nicht gewählt: höhere UX-/Gas-Hürde als der akzeptierte Holding-Cooldown.

### Mindest-Holding-Periode

Akzeptiert als 24-Stunden-Cooldown für monetäre Benefits.

### Wallet-/Token-Cooldown nach Discount

Kann Rotation erschweren, ist aber komplex bei fungiblen Tokens und mehreren Wallets.

### Account-only Benefit Caps

Einfach, verhindert aber Sybil Accounts mit derselben rotierenden Tokenmenge nicht vollständig.

## Consequences

- Billing Order und Benefit Reservation werden eng, aber über IDs nachvollziehbar gekoppelt.
- normale 24-Stunden-Billing-TTL und exakt 10 Minuten ULIQ Discount-TTL müssen getrennt bleiben.
- Wallet-Wechsel erhält zusätzliche serverseitige Side Effects.
- Support/Admin benötigt Reservation- und Reversal-Sichtbarkeit.
- Benefit Ledger wird append-only.

## Security implications

- Reservation Creation und Order Creation benötigen serialisierbare Transaktion oder robuste CAS/Unique Constraints.
- Referenzen und Idempotency Keys dürfen nicht userkontrolliert kollidieren.
- Reservation sperrt keine Tokens on-chain; der zusätzlich verpflichtende 24-Stunden-Holding-Nachweis verhindert unmittelbare Wiederverwendung nach Transfer.
- Reorgs invalidieren betroffene Snapshots und offene Reservations.
- stale/degraded Price State kann kein Tier-Upgrade erzeugen; das letzte bestätigte Tier wird gemäß ADR-005 gehalten. Ein stale Indexer-, Balance- oder Holding-Proof gewährt dagegen keine neue monetäre Reservation.
- Wallet-Änderungen dürfen nicht zwischen Entitlement Check und Reservation Commit durchrutschen.

## Legal implications

- Discount-Regeln, Expiry, Cap und mögliche Lock-/Holding-Anforderungen müssen transparent beschrieben werden.
- Reversal darf nicht zu einer unzulässigen nachträglichen Preiserhöhung abgeschlossener Käufe führen.
- Account-/Wallet-Verknüpfung und Transferhistorie berühren Privacy-/Retention-Fragen.

## Open questions

- exakte konservative Lot-/Minimum-Balance-Attribution für gemischte Presale-, Transfer-, Claim- und Lock-Bestände.
- Benefit Caps pro User, Wallet, Haushalt/Entity oder Kombination.
- Behandlung von Token Transfer nach Reservation, aber vor Zahlung.
- Behandlung von Late Payment nach Reservation Expiry.
- wie Reorg und Order Reconciliation Reservations invalidieren/reversen.

## Acceptance criteria

- parallele Requests konsumieren denselben Reference Benefit höchstens einmal.
- regulär erworbene oder übertragene ULIQ gewähren vor 24 Stunden keinen monetären Benefit.
- finalisierte Presale Allocation gewährt ohne zusätzliche 24 Stunden unmittelbar Benefits.
- Transfer Wallet A -> Wallet B ermöglicht Wallet B nicht unmittelbar denselben monetären Tier-Benefit.
- Wallet-Wechsel macht offene rabattierte Quotes unbrauchbar.
- Wallet-Wechsel setzt alle offenen `RESERVED` Reservations auf `RELEASED`.
- jede Discount Quote läuft exakt nach 10 Minuten ab.
- abgelaufene Reservation kann nicht bezahlt und konsumiert werden, ohne erneute Prüfung.
- Reorg invalidiert den zugrundeliegenden Snapshot und verhindert falschen Consumption State.
- Reorgs und gemischte Bestände können den Holding-Nachweis nicht künstlich verlängern oder vervielfachen.
