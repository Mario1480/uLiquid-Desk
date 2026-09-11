# Active Program Closeout Register

Status date: 2026-09-11

Local closeout evidence:
[`../archive/tasks/2026-09-11-active-program-closeout-local.md`](../archive/tasks/2026-09-11-active-program-closeout-local.md).

This register reconciles active planning packets with current code, tests,
deployment records, browser evidence, and explicit owner decisions. Historical
checklists remain useful specifications, but their unchecked boxes do not
override newer evidence. Production configuration, runtime observation, and
capital or onchain evidence remain separate from repository implementation.

## Closeout status

| Program | Current classification | Closeout state |
| --- | --- | --- |
| AI Agent Chat | Implemented and production-evidenced | Formal closeout gates open |
| Limited Beta | Implemented feature slices plus deployed intake | Scope decision and release acceptance open |
| OpenAI Router and AI Credits | Implemented with paid production-run evidence | Billing and operations closeout open |
| Execution Foundation | Shared foundation landed | Re-baselined follow-up list open |
| Market Intelligence providers | Production hardening and authenticated acceptance complete | Telegram delivery and seven-day observation open |
| Type Safety strictness | Current budget gate restored | Incremental strictness program open |

ULIQ, Hummingbot, and Arbitrum USDC Billing remain active but are intentionally
outside this closeout pass. No decision, deployment, activation, wallet action,
or onchain action is authorized by this register.

## AI Agent Chat

Current state: `IMPLEMENTED / RELEASED / FORMAL CLOSEOUT OPEN`.

Repository and release evidence establish the separate read-only Agent Chat,
Market Analyst and Position Copilot profiles, server-side ownership and tool
policy, persisted conversations and activity, redaction, bounded cost/tool
execution, production API/web releases, and desktop/mobile acceptance slices.
The historical checkbox list in
[`../plans/active/ai-agent-chat/13-definition-of-done.md`](../plans/active/ai-agent-chat/13-definition-of-done.md)
was not maintained as those releases landed and must not be read as 53 current
implementation gaps.

Closeout gates:

- approve the production retention period for run and tool activity;
- define the production allowlist administration process and responsible operator;
- record one current read-only acceptance summary covering supported public and
  private reads, ownership denial, degraded/stale behavior, persistence,
  German/English, mobile, costs, error rate, monitoring, and rollback;
- decide whether General Availability or continued Limited Beta is the terminal
  state for read-only V1;
- keep streaming, broader private spot reads, custom-profile expansion, and
  trade drafts out of the V1 closeout unless separately approved.

Close condition: the current read-only scope has an explicit release state,
retention and operations owners are recorded, and a final evidence summary is
archived. Future trade-draft work becomes a separate active plan.

## Limited Beta

Current state: `SCOPE DECISION REQUIRED`.

Predictions, Prediction Builder, Prediction Copier, Position Copilot, and AI
safety slices are implemented. Separately, the beta application and invitation
system was deployed and intake enabled on 2026-09-07. Its live email delivery
and invitation redemption still lack production evidence.

The packet's proposed central `PUBLIC_LAUNCH_MODE=limited_beta` registry and its
global Grid/Vault/job shutdown are not established by the current source under
the planned configuration names. Existing capability gates are not equivalent
to accepting that product-wide operating mode.

Closeout gates:

- decide whether the packet's restricted launch mode is still the desired
  product state or whether the deployed invite-only access model supersedes it;
- if retained, implement and verify central server, job, navigation, and deep-link
  enforcement for the declared enabled and disabled feature matrix;
- complete or explicitly remove the architecture-refactoring workstream from the
  release boundary;
- execute the quality, observability, backup/restore, rollback, legal-copy, and
  Prediction Copier safety matrix;
- perform a controlled real SMTP and invitation-redemption smoke;
- publish an evidence-backed `Go`, `Conditional Go`, or `No-Go` decision.

Close condition: one beta definition is authoritative, its gates are technically
enforced, and the final release report accounts for every checklist item with
evidence, accepted risk, or an explicit out-of-scope decision.

## OpenAI Router and AI Credits

Current state: `IMPLEMENTED / PRODUCTION USE EVIDENCED / CLOSEOUT OPEN`.

The current schema and API contain the credit ledger, pricing revisions, agent
runs, usage records, reservations, feature flags, model routing, and operations
surfaces. Production Agent Chat evidence records settled AI Credit usage. The
original implementation packet therefore no longer represents the current
implementation state. This closeout did not query the live database and does not
claim a fresh production migration or reconciliation result.

Closeout gates:

- verify current provider pricing before changing or approving a pricing revision;
- record a production read-only census for active, expired, and
  reconciliation-required reservations and failed usage records;
