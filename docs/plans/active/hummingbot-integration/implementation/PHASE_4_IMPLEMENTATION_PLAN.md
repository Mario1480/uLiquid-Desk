# Phase 4 — Exchange Gateway and isolated Bitget POC

Status: `COMPLETE — DECISION PARTIAL`, 2026-09-08.

Owner follow-up, 2026-09-10: the remaining private certification is deferred until a separate Bitget Demo API Key and bounded test window are available. The currently connected account is live and is not authorized for Hummingbot order, recovery or disruption tests. Phase 5 preparation may proceed, while Phase 5 implementation and production adoption remain gated. See the [deferral record](../../../../archive/tasks/2026-09-10-phase4-private-certification-deferred.md).

Mario authorized starting Phase 4 before Phase 3 and directed the work to start from current `main`. At that checkpoint, Phase 1 and Phase 2 were complete by owner acceptance and Phase 3 had not started. Phase 3 was subsequently completed and accepted on 2026-09-09. Owner acceptance does not establish new test, deployment or connector-certification evidence.

## Baseline evidence and dependencies

Aligned the isolated worktree to `main` / `origin/main` at `d637371e819ebc21f2254bcc8b171dce3d181f25`. The prior divergent local history remains reachable through `codex/einui-baseline-20260906`; it was not discarded or merged.

| Responsibility | Existing foundation | Finding / next action |
|---|---|---|
| Native public Bitget transport | `packages/futures-exchange/src/bitget/bitget.market.api.ts`, `bitget.rest.ts` | Existing V2 mix contracts, ticker, candles and merge-depth methods; preserve native behavior and measure through these methods |
| Consumer contract | `packages/futures-exchange/src/futures-exchange.interface.ts` | Extend additively only after full contract audit |
| Provider capability authority | `packages/futures-exchange/src/core/exchange-capabilities.ts` | Native Bitget identity and conservative `not_assessed` certification already exist |
| Shared public data | `apps/api/src/market-data/sharedMarket.ts`, `sharedDerivatives.ts`, `snapshotCache.ts` | Snapshot foundations present; preserve keys, units, provenance and bounded cache behavior |
| Features | `apps/api/src/ai/features/registry.ts`, bounded provider-history modules | Accepted Phase 2 snapshot and bounded-history foundations are present on current `main` |
| Credential / ownership boundary | `apps/api/src/exchange-accounts/routes.ts` | Existing ownership queries and injected encryption/decryption; POC must never import account credentials |
| Recovery policy | `packages/futures-exchange/src/core/retry-policy.ts` | Existing retry classification needs call-site audit; do not reuse it as proof of safe execution retries |
| Accepted Phase 2 record | `docs/archive/tasks/2026-09-07-phase2-owner-acceptance.md` | Present; records owner acceptance separately from tests and connector certification |

Current `main` resolves the earlier baseline discrepancy. Existing ULIQ, authentication and UI changes on `main` are baseline content and remain outside this task; do not modify or claim them as Phase 4 work.

## Authorized stages and acceptance criteria

### 4A — Baseline and upstream preflight

1. Recheck the accepted Phase 2 base and preserve its public-data contracts.
2. Audit futures interfaces, Bitget normalization/transport, provider capability fields, tenant ownership, health and actual retry call sites.
3. Verify official Hummingbot source, Bitget contracts, supported market products and licenses. Record exact upstream commit/version and immutable image digest where applicable. Do not choose an unverified dependency or floating tag.
4. Establish public native Bitget measurements without credentials. Record request count, failures, timestamp availability, latency, depth and normalized units.

Acceptance: reproducible baseline, verified upstream references, explicit unsupported fields and no private requests. Current upstream versions and support remain unverified at this preflight checkpoint.

### 4B — Additive local contracts

Extend existing futures/capability foundations with `ExchangeProvider`, `MarketDataProvider`, `CapabilityDescriptor` and `ProviderHealth` only where needed. Preserve production imports, response shapes and native registry behavior. Unknown certification remains `not_assessed`.

Canonical execution identity / `ExecutionIntent` may describe local mock reconciliation only. uLiquid retains tenant/account identity, idempotency and reconciliation authority. Unknown submission state must require reconciliation, not blind resend. No execution runtime or production routing is introduced.

Acceptance: deterministic capability and permission rejection before provider invocation; unsupported providers and operations fail closed; no Hummingbot DTOs or dependencies in production API, runner or shared consumer contracts.

### 4C — Isolated public provider harness

Create `hummingbot-provider-poc` outside production runtime wiring, disabled by default, with explicit local opt-in. Use the actual pinned Hummingbot connector path rather than relabeling direct Bitget REST requests as Hummingbot evidence. Prefer no UI or service ingress. No exchange credentials or production configuration may be loaded.

