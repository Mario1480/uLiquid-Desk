# Type Safety Strictness Plan

Last updated: 2026-09-11

Current classification: `CURRENT BUDGET GATE PASSING / STRICTNESS PROGRAM OPEN`.

The verified current `npm run quality:any-budget` baseline is:

| Scope | Current count / ceiling | Suppressions |
| --- | ---: | ---: |
| `api-vaults` | 334 / 334 | 0 / 0 |
| `api-grid` | 199 / 199 | 0 / 0 |
| `api-manual-trading` | 8 / 8 | 0 / 0 |
| `runner` | 97 / 97 | 0 / 0 |
| `futures-core` | 0 / 0 | 0 / 0 |
| `futures-exchange` | 32 / 32 | 0 / 0 |
| `exchange` | 72 / 72 | 0 / 0 |

The immediate 73/72 `exchange` failure was corrected on 2026-09-11 without
raising its ceiling. Package typecheck and focused Binance client tests pass.
The older planned `api-vaults` target of 323 was not preserved; 334 is the
current measured ceiling, not an accepted final target. Ratchet it down through
scoped cleanup rather than lowering the configuration ahead of the code.

This plan turns the v18 review finding into an incremental release track. The goal is to raise type safety in capital-moving paths without flipping repository-wide strictness in one risky step.

## Current Gates

- `npm run typecheck` covers production TypeScript sources in API, runner, web, and packages.
- `npm run quality:any-budget` prevents tracked `any` and TypeScript suppression debt from increasing in selected capital-moving areas.
- `packages/futures-core` is already at a zero-`any` budget.

## Budget Ratchet

Any-budget changes must move in only one direction for protected paths:

- Lower a budget when code cleanup reduces the count.
- Lower a budget when the measured count is already below the old cap.
- Do not raise a budget without a release-owner note explaining why the added debt is temporary and when it will be removed.

Historical review-v18 targets were `api-vaults: 323` and
`futures-exchange: 32`. The futures-exchange target is preserved. The API Vault
drift is explicitly open and must be reduced from its current 334 baseline.

## API Strictness Stages

The API still has `noImplicitAny: false` at app level. Move it module by module:

1. DTO and boundary modules:
   - auth/license DTOs
   - funding and vault request/response shapes
   - webhook payloads
   - exchange-account inputs
2. Capital-moving services:
   - vault settlement
   - funding/onchain actions
   - reconciliation issue payloads
   - controller-wallet and transaction payloads
3. Route groups:
   - grid/vault routes
   - manual trading routes
   - admin operations that mutate trading or funding state
4. Final app-level switch:
   - enable `noImplicitAny`
   - keep any intentional dynamic boundaries behind `unknown` parsers or narrow helper types

Each stage should include a small typecheck or unit-test note in the release evidence matrix.

## Web Strictness Stages

The web app still has `strict: false` and `allowJs: true`. Avoid a broad flip until the user-facing trading paths are ready:

1. Add local explicit types to capital-moving components:
   - funding forms and history rows
   - vault actions
   - grid bot order controls
   - manual trading order tickets
2. Move shared API response parsing into typed helpers under `apps/web/lib`.
3. Remove or isolate JavaScript-only surfaces before disabling `allowJs`.
4. Enable stricter checks by folder once the local surfaces are clean.
5. Flip `strict` only after the capital-moving screens and shared wallet/funding libraries compile without local suppressions.

## Review Rule

For every release candidate, record:

- current `npm run quality:any-budget` output
- any budget decreases made since the previous release
- strictness modules completed
- remaining modules that still rely on app-level non-strict settings

## Program close condition

This program closes when API `noImplicitAny` and Web `strict` are enabled, Web
no longer requires `allowJs`, protected budgets no longer depend on unmanaged
dynamic boundaries, and external inputs are parsed from `unknown` into narrow
types. Passing the current budget ceiling prevents new debt but is not the final
completion criterion.
