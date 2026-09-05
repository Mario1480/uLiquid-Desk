---
description: Configure dashboard widgets and understand their data and safety boundaries.
icon: gauge
---

# Dashboard Widgets

The dashboard is a personal operational workspace. Use **Edit dashboard** to move, resize, hide, or restore widgets. Desktop layouts use a grid; mobile layouts stack widgets in one column. Saved layout choices belong to your user account and do not change trading, margin, or bot configuration.

{% hint style="warning" %}
Dashboard data helps you monitor the platform. A widget is not a substitute for verifying orders, positions, balances, or transfers directly before a live action.
{% endhint %}

## Market and Navigation Widgets

| Widget | What it shows | Safe use |
| --- | --- | --- |
| Watchlist | Selected market prices and recent range. | Use the link to open the Trading Desk, then review the symbol and account again. |
| Market Sessions | Current major market-session timing. | Use as context only; it is not a liquidity or volatility guarantee. |
| Funding Rates | Available perpetual funding-rate context. | Check venue, timestamp, and data health before relying on it. |
| Top Movers | Notable recent market moves. | A large move is not an entry signal. |
| Quick Actions | Shortcuts to permitted product areas. | A shortcut never bypasses feature, role, or risk gates. |

## Portfolio and Health Widgets

| Widget | What it shows | Safe use |
| --- | --- | --- |
| Portfolio Allocation | A portfolio-level allocation view from available accounts and positions. | Treat missing or delayed accounts as incomplete data. |
| Network Status | Connectivity and account-status indicators. | Investigate degraded or disconnected states before starting a live action. |
| Open Positions | Position-side, size, entry, protective values, and PnL where available. | Cross-check surprising values with the venue. |
| Liquidation Distance | Distance between mark price and venue-reported liquidation price when available. | Unknown or delayed values are not a safe margin buffer. |

## Operations Widgets

| Widget | What it shows | Safe use |
| --- | --- | --- |
| Price Alerts | Price-threshold alerts for supported markets. | They run while the visible dashboard tab is active; they are not background or Telegram notifications. |
| Trading Journal | Recent bot-trade records and manual journal entries. | Manual exchange trades are not imported automatically. |
| Day & Week | Today or rolling seven-day journal summary. | Fees or net values can be unavailable when the source does not provide them. |
| Bot Radar | Standard-bot issues, stale runtimes, and waiting signals. | Grid bots retain their dedicated overview; investigate stale data before acting. |
| Grid Bots | Grid-bot overview and current operational hints. | Check funding, reserve, and runner status on the bot before changing it. |
| Notes & Checklist | Personal plan and checklist entries. | Save deliberately; reload if another tab has saved a newer version. |

## Layout and Data Hygiene

- Longer widget content scrolls inside its panel on desktop.
- Resize only to improve monitoring; it does not request additional data or change background schedules.
- Refresh the relevant product page if a value is stale, missing, or inconsistent.
- If a dashboard status is degraded, pause new high-risk actions and investigate the data source first.
