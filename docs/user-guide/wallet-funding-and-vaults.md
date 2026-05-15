---
description: Wallet verbinden, Assets bewegen, Funding Vaults und BotVaults nutzen.
icon: wallet
---

# Wallet, Funding und Vaults

Wallet- und Funding-Flows verbinden uLiquid Desk mit HyperEVM, HyperCore, Arbitrum und BotVaults. Jede Signatur sollte bewusst geprueft werden.

## Wallet verbinden

1. Oeffne **Wallet & Funding** oder den Wallet-Button in der Kopfzeile.
2. Verbinde deine Wallet.
3. Pruefe Adresse und Netzwerk.
4. Wechsle bei Bedarf zu HyperEVM.
5. Pruefe HYPE fuer Gas und USDC fuer Funding.

## Balance-Bereiche

| Bereich | Zweck |
| --- | --- |
| Arbitrum | Quelle oder Ziel fuer USDC Bridge-Flows. |
| HyperCore | Hyperliquid Trading- und Core-Balances. |
| HyperEVM | Onchain Aktionen, BotVault Funding und Gas. |
| Funding Vault | USDC-Speicher fuer agent-signierte GridBot-Starts. |
| BotVault | Kapitalbereich fuer Bot-/Grid-Ausfuehrung. |

## Funding Hub

Im Funding Hub kannst du Assets verschieben:

- Arbitrum zu HyperCore.
- HyperCore zu HyperEVM.
- HyperEVM zu HyperCore.
- Spot zu Perps und zurueck.
- BotVault-Wallet funden.
- Ungenutztes USDC zurueck nach Arbitrum auszahlen.

{% hint style="info" %}
Manche Transfers bestaetigen nicht sofort, sondern bleiben pending, bis die erwartete Zielbalance erreicht wurde.
{% endhint %}

## Funding Vault

Der Funding Vault ist fuer mobile- und agent-faehige GridBot-Starts gedacht. Er haelt USDC bereit, damit ein GridBot-Launch nicht jedes Mal denselben manuellen Funding-Aufwand braucht.

Pruefe:

- Vault erstellt.
- Verfuegbares USDC.
- Reserviertes USDC.
- Agent-Wallet-Status.
- HYPE-Gas fuer notwendige onchain Aktionen.

## BotVault

BotVaults kapseln Kapital fuer Bots und Grid Bots. Ein BotVault kann neu erstellt oder wiederverwendet werden, wenn er verfuegbar ist.

Beim GridBot-Start wird angezeigt:

- geplantes Invest,
- Reserve oder Extra Margin,
- moegliche Vault-Erstellungsgebuehr,
- Funding-Quelle,
- Provisioning-Status.

## Funding History

Die Funding-Historie zeigt In-App-Aktionen und deren Status. Nutze sie, um pending Transfers, bestaetigte Aktionen und Tx-Hashes nachzuvollziehen.

## Fehler vermeiden

- Nie auf dem falschen Netzwerk signieren.
- Vor Withdrawals Zieladresse und Betrag pruefen.
- Bei pending Aktionen keinen gleichen Folgeflow erzwingen.
- Bei Rate Limits einen Moment warten und erneut refreshen.
- Bei unklarer Balance direkt die Zielumgebung pruefen.
