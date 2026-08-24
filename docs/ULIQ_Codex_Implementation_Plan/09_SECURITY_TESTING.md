# 09 – Security, Testing & Audit

## Gate

- Keine Production Contracts und kein Mainnet vor aufgelöstem ADR-001.
- Kein Mainnet vor unabhängigem Contract Audit und nachweislich behobenen Findings.
- exakte Dependency-, Compiler-, ABI- und Bytecode-Versionen vor Audit einfrieren.
- Legal Final Sign-off erfolgt nach Audit-Fixes und vor Deployment/Presale.

## Contract Tests

- Unit-, Fuzz-, Invariant- und Arbitrum-Fork-Tests.
- Fixed Supply und kein Minting.
- ERC20Permit Nonce, Deadline, Domain Separator und Replay-Schutz.
- canonical USDC Address und 6-vs-18-Decimal-Mathematik.
- Price-, Hard-Cap-, Allocation-Cap- und per-wallet-Grenzen.
- 25/75-Rundung für Minimum, Maximum und Fuzz Amounts.
- Sale State Transitions einschließlich Pause, End, Complete und Cancel.
- fachliche States `DRAFT -> READY -> ACTIVE -> ENDED -> DEX_PENDING -> DEX_LAUNCHED -> COMPLETED` und Sonderübergänge aus ADR-006.
- Purchase States `PENDING_WITHDRAWAL`, `WITHDRAWN`, `FINALIZED`.
- pending Purchase transferiert 0 ULIQ und erzeugt 0 Vesting.
- Withdrawal/Refund idempotent und Finalize-after-Withdrawal verboten.
- Finalization idempotent und Withdrawal-after-Finalize verboten.
- permissionless Finalisierung durch Buyer, Worker und fremde Adresse mit unverändertem Buyer als einzigem Beneficiary.
- atomare 25/75-Verteilung und State Transition.
- Cancellation mit offenen Purchases entsprechend finaler Legal Policy.
- insufficient ULIQ- und USDC-Inventar.
- einmaliger DEX Launch Timestamp und unzulässige Timestamp-Werte.
- DEX Launch bei `pendingPurchaseCount > 0` verboten.
- Sale-Ende durch Hard Cap oder `saleEnd`, einschließlich Rounding-/Partial-Fill-Policy am Restbetrag.
- `ENDED -> DEX_PENDING` bei Pending Purchase verboten; nach vollständigem Settlement geht exakt die unverkaufte Presale-Allokation an die aktive Custody-Treasury.
- Leerstornierung aus `READY`, `ACTIVE` oder `PAUSED` gibt die vollständige Presale-Allokation an dieselbe aktive Treasury zurück; Full-Cap-Sale führt zu einem Zero-Amount-Unsold-Event ohne zusätzlichen Transfer.
- Forced/versehentlich zusätzliche ULIQ im Presale werden vom Unsold-Release nicht erfasst.
- globales 9-Monats-Vesting vor/am/nach Start.
- mehrere Purchases und Claims pro Wallet.
- Lock 30/90/180, vorzeitiger Withdraw, doppelter Withdraw und mehrere Locks.
- Access Control, Zwei-Schritt-Ownership, Safe-Rollen und Pause-Semantik.
- Pause blockiert Kauf, aber nicht zulässige Withdrawals, Finalisierungen und Reads.
- getrennte Treasury-/Ecosystem-/Marketing-/Liquidity-Safes sowie Team-/Presale-Vesting-Budgets.
- Reentrancy, malicious ERC20 assumptions, forced token transfers und Rescue-Grenzen.
- purchase-gebundene tUSDC-States `COLLECTED -> REFUNDED | RELEASED`, kein doppeltes Settlement und atomarer Revert bei fehlgeschlagener Treasury-Auszahlung.
- Treasury-Rotation mit Owner-Proposal, Acceptance ausschließlich durch die vorgeschlagene Wallet, Cancellation und deaktivierter Ownership Renunciation.

## Contract Invariants

