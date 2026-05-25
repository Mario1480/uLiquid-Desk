# Wallet & Funding Go-Live Status

Stand: 2026-05-25

## Aktueller Status

Wallet & Funding wurde fuer Go-live gehaertet. Externe Hyperliquid-Handoffs werden als lightweight Funding-Intents in `OnchainAction` gespeichert und ueber Ziel-Balances reconciled. UI-Flows zeigen nach Submit nur noch `pending`, bis die erwartete Destination-Balance erreicht ist.

Nach den BotVault-V4-Live-Durchlaeufen vom 2026-05-21 bis 2026-05-25 ist der
BotVault-bezogene Funding-Pfad weiter als diese urspruengliche Checkliste:
Wallet/User-funded BotVaults konnten starten und schliessen, und ein
FundingVault-backed BotVault konnte nach korrekter Operator-Rotation starten.
Die generischen Wallet-Transfer-Canaries unten bleiben trotzdem relevant, weil
sie die Rohfluesse ausserhalb des BotVault-Lifecycle absichern.

## Behobene Blocker

- Arbitrum -> Hyperliquid Deposit wird nur bestaetigt, wenn die credited USDC Balance den erwarteten Zielbetrag erreicht.
- Hyperliquid -> Arbitrum Withdraw wird nicht mehr durch sinkende Source-Balance als final bestaetigt.
- EVM -> Core Transfer gilt nach EVM Receipt nur als pending und wird ueber HyperCore-Balance finalisiert.
- Core/EVM und Spot/Perp Transfers nutzen amount-basierte Zielbalance-Reconciliation.
- Funding-Readiness meldet Zero-Balances nicht mehr als ready.
- Funding-History zeigt externe Deposits, Withdraws und Transfers als durable Pending-/Confirmed-Intents.

## Offene Nicht-Blocker

- Hyperliquid SDK Actions ohne txHash koennen nur balance-basiert, nicht ueber eine native Action-ID, reconciled werden.
- Pending-Intent Cleanup/Expiry ist noch konservativ manuell: offene Intents blockieren gleiche Folgeaktionen bis confirmed oder failed.
- Funding-Reconcile laeuft aktuell on-demand aus der UI; ein Hintergrundjob fuer stale Pending-Intents waere sinnvoll.
- Wallet Activity kann Funding-Intents spaeter noch detaillierter mit reasonCode/recoveryHint anzeigen.
- FundingVault Operator-Mismatch sollte vor dem Agent-Launch als Preflight
  sichtbar blockieren. Der Live-Run am 2026-05-25 zeigte `only_operator`, bis
  `FundingVault.operator()` auf die aktuelle Agent-Wallet rotiert wurde.
- FundingVault Operator-Rotation sollte als gefuehrter Owner-Wallet-Flow oder
  Admin-Runbook verfuegbar sein, damit keine normale HYPE-Transfer-Transaktion
  versehentlich an den FundingVault gesendet wird.

## BotVault-bezogene Live-Evidence

- Wallet/User-funded BotVault V4:
  - mehrfacher Live-Start bis `running` mit HyperEVM Funding, HyperCore
    Funding, Perp-Margin, HYPE-Reserve, Autostart und Initial Seed;
  - live Close/Settlement bis `execution_status=closed`,
    `funding_status=settled`, `hypercore_funding_status=withdrawn` und
    Reconciliation `ok`.
- FundingVault-backed BotVault V4:
  - erster erfolgreicher FundingVault-backed Launch am 2026-05-25;
  - FundingVault Reserve wurde nach Confirmation frei, BotVault allocation
    stand bei `6 USDC`, HyperCore Funding wurde `funded`, Grid/BotVault liefen
    bis `running`;
  - initiale Fehlversuche waren Operator-Konfiguration, kein Funding- oder
    BotVault-V4-Code-Blocker.

## Canary-Checkliste

- Deposit: Arbitrum USDC vorhanden -> Intent prepared -> Wallet Submit -> pending -> Hyperliquid credited balance erreicht target -> confirmed.
- Withdraw: Hyperliquid withdrawable USDC > fee -> Submit -> pending -> Arbitrum USDC Zielbalance erreicht target -> confirmed.
- Core -> EVM: HyperCore Source + HYPE Gas vorhanden -> Submit -> pending -> HyperEVM Zielbalance erreicht target -> confirmed.
- EVM -> Core: HyperEVM Source + HYPE Gas vorhanden -> EVM Receipt -> pending -> HyperCore Zielbalance erreicht target -> confirmed.
- Spot/Perp: Spot->Perp und Perp->Spot bestaetigen erst bei Zielbalance-Anstieg um den angefragten Betrag.
- Refresh waehrend Pending: History zeigt Intent weiter, gleicher Flow wird bis Abschluss blockiert.
- FundingVault Launch: `FundingVault.operator()` == Agent-Wallet -> launch
  submitted -> onchain confirmed -> reserve freigegeben -> BotVault
  `execution_ready` -> Grid `running`.
- FundingVault Operator-Rotation: Owner-Wallet sendet `setOperator(address)` mit
  `value=0`; danach stimmen onchain Operator, DB Operator und Agent-Wallet
  ueberein.

## Verweise

- BotVault Follow-ups: `docs/botvault-go-live-followups.md`
- GridBot Status: `docs/gridbot-go-live-status.md`
- FundingVault Live-Start: `docs/tasks/2026-05-25-funding-vault-live-start.md`
