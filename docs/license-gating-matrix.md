# License Gating Matrix

This document defines the centralized product-module gates used across the API and web app for uLiquid Desk.

## Principles

- Product access is enforced through capability keys in `@mm/core`.
- Frontend visibility should follow the same gate decisions the backend enforces.
- When a feature is not available for the current plan, backend routes should fail with the standardized capability-denied response where a hard block is appropriate.
- Read/list surfaces may return empty module payloads instead of hard failures when that preserves existing UX safely.

## Feature Gate Registry

| Product module | Capability key | Default plan | Backend enforcement | Frontend enforcement |
| --- | --- | --- | --- | --- |
| AI predictions | `product.ai_predictions` | `pro` | prediction generation routes, AI prompt admin routes, user AI prompt generation routes, AI trace routes | predictions page option filtering, create-button blocking, admin links, strategies index |
| Local strategies | `product.local_strategies` | `free` | prediction generation selection, local strategy read/admin routes, local strategy run/create/update/delete routes | predictions strategy filtering, strategy navigation grouping, admin links, strategies index |
| Composite strategies | `product.composite_strategies` | `pro` | prediction generation selection, composite strategy read/admin routes, composite create/update/delete/dry-run routes | predictions strategy filtering, strategy navigation grouping, admin links, strategies index |
| Grid bots | `product.grid_bots` | `pro` | grid preview/create/template/instance routes | sidebar/header navigation, grid landing gate card, admin links |
| Vaults | `product.vaults` | `pro` | vault summary, ledger, deposit, withdraw, bot-vault routes | sidebar/header navigation, vault landing gate card, admin links |
| Paper trading | `product.paper_trading` | `free` | paper exchange-account create/update guards | exchange-account settings hide paper venue when unavailable |
| Advanced admin | `product.admin_advanced` | `free` | `requireSuperadmin` capability enforcement for admin routes | sidebar/header admin visibility |

## Response Model

The centralized product feature map is exposed via `GET /settings/subscription`:

- `capabilities`
- `featureGates`

`featureGates` is derived from `@mm/core` and includes:

- `feature`
- `capability`
- `title`
- `allowed`
- `currentPlan`
- `requiredPlan`

This allows frontend surfaces to render plan-aware visibility without duplicating plan logic.

## Enforcement Notes

### Hard-denied routes

Use the standardized capability-denied response for:

- prediction generation
- vault routes
- grid routes
- paper exchange-account writes
- strategy management writes
- admin module routes

### Soft-hidden read surfaces

Return empty module payloads where preserving the current UI flow is safer than throwing a hard error:

- `GET /settings/local-strategies`
- `GET /settings/composite-strategies`
- `GET /settings/ai-prompts/own`
- `GET /settings/ai-prompts/public`

This keeps existing selectors and dashboards stable while still preventing actionable use.

## Frontend Surfaces Updated

- app shell navigation in `AppSidebar` and `AppHeader`
- predictions module strategy selection and submission gating
- grid landing page
- vault landing page
- settings exchange-account paper venue options
- admin landing links
- admin strategies index

## Follow-up Candidates

- Add richer upgrade CTAs per denied module instead of the shared generic gate copy.
- Extend product-gate-aware filtering deeper into module-specific admin pages, not just their entry points.
- Consider exposing a single `me.features` snapshot from the backend if more pages need zero-roundtrip gating.
