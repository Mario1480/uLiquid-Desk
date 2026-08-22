# ADR-007 – Onchain Data & Indexer

## Status

`ACCEPTED ARCHITECTURE / P1 OPERATIONAL VALUES OPEN`

## Context

Das Repository besitzt bereits die generischen Prisma-Modelle `OnchainIndexedEvent` und `OnchainSyncCursor` sowie Billing-/Vault-Onchain-Jobs. Der ursprüngliche Plan schlug ein separates `UliqChainEvent`-Modell und einen neuen Indexer vor. Das würde parallele Cursor-, Reorg- und Monitoring-Infrastruktur erzeugen.

ULIQ benötigt zusätzlich uint256-fähige Speicherung, Reorg Rollback, Worker Lease, Backfill, RPC Failover, regelmäßige Contract-Reconciliation und blockkonsistente Entitlement Reads.

## Decision

- vorhandene generische Onchain Event/Cursor-Infrastruktur wird erweitert.
- kein zweiter paralleler Indexer ohne neue ADR und nachgewiesene technische Notwendigkeit.
- Event Identity ist mindestens `(chainId, transactionHash, logIndex)`.
- Event speichert Block Number, Block Hash, Contract Address, Event Name, Payload und canonical/finalized/orphaned Status.
- Cursor speichert Startblock, last processed/finalized block, Block Hash, Lease Owner/Expiry und Failure/Retry State.
- ein transaktionaler Worker Lease verhindert konkurrierende Verarbeitung durch mehrere API-Replikate.
- Reorg Mismatch markiert Events orphaned, rollt abhängigen Domain State zurück und replayt canonical Events.
- regelmäßige Reconciliation vergleicht Event-Projektionen mit authoritative Contract Reads.
- alle Entitlement-Komponenten stammen vom selben finalisierten `asOfBlock` und `blockHash`.
- ULIQ uint256 Raw Units werden als Prisma Decimal/`NUMERIC(78,0)` gespeichert und an TypeScript-Grenzen als Decimal String/`bigint` verarbeitet.

## Alternatives considered

### Separater ULIQ Indexer und Tabellen

Einfacher fachlicher Start, aber dupliziert Reorg, Cursor, Lease, RPC, Monitoring und Alerting. Verworfen ohne zwingenden Skalierungsgrund.

### Nur direkte Contract Reads ohne Event Index

Keine Reorg-Projektion, aber zu langsam für Historie/Admin/Notifications und unzureichend für Purchase-/Refund-Audit.

### Externer Managed Indexer

Kann Backfill und Skalierung vereinfachen, erzeugt Provider-Abhängigkeit. Als zusätzliche Source/Failover möglich, nicht alleinige Source of Truth.

### Event Sourcing ohne Reconciliation

Verworfen; verpasste Logs, RPC-Fehler oder Bugs könnten dauerhaft unentdeckt bleiben.

## Consequences

- generische Prisma-Modelle erhalten neue Felder und Migrationen mit möglicher Auswirkung auf bestehende Vault-/Onchain-Verwendung.
- ULIQ Domain-Projektionen bleiben separat, teilen aber Event/Cursor Core.
- Jobs benötigen lease-aware Start/Stop und Health Reporting.
- historische Reads und Reorg-Fenster erhöhen RPC-/Storage-Bedarf.
- Admin kann Event, Projection und Reconciliation State gemeinsam sehen.

## Security implications

- Cursor darf erst nach erfolgreich replaybarer/atomarer Domain-Verarbeitung committed werden.
- Lease Expiry und Clock Skew dürfen keine parallele Doppelverarbeitung erzeugen.
- RPC Failover muss Chain ID, Block Hash und Contract Address validieren.
- Reorgs nach Benefit Reservation oder Billing Quote invalidieren betroffene Snapshots/Reservations.
- Reconciliation darf keine Abweichung still überschreiben.
- Decimal Strings werden strikt als unsigned Integer im uint256 Range validiert.
- Payloads und Logs gelten als untrusted Input.

## Legal implications

- Purchase-, Withdrawal-, Refund- und Finalization-Auditdaten müssen nach der finalen Retention Policy nachvollziehbar bleiben.
- Wallet-/Event-Daten sind öffentlich on-chain, ihre Verknüpfung mit User Accounts erfordert trotzdem Privacy-/Retention-Regeln.
- Event History darf durch Account-Löschung nicht verfälscht werden; User-Zuordnung kann entsprechend Policy anonymisiert werden.

## Open questions

- Confirmation und Finality Threshold auf Arbitrum.
- Reorg Overlap/Maximum Rollback Depth.
- konkrete Lease Duration, Heartbeat und Clock-Skew-Toleranz.
- primäre und Failover-RPCs.
- Block Chunk Size und Rate Limits.
- Reconciliation-Intervalle je Domain.
- Aufbewahrungsdauer orphaned Events.
- ob Price Snapshot Block exakt mit Entitlement `asOfBlock` identisch sein muss.
- Migration vorhandener `eventKey`-Daten zur Composite Unique Constraint.
- eigener Prozess versus API Job bei späterer Skalierung.

## Acceptance criteria

- zwei Worker verarbeiten denselben Scope nicht gleichzeitig.
- Crash vor Cursor Commit ist sicher replaybar.
- Duplicate Log erzeugt keine doppelte Domain-Wirkung.
- Reorg markiert orphaned Events, rollt State zurück und replayt canonical Logs.
- Snapshot kombiniert niemals unterschiedliche Blocks.
- `10^27` Raw Units roundtrippen verlustfrei DB -> TypeScript -> DB.
- Reconciliation Mismatch erzeugt Alert und bleibt bis zur Auflösung sichtbar.
- Backfill und Live Tail konvergieren auf denselben canonical State.
