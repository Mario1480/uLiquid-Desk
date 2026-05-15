---
description: User documentation and knowledge base for uLiquid Desk.
icon: book-open
---

# uLiquid Desk Knowledge Base

Welcome to the uLiquid Desk documentation. This knowledge base explains the core workflows for the dashboard, exchange accounts, manual trading, predictions, bots, grid bots, wallet, funding, vaults, admin operations, and support.

{% hint style="warning" %}
uLiquid Desk is a trading and automation tool. Always review every order, funding action, and bot configuration yourself. This documentation is not financial advice.
{% endhint %}

## Quick Start

1. Create an account or sign in.
2. Check your workspace and role.
3. Connect an exchange account or wallet.
4. Test first in paper or demo mode.
5. Move to small live canaries only after the test flow is clear.

## Main Areas

<table data-view="cards">
  <thead>
    <tr>
      <th>Area</th>
      <th>What it is for</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="getting-started/quickstart.md">Getting Started</a></td>
      <td>Setup order, login, roles, and security basics.</td>
    </tr>
    <tr>
      <td><a href="user-guide/dashboard-and-accounts.md">Dashboard & Accounts</a></td>
      <td>Account status, open positions, alerts, and exchange accounts.</td>
    </tr>
    <tr>
      <td><a href="user-guide/trading-desk-and-risk.md">Trading Desk & Risk</a></td>
      <td>Manual orders, positions, guardrails, and emergency behavior.</td>
    </tr>
    <tr>
      <td><a href="user-guide/signals-and-automation.md">Signals & Automation</a></td>
      <td>Predictions, strategies, standard bots, and grid bots.</td>
    </tr>
    <tr>
      <td><a href="user-guide/wallet-funding-and-vaults.md">Wallet, Funding & Vaults</a></td>
      <td>Connect wallets, move assets, fund vaults, and run BotVault flows.</td>
    </tr>
    <tr>
      <td><a href="support/troubleshooting-and-faq.md">Support & FAQ</a></td>
      <td>Common issues, diagnostics, and frequent questions.</td>
    </tr>
  </tbody>
</table>

## Good Operating Habits

- Use paper or canary flows for every new setup.
- Change only one critical setting at a time.
- Keep screenshots, timestamps, workspace names, account labels, and bot or grid IDs for support cases.
- Start live bots only when account data, margin, funding, and permissions are clearly shown as ready.
- Do not grant withdrawal permissions to exchange API keys used by uLiquid Desk.

## GitBook and GitHub

This documentation is prepared for GitBook Git Sync. GitBook uses `docs/README.md` as the homepage, `docs/SUMMARY.md` as the navigation, and `.gitbook.yaml` in the repository root as the sync configuration.
