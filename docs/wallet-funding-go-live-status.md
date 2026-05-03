# Wallet & Funding Go-Live Status

Stand: 2026-05-02

## Aktueller Status

Wallet & Funding wurde fuer Go-live gehaertet. Externe Hyperliquid-Handoffs werden als lightweight Funding-Intents in `OnchainAction` gespeichert und ueber Ziel-Balances reconciled. UI-Flows zeigen nach Submit nur noch `pending`, bis die erwartete Destination-Balance erreicht ist.

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

## Canary-Checkliste

- Deposit: Arbitrum USDC vorhanden -> Intent prepared -> Wallet Submit -> pending -> Hyperliquid credited balance erreicht target -> confirmed.
- Withdraw: Hyperliquid withdrawable USDC > fee -> Submit -> pending -> Arbitrum USDC Zielbalance erreicht target -> confirmed.
- Core -> EVM: HyperCore Source + HYPE Gas vorhanden -> Submit -> pending -> HyperEVM Zielbalance erreicht target -> confirmed.
- EVM -> Core: HyperEVM Source + HYPE Gas vorhanden -> EVM Receipt -> pending -> HyperCore Zielbalance erreicht target -> confirmed.
- Spot/Perp: Spot->Perp und Perp->Spot bestaetigen erst bei Zielbalance-Anstieg um den angefragten Betrag.
- Refresh waehrend Pending: History zeigt Intent weiter, gleicher Flow wird bis Abschluss blockiert.

## Verweise

- BotVault Follow-ups: `docs/botvault-go-live-followups.md`
- GridBot Status: `docs/gridbot-go-live-status.md`
