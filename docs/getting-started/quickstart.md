---
description: The fastest path from first login to a controlled test run.
icon: rocket
---

# Quickstart

This flow is for new users and operators who want to set up uLiquid Desk safely and test it in a controlled way before using live capital.

## 1. Check Your Account and Workspace

Sign in and check your user menu in the top right. If you use multiple workspaces, make sure you are operating in the correct one.

{% hint style="info" %}
Many actions are role-based. If a menu item is missing or a button is disabled, you probably do not have the required permission in the current workspace.
{% endhint %}

## 2. Complete the Security Setup

- Verify your email if required.
- Set up OTP or re-authentication if sensitive actions require it.
- Use a strong password for admin or trading roles.
- Never share sessions or exchange API keys.

## 3. Connect an Exchange Account or Wallet

Manual trading, bots, and predictions usually need an exchange account. Funding, BotVaults, and onchain actions need a wallet.

Recommended order:

1. Create an exchange account in Settings.
2. Confirm the account sync in the dashboard.
3. Connect a wallet if you use funding or vault flows.
4. Check the HyperEVM network status.

## 4. Verify the Read-only View

Open the dashboard and check:

- Exchange accounts are connected.
- Equity, margin, and PnL look plausible.
- Open positions are shown correctly.
- Alerts are empty or understandable.
- Calendar, news, and predictions load without errors.

## 5. Paper First, Then Canary

Before using live capital:

- Run a paper or demo flow.
- Test order submit, cancel, close, and refresh.
- Use small notional limits for the first live canary.
- Avoid parallel browser tabs for critical trading actions during the first test.

## 6. Next Pages

- [Account, Login, and Security](account-login-security.md)
- [Dashboard and Exchange Accounts](../user-guide/dashboard-and-accounts.md)
- [Trading Desk and Risk](../user-guide/trading-desk-and-risk.md)
- [Wallet, Funding, and Vaults](../user-guide/wallet-funding-and-vaults.md)
