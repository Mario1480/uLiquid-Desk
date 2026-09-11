# 05 – Price Feed & Arbitrum Indexer

## Architekturentscheidung

ULIQ erweitert die vorhandene generische Onchain-Event-Infrastruktur. `OnchainIndexedEvent` und `OnchainSyncCursor` werden reorg-, lease- und blockhash-fähig gemacht. Ein zweiter paralleler Indexer ist nur nach einer dokumentierten ADR-Änderung zulässig.

## Indexer Scope

Der Indexer verarbeitet mindestens:

- ULIQ `Transfer` und `Burn`.
- Presale Purchase/Pending Allocation.
- Withdrawal, Refund und Finalization.
- Vesting Allocation und Release/Claim.
- Locker Deposit und Withdraw.
- Sale Pause, Cancellation und Lifecycle Events.
- einmaliges Setzen des DEX-Launch-/Vesting-Start-Timestamps.
- später Buyback/Burn nur nach separatem Scope-Gate.

## Cursor, Lease und Skalierung

Jeder Indexer Scope besitzt:

- Chain ID und Contract Scope.
- Deployment-/Startblock.
- last processed und last finalized block.
- letzten Block Hash.
- `leaseOwner` und `leaseExpiresAt`.
- Heartbeat, Failure Count, Retry Time und Last Error.

Nur der aktive Lease Owner darf einen Scope vorziehen. Lease Acquisition und Cursor Commit erfolgen transaktional. Ein abgestürzter Worker kann nach Lease Expiry sicher übernommen werden. Mehrere API-Replikate dürfen weder konkurrierende Cursor noch doppelte Domain-Transitions erzeugen.

## Event Identity und Idempotenz

- Unique Key mindestens `(chainId, transactionHash, logIndex)`.
- Contract Address, Block Number und Block Hash werden zusätzlich gespeichert.
- Domain-Projektionen verwenden eigene idempotente Purchase-/Lock-/Vesting-IDs.
- ein Event Batch und seine Domain-Updates werden atomar oder replaybar verarbeitet.
- erneut gelieferte Logs sind No-Ops, solange sie zum selben canonical Block gehören.
- `blockTimestamp` wird als nullable Onchain-Zeit am kanonischen Event persistiert und für die Activity-Sortierung verwendet.
- neue Indexer-Batches schreiben den Timestamp direkt; historische Nullwerte werden über ein idempotentes, blockhash-validierendes Backfill ergänzt.
- bis zum Backfill bleiben fehlende Zeitwerte sichtbar als partieller Verlauf statt über `createdAt` oder erfundene Daten ersetzt zu werden.

## Confirmations und Reorg Handling

- Confirmation Threshold ist chain- und scope-spezifisch konfigurierbar.
- Events wechseln von observed zu confirmed/finalized.
- Block Hashes werden für alle verarbeiteten Blöcke im Reorg-Fenster geprüft.
- bei Mismatch werden betroffene Events als orphaned markiert.
- abhängige Purchase-, Vesting-, Lock-, Entitlement- und Reservation-States werden deterministisch zurückgerollt oder aus canonical Events neu aufgebaut.
- canonical Logs werden ab dem gemeinsamen Vorfahren erneut eingelesen.
- Reorgs dürfen niemals still als neue wirtschaftliche Käufe, Refunds oder Benefits gezählt werden.

## Backfill und RPC Failover

- Startblock kommt aus dem verifizierten Deployment-Artefakt.
- Backfill läuft in adaptiven Block-Chunks mit Rate-Limit-Backoff.
- Live-Tail startet erst, wenn der Backfill bis zum sicheren Head konsistent ist.
- mindestens ein primärer und ein Failover-RPC werden konfiguriert.
- widersprüchliche RPC-Ergebnisse führen zu Degradation/Alert statt blindem Cursor-Fortschritt.
- Contract Address und Chain ID sind pro Umgebung versioniert.

## Reconciliation

Zusätzlich zum Event Indexing laufen regelmäßige authoritative Reads:

