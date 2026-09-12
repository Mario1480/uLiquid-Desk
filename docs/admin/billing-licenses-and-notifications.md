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

### Central payment history

The payment overview is available under **Admin > Licenses > Payments** (`/admin/licenses/payments`). It was deployed on 2026-09-12 with successful runtime and read-only database checks. Authenticated browser acceptance remains open; see the [production evidence](../archive/tasks/2026-09-12-admin-payments-production-deploy.md) and [acceptance plan](../plans/active/billing/admin-payments-overview.md).

Platform superadmins can search checkout orders by user ID/email, merchant order ID, internal order ID, or transaction hash. Provider, order status, and inclusive UTC date filters narrow the results. The newest orders appear first, with 25 rows per page. Select a merchant order ID to load its details independently of the list.

Details include quantities, historical package names where available, amounts/currencies, recorded payment verification, transaction explorer links, subscription terms, capacity grants, credit entries, and current subscription-wide entitlement synchronization. Historical package names may fall back to the current catalog when no item snapshot exists; these fallbacks are labeled.

Order status, network verification and entitlement evidence are separate. A transaction hash, a paid status, or an existing ledger entry alone does not prove complete fulfillment or current entitlement availability. Old orders and immediate plan upgrades may lack a directly linked term. The view reads persisted database state and does not trigger payment verification, retries, activation, refunds, or wallet actions. For a payment anomaly, follow the [payment review and refund runbook](../runbooks/billing-payment-review-refund.md).

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
