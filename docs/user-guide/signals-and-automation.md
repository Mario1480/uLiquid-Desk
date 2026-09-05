---
description: Use predictions, strategies, bots, and grid bots safely.
icon: rocket
---

# Signals and Automation

uLiquid Desk brings together predictions, strategies, standard bots, and grid bots. The safe operating pattern is: understand the signal, check the risk, simulate or test small first, and automate only after that.

Market context can be reviewed separately in [Market Intelligence](market-intelligence.md). It does not create a prediction or execute a trade.

## Predictions

Predictions analyze market information and produce setups. They can prefill the Trading Desk, but they do not execute an order automatically.

Recommended flow:

1. Select symbol and timeframe.
2. Check the strategy or signal source.
3. Read confidence, tags, and rationale.
4. Send the setup to the Trading Desk.
5. Review order details manually.

## Strategies

Strategies can be AI-based, local deterministic, or composite.

| Mode | Purpose |
| --- | --- |
| AI | Evaluation and explanation of complex setups. |
| Local | Deterministic rules for stable, repeatable results. |
| Composite | Chains local and AI steps. Test with dry-runs before activation. |

## Standard Trading Bots

Standard bots execute strategy logic automatically. Before starting one, check:

- Exchange account and symbol.
- Permissions.
- Investment and risk limits.
- Runner status.
- Last strategy evaluation.
- Stop and pause behavior.

## Monitor, Pause, and Recover

After starting a bot, monitor its current state, latest evaluation, account data, and runner health. A visible running state is not evidence that every venue-side order has completed; check the relevant bot detail and exchange account before making another capital-changing decision.

- **Pause** stops new strategy actions according to the bot workflow. Review existing venue orders and positions separately.
- **Stop** is a controlled lifecycle action. Read the displayed effect before confirming; it may not mean that every external order or position has disappeared immediately.
- **Error**, **stale**, or **pending** states require investigation. Do not create a replacement bot to work around an unresolved state.
- If recovery is needed after a connectivity or runner issue, collect the bot ID, account label, timestamp, and visible status before contacting support.

## Grid Bots

Grid bots place orders inside a price range. They are especially sensitive to capital, leverage, range, grid count, and liquidation distance.

Before launch:

1. Select a template.
2. Check symbol, range, leverage, and grid count.
3. Calculate the preview.
4. Review minimum investment, reserve, and liquidation distance.
5. Choose a funding source.
6. Check BotVault and funding status.
7. Start only when the preview is ready.

## Grid Bot Warnings

| Warning | Meaning |
| --- | --- |
| Budget too low | Capital is not enough for venue minimums or the grid structure. |
| Elevated liquidation risk | Liquidation distance is tight. Adjust range, leverage, or reserve. |
| Too many grids | Capital per grid is too thin. Reduce grid count or increase budget. |
| Venue constraints missing | Exchange metadata is incomplete. Do not start live. |

## When to Stop

Pause or stop automation when:

- account data is degraded,
- runner errors appear,
- open positions do not look plausible,
- funding or BotVault state is not reconciled,
- external market conditions no longer match the strategy.
