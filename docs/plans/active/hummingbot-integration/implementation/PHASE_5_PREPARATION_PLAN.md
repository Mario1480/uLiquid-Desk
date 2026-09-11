# Phase 5 Preparation Plan

Status: `PREPARATION COMPLETE — IMPLEMENTATION GATED`, 2026-09-10.

Phase 5 production Hummingbot adoption still requires an explicit Phase 4 `PASS`. Mario deferred the remaining Bitget demo certification on 2026-09-10 because the available connected account is live and the demo setup cannot be completed yet. The [deferral record](../../../../archive/tasks/2026-09-10-phase4-private-certification-deferred.md) preserves the remaining evidence requirements.

## Purpose

Prepare a reviewable production-adoption design so implementation can begin efficiently after the Phase 4 gate passes. This track does not authorize runtime integration, credentials, exchange mutations, orders, migrations, deployment or provider switching.

## Preparation scope

### 5A — Contract and dependency map

- Map the existing Shared Market Data, Exchange Gateway, capability, provider-health, credential, tenant, idempotency and reconciliation boundaries.
- Define the minimum additive interface mapping from the pinned Hummingbot connector into uLiquid-owned DTOs.
- Keep Hummingbot DTOs and lifecycle assumptions inside the provider module.

### 5B — Disabled runtime design

- Specify configuration, immutable version pins and feature flags with disabled-by-default behavior.
- Define process isolation, resource limits, network egress allowlists and secret injection without repository or log exposure.
- Define health, readiness and degraded-state behavior without adding a production service yet.

### 5C — Observability and rollback

- Define metrics and structured events for request latency, stale data, reconnects, reconciliation, unknown submissions and provider failures.
- Define shadow/canary entry criteria, rollback triggers and the native-provider fallback boundary.
- Keep product-facing APIs stable during any later provider introduction.

### 5D — Certification design

- Define separate certification matrices for the Bitget market-data provider, Bitget execution provider, TWAP, DCA and every additional connector/market/executor combination.
- Preserve the Phase 4 requirements for no duplicate or lost orders and no unexplained position drift.
- Require fresh demo evidence before any private or execution capability changes from `not_assessed`.

## Current boundary map

| Boundary | Current authority | Phase 5 integration decision |
|---|---|---|
| Provider contracts | `packages/futures-exchange/src/core/provider-contracts.ts` | Retain `CapabilityDescriptor`, `ProviderHealth`, normalized observations, `ExecutionIntent`, tenant binding and diagnostic redaction as the provider-neutral boundary. Add execution responses only after the gate passes. |
| Venue capabilities | `packages/futures-exchange/src/core/exchange-capabilities.ts` | Keep native providers authoritative. A production Hummingbot provider needs its own provider identity and must remain `not_assessed` until each capability is certified. |
| Native adapter creation | `packages/futures-exchange/src/factory/create-futures-adapter.ts` | Do not replace the exchange-based native factory. A later provider resolver selects native or Hummingbot before adapter creation and defaults to native. |
| Shared Market Data | `apps/api/src/market-data/sharedMarket.ts`, `sharedDerivatives.ts` | Reuse the existing provider-aware keys, schemas, freshness and warning projection. Hummingbot payloads are normalized before entering these stores. |
| Credential ownership | `apps/api/src/exchange-accounts/routes.ts`, `prisma/schema.prisma` | Preserve user-owned encrypted `ExchangeAccount` records and ownership queries. Introduce a scoped credential lease boundary later; the provider never queries the database or receives another tenant's account. |
| Runner adapter cache | `apps/runner/src/execution/futuresVenueRuntime.ts` | Keep native adapters as the default. Any future provider cache key must include tenant, exchange connection, provider and credential version, and rotation must evict the old process/session. |
| Execution selection | `apps/runner/src/execution/registry.ts`, `types.ts`, `config.ts` | Strategy mode remains separate from provider selection. Do not encode Hummingbot as a strategy or allow bots to bypass capability and risk checks. |
| Recovery and reconciliation | `apps/runner/src/execution/recovery.ts` | Reuse the conservative unknown-submission and no-blind-resend principles. Extract a provider-neutral state machine only after demo evidence confirms the required exchange identifiers and event ordering. |
| Execution persistence | `PredictionCopierExecution`, `GridBotOrderMap`, `GridBotFillEvent` in `prisma/schema.prisma` | Existing records are strategy-specific. Design a generic provider execution ledger before implementation; do not add a migration during preparation. |
| Risk controls | `ExchangeAccountRiskProfile` and runner execution guardrails | Fresh account/position/rule reads and per-account notional, loss, margin and open-position limits remain mandatory before submission. Provider success cannot override uLiquid risk decisions. |

## Planned inactive topology

```text
Web / Agent / Strategy
          |
          v
uLiquid API and Runner
  auth -> tenant -> account -> capability -> risk -> idempotency
          |
          v
Exchange Gateway provider resolver
  default: uLiquid native provider
  optional: Hummingbot provider, disabled and uncertified
          |
          v
Private Hummingbot provider process
  normalized DTOs, scoped credential lease, bounded resources and egress
          |
          v
Bitget API

Reconciliation always reads Bitget state back through the selected provider and
commits canonical order, fill and position state under uLiquid ownership.
```

The provider process must have no public ingress. API and runner callers use an internal authenticated channel with request size, deadline and concurrency limits. Network policy allows only the required Bitget REST and WebSocket destinations plus explicitly required local dependencies. DNS, proxy and redirect behavior must be covered by the egress test.

## Contracts reserved for post-gate implementation

No code is added for these contracts during preparation. The later design must define:

