# ADR-006 – Presale & Vesting State Machine

## Status

`ACCEPTED`

Legal-/Cancellation-Semantik bleibt für die in ADR-001 benannten Sonderfälle blockiert.

## Context

Der Presale benötigt eine State Machine, die individuelle Withdrawal Periods, Refunds, Finalisierung, 25/75-Verteilung, globalen Vesting-Start, Pause und Cancellation eindeutig trennt. Die frühere atomare Sofortverteilung beim Kauf ist nicht mehr Teil des Plans.

Die fachliche Semantik ist beschlossen; Details von Withdrawal, Safeguarding und Cancellation bleiben von ADR-001 abhängig.

## Decision

### Fachlicher Sale State

- `DRAFT`
- `READY`
- `ACTIVE`
- `PAUSED`
- `ENDED`
- `DEX_PENDING`
- `DEX_LAUNCHED`
- `COMPLETED`
- `CANCELLED`

Die Solidity State Machine darf Zustände zusammenfassen, muss jedoch dieselben zulässigen Aktionen und Sperren erzwingen.

Reguläre Übergänge: `DRAFT -> READY -> ACTIVE -> ENDED -> DEX_PENDING -> DEX_LAUNCHED -> COMPLETED`. Sonderübergänge: `ACTIVE <-> PAUSED`, `ACTIVE -> CANCELLED` und `PAUSED -> CANCELLED`.

### Purchase State

- `PENDING_WITHDRAWAL`
- `WITHDRAWN`
- `FINALIZED`

### Purchase

- bestätigter Kauf erzeugt nur eine pending Allocation.
- Kauf ist ausschließlich bei Sale State `ACTIVE` erlaubt.
- 0 ULIQ gehen während Withdrawal an die Wallet.
- keine Vesting-Position wird während Withdrawal aktiviert.
- eligible ULIQ und Benefits sind 0/inactive.
- Purchase speichert Buyer, Purchase Timestamp, USDC Amount, ULIQ Allocation und individuelle Withdrawal Deadline.

### Withdrawal

- nur aus `PENDING_WITHDRAWAL` und innerhalb der final zulässigen Frist.
- storniert die vollständige Allocation.
- erzeugt keine ULIQ und keine Vesting-Position.
- veranlasst USDC Refund nach ADR-001.
- ist idempotent und schließt Finalisierung aus.

### Finalization

- nur aus `PENDING_WITHDRAWAL` nach Ablauf der final zulässigen Frist.
- 25 % an die Purchase Wallet.
- 75 % an deren Presale-Vesting-Position.
- aktiviert Utility erst nach canonical bestätigtem Finalization Event.
- ist idempotent und schließt Withdrawal aus.
- `finalizePurchase(purchaseId)` ist permissionless: Buyer, Backend Worker oder jede externe Adresse darf callen; Beneficiary bleibt unveränderlich der Buyer und der Caller erhält nichts.
- Wallet-Transfer, Vesting-Allocation und Statuswechsel auf `FINALIZED` erfolgen atomar.

### Vesting

- globaler Start entspricht DEX Launch Timestamp.
- Start ist initial unset und darf on-chain nur einmal durch die Safe-Rolle gesetzt werden.
- alle finalisierten Presale-Käufer nutzen denselben Start.
- Dauer: 9 Monate linear.
- vor Start ist nichts releasable, unreleased finalisierte Allocation zählt aber zur Utility.
- Claims verschieben ULIQ von Vesting zu Wallet ohne Erhöhung von eligible ULIQ.

### Sale und DEX

- Sale endet bei erreichtem Hard Cap oder `saleEnd` Timestamp; es gibt keinen Soft Cap.
- nie dürfen mehr als 120.000.000 ULIQ beziehungsweise 120.000 USDC verkauft werden.
- nach `ENDED` folgt `DEX_PENDING`.
- DEX Launch ist nur zulässig, wenn `pendingPurchaseCount == 0`.
- neue Purchases nach gesetztem DEX-/Vesting-Start sind standardmäßig verboten.
- DEX Launch und Market Price Mode sind getrennte Aktionen.
- Backend bereitet Safe-Calldata vor, signiert aber nicht.

