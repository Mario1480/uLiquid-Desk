# uTrade Onchain Vault + Hyperliquid Bots — Architektur & Umsetzungsstand

> Stand: Plan/Blueprint bis Task 19 (MVP-fähig).  
> Ziel: CEX-ähnlicher Flow ohne Subaccounts, pro User isoliert, pro Bot isoliert, 30% Fee nur bei realisiertem Gewinn.

---

## 1) Ziel / Produkt-Flow

**User Journey (CEX-ähnlich):**
1. User verbindet Wallet (Web)
2. User loggt sich per Signatur ein (SIWE)
3. User erstellt **eigenen MasterVault**
4. User zahlt USDC in MasterVault ein
5. User wählt Bots aus einer Liste und startet sie
6. Für jeden gestarteten Bot wird ein **eigenes BotVault** erstellt
7. Bot handelt Perps auf Hyperliquid
8. User kann Bots stoppen/close-only setzen/schließen
9. **30% Performance Fee** wird nur fällig bei:
   - Gewinn-Entnahme aus einem BotVault, oder
   - Bot-Schließung mit Gewinn  
10. User kann freie Mittel aus dem MasterVault abheben

**Wichtig:** Kein gemeinsamer Pool-Vault. Jeder User ist isoliert.

---

## 2) Kern-Architektur (High Level)

### Onchain
- **MasterVaultFactory**
  - erstellt `MasterVault` pro User (1:1)
  - mapping `owner -> masterVault`
  - event `MasterVaultCreated(owner, vault)`

- **MasterVault (pro User)**
  - hält User-Funds (USDC)
  - trennt Salden:
    - `freeBalance` (frei abhebbar)
    - `reservedBalance` (an BotVaults gebunden)
  - erstellt & verwaltet BotVaults

- **BotVault (pro kopiertem Bot)**
  - isolierte Wirtschaftseinheit pro Bot
  - hält Accounting:
    - principalAllocated / principalReturned
    - realizedPnlNet (realisierter PnL)
    - highWaterMark (HWM)
    - feePaidTotal
  - Statusmaschine:
    - `active`, `paused`, `close-only`, `closed`
  - Profit-Share wird beim Claim/Close abgezogen

### Offchain
- **apps/web (Next.js)**
  - Wallet Connect + UI
  - Bot-Auswahl & Controls
  - Vault-Übersichten (Balances, BotVaults, PnL/Fees)

- **apps/api (Express + Prisma)**
  - SIWE Auth & Session
  - Domain Services (MasterVault/BotVault lifecycle)
  - Onchain Adapter (Txs) + Event Indexing
  - Reconciliation (PnL/Fills/Funding) + Audit Reports

- **apps/runner**
  - Executor/Keeper: führt Bots aus
  - pro BotVault eine eigene Execution-Identity (Agent Wallet)
  - sendet Orders an Hyperliquid, verwaltet Bot-Lifecycle (pause/close-only/close)

---

## 3) Warum pro BotVault eine eigene Execution-Identity nötig ist

Mehrere Bots sollen das **gleiche Pair** parallel handeln können:
- unterschiedliche Leverage
- long & short parallel
- cross/isolated Strategielogik

Auf CEX/Perps vermischt sich PnL/Funding/Positionen sonst pro Symbol.  
Daher: **1 BotVault = 1 isolierte Execution-Identity (Agent/Signer)**  
→ verhindert Positions-/PnL-Vermischung und Nonce-Kollisionen.

---

## 4) Aufgabenpakete (Codex Tasks)

### 1–10: Offchain Core / Repo-Integration
1. Repo-Analyse + Integrationsplan
2. DB/Domain Model (MasterVault, BotVault, BotTemplate, FeeEvent, CashEvent, Orders/Fills)
3. ExecutionProvider-Abstraktion (Stub)
4. MasterVault Service (free/reserved, deposits, withdraw validation)
5. BotVault Lifecycle Service (create/top-up/pause/close)
6. Fee Engine (30% nur realisiert, pro Bot, HWM, Audit)
7. Execution/Agent Wallet Layer (Struktur)
8. Risk/Guardrails (Limits, Transitions)
9. API + UI MVP Integration
10. Tests + Observability + Migration Notes