- ULIQ `balanceOf` für relevante User-Wallets.
- Vesting allocated, released, unreleased und releasable.
- Locker-Balances und einzelne Positionen.
- Presale pending, withdrawn und finalized Allocations.
- ULIQ Sale-/Vesting-/Locker-Inventar.
- USDC Purchase-/Refund-Accounting gemäß ADR-001.
- globaler Vesting-/DEX-Start-State.

Abweichungen werden:

- strukturiert geloggt.
- als Platform Alert erzeugt.
- im Admin Dashboard angezeigt.
- nicht still in der Datenbank überschrieben.
- erst durch Replay, Reconciliation oder auditierten manuellen Review aufgelöst.

## Price Modes

### `PRESALE_REFERENCE`

- gilt als interner Utility-Referenzwert für alle eligible Bestände, solange dieser Mode aktiv ist; vor DEX Launch können dies nur finalisierte Presale-Bestände sein.
- 0,001 USD pro ULIQ.
- ausdrücklich interner Utility-Referenzwert, kein Marktpreis und keine Preisprognose.

### `MARKET_OBSERVATION`

- startet mit DEX Launch und dauert 30 Tage.
- sammelt DEX-, Pool-, Price- und Liquidity-Daten.
- Tier Engine verwendet währenddessen weiter 0,001 USD `PRESALE_REFERENCE`.
- aktiviert `MARKET_REFERENCE` niemals automatisch.

### `MARKET_REFERENCE`

Technische Aktivierungskriterien:

- Pair ULIQ/USDC auf Arbitrum One.
- Pool Age >= 30 Tage.
- ausreichende TWAP-Historie.
- ausschließlich 24h TWAP als Tier-Preis.
- Pool TVL >= 50.000 USD.
- Price Feed healthy.
- Staleness <= 30 Minuten.
- Spot-vs-24h-TWAP-Abweichung <= 25 % für neue Upgrades.

Vor Audit müssen zusätzlich final feststehen:

- DEX und Pool Address.
- Base Token ULIQ und Quote Asset USDC.
- Fee Tier.
- konkrete TWAP-Implementierung.
- Failover Source.
- Admin-Freigabe- und Rollback-Prozess.

Diese Parameter werden in ADR-005 versioniert und vor Audit eingefroren.

## Price Snapshot

Jeder Price Snapshot enthält:

- Chain, Pool und Token-Adressen.
- Block Number und Block Hash.
- Price Mode und Source.
- Preis mit Decimal-Präzision.
- 24h-TWAP-Wert, optionaler Spot-Beobachtungswert und berechnete Abweichung.
- Liquidity und Pool Age.
- beobachteten Zeitpunkt und Validity Window.
- Quality Status und Degradation Reason.

Kein einzelner Spot-Tick entscheidet über Tiers oder monetäre Discounts.

## Upgrades, Downgrades und Failure

- Upgrade nur mit frischem, bestätigtem und qualifiziertem Snapshot.
- bei Spot/TWAP-Abweichung > 25 %: kein Upgrade, keine automatische Herabstufung, bestehendes Tier halten und Alert erzeugen.
- bei Price Data älter als 30 Minuten: kein Upgrade, kein Forced Downgrade, bestehendes Tier halten und Alert erzeugen.
- bei Price Feed Failure: bestehendes Tier halten, neue Upgrades und automatische Downgrades deaktivieren und Operations alarmieren.
- fällt Pool TVL unter 50.000 USD, bleibt `MARKET_REFERENCE` für neue Upgrades deaktiviert.
- Rückkehr von Degraded zu Healthy erfordert einen neuen blockkonsistenten Entitlement Snapshot.

## Monitoring

- Indexer Lag und finalized Head.
- Lease Owner und Lease Age.
- RPC Health und Failover-Nutzung.
- Reorg Count und Rollback Depth.
- Backfill Progress.
- Event Processing Failures.
- Reconciliation Mismatches.
- Price Staleness, Liquidity, Deviation und Mode.
- Alert Delivery und Runbook-Probe.
