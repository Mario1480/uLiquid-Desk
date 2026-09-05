---
description: Dashboard, account cards, alerts, and exchange account setup.
icon: gauge
---

# Dashboard and Exchange Accounts

The dashboard is the operational home screen. It shows account status, performance, open positions, alerts, wallet snapshot, bots, grid bots, calendar, and news.

## Read the Dashboard

Start with the account cards:

- Status: connected, degraded, or disconnected.
- Last synchronization.
- Equity, available margin, and today's PnL.
- Open positions and bot or prediction activity.
- Alerts or error hints.

If data is degraded, do not start risky actions until the cause is understood.

## Personal Dashboard Widgets

Use **Edit dashboard** to move, resize, hide, and restore widgets. New widgets are added to existing layouts without replacing saved visibility choices.

For the complete widget catalogue, data freshness notes, and navigation shortcuts, see [Dashboard Widgets](dashboard-widgets.md).

On desktop, widget widths and heights snap to the same grid in edit and normal view. Each height unit is 96 pixels, with 12-pixel gaps between units. Longer content scrolls inside its panel. Saved sizes, ordering, and visibility remain unchanged. On mobile, widgets stack in a single column with content-driven heights.

- **Price Alerts:** set up to 20 alerts for the supported Binance Spot USDT markets. A fresh quote at or above/below the target triggers the alert, which stays recorded until rearmed or removed. Checks run every 15 seconds while the widget is mounted in a visible dashboard tab. These alerts do not send background or Telegram notifications.
- **Trading Journal:** review the latest 100 recorded bot trades from the last seven days, add trade notes, and enter up to 200 manual trade records. Manual exchange trades are not imported automatically. Manual records can be removed and re-entered to correct their values.
- **Day & Week:** switch between today in UTC and a rolling seven-day window, and filter bot/manual records. Fees and net results remain unavailable where the source does not contain fees. Manual entries use realized P&L before fees. The summary refreshes every minute and after journal changes. More than 5,000 bot trades are explicitly marked as a limited sample.
- **Bot Radar:** prioritize errors, stale runtimes, margin-related reasons, and waiting signals for standard bots. Runtime data older than five minutes is marked stale. Grid bots retain their dedicated overview widget.
- **Notes & Checklist:** save a personal daily plan and up to 30 checklist items. Save changes explicitly. If another tab saved a newer version, reload the saved version before editing again.
- **Liquidation Distance:** sort open positions by distance between mark price and venue-reported liquidation price. The display highlights distances at or below 10% and 5%. Missing prices stay unknown, and delayed position data is marked visibly.

These widgets use per-user preferences and existing position/bot data. They do not change orders, margin, or bot execution.

## Create an Exchange Account

1. Open **Settings**.
2. Go to **Exchange Accounts**.
3. Create a new account.
4. Select the exchange, label, and required credentials.
5. Save after re-authentication.
6. Check the account in the dashboard.

## API Key Minimum Rules

- Do not enable withdrawal permissions.
- Grant only the trading and read permissions that are required.
- Maintain IP allowlists if used.
- Use a clear name for each workspace or environment.

## Common Status Messages

| Status | Meaning | Next step |
| --- | --- | --- |
| Connected | Data is being read successfully. | Continue normally. |
| Degraded | At least one data source is unsafe or partially unavailable. | Do not start new live actions; investigate the cause. |
| Disconnected | The account cannot be read. | Check API key, exchange, network, and permissions. |

## Open Positions

The positions view shows side, size, entry, stop loss, take profit, and PnL. When market data is degraded, the last safe data can remain visible and trading actions may be blocked.

## News and Calendar

The economic calendar and market news help you understand market context. They do not replace your own risk decision.
