# 08 – Admin & Operations

## Admin ULIQ Dashboard

Das Dashboard zeigt read-only und zeitlich eingeordnet:

- Sale State, Pause und Cancellation State.
- Sale Start/End, Hard Cap, sold und remaining allocation.
- ULIQ Sale-, Vesting-, Locker- und Distribution-Inventar.
- pending, withdrawn und finalized Purchases.
- offene Withdrawal Deadlines.
- Refund-, Finalization- und Review-Required-Queues.
- DEX-Launch-/Vesting-Start-State.
- Vesting allocated, released, unreleased und releasable totals.
- Wallet-, Vesting- und Locked-Bestände mit `asOfBlock`.
- Tier Config Versionen und effective windows.
- `PRESALE_REFERENCE`-, `MARKET_OBSERVATION`- und `MARKET_REFERENCE`-Mode mit Price Feed Health, 24h TWAP, Spot-Abweichung, TVL, Pool Age und Staleness.
- 24-Stunden-Holding-Qualifikation und 10-Minuten-Reservation-Health für monetäre Benefits.
- Indexer Cursor, Lag, Lease Owner, Backfill und Reorgs.
- Reconciliation Mismatches und failed event processing.
- Alert Delivery und letzte Runbook-Probe.
- gewünschte, aktive und vorgeschlagene Testnet-Treasury, Escrow-Bestand sowie kumuliert eingezogene, erstattete und ausgezahlte tUSDC.

Dashboard-Werte sind Beobachtungen und keine automatische Berechtigung zu Onchain-Aktionen.

## Zugriffsschutz

Alle kritischen ULIQ Admin Actions benötigen:

- Platform Superadmin.
- aktuelle Reauthentication.
- CSRF- und Rate-Limit-Schutz.
- Vier-Augen-Prinzip für die fachliche Freigabe.
- strukturiertes Admin Audit Event mit Actor, Reason, Before/After und Correlation ID.
- Safe Approval außerhalb des uLiquid Backends.

Read-only Support-Rollen erhalten keinen Zugriff auf Prepare- oder Config-Mutationen.

## Safe-/Multisig-Modell

Das Backend speichert niemals Multisig-, Treasury- oder Owner-Private-Keys.

Es darf höchstens:

- validierte Calldata erzeugen.
- eine Safe Transaction vorbereiten oder einen Safe Deep Link generieren.
- erwartete Chain ID, Contract Address, Function Selector und Parameter anzeigen.
- Safe Transaction Hash und externen Approval-/Execution-State beobachten.
- canonical Execution Receipt indexieren.

Das Backend darf eine vorbereitete Safe Transaction nicht als ausgeführt behandeln.

### Testnet-Treasury-Rotation

- gewünschte Treasury-Adresse wird als versionierter Global Setting gespeichert und gegen den finalisierten Onchain-Zustand verglichen.
- Speichern sowie Prepare-Aktionen erfordern Superadmin und aktuelle Reauthentication und erzeugen Audit Events.
- `proposeTreasury` muss vom Contract-Owner/Safe ausgeführt werden.
- `acceptTreasury` muss von der exakt vorgeschlagenen neuen Treasury/Safe ausgeführt werden.
- `cancelTreasuryTransfer` muss vom Contract-Owner/Safe ausgeführt werden.
- Backend und Web-App signieren oder senden keine dieser Transaktionen.
- Mainnet verbietet weiterhin eine persönliche EOA als Treasury und bleibt bis ADR-001 blockiert.

## Kritische Aktionen

### `setDexLaunchTimestamp()`

- High Impact und einmalig/final.
- nur auf dem erwarteten Vesting Contract und der erwarteten Chain.
- Timestamp, aktuelle Chain-Zeit, Sale State und verbleibende pending Purchases im Preflight anzeigen.
- Preflight und Contract erzwingen `pendingPurchaseCount == 0`.

### `markDexPending()` / Unsold ULIQ

- High Impact, owner-/Safe-kontrolliert und pro Sale nur über den einmaligen State-Übergang ausführbar.
- Preflight zeigt finalisierten Sale State, `pendingPurchaseCount`, aktive Payment-Custody-Treasury, finalisierte Allocation, erwartete Unsold-Menge und tatsächliches Presale-Inventar.
- Contract erzwingt `ENDED`, `pendingPurchaseCount == 0`, ausreichendes Inventar und die aktive `paymentCustody.treasury()` als unveränderlichen Empfänger der vorbereiteten Transaktion.
- Übertragen wird exakt die unverkaufte Presale-Allokation; zusätzliche ULIQ im Contract bleiben unberührt.
- Backend und Web-App signieren oder senden die Transaktion nicht; Receipt, `UnsoldUliqReleased` und Treasury-Zielbalance werden getrennt beobachtet und finalisiert indexiert.
- `cancelEmptySale()` ist nur für einen leeren Sale aus `READY`, `ACTIVE` oder `PAUSED` zulässig und dient zugleich als Recovery-Pfad, falls eine finanzierte Instanz nie aktiviert wird.
- keine Änderung nach Ausführung.
- Safe/Multisig-kontrolliert.
- Ausführung, Receipt, Block Hash und Indexer-Verarbeitung auditieren.

