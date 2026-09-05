---
description: Manage workspace users, roles, and permissions.
icon: users
---

# Users, Roles, and Permissions

Roles control which areas a user can see and which actions they can run. Use least privilege: each user should receive only the permissions they actually need.

## Manage Roles

1. Open the admin area.
2. Select Users or Roles.
3. Choose the user or role.
4. Review permissions.
5. Save the change.
6. Ask the affected user to verify access.

## Critical Permissions

Be especially careful with permissions for:

- manual market orders,
- manual limit orders,
- exchange key management,
- role and user administration,
- billing and licenses,
- vault and funding operations,
- admin API keys,
- AI prompt and strategy configuration.

## Recommended Role Split

| Role | Recommendation |
| --- | --- |
| Superadmin | Only for platform owners and break-glass access. |
| Admin | Workspace owners, not every operator. |
| Operator | Trading and bot operation without global admin rights. |
| Viewer | Monitoring, reporting, and support without mutations. |

## After Team Changes

- Remove the user or reduce their role.
- Rotate exchange keys if they had access.
- Review API keys and webhooks.
- Check audit logs for unusual actions.

## Recognize Permission Problems

Common signs:

- A button is missing.
- A button is disabled.
- The API returns `403 permission_required`.
- A feature does not appear in navigation.

Check workspace, role, feature gate, and ownership.