- prove reserve, settle, release, partial charge, idempotent retry, parallel
  balance protection, and missing/ambiguous usage handling;
- verify that every paid provider call is associated with a usage record and
  that no available balance becomes negative;
- accept the pricing/markup administration, alerts, cost and margin monitoring,
  and rollback procedure;
- keep Deep Analysis disabled or approve its separate estimates and per-run limits;
- archive a final billing reconciliation and release-acceptance record.

Close condition: pricing is current, the live ledger reconciles, failure and
concurrency paths have evidence, and operations owns the alert and rollback path.

## Execution Foundation

Current state: `FOUNDATION LANDED / FOLLOW-UP OPEN`.

The shared execution contract and pipeline are in use by manual leverage,
placement, order editing, TP/SL, and position close paths, as well as shared
runner paths. The previous gap list overstated the remaining manual-trading
scope and has been re-baselined.

Closeout gates:

- move manual single-order cancel and cancel-all through the shared pipeline;
- retire or formally justify the legacy Prediction Copier execution mode;
- finish normalization of remaining futures-grid result construction;
- decide whether Vault provider actions use the full shared pipeline or remain
  metadata-aligned by design;
- decide whether runner guardrail transitions and execution-event helpers belong
  in the shared package;
- add parity coverage for live manual adapters, paper futures-grid terminal
  states, and persisted Vault provider lifecycle events.

Close condition: every retained exception is intentional and documented, all
required paths use the shared result vocabulary, and parity tests pass.

## Market Intelligence Providers

Current state: `DEPLOYED / SEVEN-DAY OBSERVATION AND TELEGRAM DELIVERY OPEN`.

Local verification on 2026-09-11 passed Prisma Client generation, all 58
targeted Market Intelligence tests, API and Web typechecks, and the Web i18n
integrity check after removing eight tracked, unreferenced ` 2.ts` copies of
older source and test files. The recommended FMP-independent flags are present
in `.env.example`, and primary sources have reviewed terms status in the
operations guide. A public production probe returned `200` for `/health` and
the expected `401` authorization boundary for News, Economic Calendar, Context,
and Summary without a session.

The authorized production pass backed up and restore-tested the database,
verified the provider migration and FMP-off flags, and deployed API hardening in
commit `01162eb0b`. Post-deploy probes returned all eight RSS sources and both
official calendar sources healthy without warnings. See the
[production rollout evidence](../archive/tasks/2026-09-11-market-intelligence-production-rollout.md).

Authenticated Chrome checks passed for Dashboard, News, Economic Calendar,
Market Intelligence, Admin Providers, Predictions, and Prediction Builder.
Follow-up commits `94a85054f` and `61833487b` clarified the calendar risk-horizon
status and filtered implausibly dated news items. Production builds and service
health checks passed. A transient first-cycle SEC and Eurostat degradation
cleared on one controlled provider retry, which restored 8/8 RSS sources and
both official calendar sources. Telegram Daily Calendar is configured and
enabled, but a real delivery has not yet been observed.

Remaining gates:

- exercise or observe one real Telegram Daily Calendar delivery;
- continue capturing coverage, latency, stale/degraded behavior, alert delivery,
  and source terms status as release evidence;
- observe at least seven stable FMP-off days;
- only then remove the legacy FMP adapter, key administration, health probe, tests,
  translations, and documentation.

Close condition: Telegram delivery and the seven-day observation pass, then
legacy FMP cleanup is deployed and verified.

## Type Safety Strictness

Current state: `CURRENT GATE PASSING / LONG-RUN PROGRAM OPEN`.

The 2026-09-11 baseline passes `npm run quality:any-budget`. The immediate
`exchange` overage was removed by replacing one Binance response-boundary `any`
with an `unknown` record parser; the package typecheck and focused Binance tests
also pass. Current budgets are still ceilings rather than completion targets,
and the historical API Vault target of 323 was not preserved: the verified
current ceiling and count are 334.

Remaining gates:

- ratchet protected budgets down when touched, beginning with API Vaults, API
  Grid, runner, and exchange boundaries;
- move API DTO/boundary, capital service, and route groups to strict typing;
- enable API-level `noImplicitAny` only after those module gates pass;
- type Web capital-moving surfaces and shared response parsers;
- isolate remaining JavaScript before disabling `allowJs`;
- enable Web `strict` after the scoped folders pass without suppressions;
- record each ratchet in release evidence.

Close condition: API `noImplicitAny` and Web `strict` are enabled, Web `allowJs`
is no longer required, and intentional dynamic inputs are parsed from `unknown`.
