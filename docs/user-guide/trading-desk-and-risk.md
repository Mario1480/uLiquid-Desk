---
description: Manual trading, order types, positions, guardrails, and risk behavior.
icon: gauge
---

# Trading Desk and Risk

The Trading Desk is the manual trading interface. It can prepare orders, execute orders, show open orders, and close positions when your role and feature permissions allow it.

{% hint style="danger" %}
Live orders can move real capital. Check the account, symbol, side, order type, size, leverage, stop loss, and take profit before every confirmation.
{% endhint %}

## Typical Flow

1. Select an exchange account and symbol.
2. Check the live data status.
3. Choose the order type.
4. Enter size, price, and risk values.
5. Read warnings.
6. Submit the order.
7. Refresh and verify open orders and positions.

## Order Types

| Type | Use |
| --- | --- |
| Market | Fast execution at the current market price, with slippage risk. |
| Limit | Executes only at the limit or better, and may stay open. |
| Cancel | Cancels one open order. |
| Cancel All | Cancels all open orders in scope. |
| Close Position | Reduces or closes an existing position. |

## Safety Behavior

The desk blocks or warns on:

- unsafe or degraded market data,
- missing trading permissions,
- an identical action already in progress,
- missing re-authentication,
- incomplete account or symbol selection,
- critical close or cancel-all actions.

## Idempotency

Risky live actions are protected with a unique key. This helps prevent browser retries or double-clicks from unintentionally triggering multiple live actions.

## Closing a Position

After a close action, the server reads fresh live data. A position is only considered internally closed when no remaining exposure is visible. If exposure remains or the read fails, the state stays conservative and may remain open or pending.

## Risk Settings

Risk controls can be managed in Settings. Common parameters include:

- Daily loss limits.
- Margin thresholds.
- Allowed order types.
- Roles for market and limit orders.
- Workspace defaults for trading and bots.

## Emergency Behavior

If data looks unsafe:

1. Do not start new orders.
2. Check the exchange UI directly.
3. Cross-check open orders and positions.
4. Wait for account sync or notify an operator.
5. Collect a support package with timestamp and account ID.
