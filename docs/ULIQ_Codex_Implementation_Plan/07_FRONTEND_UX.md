# 07 – Web UI / UX

## Design- und Integrationsregeln

- bestehende uLiquid-Komponenten, CSS-Primitives und Design Tokens verwenden.
- `AppIcon` für normale UI-Icons; keine neuen Inline-SVGs.
- Sidebar und Main Navigation konsistent erweitern.
- sichtbare Texte vollständig in DE und EN pflegen.
- Wallet-, Subscription-, AI-Credit- und Admin-Flows responsiv und mobil testen.
- Contract-, Allocation- oder Benefit-State niemals im Browser erfinden.
- ULIQ-Reads dürfen kapitalnahe Wallet-/Billing-Listen nicht blockieren.

## Navigation und Routen

- `/uliq`
- `/uliq/presale`
- `/uliq/vesting`
- `/uliq/locking`

Admin Navigation erhält einen getrennten ULIQ-/Token-Operations-Eintrag.

## ULIQ Overview

Anzeigen:

- Wallet ULIQ.
- unreleased Vesting ULIQ.
- Locked ULIQ.
- Pending Presale Allocation separat.
- Eligible ULIQ.
- Reference USD-equivalent mit Price-Mode-Kennzeichnung.
- Current und Next Tier.
- aktive Benefits und Lock Modifier.
- Snapshot Block, Aktualität und Degradation-Hinweis.

Pending Allocation darf optisch nicht als verfügbar, vested oder eligible dargestellt werden.

## Presale UI States

Mindestens:

- `SALE_NOT_STARTED`
- `SALE_ACTIVE`
- `PURCHASE_PENDING`
- `WITHDRAWAL_ACTIVE`
- `PURCHASE_WITHDRAWN`
- `PURCHASE_FINALIZED`
- `SALE_PAUSED`
- `SALE_ENDED`
- `SALE_CANCELLED`
- `WAITING_FOR_DEX_LAUNCH`
- `VESTING_ACTIVE`
- `INDEXER_DELAYED`
- `REVIEW_REQUIRED`

## Presale Page

Vor Kauf:

- Price und Kennzeichnung als Presale-Preis.
- sold, hard cap und remaining allocation.
- Sale Start/End.
- USDC-Balance und ETH-Gas-Hinweis.
- Amount Input und per-wallet Limits.
- Total Allocation.
- Finalization Preview: 25 % Wallet / 75 % Vesting; beide tatsächlichen Pending-Bestände bleiben 0.
- Withdrawal Period und konkrete Deadline-Semantik.
- klare Aussage: während Withdrawal 0 eligible ULIQ und keine Benefits.
- Sale Terms, Legal Acknowledgement und Restricted-Jurisdiction-Gates nach ADR-001.
- Approve/Permit und Buy Flow.

Während Withdrawal:

- Total Allocation.
- Withdrawal Deadline mit Zeitzone.
- Finalization Preview 25 % Wallet Release.
- Finalization Preview 75 % Vesting Allocation.
- Wallet received: 0.
- Vesting active/allocated: 0.
- Eligible: 0.
- Benefits: inactive.
- verfügbare Withdrawal-/Refund-Aktion nach finalen Sale Terms.
- Tx-, Confirmation-, Indexer- und Refund-Status.

Nach Finalisierung:

- 25 % Wallet Allocation.
- 75 % Vesting Allocation.
- Eligible ULIQ.
- Current Tier und aktive Benefits.
- DEX-/Vesting-Start-State.
- Transaktionshistorie.

## Withdrawal und Refund UX

- keine Formulierung „keine Refunds“.
- präzise Unterscheidung zwischen fehlendem Soft-Cap-Refund und anwendbarem Withdrawal-/Cancellation-Refund.
- vor Aktion Betrag, Ziel-Wallet, Deadline und Konsequenzen anzeigen.
- Wallet Confirmation statt serverseitigem Signing.
- `submitted`, `confirming`, `confirmed`, `failed`, `reorged` und `review_required` sichtbar unterscheiden.
- Allocation erst nach canonical Refund Event als withdrawn/final anzeigen.

## Vesting Page

- total finalized allocated.
- pending Presale Allocation separat und nicht als Vesting.
- Start State: waiting for DEX launch oder active.
- einmalig gesetzter Start Timestamp.
- Vesting End.
- vested, releasable, released und unreleased.
- Progress Timeline.
- Claim Button mit Wallet-, Gas- und Receipt-State.
- Hinweis, dass unreleased finalisierte Vesting-ULIQ für Utility zählen.

## Locking Page

- verfügbare unlocked Wallet-ULIQ.
- feste Perioden 30, 90 und 180 Tage.
- erwartete Produkt-Benefits, niemals Yield/APY/Rewards.
- Unlock Date vor Bestätigung.
- aktive, abgelaufene und withdrawn Locks.
- Lock/Withdraw Tx Progress.
- Hinweis, dass Locking eligible ULIQ nicht erhöht.

## Billing und AI-Credit UI

Anzeigen:

- Base USDC Price.
- ULIQ Tier.
- Discount BPS beziehungsweise Prozent und Amount.
- Final USDC Price.
- kurze Quote-Gültigkeit mit Countdown.
- exakt 10 Minuten Quote-TTL.
- Holding-Cooldown-Status für monetäre Benefits; bei regulären ULIQ Zeitpunkt bis zur 24-Stunden-Qualifikation.
- finalisierte Presale Allocation klar als unmittelbar qualifiziert, ohne zusätzliche 24 Stunden.
- Wallet, Snapshot-Freshness und Fallback-Grund.

Bei abgelaufener Reservation wird neu gequotet. Ein alter Discount darf nicht weiter angezeigt werden, wenn die Order bereits zum Standardpreis fortgesetzt werden muss.

## Wallet-Wechsel

- vor dem Wechsel auf offene ULIQ Discount Reservations hinweisen.
- Wechsel invalidiert monetäre ULIQ Quotes.
- alte Wallet-Bestände oder Presale Purchases werden nicht auf die neue Wallet übertragen.
- nach Wechsel Entitlement und UI vollständig neu laden.
- offene `RESERVED` Discount Quotes werden sichtbar `RELEASED` und sind nicht wiederverwendbar.

## Admin UI Touchpoints

- Admin Navigation.
- Sale State und Contract-Adressen.
- Indexer/Price/Reconciliation Health.
- Purchase-/Refund-/Finalization-Review.
- Tier Config Versionen.
- Safe Transaction Vorbereitung und externer Safe-Status.
- Superadmin, Reauth, Vier-Augen- und Audit-Hinweise.

## Copy Rules

- ausschließlich „AI Credits“, niemals „AI Tokens“.
- kein APY, Yield, Earn oder Revenue Share.
- keine Preisziele oder Renditeversprechen.
- Presale Reference Price klar von Market Price unterscheiden.
- Price Modes `PRESALE_REFERENCE`, `MARKET_OBSERVATION` und `MARKET_REFERENCE` verständlich kennzeichnen.
- Pending, finalized, claimable und available nicht synonym verwenden.
- rechtliche Texte werden versioniert und erst nach Legal-Freigabe veröffentlicht.

## Responsive und Accessibility

- Mobile Wallet/WalletConnect Flow.
- lange Wallet-Adressen und Tx Hashes ohne Layout Overflow.
- Keyboard- und Screenreader-Bedienbarkeit aller Dialoge.
- Status nicht nur über Farbe vermitteln.
- Countdown zusätzlich als exakten Timestamp darstellen.
- Transaktionsfortschritt bleibt nach Reload wiederherstellbar.
