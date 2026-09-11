# 01 – Smart Contracts

## ADR-009 review-draft supersession

The new review-only two-round implementation is defined by `ADR_009_TWO_ROUND_PRESALE_TOKENOMICS.md` and lives in `packages/contracts/src/uliq/presale-v2/`. Its exact audit handoff is documented in `packages/contracts/ULIQ_PRESALE_V2_AUDIT_SCOPE.md`. It supersedes the single-round 120,000,000 ULIQ, 0.001 USDC, 25/75, nine-month presale parameters below for future production design.

The existing `ULIQPresale.sol`, `ULIQPresaleVesting.sol`, `ULIQLocker.sol`, provisional testnet custody, and testnet deployment scripts are isolated under `legacy-testnet/` directories and continue to describe the previously deployed testnet MVP. They are not silently migrated by the review draft. ADR-001 remains the production and Mainnet gate.

## Gate

Die folgenden Contracts werden spezifiziert und auf Testnet erprobt. Production-Solidity-Code, Audit-Freeze und Mainnet-Deployment bleiben `NO-GO`, bis die Legal-Blocker aus `ADR_001_LEGAL_PRESALE_MODEL.md` aufgelöst und die Refund-/Safeguarding-Regeln verbindlich sind.

## Gemeinsame Contract-Regeln

- Solidity ist für die Testnet-Implementierung auf `0.8.30`, das bestehende gemeinsame EVM-Target weiterhin auf `paris` gepinnt.
- OpenZeppelin Contracts ist exakt auf `5.4.0` gepinnt; keine `^5.x`-Range. Version 5.4.0 behebt GHSA-9rcw-c2f9-2j55 und besteht den Clean Build sowie die ULIQ-Suite mit Solidity `0.8.30` und EVM Paris. Die am 2026-08-22 geprüfte aktuelle Stable-Version `5.6.1` verlangt in transitiv eingebundenen Utilities das Cancun-Opcode `MCOPY`. Das gemeinsame EVM-Target wird wegen bestehender Vault-Contracts nicht ungeprüft global auf Cancun angehoben. Die Dependency-Entscheidung wird vor Audit erneut geprüft und danach eingefroren.
- Die Version wird in Tests, Deployment-Artefakten und Audit-Scope festgehalten.
- Contracts sind möglichst non-upgradeable.
- Administrative Rollen liegen bei Safe/Multisig-Adressen, nicht bei persönlichen EOAs oder App-Servern.
- Getrennte Treasury-, Ecosystem-, Marketing- und Liquidity-Safes kontrollieren ihre jeweiligen Buckets; Team und Presale liegen in Vesting-/Sale-Contracts.
- Kritische Rollen und State Transitions emittieren Events.
- Canonical Arbitrum-USDC-Adresse, Chain ID und Contract Bytecode werden im Deployment-Script geprüft.

## `ULIQToken.sol`

- ERC-20 mit Fixed Supply von 1.000.000.000 ULIQ.
- 18 Decimals.
- gesamter Supply wird einmalig im Constructor an den festgelegten Allocation-/Distribution-Controller ausgegeben.
- kein Minting nach Deployment.
- Burnable.
- ERC20Permit: verbindlich aktiviert.
- keine Tax, Blacklist oder Transfer-Limits.
- kein Proxy, sofern eine spätere ADR keinen zwingenden Grund belegt.
- Token Allocation und Ziel-Contracts folgen ADR-002.

## `ULIQPresale.sol`

Die Testnet-Implementierung verwendet `IULIQPaymentCustody` als austauschbare Custody-Grenze. `ULIQTestnetEscrow` ist ausdrücklich `TESTNET / PROVISIONAL` und bindet jeden tUSDC-Eingang an eine eindeutige Purchase-ID. Ein Eingang kann danach exakt einmal entweder an den unveränderlichen Buyer refunded oder bei Purchase-Finalisierung an die aktive Testnet-Treasury ausgezahlt werden. ULIQ-Verteilung, Vesting-Zuordnung, Purchase State und Treasury-Auszahlung sind atomar; schlägt die tUSDC-Auszahlung fehl, revertiert die gesamte Finalisierung.

