# Limited Beta plan closeout — 2026-09-11

Status: `COMPLETE / SUPERSEDED BY EXISTING CONTROLS`.

## Owner decision

Mario confirmed that a separate Limited Beta program is no longer required.
Functions can already be enabled or restricted selectively through the existing
backend and administrative controls. The proposed product-wide
`PUBLIC_LAUNCH_MODE=limited_beta` architecture is therefore not an open
implementation or rollout requirement.

## Current control model

The current repository provides feature-specific control layers instead of one
global beta switch:

- `packages/core/src/capabilities/productGates.ts` maps product functions to
  explicit capabilities.
- `apps/api/src/capabilities/guard.ts` enforces capabilities at server
  boundaries.
- Feature routes, including strategy, grid, and Position Copilot routes, apply
  server-side capability checks.
- Web navigation and product pages consume the resolved feature gates.
- Administrative plan overrides and billing feature controls remain separately
  auditable operational controls.

This decision does not weaken feature-specific security, permission, capital,
audit, or production gates. It only removes the redundant requirement for a
second product-wide Limited Beta mode.

## Documentation disposition

- The Limited Beta packet moved from `docs/plans/active` to
  `docs/archive/plans/limited-beta`.
- Unchecked packet workstreams are retained as historical proposals, not active
  tasks.
- No application code, production configuration, deployment, invitation state,
  or user access was changed as part of this closeout.
