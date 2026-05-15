---
description: Login, sessions, re-authentication, and safe account usage.
icon: shield-check
---

# Account, Login, and Security

uLiquid Desk protects sensitive actions with sessions, roles, re-authentication, and audit logs. This page explains what users should watch in daily operation.

## Login

Sign in with your registered email and password. Depending on the setup, you may need to verify your email before the account is fully active.

After repeated failed attempts, login may be temporarily rate-limited. If that happens, wait for the displayed cooldown instead of continuing to retry.

## Re-authentication and OTP

uLiquid Desk may require a fresh confirmation before sensitive actions. Typical examples include:

- Creating or changing exchange API keys.
- Manual trading actions.
- Role and permission changes.
- Critical admin settings.

If an OTP is entered incorrectly too many times, the action can be locked until the code expires or a new code is requested.

## Secure Exchange API Keys

Exchange keys should only have the permissions needed for their purpose.

{% hint style="danger" %}
Do not enable withdrawal permissions on API keys used by uLiquid Desk. Trading and read permissions are enough for the intended exchange flows.
{% endhint %}

Recommendations:

- Use separate keys per workspace or environment.
- Use IP allowlists if your exchange supports them.
- Rotate keys after team changes or security incidents.
- Disable keys directly at the exchange when they are no longer needed.

## Wallet Safety

Wallet signatures confirm onchain actions. Before every signature, check:

- The correct wallet address.
- The correct network.
- The correct amount.
- The expected target, such as HyperEVM, HyperCore, Arbitrum, or BotVault.

## Audit and Traceability

Admin and security-relevant actions may appear in the audit log. For support cases, timestamps, user, workspace, action, and affected account or bot IDs are especially useful.