- `totalSupply + burned` entspricht dem einmalig erzeugten Initial Supply.
- Sale-Verteilungen und Vesting Allocations überschreiten nie Sale Inventory oder Allocation Cap.
- ein Purchase kann höchstens einmal refunded oder finalized werden.
- pending Purchases aktivieren niemals Utility oder ULIQ Transfer.
- Summe der wirtschaftlich wirksamen USDC Purchases minus Refunds entspricht dem contractseitig erklärten Sale Accounting nach finalem Safeguarding-Modell.
- Testnet-Custody: `totalCollected == escrowBalance + totalRefunded + totalReleased`; indexierte pending tUSDC entsprechen dem Escrow-Bestand und indexierte Treasury-Releases dem Onchain-Counter.
- Bei `pendingPurchaseCount == 0` entspricht der Unsold-Release exakt `allocationCapUliqRaw - finalizedAllocationUliqRaw`; er verändert `totalSupply` nicht und adressiert ausschließlich die aktive Custody-Treasury.
- `released <= allocated` für jede Vesting-Position.
- Locker Withdrawals überschreiten nie eingezahlte Locks.
- Locking oder Claiming erzeugen keine ULIQ aus dem Nichts.

## Backend und API Tests

- Auth, CSRF, Rate Limit und serverseitige Wallet-Bindung.
- Purchase Event Ingestion und Duplicate Event Idempotency.
- Receipt, Confirmation, canonical Block Hash und Reorg.
- pending/withdrawn/finalized API Shapes.
- Deadline- und Timestamp-Grenzen mit UTC-/Kalendertag-Semantik.
- Prepare-Endpunkte erzeugen erwartete Chain ID, Contract Address und Calldata.
- Backend kann keine Safe-/Multisig-Aktion signieren.
- Refund- und Finalization-Reconciliation.
- Cancellation und Pause.
- Feature Flags fail closed.
- PII-/Wallet-Daten und Audit-Retention.

## Indexer Tests

- Unique `(chainId, txHash, logIndex)`.
- Backfill ab Deployment Block.
- adaptive Chunking, Retry und RPC Failover.
- zwei konkurrierende Worker; nur Lease Owner verarbeitet.
- Lease Expiry und Crash Recovery.
- Batch Crash vor/nach Cursor Commit.
- Shallow und Deep Reorg innerhalb des unterstützten Fensters.
- orphaned Event markieren, Domain State rollbacken, canonical Event replayen.
- Restart ohne Doppelprojektion.
- Reconciliation gegen `balanceOf`, Vesting, Locker, Purchases und Inventory.
- Mismatch erzeugt Alert und wird nicht still überschrieben.

## Entitlement Tests

- pending Purchase: eligible 0 und Benefits inactive.
- finalisierter 1.000-USDC-Kauf: wallet 250k, vesting 750k, eligible 1m.
- Claim 100k: wallet 350k, vesting 650k, eligible 1m.
- Lock 150k: wallet 200k, vesting 650k, locked 150k, eligible 1m.
- alle Komponenten vom selben `asOfBlock` und `blockHash`.
- stale oder gemischte Blocks erzeugen keinen monetären Snapshot.
- Wallet Transfer, Vesting Claim, Lock und Unlock invalidieren Cache.
- Wallet-Wechsel überträgt keine Entitlements.
- Price Modes, Tier Boundaries und Held-Tier-Fail-safe ohne Forced Downgrade.
- 30 Tage Market Observation, 24h TWAP, TVL 50.000 USD, 30-Minuten-Staleness und 25-%-Deviation Guard.
- Feed Failure/Staleness/Deviation hält bestehendes Tier, verhindert Upgrade und erzeugt keinen Forced Downgrade.
- pending/cancelled/withdrawn Allocations bleiben ausgeschlossen.

## Benefit- und Billing-Tests

