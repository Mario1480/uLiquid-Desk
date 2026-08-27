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

- `AWAITING_SIGNATURE`
- `SUBMITTED`
- `SOFT_CONFIRMED`
- `SAFE`
- `FINALIZED`
- `FAILED`
- `REORGED`
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

## Receipt-first Purchase UX und Netzwerk-Finalität

Verbindliche Mainnet-UX-Anforderung, festgehalten am 2026-08-23:

- Die UI wartet nach einem erfolgreichen Kauf-Receipt nicht auf den `finalized`-Indexer, bevor sie dem User den Kauf sichtbar bestätigt.
- Nach Signatur und Hash wird `SUBMITTED` angezeigt. Nach einem erfolgreichen L2-Receipt mit passendem Contract, Event, Buyer und Betrag wird der Kauf sofort als `SOFT_CONFIRMED` mit dem klaren Zusatz „Netzwerk-Finalität ausstehend“ in der Purchase-Historie dargestellt.
- `SOFT_CONFIRMED` ist ausschließlich eine vorläufige UX-Projektion. Sie aktiviert weder Wallet-/Vesting-ULIQ noch Entitlements, Benefits, Rabatte oder andere irreversible Produktzustände.
- Der Backend-/Indexer-Status führt denselben Purchase anschließend über `SAFE` nach `FINALIZED`. Für irreversible Accounting-, Benefit- und Release-Entscheidungen bleibt `FINALIZED` erforderlich; eine feste Zahl von Arbitrum-Child-Blocks ersetzt diese Block-Tags nicht.
- Der canonical Indexer-Datensatz ersetzt die vorläufige Anzeige anhand Chain ID, Transaction Hash, Log Index und Purchase ID idempotent, ohne einen zweiten Purchase zu erzeugen.
- Revert, Replacement, RPC-Ausfall, Reorg oder Receipt-/Indexer-Mismatch führen sichtbar zu `FAILED`, `REORGED` oder `REVIEW_REQUIRED`; eine vorläufige Anzeige darf dabei niemals still als final bestehen bleiben.
- Status, Transaction Hash, Betrag und aktueller Confirmation-Level müssen nach Reload und auf einem zweiten Gerät wiederherstellbar sein. Die Finalitätsprüfung läuft im Hintergrund weiter; der User muss die Seite nicht geöffnet lassen.
- DE/EN-Copy unterscheidet ausdrücklich Wallet-Bestätigung, L2-Receipt, Netzwerk-Finalität und die separate Presale-Business-Finalisierung nach der Withdrawal Period.

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
- klare Testnet-Aussage: tUSDC bleibt bis Withdrawal oder Finalisierung im Escrow; Withdrawal erstattet an den Buyer, Finalisierung zahlt an die aktive Testnet-Treasury aus.
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
- Treasury-Release darf erst nach erfolgreichem Finalize-Receipt plus canonical Indexer-Abgleich als abgeschlossen erscheinen.
- ein bereits erfolgreiches Receipt erscheint sofort als vorläufig bestätigter Purchase, auch wenn der `finalized`-Indexer noch nachläuft.

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
- feste initiale Perioden 32, 185 und 367 Tage, dargestellt als 1, 6 und 12 Monate plus einen Tag Abwicklungspuffer.
- erwartete Produkt-Benefits, niemals Yield/APY/Rewards oder zusätzliche Laufzeit-Multiplikatoren.
- exaktes Unlock Date und nicht auf volle Tage aufgerundete verbleibende Abdeckung vor Bestätigung.
- pro Lock sichtbare Qualifikation für monatliche, sechsmonatige und jährliche Käufe.
- bei unzureichender Laufzeit konkrete Fehlzeit, benötigtes Datum und direkte Vorbereitung einer nicht verkürzenden Extension.
- aktive, abgelaufene und withdrawn Locks.
- Lock/Extend/Withdraw Tx Progress mit Receipt-, Finality- und Indexer-State.
- Hinweis, dass Locking eligible ULIQ nicht erhöht und nur den bereits bestehenden Tier-Discount aktiviert.

## Billing und AI-Credit UI

Anzeigen:

- Base USDC Price.
- ULIQ Tier.
- Discount BPS beziehungsweise Prozent und Amount.
- Final USDC Price.
- kurze Quote-Gültigkeit mit Countdown.
- exakt 10 Minuten Quote-TTL.
- Feature Access ohne Lock klar von monetärem Lock-Gating trennen.
- erforderlichen und qualifizierenden Lock-Betrag sowie das exakte benötigte Abdeckungsdatum anzeigen.
- strukturierte Gründe für fehlenden Lock, zu kleinen Betrag, zu kurze Laufzeit, stale Evidence, fehlende rabattierte Subscription oder fehlenden AI-Cap anzeigen.
- normaler USDC-Checkout zum Standardpreis bleibt als expliziter Fallback verfügbar.
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
