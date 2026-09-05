---
description: Common issues, diagnostics, and answers to frequent questions.
icon: book-open
---

# Troubleshooting and FAQ

## Data Is Missing or Not Loading

Check:

- API health.
- Internet and browser connection.
- Exchange account status.
- Last synchronization.
- Runner status.
- Websocket connection.
- Role and workspace.

If only one area is affected, check that feature page and its alerts.

## A Trading Button Is Disabled

Possible causes:

- missing permission,
- re-authentication required,
- degraded live-data signal,
- no exchange account selected,
- missing symbol,
- action already in progress,
- maintenance mode,
- feature not enabled.

## An Order Was Rejected

Check:

- Exchange key permissions.
- Symbol and market type.
- Minimum notional and minimum quantity.
- Margin and leverage.
- Open opposing orders.
- Exchange-specific error message.
- Rate limits.

## A Grid Bot Will Not Start

Check:

- Template preview is ready.
- Budget meets the minimum investment.
- Liquidation distance is not blocked.
- Funding Vault or wallet has enough USDC.
- HYPE is available for gas.
- BotVault provisioning is not pending.
- Runner is active.

## A Wallet Action Stays Pending

Some funding flows confirm only when the destination balance is reached. Wait for indexer or balance refresh and do not start the same flow repeatedly.

## Market Intelligence or AI Is Unavailable

Check your current plan and workspace role first. Then check the feature page for a locked state, provider warning, or exhausted AI-credit notice. A degraded source means the result may be incomplete; use its source references and do not treat it as a trading instruction.

## FAQ

### Does a prediction execute trades automatically?

No. Predictions can prefill the Trading Desk. The order must still be reviewed and confirmed separately.

### Does an exchange key need withdrawal permissions?

No. Withdrawal permissions should not be enabled.

### Why can I not see an admin menu item?

Either the role is missing, the feature gate is off, or you are in the wrong workspace.

### Why do the exchange UI and uLiquid Desk briefly disagree?

Exchange APIs, websockets, indexers, and internal reconciliation can have slightly different timing. If values differ, do not start new live actions and check the exchange UI directly.

### What is a canary?

A small live test with limited capital, clear scope, and close monitoring.

### Can Market Intelligence, Agent Chat, or Position Copilot place a trade?

No. They provide market context, analysis, or risk-oriented recommendations. Any live order remains a separate Trading Desk action that you must review and confirm.