Compare matching Bitget USDT perpetual instruments only after upstream support is verified. For each supported ticker/book/candle/funding/rules dataset, record product, symbol, depth, observation window, provider timestamps, fetch times, units and request duration. Unsupported datasets remain unavailable.

Proposed bounded pilot: one instrument, at most 10 paired observations per supported dataset, at most two attempts per logical read, a 10-second request deadline and a five-minute process deadline. Include connector startup/internal requests in the resource/request accounting; stop if those cannot be bounded. Record temporal skew and never interpret asynchronous books as atomic equality.

Acceptance: report actual sample counts, correctness differences, p50/p95 latency where sample size permits, stale/degraded status, errors, CPU/RAM and limitations. Report unavailable runtime/network prerequisites precisely. Public success cannot complete the full POC.

### 4D — Local failure and security validation

Use deterministic fixtures or the isolated process for malformed, crossed and empty books; missing/future/stale timestamps; unit normalization; unsupported capabilities; timeout, retry and 429/5xx bounds; reconnect and restart behavior. Keep synthetic evidence separate from public observations.

Test tenant/account mapping with synthetic identities, cross-tenant rejection before provider access, mutation isolation and secret redaction including nested error payloads. Apply an applicable security-review skill before reviewing implemented boundaries. Read-only AI permissions remain unchanged. Never disrupt production to manufacture recovery evidence.

### 4E — Verification and decision report

Run relevant Futures Core and Futures Exchange tests/builds, API tests/typecheck, and `git diff --check`. Run suites without forced-exit masking; record hangs as unverified. Add runner checks if runner-facing contracts change. Web/i18n/browser checks apply only if web surfaces change.

Produce run instructions and a comparison report separating implemented, deterministic verification, observed public results, unsupported capabilities and approval-gated work. Update roadmap/indexes while retaining historical evidence. Do not publish an overall `PASS` or connector certification from this slice.

## Separate approval gates retained from the full POC

[POC_PLAN.md](POC_PLAN.md) remains authoritative for private authentication, orders/fills, balances/positions, leverage/margin, cancellation, close/reduce, submission recovery and multi-account scaling. Sandbox/demo or real private tests require explicit environment, accounts, allowed operations and limits. No credential provisioning is implied.

Full POC acceptance still requires zero duplicate/lost orders, zero unexplained position drift, execution recovery, tenant isolation and measured scaling/economics. Phase 5, production adoption, TWAP/DCA and additional exchanges remain gated. This decision does not authorize deployment, migration, provider switching, a new production endpoint, monitoring activation or capital action.

## Final checkpoint

Repository preflight and baseline alignment are complete. The additive provider contracts, disabled public POC harness, Bitget funding/open-interest reads, deterministic boundaries, native baseline and pinned Hummingbot Docker runtime are implemented locally.

Verified on 2026-09-08:

- Hummingbot `v2.16.0` / `8f1906145ba7840c9935cb2151d669e6af21564f` is pinned; the `bitget_perpetual` connector and Apache-2.0 license were verified from official upstream source.
- Futures Core passed 19/19 tests.
- Futures Exchange passed 49/49 core, 59/59 CEX and 77/77 Hyperliquid tests without forced exit; the package build and typecheck passed.
- API typecheck passed after regenerating Prisma Client and rebuilding the required shared packages; no migration was run.
- Python probe compilation and POC JSON validation passed.
- Final hardened POC tests passed 6/6 (four comparison-integrity cases plus disabled-by-default and credential-rejection process checks).
- The final bounded native Bitget run observed 3/3 public BTCUSDT samples, 18 request attempts, p50 298 ms and p95 632 ms. See the [public comparison report](PHASE_4_PUBLIC_COMPARISON_REPORT.md).
- The immutable Hummingbot Docker runtime completed 3/3 fresh-process samples. The harness verified the exact image digest and all connector source hashes against the pinned checkout.
- A controlled public WebSocket disconnect reconnected and delivered a subsequent order-book message in 2,713 ms. Three fresh container starts completed successfully with 3,825–6,807 ms wall time, 2.683 aggregate CPU seconds and at most 147,398,656 bytes RSS.
- A scoped Codex Security review found no remaining reportable finding after hardening capability validation, tenant and execution identities, diagnostic redaction, subprocess environment isolation, source-checkout validation and comparison input validation. The closeout adds immutable runtime and connector-source attestation plus read-only filesystem, CPU/RAM/PID, capability and privilege limits. Network egress restriction and end-to-end execution controls remain deferred gates.

API/runner/product routes, credential loading and execution behavior remain unchanged. The Decision Gate is `PARTIAL`: the bounded public capabilities are accepted for continued evaluation, while private/execution/recovery/scaling capabilities remain `NOT ASSESSED`. Only `PASS` can unlock Phase 5, so production Hummingbot adoption remains gated. See the [dated decision record](../../../../archive/tasks/2026-09-08-phase4-hummingbot-bitget-decision.md).
