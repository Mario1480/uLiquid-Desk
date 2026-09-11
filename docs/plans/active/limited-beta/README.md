# uLiquid Desk Codex Limited Beta Plan v2

Status date: 2026-09-11

Current classification: `SCOPE DECISION REQUIRED`.

The feature slices marked complete below have landed. The separately designed
beta application and invitation flow was deployed and intake enabled on
2026-09-07, but live email delivery and invitation redemption remain untested.
That invite-only access flow does not by itself implement this packet's proposed
product-wide `PUBLIC_LAUNCH_MODE=limited_beta` mode.

The planned central launch-mode configuration was not found as an accepted
current implementation under the packet's configuration names. Before further
implementation, decide whether the restricted launch mode is still required or
whether invite-only access plus existing capability gates supersedes it. The
authoritative remaining gates are tracked in the
[active program closeout register](../../../status/active-program-closeout.md).

This plan defines a deliberately limited beta for AI-assisted prediction and position workflows. It separates implemented feature work from release authorization: completed implementation items do not by themselves approve a beta launch.

## Beta boundary

- AI analysis and prediction workflows remain permissioned and observable.
- Position Copilot is read-only.
- Prediction Copier uses deterministic review, activation, and execution boundaries.
- The beta must not introduce an unrestricted AI path to place or modify trades.
- Provider, credit, security, degraded-state, and audit behavior must remain visible to operators.

## Workstreams

- [ ] `01-limited-beta-launch-mode.md` — beta cohort, feature flags, operator controls, and launch criteria.
- [x] `02-ai-predictions-ui-ux.md` — Predictions UI/UX implemented.
- [x] `03-ai-prediction-builder-chat.md` — Prediction Builder Chat implemented and reachable from navigation and Predictions.
- [x] `04-prediction-copier.md` — review, activation, and execution safety boundaries implemented.
- [x] `05-position-copilot.md` — read-only Spot/Perpetual Position Copilot with triggers, deduplication, audit, and notification settings implemented. Evidence: `docs/archive/tasks/2026-08-02-position-copilot-limited-beta.md`.
- [x] `06-ai-safety-and-tool-boundaries.md` — separate AI registries, central tool policy, prompt/output guards, secret redaction, and deterministic Copier boundary implemented. Evidence: `docs/archive/tasks/2026-08-02-ai-safety-tool-boundaries.md`.
- [ ] `07-architecture-refactoring.md` — remaining architecture consolidation.
- [ ] `08-quality-testing-observability.md` — full quality, test, and observability gate.
- [ ] `09-beta-release-checklist.md` — final release decision and evidence.

The unchecked workstreams keep this plan active, but they must be re-scoped
after the launch-mode decision instead of being executed mechanically.

## Definition of done

A workstream is complete only when:

- its implementation and persistence changes are finished;
- authorization, tenant isolation, and safety boundaries are covered;
- focused typechecks and tests pass;
- degraded and failure states are observable;
- user-visible copy follows i18n patterns;
- operational documentation and evidence links are current;
- no deployment, migration, production activation, or beta approval is inferred from local completion.

Use `CODEX-MASTER-PROMPT.md` for the packet execution workflow.
