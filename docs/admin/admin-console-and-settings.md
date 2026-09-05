---
description: Admin console, platform areas, and workspace settings.
icon: server
---

# Admin Console and Settings

The admin console is for platform and workspace management. Visibility and actions depend on role, permissions, and feature availability.

## Main Admin Areas

- Users and workspaces.
- Roles and permissions.
- Exchange and API key management.
- Bots, grid templates, and runners.
- Prediction defaults and AI prompts.
- SMTP, Telegram, and notifications.
- Billing, licenses, and feature gates.
- Audit, alerts, and server info.
- Vault execution, vault operations, and vault safety.

## Settings

Workspace settings manage operational defaults:

- Exchange accounts.
- Risk settings.
- Global defaults.
- Notifications.
- Affiliate.
- Subscription.
- Audit.
- Setup.

## Make Changes Safely

1. Record the current state.
2. Change only one critical setting at a time.
3. Save and check the response.
4. Reload the dashboard and affected feature page.
5. For trading or bot settings, run a small smoke test.

## AI and Prediction Admin

AI prompts, prediction defaults, refresh triggers, and trace logs affect signal quality and cost. Change them only when you understand the impact on existing predictions.

## Grid Templates

Grid templates control the launch parameters users see in the grid catalog. Before publishing:

- Test the preview with a realistic budget.
- Check symbol and venue constraints.
- Set risk and difficulty labels.
- Review profitshare and template description.

## Maintenance Mode

When maintenance mode is active, admin access can remain available while normal users may be restricted. Communicate planned maintenance ahead of time.

## Public Registration

Platform superadmins can open **Access Settings** (the legacy Access Section page) and change **Allow new registrations**, then save that section. Turning it off rejects public `POST /auth/register` requests with `403 registration_disabled` and displays a closed-registration notice on the registration page. Existing login, password reset, verification of accounts already created, wallet login for linked accounts, and admin-created accounts remain available.

The setting is stored in `GlobalSetting` under `auth.registration.v1`; no migration or restart is needed to toggle it after deployment. An absent setting preserves the existing open-registration behavior. A malformed stored value closes registration, and a database read failure returns `503 registration_unavailable`. Changes are restricted to platform superadmins and audited as `admin.registration.updated` in the same transaction. Public clients read the uncached status through `GET /auth/registration`.

Deploy the API and web changes before using this control. Deployment alone does not close registration: explicitly save the switch as disabled. Requests already admitted before a toggle may finish.
