---
description: Subscription, licenses, affiliate, SMTP, Telegram, and notifications.
icon: bell-ring
---

# Billing, Licenses, and Notifications

This page summarizes operational admin topics that are not direct trading parameters but still control access and communication.

## Billing and Licenses

Depending on your role, the admin and settings areas may show:

- Subscription status.
- License packages.
- Feature availability.
- Workspace or user limits.
- Billing-related audit entries.

If a feature is missing, check license, role, and section access first.

## Affiliate and Profitshare

Affiliate data and payout wallets are managed in dedicated areas. Before payouts, check:

- Payout wallet exists.
- Wallet configuration is correct.
- USDC and HYPE balances are sufficient.
- Secret reference is present.
- Audit and history show no unresolved errors.

## SMTP

SMTP is used for emails such as verification, password reset, and OTP. For email issues, check:

- SMTP host, port, and credentials.
- Sender address.
- TLS/SSL setting.
- Spam folder.
- Mail provider rate limits.

## Telegram

Telegram can be used for actionable signals, alerts, and deep links. For issues, check:

- Bot token.
- Chat or channel ID.
- User linking.
- Deep-link base URL.
- Notification settings.

## Webhooks

Webhook targets should use HTTPS and point to trusted external systems. Private, local, or metadata addresses are blocked in production.

## Alert Hygiene

- Enable only actionable alerts.
- Define clear owners.
- Send test messages after setup.
- Do not ignore repeated false alerts; fix the cause.