Die Testnet-Treasury ist rotierbar, aber nicht einseitig überschreibbar: Der Contract-Owner schlägt eine neue Adresse vor, ausschließlich diese Adresse kann die Rolle akzeptieren, und der Owner kann einen offenen Vorschlag verwerfen. Ownership Renunciation ist deaktiviert; ein generischer Sweep-/Rescue-Pfad existiert nicht. Beim Übergang `ENDED -> DEX_PENDING` muss `pendingPurchaseCount == 0` gelten; danach wird exakt `allocationCapUliqRaw - finalizedAllocationUliqRaw` an die zu diesem Zeitpunkt aktive `paymentCustody.treasury()` übertragen. Eine erlaubte Leerstornierung aus `READY`, `ACTIVE` oder `PAUSED` gibt dieselbe exakt begrenzte Sale-Allokation an diese Treasury zurück. So bleibt auch eine bereits finanzierte Instanz recoverbar, deren Aktivierungsfenster nie genutzt wurde. Zusätzlich oder versehentlich an den Presale gesendete ULIQ werden nicht mitübertragen. Backend und Admin UI speichern nur die gewünschte Adresse und bereiten validierte Safe-Transaktionen vor, ohne Private Keys, Signatur oder Broadcast. Ein Production-Custody-/Safeguarding-Adapter und dessen Auszahlungszeitpunkt bleiben ungeachtet dieser Testnet-Simulation ADR-001-blockiert.

### Sale State

Die fachliche State Machine umfasst mindestens:

- `DRAFT`
- `READY`
- `ACTIVE`
- `PAUSED`
- `ENDED`
- `DEX_PENDING`
- `DEX_LAUNCHED`
- `COMPLETED`
- `CANCELLED`

Die Solidity-Darstellung darf kompakter sein, muss aber dieselben erlaubten und verbotenen Übergänge erzwingen.

Fachlich gilt `DRAFT -> READY -> ACTIVE -> ENDED -> DEX_PENDING -> DEX_LAUNCHED -> COMPLETED`, ergänzt um `ACTIVE <-> PAUSED` sowie die Leerstornierungen `READY -> CANCELLED`, `ACTIVE -> CANCELLED` und `PAUSED -> CANCELLED`.

### Purchase State

- `PENDING_WITHDRAWAL`
- `WITHDRAWN`
- `FINALIZED`

Ein Kauf:

1. ist ausschließlich in `ACTIVE` zulässig;
2. akzeptiert ausschließlich die konfigurierte Arbitrum-USDC-Adresse;
3. zieht USDC gemäß dem rechtlich finalisierten Safeguarding-Modell ein;
4. erzeugt eine pending Allocation und einen eindeutigen Purchase-Identifier;
5. speichert Buyer, Purchase Timestamp, USDC Amount, ULIQ Allocation und Withdrawal Deadline;
6. überträgt während der Withdrawal Period keine ULIQ;
7. aktiviert weder Vesting noch Utility;
8. kann vor Ablauf der anwendbaren Deadline einmalig withdrawn oder danach einmalig finalized werden.

Finalisierung:

- 25 % der Allocation werden an die Käufer-Wallet übertragen.
- 75 % werden der Presale-Vesting-Position zugeordnet.
- Wallet-Transfer, Vesting-Zuordnung und Purchase State `FINALIZED` werden atomar gesetzt.
- Finalisierung ist idempotent und darf nicht nach Withdrawal oder unzulässiger Sale Cancellation erfolgen.
- `finalizePurchase(purchaseId)` ist permissionless. Caller und Gas Payer können beliebig sein; Buyer/Beneficiary und Beträge bleiben unveränderlich und der Caller erhält keine ULIQ oder Benefits.
- der exakt zum Purchase eingezogene tUSDC-Betrag wird in derselben atomaren Transaktion an die zu diesem Zeitpunkt aktive Testnet-Treasury ausgezahlt; diese Regel ist ausschließlich Testnet-Evidence und kein Production-Safeguarding-Entscheid.

Withdrawal:

- storniert die vollständige pending Allocation;
- erzeugt keine ULIQ- oder Vesting-Position;
- veranlasst den USDC-Refund nach den finalen Sale Terms;
- ist idempotent und vollständig auditierbar.

### Sale Parameter

- Sale Start und End.
- Fixed Price: 0,001 USDC je ULIQ.
- Hard Cap: 120.000 USDC.
- Allocation Cap: 120.000.000 ULIQ.
- kein Soft Cap.
- Sale endet atomar bei erreichtem Hard Cap oder `saleEnd` Timestamp.
- Hard-Cap-Restbeträge folgen einer vor Audit explizit spezifizierten Rounding-/Partial-Fill-Policy.
- per-wallet Minimum und Maximum müssen vor Audit konkret festgelegt werden.
- Purchase-, Withdrawal- und Finalization-Deadlines werden als Timestamp gespeichert und klar gerundet.
- der Testnet-Deploy-Guard akzeptiert keine Withdrawal Period unter 3.600 Sekunden; der empfohlene Staging-Wert ist `3600`. Production bleibt bei der separat freizugebenden 14-Tage-Working-Assumption.
- Sale-Inventar wird vorab funded; kein Minting im Presale.
- USDC 6 Decimals und ULIQ 18 Decimals werden ausschließlich mit Integer-Mathematik verarbeitet.

