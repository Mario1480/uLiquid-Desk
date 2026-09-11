# 02 – Presale Backend & API

## Ziel und Grenzen

Das Backend bildet bestätigte Chain- und Purchase-States serverseitig ab, ohne Blockchain Events oder Contract State als Source of Truth zu ersetzen. Es signiert keine Multisig-Aktionen und erfindet keine Allocation im Browser oder in der Datenbank.

Die konkrete Withdrawal-/Refund-Orchestrierung bleibt bis zum Abschluss von ADR-001 fachlich blockiert.

## API-Routen

Passend zur bestehenden API-Infrastruktur ohne zusätzliches `/api`-Prefix:

- `GET /uliq/presale`
  - Sale State und Pause-/Cancellation-Status.
  - Price, sold, hard cap und remaining allocation.
  - Start, End und Contract-Adressen.
  - Withdrawal-Period-Konfiguration.
  - immediatePct und vestingPct.
  - Vesting-/DEX-Launch-State.
  - Indexer-Freshness und Degradation-Hinweis.
- `GET /uliq/presale/rounds`
  - additive, round-ready Hülle um die bestehende konfigurierte Runde.
  - liefert aktuell ausschließlich `round-1`; eine zweite Runde wird nicht aus UI-Annahmen erzeugt.
  - bestehendes `GET /uliq/presale` bleibt kompatibel erhalten.
- `GET /uliq/activity?limit=&cursor=`
  - authentifizierte, walletisolierte Activity aus kanonisch finalisierten ULIQ-Events.
  - cursor-basierte Reihenfolge nach Blocknummer und Log Index.
  - kennzeichnet den Verlauf als partiell, solange historische Events keinen Onchain-Block-Timestamp besitzen.
- `GET /uliq/presale/me`
  - ausschließlich für die serverseitig verknüpfte User-Wallet.
  - Purchases mit `PENDING_WITHDRAWAL`, `WITHDRAWN` oder `FINALIZED`.
  - Withdrawal Deadline und erlaubte nächste Aktion.
  - Finalization Preview 25 % Wallet / 75 % Vesting; während Pending bleiben beide tatsächlichen Bestände 0.
  - finalized wallet allocation und Vesting-Position.
  - Refund-/Finalization-Status und Tx-Hashes.
- `GET /uliq/entitlement`
  - finalisierter blockkonsistenter Snapshot.
  - pending Purchases separat, niemals im eligible total.
- `GET /uliq/vesting`
  - Allocated, unreleased, releasable, released und Vesting-Timestamps.
- `GET /uliq/locking`
  - verfügbare Wallet-Balance und aktive/abgelaufene Lock-Positionen.
- `POST /uliq/presale/quote`
  - serverseitige Amount-, Cap-, Wallet-, Sale- und Legal-Eligibility-Prüfung.
  - liefert keine Erfolgszusage; der Contract entscheidet beim Mining endgültig.
- `POST /uliq/presale/withdraw/prepare`
  - bereitet nur die nach ADR-001 erlaubte User- oder Safe-Transaktion vor.
- `POST /uliq/presale/finalize/prepare`
  - bereitet den permissionless Call `finalizePurchase(purchaseId)` vor, ohne Backend-Key.
  - Caller darf Buyer, Backend Worker oder eine beliebige externe Adresse sein; Beneficiary bleibt on-chain der Buyer.

Alle mutierenden API-Routen nutzen Auth, CSRF-Schutz, Rate Limits, Wallet-Bindung, Idempotency Keys und strukturierte Audit Events.

## Kauf-UX und Backend-State

1. Authentifizierte und verknüpfte Wallet prüfen.
2. Arbitrum One und Legal-/Jurisdiction-Gates prüfen.
3. USDC Balance, Allowance und ETH-Gas prüfen.
4. Quote mit pending/finalized Breakdown anzeigen.
5. USDC Permit/Approve gemäß Contract-Schnittstelle ausführen.
6. `buy` in der Wallet absenden.
7. Receipt und erforderliche Confirmations abwarten.
8. Indexer ingestiert das Purchase Event idempotent.
9. UI zeigt `PENDING_WITHDRAWAL`, Deadline, 0 eligible ULIQ und inaktive Benefits.
10. Bei wirksamem Withdrawal: Refund-State verfolgen und Allocation stornieren.
11. Nach Ablauf ohne Withdrawal: Purchase on-chain finalisieren und 25/75-Verteilung indexieren.
12. Erst nach bestätigter Finalisierung Entitlement Snapshot erzeugen und Benefits aktivieren.