### Sale Pause/Unpause

- Reason Pflichtfeld.
- betroffene Entry Points und User-Rechte anzeigen.
- Pause ist keine Cancellation.
- bereits zulässige Withdrawals/Refunds und Claims dürfen nur gemäß finaler State Machine blockiert werden.
- permissionless Finalisierungen bleiben in `PAUSED` zulässig.

### Sale Cancellation

- bleibt bis ADR-001 `BLOCKED / LEGAL REVIEW REQUIRED`.
- Preflight listet pending Purchases, gehaltene USDC, Inventory und Refund-Verpflichtungen.
- keine neuen Purchases oder unzulässigen Finalisierungen nach Cancellation.

### Inventory und Allocation Releases

- Ziel-Safe, Contract, Bucket und Release Budget anzeigen.
- Allocation-Bucket und verbleibendes Budget gegen ADR-002 validieren.
- `unlocked` nicht als `circulating` ausgeben.
- persönliche EOA als zentrale Treasury ist unzulässig.
- getrennte `ULIQ Treasury Safe`, `ULIQ Ecosystem Safe`, `ULIQ Marketing Safe` und `ULIQ Liquidity Safe` anzeigen und gegen das Address Book prüfen.
- Team Vesting (12 Monate Cliff + 36 Monate linear), Treasury (12 + 48), Ecosystem (60) und Marketing (48 Monate) als getrennte Budgets reporten.
- Liquidity Releases sind bedarfsgerecht und niemals als automatische lineare Freigabe darzustellen.

## Config Versioning

Tier-, Price-, Sale- und Feature-Config wird versioniert:

- Version/Revision.
- effectiveFrom/effectiveUntil.
- Actor.
- Before/After JSON.
- Reason und Approval Reference.
- Erstellzeitpunkt und Aktivierungszeitpunkt.

Bereits erstellte Billing-/Benefit-Snapshots bleiben auf ihre historische Version referenzierbar. Eine neue Config verändert keine bestehende Reservation still.

## Operational Runbooks

Mindestens:

- Indexer Lag und Lease Recovery.
- RPC Failover und widersprüchliche RPC-Daten.
- Reorg Rollback und Replay.
- Purchase pending ohne Indexer Event.
- Withdrawal submitted ohne bestätigten Refund.
- Finalization submitted ohne 25/75-Projektion.
- Inventory Mismatch.
- Price Feed degraded/manipulation suspected.
- Holding-Cooldown-Provenienz oder Reservation-Reconciliation fehlerhaft.
- Safe Transaction pending/rejected/executed.
- Sale Pause und kontrollierte Wiederaufnahme.
- Legal/Emergency Cancellation nach finaler ADR-001-Entscheidung.
- Alert Delivery Test.

Jedes Runbook trennt Diagnose, erlaubte read-only Schritte, approvals und tatsächliche Onchain-Aktion.

## Monitoring und Alerts

P0 Alerts:

- Contract/Chain/USDC-Konfiguration weicht vom freigegebenen Address Book ab.
- Purchase-, Refund- oder Finalization-Invariant verletzt.
- Inventory unter offenen/finalisierbaren Allocations.
- DEX Launch Timestamp unerwartet gesetzt.
- canonical Event wird orphaned, nachdem ein wirtschaftlicher State abgeleitet wurde.
- Price Feed außerhalb Manipulations-/Staleness-Grenzen.
- Pool TVL unter 50.000 USD, Price Age über 30 Minuten oder Spot/TWAP-Abweichung über 25 % bei aktivem/beantragtem Market Mode.
- nicht autorisierte Admin-/Safe-Aktion.

P1 Alerts:

- Indexer Lag/Lease/Backfill-Fehler.
- Reconciliation Mismatch.
- wiederholte RPC Failover-Nutzung.
- Benefit Reservation oder Billing Reversal fehlgeschlagen.

## Treasury und Buyback

- Treasury, Ecosystem, Marketing, Liquidity, Sale Inventory und Contract Admin liegen auf den getrennten dokumentierten Safe-/Contract-Adressen aus ADR-002.
- USDC-Safeguarding und Auszahlungszeitpunkt folgen ADR-001.
- Allocation Releases folgen ADR-002.
- automatischer Buyback ist kein MVP-Bestandteil.
- ein späteres Buyback/Burn-Modul benötigt eigene Legal-, Treasury-, Approval-, Accounting- und Audit-Freigabe.
