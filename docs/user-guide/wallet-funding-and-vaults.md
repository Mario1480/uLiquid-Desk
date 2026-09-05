---
description: Connect wallets, move assets, and use Funding Vaults and BotVaults.
icon: wallet
---

# Wallet, Funding, and Vaults

Wallet and funding flows connect uLiquid Desk with HyperEVM, HyperCore, Arbitrum, and BotVaults. Every signature should be reviewed deliberately.

## Connect a Wallet

1. Open **Wallet & Funding** or the wallet button in the header.
2. Connect your wallet.
3. Check the address and network.
4. Switch to HyperEVM if needed.
5. Check HYPE for gas and USDC for funding.

## Balance Areas

| Area | Purpose |
| --- | --- |
| Arbitrum | Source or destination for USDC bridge flows. |
| HyperCore | Hyperliquid trading and core balances. |
| HyperEVM | Onchain actions, BotVault funding, and gas. |
| Funding Vault | USDC storage for agent-signed grid bot launches. |
| BotVault | Capital area for bot and grid execution. |

## Funding Hub

In the Funding Hub, you can move assets:

- Arbitrum to HyperCore.
- HyperCore to HyperEVM.
- HyperEVM to HyperCore.
- Spot to Perps and back.
- Fund the BotVault wallet.
- Withdraw unused USDC back to Arbitrum.

{% hint style="info" %}
Some transfers do not confirm immediately. They remain pending until the expected destination balance is reached.
{% endhint %}

## Funding Vault

The Funding Vault is designed for mobile-friendly and agent-capable grid bot launches. It keeps USDC available so a grid bot launch does not require the same manual funding work every time.

Check:

- Vault exists.
- Available USDC.
- Reserved USDC.
- Agent wallet status.
- HYPE gas for required onchain actions.

## BotVault

BotVaults isolate capital for bots and grid bots. A BotVault can be newly created or reused when one is available.

During a grid bot launch, uLiquid Desk shows:

- planned investment,
- reserve or extra margin,
- possible vault creation fee,
- funding source,
- provisioning status.

## Funding History

Funding history shows in-app actions and their status. Use it to trace pending transfers, confirmed actions, and transaction hashes.

## Read Status Conservatively

| Status | What it means | What to do |
| --- | --- | --- |
| Pending | The action has been submitted or is awaiting an expected state change. | Wait, refresh, and do not submit the same action again. |
| Confirmed or settled | The product has recorded the expected completion state. | Review the resulting balance and transaction reference. |
| Reconciled | The product has compared its recorded state with the expected destination state. | Treat it as operational evidence, then investigate any discrepancy shown. |
| Failed or needs attention | Completion was not established. | Do not retry blindly; keep the transaction reference and collect a support package. |

Displayed state is not a substitute for checking a material destination balance or the relevant network/venue when capital is at risk.

## Avoid Funding Mistakes

- Do not sign on the wrong network.
- Check target address and amount before withdrawals.
- Do not force the same follow-up flow while an action is pending.
- Wait and refresh if rate limits appear.
- If a balance is unclear, check the destination environment directly.
