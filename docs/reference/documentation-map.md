# Documentation Map

This map separates public guidance, current operational truth, active work, durable technical material, and historical evidence.

## Primary entry points

- Repository overview: `README.md`
- Documentation home and policy: `docs/README.md`
- User documentation navigation: `docs/SUMMARY.md`
- Internal documentation index: `docs/reference/internal-docs-index.md`
- Agent instructions: `AGENTS.md`
- Release and gate history: `AGENDA.md`

## Public and product documentation

GitBook navigation is defined by `docs/SUMMARY.md`. Public guidance lives primarily under:

- `docs/getting-started`
- `docs/user-guide`
- `docs/admin`
- `docs/auth`
- `docs/support`

## Current operational truth

- Status and readiness: `docs/status`
- Runbooks and operations: `docs/runbooks`
- Exchange integration playbooks: `docs/cex`
- Current ADRs: `docs/adr` and plan-local ADR directories where the surrounding program remains active

Status documents are authoritative only for their stated scope and evidence date. Code/tests, deployment/runtime, browser behavior, transaction finality, indexer state, and reconciliation remain separate evidence layers.

## Active and queued work

- Active programs and gated plans: `docs/plans/active`
- Non-authoritative proposals and legacy work lists: `docs/plans/backlog`

A plan remains active while any material implementation, rollout, migration, legal, security, acceptance, or production gate is unresolved. Completed phases may stay inside an active program package when later phases depend on their context.

## Durable technical material

- Architecture and system design: `docs/architecture`
- Quality, security, and acceptance material: `docs/quality`
- Stable technical and product reference: `docs/reference`
- UI migration and validation: `docs/ui`
- Strategy documentation: `docs/strategies`

## Historical evidence

- Dated task and deployment evidence: `docs/archive/tasks`
- Completed or superseded plans: `docs/archive/plans`
- Point-in-time reports: `docs/archive/reports`
- Historical ZIP snapshots: `docs/archive/packages`

Archived material supports traceability but is not proof of current runtime, finality, entitlement, reconciliation, or deployment state without fresh verification.

## Maintenance rules

- Write new and materially updated repository documentation in English.
- Keep the `docs` root limited to the documentation home and GitBook navigation.
- Place new material directly in the category that owns its lifecycle.
- Update inbound links and indexes whenever a file moves.
- Do not archive a plan merely because its code slice is complete.
- Never store credentials, secrets, private keys, tokens, seed phrases, or production data in documentation.
