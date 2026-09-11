# Onchain Deploy And Security Checklist

Stand: 2026-05-11

Diese Checkliste ist die projektnahe Ableitung aus dem Gedanken hinter
`solidity-agent-kit`: Solidity-/DeFi-Arbeit soll nicht nur "buildet und
deployed" werden, sondern vor jeder Onchain-Aktion reproduzierbar durch
Security-, Test-, Deploy- und Recovery-Gates laufen.

Wichtig: Diese Checkliste ist fuer lokale Entwicklung, CI, Review und manuelle
Deploy-Vorbereitung gedacht. Auf dem Production-VPS soll kein AI-Agent,
Skill-System oder unkontrolliertes `cast send` Zugriff auf Private Keys,
Agent-Wallets oder Live-Kapital bekommen.

## Scope

Gilt fuer:

- `FundingVaultFactoryV1`
- `FundingVaultV1`
- `BotVaultFactoryV4`
- `BotVaultV4`
- Deploy-Scripts in `packages/contracts/script`
- API-Onchain-Flows mit `OnchainAction`
- Indexer/Reconciliation fuer FundingVault/BotVault Events
- Safety Controls fuer Grid-Starts, FundingVault-Launches und Withdraws

Nicht Ziel dieser Checkliste:

- AI-Agenten als Runtime auf dem VPS betreiben.
- Private Keys in Repo, Prompt, Skill-System, CI-Logs oder Agent-Kontext geben.
- Automatische Re-Submits kapitalbewegender Transaktionen ohne Idempotency,
  Action-Tracking und Balance-Beweis.

## 1. Code Review Gate

Vor jedem Contract-Deploy pruefen:

- Contract-Diff ist eng begrenzt und enthaelt keine unrelated Refactors.
- Alle neuen externen Funktionen haben klare Rollen:
  - Owner/User.
  - Operator/Agent-Wallet.
  - Factory/Deployer.
  - BotVault Controller.
- Kapitalbewegende Funktionen haben:
  - Replay-Schutz per `actionId` oder gleichwertiger Idempotency.
  - Zieladresse fest verdrahtet oder strikt validiert.
  - Keine freie Operator-Auszahlung an beliebige Empfaenger.
  - Events mit genug Daten fuer Indexer/Reconciliation.
- Pausen-/Kill-Switch-Semantik ist klar:
  - Owner-Withdraw bleibt moeglich, wenn Operator pausiert ist.
  - Operator kann bei Pause nicht launchen oder withdrawen.
  - API-Safety-Controls blocken neue Risikoaktionen vor Tx-Erstellung.
- Beneficiary-/Ownership-Semantik ist schriftlich klar:
  - FundingVault-Launch setzt BotVault-Beneficiary auf FundingVault.
  - Withdraw aus FundingVault geht nur an die verknuepfte User-Wallet.

## 2. Solidity Security Gate

Manuell pruefen:

- Keine ungeprueften `delegatecall`, `selfdestruct`, arbitrary calls oder
  approvals an fremde Ziele.
- Keine Loops ueber unbounded User-Daten in kapitalbewegenden Funktionen.
- Kein Reentrancy-Fenster bei Token-Transfer plus State-Update.
- State wird vor externen Transfers aktualisiert oder ist durch klare
  Reentrancy-Resistenz abgesichert.
- ERC20-Transfers pruefen Rueckgabewerte oder nutzen bewusst sichere Wrapper.
- Zero-Address Checks fuer:
  - Owner.
  - Operator.
  - USDC.
  - Factory.
  - Treasury/Affiliate/Controller/Agent-Wallet, falls gesetzt.
- Fee-Konfiguration ist bounded und bei BotVault-Erstellung eingefroren.
- Factory kann keine bestehenden User-Vaults ueberschreiben.
- Event-Parameter passen exakt zu API-ABI und Indexer-Erwartung.

## 3. Test Gate

Vor Broadcast muessen lokal oder in CI laufen:

```bash
npm -w packages/contracts run test
npm -w apps/api run typecheck
npm -w apps/runner run typecheck
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/web/tsconfig.json
```

Wenn Node >=20.9.0 verfuegbar ist:

```bash
npm -w apps/web run typecheck
npm -w apps/api run test:botvault-v4-transitions
npm -w apps/api run test:vaults
npm -w apps/runner run test:vault-grid-corewriter
```

FundingVault-spezifische Mindestfaelle:

- Factory erstellt pro Owner genau einen FundingVault.
- Deposit zieht USDC per `transferFrom` in den Vault.
- Owner-Withdraw zahlt nur an Owner.
- Operator-Withdraw zahlt nur an Owner.
- Operator kann nicht an beliebige Adressen withdrawen.
- Operator-Launch erstellt BotVaultV4 mit Beneficiary FundingVault.
- FundingVault kann vorhandenen BotVault nachfundieren.
- Wiederverwendung gleicher `actionId` reverted.
- Pausierter Operator kann nicht launchen/withdrawen.
- Owner-Withdraw bleibt bei pausiertem Operator moeglich.
- Claim/Close aus BotVaultV4 fuehrt USDC zurueck in FundingVault.

API-/Indexer-Mindestfaelle:

- Wallet-direct GridBot-Launch bleibt unveraendert.
- FundingVault-Launch blockt ohne Vault, ohne Agent-Wallet, bei zu wenig USDC,
  Low-HYPE oder Safety-Control.
- Agent-signierte Launches erzeugen genau eine `OnchainAction`.
- Retry mit gleicher Action erzeugt keine doppelten Grid-/BotVault-Zeilen.
- Indexer verknuepft FundingVault-Events mit vorbereiteten DB-Zeilen.
- Reserved/Free Balance wird nach Confirm/Reconcile konsistent.

## 4. Static Analysis Gate

Vor Mainnet/Canary ausfuehren, sobald Slither im lokalen oder CI-Setup
verfuegbar ist:

```bash
cd packages/contracts
slither . --config-file slither.config.json
```

Falls noch keine Slither-Config existiert:

- Slither einmal ohne Config laufen lassen.
- False Positives dokumentieren, nicht stillschweigend ignorieren.
- Kritische Findings vor Deploy beheben.
- Medium Findings mindestens im Go-live-Status einordnen.

## 5. Deploy Preparation Gate

Vor Broadcast:

- Exakter Git-Commit ist bekannt und lokal sauber dokumentiert.
- `git diff --check` ist gruen.
- Zielnetz, Chain-ID und RPC sind bestaetigt.
- Deployer-Adresse ist bestaetigt.
- Owner-/Ops-Adresse ist bestaetigt.
- Agent-Wallet-Operator-Adresse ist bestaetigt.
- USDC-Adresse auf Zielnetz ist bestaetigt.
- BotVaultFactoryV4-Adresse ist bestaetigt.
- FundingVaultFactoryV1-Adresse wird nach Deploy in Env uebernommen.
- Keine echten Secrets im Repo, in Docs oder in Logs.

VPS-ENV nur ueber sichere Deployment-Prozesse pflegen:

```env
FUNDING_VAULT_FACTORY_ADDRESS=0x...
FUNDING_VAULT_SIM_FACTORY_ADDRESS=0x...
FUNDING_VAULT_AGENT_MIN_HYPE=0.001
FUNDING_VAULT_LAUNCHES_DISABLED=false
FUNDING_VAULT_WITHDRAWS_DISABLED=false
```

## 6. Broadcast Gate

Direkt vor Broadcast:

- Confirm: richtige Shell, richtiger Server, richtiger Branch.
- Confirm: `.env.prod` gehoert zur Zielumgebung.
- Confirm: Private Key gehoert zum erwarteten Deployer.
- Confirm: `--legacy` oder Fee-Flags passen zur HyperEVM-RPC-Situation.
- Dry-Run ohne Broadcast durchfuehren, falls Script dies unterstuetzt.

Nach Broadcast sofort sichern:

- Factory-Adresse.
- Tx-Hash.
- Deployer-Adresse.
- Constructor-Args.
- Broadcast-Artefakte aus `packages/contracts/broadcast/`.

## 7. Post-Deploy Verification Gate

Mit Read-Calls pruefen:

- FundingVaultFactoryV1:
  - `usdc()`
  - `botVaultFactory()`
  - Owner-/Admin-Semantik, falls vorhanden.
- FundingVaultV1 Test-Vault:
  - `owner()`
  - `operator()`
  - `operatorPaused()`
  - `usedActionIds(testActionId)` nach Testaktion.
- BotVaultFactoryV4:
  - `owner()`
  - `usdc()`
  - `coreDepositWallet()`
  - `treasuryRecipient()`

API/DB pruefen:

- Env wurde geladen.
- `/vaults/funding-vault` zeigt Factory/Chain korrekt.
- Create-FundingVault-Tx nutzt die neue Factory.
- OnchainAction fuer Create/Deposit/Launch wird angelegt.
- Indexer liest FundingVaultFactory/FundingVault Events.
- Admin Vault-Ops zeigt pending/confirmed/recovery sauber an.

## 8. Canary Gate

Nur mit kleinem Betrag starten:

- User erstellt FundingVault.
- User deposited kleine USDC-Menge.
- FundingVault-Balance wird live oder reconciled korrekt angezeigt.
- GridBot-Preview zeigt FundingVault-Verfuegbarkeit.
- GridBot-Launch mit `fundingSource=funding_vault` erzeugt keine Wallet-Signatur.
- Agent-Wallet submitted Launch.
- BotVaultV4 wird erstellt und FundingVault als Beneficiary gesetzt.
- HyperCore-Funding erreicht `funding_confirmed`/`execution_ready`.
- GridBot startet erst nach Funding-Readiness.
- Claim/Close/Recover zahlt zurueck in FundingVault.
- FundingVault-Withdraw zahlt nur an linked wallet.

Canary-Abbruchkriterien:

- Contract-Balance weicht von erwarteter DB-Balance ab.
- Event fehlt oder Indexer kann Action nicht zuordnen.
- Reserved Balance bleibt nach Confirm dauerhaft haengen.
- Agent-Wallet HYPE ist unter Mindestschwelle.
- Reconciliation ist stale oder degraded.
- Safety-Control greift nicht vor Tx-Erstellung.

## 9. Runtime Guardrails Auf Dem VPS

Auf Production-VPS gilt:

- Keine AI-Agent-Runtime mit Zugriff auf Secrets.
- Keine interaktive Agent-Session mit Private Key im Kontext.
- Keine manuellen `cast send` fuer User-Kapital ohne separates Ops-Runbook.
- Kein Re-Submit ohne bestehende `OnchainAction`, `actionId`, Tx-Historie und
  Balance-Pruefung.
- Neue kapitalbewegende Endpoints muessen Safety-Control und Idempotency haben.
- Alerts fuer Pending/Degraded Money-Flows muessen aktiv sein.

Minimal zu ueberwachen:

- FundingVault Launch pending zu lange.
- FundingVault Withdraw pending zu lange.
- BotVault Funding pending zu lange.
- Contract Balance mismatch.
- Low-HYPE Agent-Wallet.
- Reconcile-Job degraded.
- Doppelte Settlement- oder Launch-Versuche.

## 10. Incident Response

Bei Unklarheit zuerst:

- Neue Grid-Starts deaktivieren.
- FundingVault-Launches deaktivieren.
- Profit-Claims/Withdraws je nach Fehlerbild deaktivieren.
- Runner auf Close-only setzen, wenn offene Positionen betroffen sind.
- Reconciliation laufen lassen und Logs sichern.
- Keine DB-Handkorrektur ohne Audit-Trail.

Wiederaufnahme erst wenn:

- Onchain-Balance und DB-Balance erklaert sind.
- Offene `OnchainAction`s confirmed/failed/recovery_required sind.
- Admin Vault-Ops keine unerklaerten Pending-Flows zeigt.
- Ein kleiner Test-Flow wieder sauber durchlaeuft.

## Bezug

Inspiration: `0xlayerghost/solidity-agent-kit` als Sammlung von
Solidity-/DeFi-Agent-Skills und Checklisten. Fuer dieses Projekt wird daraus
bewusst kein Production-Agent, sondern ein Review-, CI- und Ops-Gate.
