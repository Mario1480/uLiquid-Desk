# ADR-003 – Platform Fee Discount

## Status

`ACCEPTED FOR MVP SCOPE`

## Context

Der erste ULIQ-Plan sah einen dynamischen Platform-Fee-Discount anhand des aktuellen Tiers vor. BotVaultV4 speichert Platform- und Affiliate-Fee-Raten jedoch bei der Vault-Erstellung als immutable Contract-Werte. Ein späteres Tier-Upgrade, Downgrade oder jährlicher Benefit Cap kann eine bestehende BotVaultV4-Gebühr nicht sicher verändern.

## Decision

- Platform-Fee-Discount wird vollständig aus dem ULIQ-MVP entfernt.
- ULIQ verändert keine bestehenden BotVaultV4 Fees.
- `UliqTierConfig` enthält im MVP keine wirksame `platformFeeDiscountBps`-Policy.
- Subscription- und AI-Credit-Discounts bleiben im MVP.
- eine spätere Implementierung benötigt eine neue ADR-Freigabe, Contract-/Accounting-Analyse, Tests, Legal Review und gegebenenfalls Audit.

## Alternatives considered

### Tier/Fee Snapshot beim neuen Vault-Start

Ein reduzierter Fee-Satz könnte bei Erstellung eines neuen Vaults dauerhaft eingefroren werden. Vorteil: kompatibel mit immutable Fee. Nachteil: späterer Tierverlust ändert den Vault nicht; bestehende und neue Vaults erhalten unterschiedliche lebenslange Konditionen.

### Offchain USDC Rebate

Standardgebühr bleibt on-chain, später wird ein Teil als Rebate ausgezahlt. Vorteil: keine Änderung an BotVaultV4. Nachteile: zusätzliche Treasury-, Accounting-, Tax-, Abuse-, Cap- und kapitalrelevante Auszahlungslogik.

### Neuer Vault Contract

Ein zukünftiger Contract könnte versionierte Fee-Entitlements abbilden. Nachteil: deutlich höhere Komplexität, Oracle-/Admin-Abhängigkeit und neuer Audit-/Migration-Scope.

### Dynamische Backend-Berechnung gegen BotVaultV4

Verworfen, weil der Contract die immutable Fee Policy erzwingt und Backend-State sie nicht sicher überschreiben kann.

## Consequences

- MVP bleibt kompatibel mit aktuellen BotVaultV4 Contracts und Settlement-Invariants.
- keine Änderungen an Runner-, Vault-, Profit-Share- oder Affiliate-Flows durch ULIQ.
- UI und Marketing dürfen keinen Platform-Fee-Discount versprechen.
- spätere Fee Benefits sind kein automatisch zugesagter Bestandteil des Tokens.

## Security implications

- reduziert den MVP Blast Radius und verhindert inkonsistente Onchain-/Backend-Fee-Berechnung.
- verhindert, dass manipulierbare Tiers unmittelbar kapitalrelevante Vault Fees ändern.
- spätere Rebate- oder Contract-Lösung benötigt Sybil-/Rotation-, Cap-, Idempotency- und Treasury-Schutz.

## Legal implications

- Token Utility im MVP darf Platform-Fee-Rabatte nicht als bestehendes Recht darstellen.
- spätere Rebate-/Fee-Strukturen müssen separat auf Steuer-, Consumer-, MiCA- und sonstige finanzregulatorische Auswirkungen geprüft werden.

## Open questions

- Soll eine spätere Version überhaupt Platform-Fee-Benefits anbieten?
- falls ja: Lifetime Snapshot, zeitlich begrenzter Snapshot, Rebate oder neuer Contract?
- Behandlung bereits laufender Vaults.
- Verhältnis zu Affiliate Fee und totaler Profit-Share-Fee.
- Benefit Caps, Accounting, Tax und Reversal.

## Revisit criteria

- ULIQ MVP stabil und live ausgewertet.
- klare Produkt-/Unit-Economics-Entscheidung.
- Legal und Accounting Review.
- separates Threat Model und ADR-Update.
- Contract-/Backend-Prototyp mit vollständiger Fee Settlement Regression.