### Cancellation

- Stoppt neue Purchases und neue Finalisierungen, soweit die finalen Sale Terms dies verlangen.
- behandelt alle pending Purchases deterministisch.
- bewahrt nachvollziehbares Contract-Inventar und USDC-Accounting.
- konkrete Refund- und Safeguarding-Implementierung bleibt durch ADR-001 blockiert.
- die Behandlung bereits `FINALIZED` Purchases bei vollständiger Cancellation bleibt ausdrücklich durch ADR-001 blockiert und wird nicht irreversibel vorimplementiert.

### Pause und DEX Launch

- `PAUSED` verbietet neue Purchases, lässt aber zulässige Withdrawals, permissionless Finalisierungen und Reads zu.
- nach Sale-Ende wechselt der fachliche State erst bei `pendingPurchaseCount == 0` zu `DEX_PENDING`; derselbe atomare Übergang gibt die exakt unverkaufte Presale-Allokation an die aktive Payment-Custody-Treasury frei.
- DEX Launch ist nur bei `pendingPurchaseCount == 0` zulässig.
- der globale DEX-Launch-Timestamp ist on-chain genau einmal setzbar, danach unveränderlich und ausschließlich Safe-/Multisig-kontrolliert.

### Security

- SafeERC20, ReentrancyGuard und Checks-Effects-Interactions.
- Pausable nur für risikorelevante Entry Points; bereits rechtmäßig verfügbare User-Claims und Refunds dürfen nicht unbeabsichtigt dauerhaft blockiert werden.
- keine unbeschränkte Rescue-Funktion für User-Mittel.
- Unsold-Release ausschließlich als Owner-kontrollierter, einmaliger State-Übergang beziehungsweise erlaubte Leerstornierung, mit `pendingPurchaseCount == 0`, exakt begrenztem Betrag und Event.
- Überschuss-/Fremdtoken-Recovery benötigt enge Regeln, Events und Safe-Kontrolle.
- Kauf- und Refund-Events enthalten Purchase ID, Käufer, USDC Raw Amount, ULIQ Raw Allocation und Deadline.

## `ULIQPresaleVesting.sol`

- nimmt ausschließlich finalisierte 75%-Presale-Allocations auf.
- pending oder withdrawn Purchases erzeugen keine Vesting-Position.
- globaler `vestingStart` entspricht dem DEX-Launch-Timestamp.
- `vestingStart` ist initial unset und darf nur einmal gesetzt werden.
- Setzen erfolgt ausschließlich durch die festgelegte Safe/Multisig-Rolle.
- Backend kann höchstens Calldata beziehungsweise eine Safe-Transaktion vorbereiten und besitzt keine Signierschlüssel.
- Kauf nach gesetztem Vesting-Start ist verboten, sofern ADR-006 nicht ausdrücklich eine andere sichere Semantik festlegt.
- Dauer: als immutable Deployment-Parameter. Das Testnet-Deployment verwendet transparent `270 days`; die rechtlich und fachlich exakte Production-Monatskonvention bleibt Pre-Audit-Parameter und darf nicht still aus dem Testnet-Wert abgeleitet werden.
- `allocated`, `released`, `releasable` und `unreleased` sind getrennt definiert.
- keine doppelte Freigabe; mehrere Purchases pro Beneficiary sind unterstützt.
- unreleased finalisierte Vesting-ULIQ zählen für Utility, auch wenn noch nichts claimbar ist.

## `ULIQLocker.sol`

