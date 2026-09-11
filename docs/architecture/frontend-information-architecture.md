# Frontend Information Architecture

## Objective

This cleanup pass rationalizes the uLiquid Desk frontend around the core product pillars without introducing a visual redesign or changing route behavior.

The main goal is to make the app shell read like the product:

- Desk / Trading
- Vaults
- Grid
- Strategies
- Predictions
- Wallet / Funding
- Admin / Settings

## Canonical Pillars

| Pillar | Primary label in nav | Current route(s) | Notes |
| --- | --- | --- | --- |
| Desk / Trading | `Dashboard`, `Trading Desk` | `/dashboard`, `/trade` | `Trading Desk` remains the canonical label for manual execution. |
| Vaults | `Vaults` | `/vaults` | Kept as its own capital surface instead of hiding under wallet. |
| Grid | `Grid` | `/bots/catalog`, `/bots/grid/*` | Promoted out of the generic `Bots` wording. |
| Strategies | `Strategies` | `/settings?section=strategy` | Uses the existing settings strategy area as the current user-facing entry point. |
| Predictions | `Predictions` | `/predictions` | No route change. |
| Wallet / Funding | `Wallet & Funding` | `/wallet`, `/funding` | `/funding` already redirects to `/wallet`, so the shell now reflects that combined surface. |
| Admin / Settings | `Settings`, `Admin` | `/settings`, `/admin` | `Admin` is shown only to users with backend admin access. |

## Navigation Structure

The app sidebar is now grouped into product-oriented sections:

1. `Desk & Trading`
2. `Grid, Bots & Signals`
3. `Vaults & Funding`
4. `Admin & Settings`

This replaces the flatter `Quick Links` mental model with a structure that mirrors how users reason about the product.

## Terminology Decisions

The following labels are now the preferred frontend terms:

- Use `Trading Desk` instead of mixing `Trade`, `Manual Trading`, and `Trading Desk` in navigation.
- Use `Trading Bots` for classic bot flows.
- Use `Grid` for grid template and runtime flows instead of `Grid Bots` as the main pillar label.
- Use `Wallet & Funding` for the combined wallet, transfer, deposit, and withdrawal surface.
- Use `Strategies` for prompt and strategy configuration entry points.

## Deep-Linking Rules

- `Strategies` in primary navigation deep-links to `/settings?section=strategy`.
- The settings page now opens the requested accordion section when `section` is present in the query string.
- Breadcrumbs resolve `Settings > Strategies` for that deep link so the location reads like a product surface instead of a raw settings page.

## What Changed In This Pass

- Re-grouped sidebar navigation around product pillars.
- Added missing top-level visibility for `Vaults` and admin-only `Admin`.
- Added a first-class `Strategies` entry point.
- Standardized key navigation labels in sidebar, search, and breadcrumbs.
- Reduced ambiguity between `Grid` and `Trading Bots`.
- Aligned high-visibility grid labels and CTAs with the new IA vocabulary.

## Deliberate Non-Changes

- No route renames were introduced.
- No large page-level redesign was attempted.
- `Dashboard` remains a separate overview surface inside the `Desk & Trading` pillar.
- `Strategies` still lives on top of the existing settings implementation rather than a dedicated standalone route.

## Follow-Up Candidates

- Add dedicated standalone `/strategies` routes if the strategy surface expands beyond settings-driven configuration.
- Consider merging or redirecting `/trading-desk` more explicitly into `/trade` to reduce duplicate route vocabulary.
- Review page-level headings inside wallet and vault surfaces for tighter alignment with the new `Wallet & Funding` pillar name.
- Review admin landing categories so they match the same pillar language used in the global shell.
