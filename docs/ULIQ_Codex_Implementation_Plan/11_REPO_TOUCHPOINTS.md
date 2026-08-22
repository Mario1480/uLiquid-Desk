# 11 – Current Repository Touchpoints

## Grundsatz

Die ULIQ-Integration baut auf vorhandener Infrastruktur auf. Es wird weder ein zweites Wallet- noch ein zweites Billing- oder Onchain-Indexer-System eingeführt. Historische CCPayment-Artefakte bleiben migrationsbedingt erhalten, werden aber nicht als ULIQ-Pfad reaktiviert.

## Umgesetzt im Testnet-MVP 2026-08-22

- Die unten als geplant beschriebenen Contract-, Prisma-, API-, Indexer-, Billing-, Web- und Admin-Touchpoints sind im Branch `codex/uliq-mvp-testnet` umgesetzt.
- Die Runtime ist fail-closed, akzeptiert ausschließlich Chain ID `421614` und verlangt zwei unterschiedliche API-RPC-Endpunkte. Ein technisch als `production` gebauter Prozess darf ULIQ nur mit dem zusätzlichen expliziten Staging-Gate `ULIQ_TESTNET_RUNTIME=true` und der ausdrücklich gesetzten Chain ID `421614` aktivieren; echte Production behält alle ULIQ-Flags und dieses Gate auf `false`.
- Local- und Sepolia-Deploy-Scripts verweigern andere Chains. Es existiert kein Mainnet-Deploy-Pfad für ULIQ.
- `.env.example` und `.env.prod.example` dokumentieren ausschließlich leere serverseitige Adressen/Secrets sowie die öffentliche Sepolia-RPC-Konfiguration. Private Keys werden nicht in Repo oder Backend gespeichert.
- Das echte Arbitrum-Sepolia-Deployment vom 2026-08-22 ist im Deployment-Nachweis in `10_ROLLOUT_ACCEPTANCE.md` erfasst. Lokale Anvil-Adressen bleiben davon getrennt und sind niemals gültige Sepolia-Evidence.

## Contracts

Pfad: `packages/contracts`

Vorhanden:

- Foundry Build/Test Scripts.
- Solidity 0.8.19 und EVM Paris im aktuellen `foundry.toml`.
- eigene Contract-/Deploy-/Test-Struktur.
- bestehende BotVaultV4-/FundingVault-Verträge und Deployment Scripts.

Geplant:

- `packages/contracts/src/uliq/ULIQToken.sol`
- `packages/contracts/src/uliq/ULIQPresale.sol`
- `packages/contracts/src/uliq/ULIQPresaleVesting.sol`
- `packages/contracts/src/uliq/ULIQLocker.sol`
- `packages/contracts/script/uliq/*`
- `packages/contracts/test/uliq/*`

Konflikte/Entscheidungen:

- OpenZeppelin ist derzeit nicht als Foundry-Library vorhanden; exakte Version ist P0 vor Audit.
- ERC20Permit ist für ULIQ verbindlich.
- BotVaultV4 speichert Platform Fees immutable; ULIQ Platform-Fee-Discount ist deshalb nicht im MVP.
- bestehende Contract-Deploy-Sicherheitschecklisten und Address-Book-Prüfungen wiederverwenden.

## Database

Pfad: `prisma/schema.prisma` und `prisma/migrations`

Vorhanden und wiederzuverwenden:

- `User.walletAddress` als eindeutige, serverseitig verknüpfte Wallet.
- `UserLegalAcknowledgement` als Ausgangspunkt für versionierte Legal Acknowledgements.
- `UserSubscription`, `BillingPackage`, `BillingOrder`, `BillingOrderItem` und `BillingOnchainPayment`.
- `AiCreditLedger` und `AiCreditReservation`.
- `OnchainIndexedEvent` und `OnchainSyncCursor`.
- `AdminAuditEvent`, `PlatformAlert` und `GlobalSetting`.

Zu ergänzen:

- ULIQ Purchase, Vesting, Lock, Entitlement Snapshot, Price Snapshot, Tier Config, Benefit Reservation und Benefit Ledger.
- Holding-History-/Provenienzfelder für 24-Stunden-Monetary-Eligibility und die finalisierte Presale-Ausnahme.
- Reorg-/Canonical-/Block-Hash-Felder in generischen Onchain-Modellen.
- Lease-/Backfill-/Failure-Felder im Cursor.
- Billing Base/Discount/Final- und ULIQ Snapshot References.

Datentyp-Konflikt:

- `BillingOnchainPayment.expectedAmountRaw` kann für 6-Decimal-USDC als BigInt bestehen.
- ULIQ Raw Units bis `10^27` passen nicht in signed 64-bit BigInt und benötigen `Decimal @db.Decimal(78,0)`.

## Auth und Wallet

Relevante Pfade:

- `apps/api/src/routes/auth-siwe.ts`
- `apps/api/src/auth/siwe.service.ts`
- `apps/web/lib/auth/siwe.ts`
- `apps/web/lib/web3/config.ts`
- `apps/web/lib/web3/chains.ts`
- `apps/web/app/settings/page.tsx`

Wiederverwendung:

- SIWE Verify/Link/Unlink.
- eindeutige Wallet-pro-User-Zuordnung.
- Wagmi/Viem, WalletConnect und Arbitrum Chain Support.

Benötigte Änderung:

- Wallet-Link/Replace/Unlink invalidiert offene ULIQ Benefit Reservations.
- historische ULIQ Purchases/Snapshots bleiben an die ursprüngliche Wallet gebunden.
- ULIQ Prepare-/Entitlement-Routen akzeptieren keine frei wählbare User-Wallet.

## API

Neue Domain:

- `apps/api/src/uliq/config.ts`
- `apps/api/src/uliq/routes.ts`
- `apps/api/src/uliq/presale.service.ts`
- `apps/api/src/uliq/entitlement.service.ts`
- `apps/api/src/uliq/price.service.ts`
- `apps/api/src/uliq/benefitReservation.service.ts`
- `apps/api/src/uliq/admin.service.ts`
- `apps/api/src/uliq/reconciliation.service.ts`

Routen passend zum aktuellen Express-Routing ohne unnötiges `/api`-Prefix:

- `/uliq/presale`
- `/uliq/presale/me`
- `/uliq/entitlement`
- `/uliq/vesting`
- `/uliq/locking`

Bestehende Bereiche wiederverwenden:

- `apps/api/src/billing/` für USDC Checkout und Order Lifecycle.
- `apps/api/src/ai/credits/` für AI-Credit-Pakete und `AiCreditLedger`.
- `apps/api/src/jobs/billingOnchainJob.ts` als Muster für Receipt/Confirmation/Retry.
- `apps/api/src/jobs/vaultOnchainIndexerJob.ts` als Muster für adaptive RPC-Abfragen und Backoff, aber nicht ungeprüft als ULIQ-State-Machine.
- `apps/api/src/admin/` für Superadmin, Reauth, Audit und Alerts.
- `apps/api/src/wallet/` und `apps/api/src/funding/` für bestehende Wallet-/Chain-Konventionen.

Konflikt:

- bestehende Billing Orders verwenden 24 Stunden TTL und Cart Fingerprint aus Package/Quantity.
- ULIQ Discount Reservations benötigen exakt 10 Minuten TTL und zusätzliche Snapshot-/Config-/Price-Bindung.
- normale Billing Order TTL und ULIQ Discount TTL müssen getrennt modelliert werden.

## Indexer und Jobs

Vorhanden:

- generische `OnchainIndexedEvent`-/`OnchainSyncCursor`-Tabellen.
- Billing- und Vault-Onchain-Jobs mit Retry-, Confirmation- und RPC-Logik.
- Platform Alerts und System Health Jobs.

Geplant:

- vorhandene generische Tabellen reorg- und lease-fähig erweitern.
- ULIQ-spezifische Projektionen und Reconciliation als neue Services/Jobs.
- keine zweite konkurrierende Cursor-Infrastruktur.
- Worker Lease für mehrere API-Replikate.
- Price Modes `PRESALE_REFERENCE`, `MARKET_OBSERVATION` und `MARKET_REFERENCE` mit 30-Tage-Observation, 24h TWAP, 50.000-USD-TVL-, 30-Minuten-Staleness- und 25-%-Deviation-Gates.