- akzeptiert nur frei verfügbare ULIQ aus der User-Wallet.
- feste initiale MVP-Perioden: 32, 185 oder 367 Tage, produktseitig als 1, 6 oder 12 Monate bezeichnet; der jeweils zusätzliche Tag ist ein transparenter Abwicklungspuffer für Bestätigung, Finalität und Checkout.
- keine freie Laufzeitwahl.
- kein APY, keine Token Rewards und keine USDC Rewards.
- mehrere Locks pro Wallet erhalten eindeutige Lock IDs.
- ein Lock speichert amount, owner, start und unlockAt; der exakte Timestamp ist für die Benefit-Abdeckung autoritativ.
- der Abwicklungspuffer ändert die exakte Benefit-Prüfung nicht; ein Lock muss den vollständigen, ab Checkout geplanten Vertragszeitraum weiterhin bis mindestens `requiredBenefitUntil` abdecken.
- der Owner kann eine nicht withdrawn Position mit `extendLock(lockId, newUnlockAt)` ausschließlich auf einen strikt späteren Timestamp verlängern.
- Extension verändert weder ursprünglichen Start/Betrag noch `lockedBalanceOf` oder `totalLocked` und emittiert `LockExtended` mit altem/neuem Ablauf.
- Withdraw ist nach `unlockAt` einmalig möglich und emittiert ein Event.
- Locking verschiebt ULIQ von Wallet zu Locker, ohne eligible ULIQ zu erhöhen.
- Vesting-ULIQ können erst nach Claim gelockt werden.
- Sale-Pause darf fällige Locker-Withdrawals nicht automatisch blockieren.

## Ownership und Admin

- getrennte, dokumentierte Rollen für Sale Pause, Sale Lifecycle, DEX Launch Timestamp, Inventory und Treasury.
- Safe/Multisig für alle High-Impact-Rollen.
- Zwei-Schritt-Ownership-Transfer bevorzugt.
- optionaler Timelock wird vor Audit risikobasiert entschieden.
- keine Multisig-, Treasury- oder Owner-Private-Keys im Web-, API- oder Runner-Prozess.

## Allocation-, Team- und Release Controls

- Team Allocation 150.000.000 ULIQ: 12 Monate Cliff plus 36 Monate linear; vor Cliff keine Verfügbarkeit.
- Treasury Allocation 300.000.000 ULIQ: 12 Monate initialer Lock plus 48 Monate Maximum Release Budget, ohne automatische Distribution.
- Ecosystem Allocation 220.000.000 ULIQ: 60 Monate Release Budget, Safe-kontrolliert und ohne automatische Distribution.
- Marketing/Partnerships Allocation 130.000.000 ULIQ: 48 Monate Release Budget, Safe-kontrolliert und ohne automatische Distribution.
- Liquidity Allocation 80.000.000 ULIQ: keine lineare Freigabe; nur bedarfsgerechte Safe-Transfers für die in ADR-002 erlaubten Zwecke.
- Release-/Vesting-Spezifikation trennt `unlocked`, `released`, `distributed` und `circulating`.

## Contract Tests

- Unit-, Fuzz- und Invariant-Tests.
- 6-vs-18-Decimals und exakte 25/75-Rundung.
- Hard-Cap- und Allocation-Cap-Grenzen.
- Hard-Cap-/`saleEnd`-Ende sowie Rounding/Partial Fill am exakten Restbetrag.
- per-wallet Minimum/Maximum.
- pending Purchase erzeugt 0 Wallet-ULIQ, 0 Vesting und 0 Utility.
- Withdrawal vor Deadline, doppeltes Withdrawal und Finalize-after-Withdrawal.
- Finalisierung nach Deadline, doppelte Finalisierung und Withdrawal-after-Finalize.
- Cancellation mit offenen Purchases.
- Pause/Unpause: Kauf gesperrt, Withdrawal/Finalization/Reads verfügbar.
- permissionless Finalisierung durch fremden Caller zahlt ausschließlich an Buyer/Vesting.
- DEX Launch mit `pendingPurchaseCount > 0` revertiert.
- mehrere Purchases desselben Beneficiary.
- Vesting vor, am und nach DEX Launch; einmaliger Timestamp.
- Claim und Locker-Übergänge ohne Doppelzählung.
- alle drei initialen Laufzeiten, wiederholte Extension, Shortening-Revert, Wrong-Owner, withdrawn Position und unveränderte Locked Balances.
- unzureichendes Inventar, fremde Tokens und reentrante/malicious Token-Annahmen.
- Invariant: `distributed + vesting inventory + remaining sale inventory + burned` überschreitet nie die zugewiesene ULIQ-Menge.
- Invariant: USDC Refund oder Finalisierung kann pro Purchase höchstens einmal wirtschaftlich wirksam werden.
- Fork-Test gegen die exakte Arbitrum-USDC-Implementierung.

## Deliverables

- freigegebene Contract Specification.
- Foundry Unit-, Fuzz-, Invariant- und Fork-Tests.
- gepinnte Dependency- und Compiler-Versionen.
- Deployment-Scripts für Local und Arbitrum Sepolia.
- Mainnet-Config-Template ohne Secrets.
- ABI-, Bytecode- und Source-Verification-Artefakte.
- Rollen-/Ownership-Matrix und Deployment-Checklist.
- Audit-Scope und aufgelöste Findings vor Mainnet.
