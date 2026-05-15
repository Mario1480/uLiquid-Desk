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
