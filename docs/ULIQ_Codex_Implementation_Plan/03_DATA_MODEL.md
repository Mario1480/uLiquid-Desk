# 03 – Prisma / Data Model

## Grundregeln

- Bestehende Modelle `OnchainIndexedEvent` und `OnchainSyncCursor` werden zuerst erweitert; kein paralleler ULIQ-Indexer ohne dokumentierte Notwendigkeit.
- Alle EVM-Adressen und Tx Hashes werden bei Speicherung kanonisch normalisiert; Checksums sind Darstellung, nicht Identity.
- Onchain-`uint256`-Werte werden als `Decimal @db.Decimal(78,0)` gespeichert.
- TypeScript-Grenze: `bigint <-> decimal string <-> Prisma Decimal/NUMERIC(78,0)`.
- Niemals `Float`, JS `number` oder Prisma/Postgres signed `BigInt` für ULIQ Raw Units.
- USD-Preise und monetäre Berechnungen verwenden explizite Decimal-Skalen und Integer-BPS, niemals Float-Mathematik.

## Bestehende generische Onchain-Modelle erweitern

### `OnchainIndexedEvent`

Ergänzen beziehungsweise vereinheitlichen:

- `chainId`
- `transactionHash`
- `logIndex`
- `blockNumber`
- `blockHash`
- `contractAddress`
- `eventName`
- `payload`
- `canonicalStatus`: observed, confirmed, finalized, orphaned
- `confirmations`
- `confirmedAt`
- `finalizedAt`
- `orphanedAt`
- `processedAt`
- Unique mindestens `(chainId, transactionHash, logIndex)`
- Index `(chainId, blockNumber, logIndex)`

`eventKey` bleibt nur dann bestehen, wenn seine Erzeugung exakt dieselbe Chain-spezifische Eindeutigkeit garantiert.

### `OnchainSyncCursor`

Ergänzen:

- Scope/Indexer ID und Contract Scope.
- `chainId`
- `startBlock`
- `lastProcessedBlock`
- `lastFinalizedBlock`
- `lastProcessedBlockHash`
- `leaseOwner`
- `leaseExpiresAt`
- `lastSuccessfulAt`
- `failureCount`
- `nextRetryAt`
- `lastError`

## Neue ULIQ-Domainmodelle

### `UliqPresalePurchase`

- `id`
- `chainId`
- `presaleContractAddress`
- `purchaseIdOnchain`
- `userId` nullable für spätere Zuordnung und Audit-Retention
- `walletAddress`
- `buyerAddress` als unveränderlicher on-chain Beneficiary
- `purchaseTimestamp`
- `transactionHash`
- `logIndex`
- `usdcAmountRaw` als `Decimal(78,0)`
- `uliqAllocationRaw` als `Decimal(78,0)`
- `finalizationWalletRaw` als berechnete 25%-Vorschau, nicht als Pending-Balance
- `finalizationVestingRaw` als berechnete 75%-Vorschau, nicht als Pending-Vesting
- `status`: `PENDING_WITHDRAWAL`, `WITHDRAWN`, `FINALIZED`
- `withdrawalDeadline`
- `purchaseBlockNumber`, `purchaseBlockHash`
- `withdrawTxHash`, `refundTxHash`, `finalizeTxHash`
- `withdrawnAt`, `refundedAt`, `finalizedAt`
- `legalTermsVersion`
- `createdAt`, `updatedAt`
- Unique `(chainId, presaleContractAddress, purchaseIdOnchain)`
- Unique `(chainId, transactionHash, logIndex)`

Pending Purchases sind kein Bestandteil einer Entitlement-Balance.

Der Sale Read State speichert beziehungsweise projiziert zusätzlich `pendingPurchaseCount`, Hard-Cap-/Allocation-Cap-Werte und den fachlichen State aus ADR-006. Ein DEX-Launch-Prepare ist nur bei canonical `pendingPurchaseCount == 0` zulässig.

### `UliqVestingPosition`

- `id`
- `chainId`
- `contractAddress`
- `walletAddress`
- `allocatedRaw`, `releasedRaw` als `Decimal(78,0)`
- `vestingStart`, `vestingEnd`
- `asOfBlock`, `blockHash`
- `lastReconciledAt`
- Unique `(chainId, contractAddress, walletAddress)`

`unreleased` und `releasable/claimable` werden aus authoritative Contract State berechnet oder als klar gekennzeichneter Cache mit `asOfBlock` gespeichert.

### `UliqLockPosition`

- `id`
- `chainId`
- `contractAddress`
- `lockIdOnchain`
- `walletAddress`
- `amountRaw` als `Decimal(78,0)`
- `durationDays`: ausschließlich 30, 90 oder 180
- `startAt`, `unlockAt`, `withdrawnAt`
- `status`
- `asOfBlock`, `blockHash`
- Unique `(chainId, contractAddress, lockIdOnchain)`

### `UliqEntitlementSnapshot`