- `ProviderExecutionRequest`: one validated `ExecutionIntent`, expected credential version, deadline and reconciliation policy;
- `ProviderSubmissionResult`: canonical state `rejected`, `accepted`, `unknown` or `confirmed`, with exchange/client order references and no raw payload;
- `ProviderOrderSnapshot`, `ProviderFillSnapshot` and `ProviderPositionSnapshot`: normalized exchange truth with provider timestamps;
- `ProviderReconciliationResult`: matched, missing, unexpected and drifted items plus a blocking/manual-review outcome;
- `CredentialLease`: tenant, exchange connection, provider, version, expiry and allowed capabilities without secret material in logs or DTO serialization.

Every write must preserve the same canonical identity across retry and restart. An `unknown` submission blocks resubmission until exchange reconciliation resolves the client or exchange order reference.

## Disabled runtime and rollout controls

The later implementation must use independent controls with secure defaults:

| Control | Required default | Effect |
|---|---|---|
| Provider process present | absent | No Hummingbot runtime in production until an approved deployment step. |
| Provider enabled | `false` | Resolver cannot select Hummingbot. |
| Market-data shadow | `false` | No duplicate provider reads or extra exchange load. |
| Market-data serving | `false` | Product reads stay native. |
| Private reads | `false` | No credential lease can be issued. |
| Execution | `false` | All Hummingbot write capabilities fail closed. |
| Account allowlist | empty | No tenant/account can route to the provider. |
| Connector allowlist | Bitget perpetual only after certification | Additional exchanges remain unavailable. |
| Executor allowlist | empty | TWAP, DCA and other executors require separate certification. |

Configuration must reject contradictory states, including execution without private reads, serving without provider enablement, an account outside the allowlist, or a connector/executor without a passing certification record.

## Credential lifecycle design

1. uLiquid resolves the authenticated tenant and owned exchange connection.
2. The Credential Service decrypts only the selected record and creates a short-lived, capability-scoped lease.
3. The lease is delivered over the private provider channel using an ephemeral secret mechanism; it is never written into repository files, container images, command arguments or persistent logs.
4. The provider binds the credential version to its account session and refuses mismatched tenant, account or provider identities.
5. Rotation or revocation invalidates the lease, closes the provider session and evicts the cache entry before a new version is used.
6. Withdrawal and transfer permissions remain prohibited. Bitget demo requests additionally require the explicit demo marker and must fail closed when it is absent in a demo certification run.

## Observability specification

| Signal | Required dimensions | Blocking use |
|---|---|---|
| Provider health | provider, connector, version, account shard, status and reason | Stop new routing when unavailable, stale or uncertified. |
| Request latency/error | operation, read/write, attempt, result class and timeout | Trip the provider circuit and fall back for eligible reads. Never fall back by resubmitting writes. |
| Market-data quality | symbol, dataset, provider timestamp, age and warnings | Reject stale/degraded inputs where the consumer requires fresh state. |
| Submission lifecycle | execution identity, canonical state and age | Alert and block on unresolved `unknown` submissions. |
| Reconciliation | matched, missing, unexpected, duplicate and drift counts | Enter close-only/manual-review state on unexplained drift. |
| Credential lifecycle | provider, account reference, version and lease event | Confirm rotation/revocation without logging secret values. |
| Runtime resources | shard, accounts, CPU, RSS, event-loop lag and queue depth | Enforce shard capacity and restart policy. |

Structured logs must pass recursive secret redaction before emission. Raw provider responses remain bounded diagnostics with an explicit allowlist and retention policy.

## Rollout and rollback sequence

1. Deploy no runtime until Phase 4 records `PASS` and the implementation change passes review.
2. Start the provider disabled with health-only local verification.
3. Enable public shadow reads for one connector and compare against native data without serving them to products.
4. Allow private reads for one demo-certified account; keep execution disabled.
5. Run one bounded demo execution canary after its separate approval and certification prerequisites are met.
6. Enable serving or execution only per connector/account capability record.

Rollback disables new routing first, keeps reconciliation available for already accepted work, drains known submissions, resolves every `unknown` state, and then stops the provider. Native read fallback is permitted only where schema, freshness and provenance checks pass. Writes never fall back automatically between providers.

## Certification matrix

| Unit | Minimum evidence before enablement |
|---|---|
| Bitget public market data | Schema/unit parity, timestamp quality, reconnect/restart behavior, bounded latency/resources and shadow comparison. |
| Bitget private reads | Demo authentication, balances, positions, trading rules, leverage/margin modes, rotation/revocation and tenant isolation. |
| Bitget execution | Market/limit, partial/full fills, cancel, reduce/close, restart/disconnect-after-submit, zero duplicates/losses/drift and complete reconciliation. |
| TWAP | Schedule precision, child-order identity, partial fills, cancel/restart, slippage bounds, parent-child reconciliation and max-duration abort. |
| DCA | Entry count/size bounds, idempotent scheduling, restart, cancel-on-flip, aggregate position reconciliation and loss/notional limits. |
| Additional exchange | Connector, market type and executor tested as a distinct unit; no certification inheritance from Bitget. |
| Multi-account shard | Isolation and resource measurements at 1/10/25/50/100/250 accounts, noisy-neighbor behavior, restart duration and economic cost. |

Any duplicate order, lost order, unexplained position drift, secret exposure, cross-tenant access or uncontrolled write retry is an immediate certification failure.

## Exit criteria for preparation

- [x] The dependency and interface map is complete and reviewed against the current repository.
- [x] Runtime isolation, secret flow, observability and rollback designs are explicit.
- [x] Certification matrices and stop conditions are measurable.
- [x] No production code path, credential flow or deployment has been activated.

## Implementation gate

Phase 5 implementation may start only after a dated Phase 4 reassessment records `PASS`. Until then, all production Hummingbot provider, TWAP/DCA and additional-exchange implementation items remain `GATED`.