- `RESERVED -> CONSUMED`, `RESERVED -> RELEASED` und `CONSUMED -> REVERSED`.
- idempotente Reference Keys.
- parallele Discount Requests und Cap Reservation.
- Quote TTL exakt 10 Minuten.
- Wallet-Wechsel setzt alle offenen Reservations von `RESERVED` auf `RELEASED` und invalidiert rabattierte Quotes.
- regulär erworbene/frei übertragene ULIQ erfüllen monetäre Benefits erst nach 24 Stunden Holding Age.
- finalisierte Presale Allocation ist unmittelbar ohne zusätzlichen 24-Stunden-Cooldown monetär qualifiziert.
- Token-Rotation zwischen Accounts erzeugt keinen mehrfachen wirtschaftlichen Benefit gemäß ADR-004.
- Base-, Discount- und Final-Amount-Invariants.
- Line-Discounts summieren exakt zum Order Discount.
- USDC Raw Amount entspricht Final Amount.
- Pending Purchase gewährt keinen Subscription-/AI-Discount.
- bestehender USDC Checkout: pending, confirming, paid, failed, expired und review_required.
- Late Payment und Reservation Expiry werden deterministisch behandelt.
- AI Credits werden exakt einmal über `AiCreditLedger` gutgeschrieben.
- Platform-Fee-Flows bleiben unverändert.

## Frontend Tests

- alle Presale States und Reload Recovery.
- falsche Chain, fehlende Wallet-Verknüpfung, insufficient ETH und insufficient USDC.
- Permit/Allowance, abgelehnte und revertierte Transaction.
- delayed Confirmation, Indexer Lag, Reorg und Review Required.
- Withdrawal Deadline und Refund Progress.
- pending UI zeigt 0 Wallet-ULIQ, 0 eligible und Benefits inactive.
- finalized UI zeigt 25/75 und aktive Benefits.
- Wallet-Wechsel und Quote Expiry.
- Vesting Claim und Lock/Unlock.
- DE/EN i18n vollständig.
- Mobile WalletConnect, responsive Layout, Keyboard und Screenreader.

## Admin Security Tests

- Superadmin und Reauth für kritische Endpunkte.
- Vier-Augen-/Approval-State.
- Audit Event für Prepare, Config und State Change.
- Safe Transaction Preparation ohne Private Key.
- Manipulation von Chain ID, Target, Selector und Params wird abgewiesen.
- ausgeführt erst nach canonical Safe Receipt, nicht nach UI-Klick.
- Tier-/Price-Config-Versionierung und historische Snapshot-Rekonstruktion.

## Tooling und Audit

- Foundry Unit/Fuzz/Invariant/Fork Suite.
- Slither und weitere statische Analyse.
- Dependency- und Lizenzreview der gepinnten OpenZeppelin-Version.
- Deployment-Script- und Address-Book-Review.
- Source Verification auf Arbiscan/Sourcify entsprechend Release-Prozess.
- externer Audit umfasst Token, Presale, Refund/Finalization, Vesting, Locker, Rollen und Deployment Scripts.
- alle Findings erhalten Severity, Owner, Fix Evidence und Retest.

## Security Evidence

- Testberichte und exakte Commit ID.
- Compiler-, Dependency-, ABI- und Bytecode Hashes.
- Deployment Simulation und Sepolia-Adressen.
- Safe-/Role-/Ownership-Matrix.
- Legal Gate Referenz.
- Audit Report und Findings Closure.
- Mainnet Deployment und Verification Receipts.
- Monitoring-, Alert- und Incident-Runbook-Evidence.

## Lokale Evidence 2026-08-22

Verifiziert:

- `npm run contracts:build`: PASS.
- `npm run contracts:test`: PASS, 38/38 repositoryweite Contract-Tests. Der ULIQ-Scope umfasst 10 Unit-/Fuzz-Tests und 4 Invarianten; die beiden ULIQ-Fuzz-Tests liefen mit 256 Runs, jede ULIQ-Invariante mit 256 Runs und 128.000 Calls.
- ULIQ-Coverage mit Foundry `--ir-minimum`: `ULIQToken` 100 % Lines, `ULIQPresaleVesting` 100 % Lines, `ULIQPresale` 84,21 % Lines, `ULIQLocker` 90,32 % Lines, `ULIQTestnetEscrow` 90 % Lines und `ULIQMockUSDC` 100 % Lines. Das Flag ist wegen eines `stack too deep` im unoptimierten Coverage-Build erforderlich und Foundry warnt dabei vor ungenaueren Source Mappings; die ausgewiesene Branch-Coverage liegt niedriger und bleibt ein Audit-Härtungspunkt.
- `npm -w apps/api run typecheck`: PASS.
- `npm -w apps/api run test:uliq`: PASS, 23/23 einschließlich explizitem Production-Build-/Sepolia-Staging-Gate sowie `READY`-/`ACTIVE`-Kaufvorbereitungsgate.
- `npm -w apps/api run test:billing`: PASS, 100/100.
- `npm -w apps/api run test:auth`: PASS, 48/48.
- `npm -w apps/web run typecheck`, `i18n:check` und `test:billing`: PASS, letzteres 6/6.
- `npx prisma validate` und `npx prisma generate`: PASS.
- `npm run quality:any-budget`, `npm run quality:vendor-charting` und `git diff --check`: PASS.
- `npm audit --omit=dev`: PASS mit 0 Production-Dependency-Findings nach Pin auf OpenZeppelin Contracts 5.4.0 und `nanoid` 3.3.18.
- lokaler Anvil-Deploy mit Inventory-/Role-/Wiring-Preflight: PASS; die dabei erzeugten Adressen sind flüchtige Local-Adressen und kein Sepolia-Address-Book.
- Slither 0.11.6 wurde isoliert gegen den ULIQ-Scope ausgeführt. Der erste Lauf meldete zwei `reentrancy-no-eth`-Treffer und einen `reentrancy-events`-Treffer; die State-Transitions in `buy` und `setDexLaunchTimestamp` wurden daraufhin nach Checks-Effects-Interactions vor die externen Calls gezogen. Der Retest enthält keine Reentrancy-Findings mehr und `npm -w @mm/contracts run test:uliq` bleibt mit 14/14 grün.
- Der Slither-Retest enthält 13 verbleibende, manuell bewertete Treffer: einmal Medium/High `incorrect-equality` für den beabsichtigten `amount == 0`-Guard in `claim` sowie zwölf Low/Medium `timestamp`-Treffer. Der Equality-Guard verändert weder Preis noch Vesting-Mathematik, sondern verhindert ausschließlich einen Null-Claim. Die Timestamp-Vergleiche bilden die fachlich verpflichtenden Sale-, Withdrawal-, DEX-Launch-, Vesting- und Lock-Zeitfenster ab; einzelne vom Timestamp-Detector gruppierte Balance-/Nullvergleiche sind keine Zeitmanipulationspfade. Diese Bewertungen ersetzen keinen unabhängigen Audit.

Offen oder blockiert:

- Arbitrum-Fork-Test gegen canonical USDC: nicht als Testnet-Nachweis ausgeführt; der isolierte Testnet-Scope verwendet Mock-USDC/Testnet-Custody.
- Arbitrum-Sepolia-Deploy und Konfiguration: PASS; Address Book, Stage-1-/Stage-2-Transaktionen und Finalitätsnachweis stehen in `10_ROLLOUT_ACCEPTANCE.md`.
- Source Verification: PASS über Sourcify für alle sechs Testnet-Contracts; Runtime- und Creation-Bytecode wurden jeweils als `exact_match` bestätigt.
- Live-Contract-E2E: offen; Presale bleibt bis zur getrennten Freigabe von `activateSale()` im Zustand `READY`.
- Browser-E2E: geschützter Flow benötigt eine autorisierte Test-Session und deployte API/Contracts; Auth wurde nicht umgangen.
- externer unabhängiger Audit: nicht durchgeführt.

Foundry meldet nicht sicherheitskritische Lint-Hinweise zu Namenskonventionen und Modifier-Wrapping. Bestehende Vault-Tests erzeugen darüber hinaus bekannte Test-Lints; die komplette Suite bleibt grün. Diese Hinweise werden vor einem Audit-Freeze geprüft und nicht als statischer Security-Scan fehlinterpretiert.
