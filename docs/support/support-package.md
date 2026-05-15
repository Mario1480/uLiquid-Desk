---
description: What support or operators need for a fast investigation.
icon: package-check
---

# Collect a Support Package

A good support package saves time and prevents misunderstandings. For every incident, collect specific information whenever possible.

## Minimum Information

- Workspace name or workspace ID.
- User email or user ID.
- Timestamp with timezone.
- Affected page.
- Action that was performed.
- Expected result.
- Actual result.
- Screenshot or screen recording.

## Trading Cases

Also include:

- Exchange.
- Exchange account label or ID.
- Symbol.
- Order type.
- Side.
- Size, price, and leverage.
- Order ID or client ID, if available.
- Position before and after the action.
- Screenshot from the exchange UI if live capital was involved.

## Bot and Grid Cases

Also include:

- Bot ID or grid instance ID.
- Template ID.
- Runner status.
- Last error text.
- Preview status and warning codes.
- Funding or BotVault ID.

## Wallet and Funding Cases

Also include:

- Wallet address.
- Network.
- Transaction hash.
- Asset and amount.
- Source and destination.
- Pending or confirmed status.
- Balance before and after the flow.

## Admin and Security Cases

Also include:

- User role.
- Expected permission.
- Audit entry, if available.
- Error message such as `403`, `429`, or `invalid_or_expired_code`.

{% hint style="info" %}
Never share API secrets, private keys, seed phrases, or OTP codes in a support package.
{% endhint %}
