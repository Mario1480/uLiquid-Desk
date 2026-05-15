---
description: Workspace model, role model, and important terms.
icon: users
---

# Workspaces, Roles, and Glossary

## Workspaces

A workspace separates users, exchange accounts, bots, settings, and permissions. Before any critical action, verify that you are operating in the correct workspace.

Typical workspace content:

- Members and roles.
- Exchange accounts.
- Trading and risk settings.
- Bots, grid bots, and predictions.
- Billing, license, and affiliate data.

## Roles

The exact role matrix can vary by installation. Common roles are:

- **Superadmin**: Platform-wide administration.
- **Admin**: Workspace management, roles, settings, and critical configuration.
- **Operator**: Operational use of trading, bots, and monitoring.
- **Viewer**: Read-only access without critical mutations.

{% hint style="info" %}
If you expect an action but cannot see it, check your role, workspace, and feature availability first.
{% endhint %}

## Important Terms

| Term | Meaning |
| --- | --- |
| Exchange Account | A server-side exchange connection whose keys are stored encrypted. |
| Trading Desk | Manual trading interface for orders, positions, and live data. |
| Prediction | A market forecast or signal that describes a setup and can prefill the Trading Desk. |
| Strategy | Rule-based or AI-based logic that evaluates setups or generates signals. |
| Bot | An automated trading run that executes a strategy. |
| Grid Bot | A bot type that manages grid orders inside a price range. |
| Funding Vault | A USDC store designed for mobile-friendly and agent-signed grid bot launches. |
| BotVault | A capital area for bot and grid execution plus settlement. |
| Re-authentication | A fresh OTP or security confirmation before sensitive actions. |
| Canary | A controlled live test with small limits and close monitoring. |