## Purchase- und Refund-Regeln

- Contract Events und Contract Reads sind authoritative.
- Ein pending Purchase ist keine Wallet- oder Vesting-Balance.
- Neue Purchases sind ausschließlich im on-chain Sale State `ACTIVE` zulässig.
- Sale endet bei Hard Cap oder `saleEnd`; Backend-Quotes dürfen nie eine Allocation oberhalb von 120.000.000 ULIQ versprechen.
- Partial Fill/Rounding am Hard Cap folgt ausschließlich der vor Audit festgelegten Contract Policy.
- Finalität erst nach der konfigurierten Confirmation-Anzahl.
- Duplicate Event Ingestion, Withdrawal, Refund und Finalization sind idempotent.
- Backend unterscheidet `submitted`, `confirming`, `confirmed`, `reorged`, `failed` und `review_required`.
- Eine abgelaufene Deadline im Browser allein finalisiert nichts.
- Cancellation und Legal Hold verhindern neue Finalisierungen entsprechend der finalen State Machine.
- `PAUSED` verhindert neue Purchases, aber nicht zulässige Withdrawals, permissionless Finalisierungen oder Reads.
- DEX-Launch-Preparation ist nur bei canonical `pendingPurchaseCount == 0` zulässig.
- die Sonderbehandlung bereits finalisierter Purchases bei vollständiger Cancellation bleibt ADR-001-blockiert.
- Refund-Status wird nicht allein aus sinkender Source-Balance abgeleitet; Zieltransfer und canonical Receipt müssen belegt sein.
- Admin darf keine DB-Korrektur als Ersatz für Onchain-Reconciliation verwenden.

## Wallet-Wechsel

- `/me` und alle Prepare-Endpunkte verwenden die serverseitig verknüpfte Wallet, keinen frei übergebenen Wallet-Identifier.
- Beim Wallet-Wechsel werden offene ULIQ Benefit Reservations von `RESERVED` auf `RELEASED` gesetzt.
- Pending Purchases bleiben der ursprünglichen Onchain-Wallet zugeordnet und werden nicht auf die neue Wallet übertragen.
- Historische Purchase- und Refund-Daten behalten ihre ursprüngliche Wallet-Zuordnung.
- Ein Wallet-Wechsel darf keine offene rabattierte Quote wiederverwendbar machen.

## Feature Flags und Degradation

Getrennte Gates:

- ULIQ Read Model.
- Presale Read UI.
- Testnet Purchase.
- Mainnet Purchase.
- Withdrawal/Refund.
- Finalization.
- Entitlements.
- Subscription Discount.
- AI-Credit-Discount.
- Locking.

Bei Indexer- oder RPC-Störung:

- keine neuen aggressiven Entitlement-Upgrades.
- keine browserseitigen Ersatzwerte.
- bei reiner Price-Feed-Störung bleibt das letzte bestätigte Tier gemäß ADR-005 bestehen; Upgrades und automatische Downgrades sind deaktiviert.
- fehlt ein frischer Balance-/Holding-/Wallet-Nachweis, entstehen keine neuen monetären Reservations und es gilt Standardpreis.
- bestehende Feature-Entitlements folgen dem gehaltenen Tier und entfallen beim nächsten validierten Refresh, falls das Entitlement nicht mehr besteht.
- Purchases und Refunds bleiben sichtbar als pending/review_required statt fälschlich erfolgreich.

## Externer Launchpad

- nicht Teil des MVP.
- spätere Integration benötigt eigene ADR, Legal Review und verifizierbare Contract-/Merkle-/Wallet-Daten.
- externe Allocations zählen erst nach confirmed/finalized Status und dürfen nicht doppelt mit internen Presale-Allocations erfasst werden.