## Billing und AI Credits

Relevante Pfade:

- `apps/api/src/billing/service.ts`
- `apps/api/src/billing/routes.ts`
- `apps/api/src/billing/onchain.ts`
- `apps/api/src/ai/credits/creditService.ts`
- `apps/api/src/ai/credits/routes.ts`
- `apps/web/app/settings/subscription/`
- `apps/web/src/billing/`

Wiederverwendung:

- direct Arbitrum-USDC Sender-/Treasury-Snapshot.
- Confirmation, Review Required, Late Payment und Reconciliation.
- Billing Package/Cart/Order/Line Items.
- AI-Credit-Gutschrift und Idempotency.

Änderung:

- ULIQ Entitlement Interface vor Order-Erstellung.
- Base/Discount/Final Snapshot.
- Benefit Reservation Lifecycle.
- 24-Stunden-Holding-Cooldown für reguläre/frei übertragene ULIQ; canonical finalisierte Presale Allocation ohne zusätzlichen Cooldown.
- `amountCents` und expected USDC Raw Amount bleiben Final Amount.
- kein Platform-Fee-Discount und keine Änderung bestehender BotVaultV4 Fees.

## Web

Relevante vorhandene Bereiche:

- `apps/web/app/wallet/`
- `apps/web/components/wallet/`
- `apps/web/app/settings/subscription/`
- `apps/web/app/admin/`
- `apps/web/app/components/AppIcon.tsx`
- App Sidebar/Main Navigation unter `apps/web/app/components/`.
- `apps/web/app/styles/` und `apps/web/app/ui-system.css`.
- `apps/web/messages/de/` und `apps/web/messages/en/`.

Neue Bereiche:

- `apps/web/app/uliq/page.tsx`
- `apps/web/app/uliq/presale/page.tsx`
- `apps/web/app/uliq/vesting/page.tsx`
- `apps/web/app/uliq/locking/page.tsx`
- `apps/web/components/uliq/*`
- `apps/web/lib/uliq/*`

Integration:

- Wallet Overview zeigt ULIQ Breakdown.
- Subscription und AI-Credit Checkout zeigen Base/Discount/Final.
- Sidebar und Admin Navigation erweitern.
- DE/EN i18n und mobile/responsive QA.
- uLiquid Design System und `AppIcon` verwenden.

## Admin und Safe

Relevante Infrastruktur:

- `requireSuperadmin`/Platform-Superadmin-Middleware.
- `consumeRecentReauth`.
- `recordAdminAuditEvent`.
- `AdminAuditEvent`, `PlatformAlert`, `GlobalSetting`.

Neue Admin-Funktionen dürfen nur Safe-Calldata/Deep Links vorbereiten und Ausführungsstatus lesen. Es werden keine Multisig-Private-Keys oder unbeobachtete automatische Admin-Transaktionen eingeführt.

Das Address Book führt getrennt `ULIQ Treasury Safe`, `ULIQ Ecosystem Safe`, `ULIQ Marketing Safe` und `ULIQ Liquidity Safe`. Team Tokens werden über Vesting Contracts und Presale Tokens über Presale-/Vesting-Contracts kontrolliert; relevante Bestände liegen nie zentral auf einer persönlichen EOA.

## Tests und Checks

Mindestens:

```bash
npm run contracts:build
npm run contracts:test
npm -w apps/api run typecheck
npm -w apps/api run test:billing
npm -w apps/web run typecheck
npm -w apps/web run i18n:check
git diff --check
```

Zusätzlich neue gezielte ULIQ Suites für Contracts, Indexer, Entitlements, Reservations, Presale API und UI. Die exakten npm-Scriptnamen werden bei Implementierung ergänzt.

## Nicht betroffene Bereiche im MVP

- Runner Execution und Exchange Adapter benötigen für Subscription-/AI-Utility grundsätzlich keine direkte ULIQ-RPC-Abhängigkeit.
- BotVaultV4-Contract und Platform-Fee-Logik bleiben unverändert.
- CCPayment bleibt historisches Schema-/Migration-Artefakt, aber kein aktiver ULIQ-Pfad.
- externer Launchpad, Buyback/Burn und Governance sind außerhalb des MVP.