- `id`
- `userId`
- `walletAddress`
- `chainId`
- `asOfBlock`
- `blockHash`
- `walletRaw`, `vestingRaw`, `lockedRaw`, `eligibleRaw` als `Decimal(78,0)`
- `featureEligibleRaw` und `monetaryEligibleRaw` als getrennte abgeleitete Werte
- `holdingCooldownSeconds`: für monetäre Benefits 86.400
- `holdingQualifiedAt` beziehungsweise konservativer History-Proof für die monetary-eligible Menge
- `presaleCooldownExemptRaw` für canonical finalisierte Presale-Provenienz
- `pendingPresaleRaw` separat und ausdrücklich nicht eligible
- `referencePriceUsd` als Decimal
- `priceMode`: presale_reference, market_observation, market_reference
- `priceQualityStatus` und `degradationReason` getrennt vom Mode
- `eligibleUsd` als Decimal
- `baseTier`, `lockModifier`, `effectiveTier`
- `tierConfigVersion`
- `priceSnapshotId`
- `computedAt`, `validUntil`
- Index `(userId, computedAt desc)`

Alle Komponenten stammen vom selben `asOfBlock` und `blockHash`.

### `UliqBenefitReservation`

- `id`
- `userId`
- `walletAddress`
- `entitlementSnapshotId`
- `configVersion`
- `priceSnapshotId`
- `asOfBlock`
- `referenceType`, `referenceId`
- `benefitType`
- `baseAmount`, `discountAmount`, `finalAmount` mit expliziter Currency/Unit
- `status`: `RESERVED`, `CONSUMED`, `RELEASED`, `REVERSED`
- `expiresAt`, `consumedAt`, `releasedAt`, `reversedAt`
- `idempotencyKey` unique
- `metadata`
- `createdAt`, `updatedAt`

Reservations schützen monetäre Discounts gegen Wiederverwendung und parallele Order-Erstellung. Statusübergänge erfolgen transaktional.

Die Reservation TTL beträgt exakt 10 Minuten. Wallet Link/Replace/Unlink setzt alle offenen Reservations des Users transaktional von `RESERVED` auf `RELEASED`; alte Quotes können danach nicht konsumiert werden.

### `UliqBenefitLedger`

- immutable Audit Ledger für tatsächlich konsumierte oder rückabgewickelte Benefits.
- `userId`, `walletAddress`, `benefitType`
- `referenceType`, `referenceId`
- `reservationId`
- Tier-, Config-, Price- und Entitlement-Snapshot
- Base-, Discount- und Final-Amount mit Currency/Unit
- `entryType`: consumed, reversed, adjustment
- `idempotencyKey` unique
- `metadata`, `createdAt`

### `UliqTierConfig`

- `id`, `code`, `version`
- `enabled`
- `minUsdValue`
- Lock-Regeln und Feature Flags
- `aiDiscountBps`
- `subscriptionDiscountBps`
- keine Platform-Fee-Discount-Felder im MVP
- optionale monetary benefit caps mit klarer Periode und Currency
- `effectiveFrom`, `effectiveUntil`
- `createdByUserId`, `reason`, `createdAt`
- Unique `(code, version)`

### `UliqPriceSnapshot`

- `id`
- `chainId`, `poolAddress`, `baseTokenAddress`, `quoteTokenAddress`
- `priceUsd` als Decimal
- `mode`, `source`, `twapWindowSeconds` mit 86.400 Sekunden im `MARKET_REFERENCE`
- `spotPriceUsd`, `spotTwapDeviationBps`
- `liquidityUsd` als Decimal
- `poolAgeSeconds`
- `blockNumber`, `blockHash`
- `qualityStatus`, `degradationReason`
- `observedAt`, `validUntil`

Market-Reference-Qualität verlangt Pool Age >= 30 Tage, Pool TVL >= 50.000 USD, Staleness <= 30 Minuten und Spot/TWAP-Abweichung <= 25 % für Upgrades. DEX-/Pool-Adresse, Fee Tier, TWAP-Implementierung und Failover Source bleiben versionierte Pre-Audit-Deployment-Parameter.

## Bestehendes Billing erweitern

`BillingOrder` und gegebenenfalls `BillingOrderItem` speichern:

- `baseAmountCents`
- `discountAmountCents`
- `finalAmountCents`
- `uliqTierSnapshot`
- `uliqDiscountBps`
- `uliqEntitlementSnapshotId`
- `uliqBenefitReservationId`
- `uliqTierConfigVersion`
- `uliqPriceSnapshotId`
- `uliqWalletAddress`
- `uliqAsOfBlock`

`amountCents` und `expectedAmountRaw` bleiben der tatsächlich zu zahlende finale USDC-Betrag. Line-Items müssen Base- und Discount-Verteilung nachvollziehbar abbilden.

## Bestehendes AI-Credit-Modell

Das aktuelle Modell heißt `AiCreditLedger` und wird unverändert als Credit-Ledger wiederverwendet. Es werden keine ULIQ Credits und kein `AiTokenLedger` eingeführt.

## Retention und User-Zuordnung

- Onchain-Events und Purchase-Auditdaten bleiben chainbezogen nachvollziehbar.
- Account-Löschung darf immutable Chain-Fakten nicht fälschen; `userId` kann nach rechtlich definierter Retention anonymisiert/nullbar sein.
- Wallet-Wechsel ändert historische Purchase-, Snapshot- oder Benefit-Ledger-Einträge nicht.
- Legal-Terms-Acknowledgement muss Purchase-/Wallet-spezifisch rekonstruierbar sein; das vorhandene generische User-Acknowledgement allein ist dafür gegebenenfalls nicht ausreichend.