### 11–16: Onchain Enablement
11. Wallet Connect + Web3 Setup (`apps/web`)
12. SIWE Auth (`apps/api`) + Web Login Flow
13. Contracts Workspace (`packages/contracts`) (Foundry/Hardhat)
14. Contracts: MasterVaultFactory + MasterVault MVP (deposit/withdraw + free/reserved)
15. Contracts: BotVault + Allocation Flow (create bot vault, close, claim)
16. Backend: Onchain Adapter + Event Indexing/Reconciliation (Events als Truth)

### 17–19: Live Trading + Ops
17. Hyperliquid Execution in `apps/runner` (pro BotVault eigener Agent/Signer)
18. PnL/Fills/Funding Reconciliation + Audit Pipeline (idempotent, reportbar)
19. Security & Operations Hardening (Keys, rate limits, kill switch, monitoring)

---

## 5) MVP Definition (bis Task 19)

Mit Tasks 1–19 ist ein **funktionaler MVP** möglich:

✅ Wallet connect + SIWE Login  
✅ MasterVault & BotVaults onchain  
✅ USDC deposit/withdraw (nur freeBalance)  
✅ Kapital-Allokation in BotVaults (reservedBalance)  
✅ Bots handeln Perps auf Hyperliquid (Runner)  
✅ PnL/Funding/Fee wird pro BotVault nachvollziehbar berechnet (Reconciliation)  
✅ 30% Fee wird **nur bei Realisierung** eingezogen (withdraw profit / close bot)  
✅ grundlegende Security/Monitoring vorhanden  

---

## 6) Was für "Live / Public Launch" zusätzlich empfohlen wird

> Nicht zwingend für interne Beta, aber stark empfohlen vor Public Launch / großem TVL.

### A) Withdraw/Deposit Windows + Queue
**Warum:** Withdrawals dürfen Bots nicht destabilisieren.
- Withdraw-Requests werden gesammelt und in Windows ausgeführt (z. B. 1x täglich)
- BotVault kann vorher kontrolliert de-risked / close-only werden
- klare UI: „withdraw pending“

### B) Contract Security / Audit
- Threat model (inkl. Keeper/Executor Risiken)
- internes Audit mindestens, externes Audit vor Scale
- Entscheidung: upgradeable vs non-upgradeable + Versionierung
- emergency pause & recovery flows testen

### C) Reconciliation Edge Cases (Perps Realität)
- partial fills, rejects, retry semantics
- liquidation / ADL handling
- extreme funding events
- klare Dispute-/Audit-Ansicht im UI (Beweisbarkeit)

### D) Reliability / Operations
- Job scheduler stabil (indexer + reconciliation)
- Backups, migration strategy, replay capability
- SLOs + alerts:
  - order fail rate
  - reconciliation lag
  - tx failures / stuck nonces
  - DB vs onchain divergence

### E) UX / Trust Layer
- Bot-Transparenzseiten:
  - PnL, Fees, Funding, Trades, HWM, Fee History
- klare Definition: „Profit realisiert wann?“ (MVP: nur wenn Bot flat)
- Controls: pause, close-only, close + withdraw

### F) Compliance / Terms (EU)
- rechtliche Einordnung (Vault + Performance Fee + Trading)
- Terms, risk disclosures, Jurisdiktionen

---

## 7) MVP-Parameter (empfohlen, um schnell stabil live zu gehen)

- 1 BotTemplate = 1 Symbol (z. B. BTC-PERP)
- Bot profit-claim nur wenn Bot **flat** (keine offenen Positionen)
- Fee nur bei:
  - `claimProfit()` oder
  - `closeBotVault()`
- 1 BotVault = 1 Agent Wallet = 1 Executor Loop

---

## 8) Glossar

- **MasterVault**: User-Treasury, free/reserved Logik, BotVault-Verwaltung
- **BotVault**: isolierter Bot-Container mit eigenem Accounting & Status
- **HWM (High-Water-Mark)**: verhindert doppelte Fees auf denselben Gewinn
- **Reconciliation**: Sync von Trades/Funding/Fees → auditierbare PnL-Basis
- **Executor/Keeper**: Offchain Prozess, der Orders ausführt und Bot-States umsetzt