## Alternatives considered

### 25 % sofort beim Kauf

Verworfen; erschwert Withdrawal und Refund.

### 100 % Escrow, manuelle Batch-Finalisierung

Kann Gas sparen, erzeugt Operator-/Liveness-Risiko und komplexe Partial-Failure-Semantik.

### Permissionless Finalisierung pro Purchase

Akzeptiert, weil Recipient und Amount unveränderlich sind und kein privilegierter Cron-/Admin-Key benötigt wird.

### User-only Finalisierung

Weniger fremde Interaktion, aber User kann Utility/Token-Ausgabe unbegrenzt verzögern und erzeugt Support-/Accounting-Sonderfälle.

### Automatische Finalisierung ohne Onchain-Transaktion

Für Token-Transfer technisch nicht möglich; ein Backend Timer allein kann keinen canonical State erzeugen.

## Consequences

- Presale Contract hält ULIQ Inventory bis Finalisierung.
- USDC Safeguarding bleibt von Legal-Modell abhängig.
- Indexer und UI müssen pending, withdrawn und finalized separat behandeln.
- Entitlement wird durch Finalization Event invalidiert/aktiviert, nicht nur durch Zeitablauf.
- jede Purchase Deadline und jeder State Transition benötigt canonical Event Evidence.

## Security implications

- Withdrawal und Finalization müssen gegenseitig ausschließend und reentrancy-sicher sein.
- Deadline Boundary und Timestamp Manipulation werden getestet.
- Batch-Finalisierung, falls eingeführt, darf Partial Failures nicht verschleiern.
- Inventory muss alle finalisierbaren pending Allocations plus bereits zugesagte Vesting-Bestände decken.
- Pause darf rechtlich erforderliche Withdrawals/Refunds nicht unbeabsichtigt sperren.
- Cancellation benötigt Safe-Kontrolle und deterministische Pending-Purchase-Behandlung.
- Die Behandlung bereits finalisierter Purchases bei vollständiger Cancellation bleibt bis ADR-001 Legal Sign-off nicht implementierbar.

## Legal implications

- Deadline, Sale-Ende, Cancellation, Refund und Safeguarding hängen vollständig von ADR-001 ab.
- die modellierten 14 Kalendertage sind kein finaler Rechtsbefund.
- UI- und Contract-Zeitpunkte müssen den freigegebenen Sale Terms entsprechen.
- DEX Launch darf offene Rechte aus pending Purchases nicht verletzen.

## Open questions

- exakte Deadline-Berechnung und Zeitzone/Kalendertag-Semantik.
- wer Refund-Gas trägt.
- USDC Custody während Pending.
- Treatment von Pending Purchases bei Sale-Ende oder Cancellation.
- exakte Rounding-/Partial-Fill-Policy an der Hard-Cap-Grenze vor Contract Audit.
- Verhalten bei unzureichendem ULIQ-/USDC-Inventar.
- Aggregation mehrerer Purchases in Vesting.

## Acceptance criteria

- pending Purchase gibt 0 ULIQ aus und aktiviert 0 Utility.
- genau einer der Terminal States `WITHDRAWN` oder `FINALIZED` ist erreichbar.
- Finalisierung verteilt exakt 25/75.
- Refund und Token-Ausgabe können nie beide für denselben Purchase wirtschaftlich wirksam werden.
- DEX Timestamp ist nur einmal setzbar.
- Pause blockiert neue Purchases, aber nicht zulässige Withdrawals, Finalisierungen oder Reads.
- `DEX_PENDING -> DEX_LAUNCHED` ist nur bei `pendingPurchaseCount == 0` möglich.
- Permissionless Finalisierung kann Beneficiary oder Allocation nicht ändern.
- Claim und Lock verändern eligible ULIQ nicht doppelt.
