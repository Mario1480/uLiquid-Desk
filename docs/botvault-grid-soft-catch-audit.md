# BotVault/Grid Soft Catch Audit

Scope: `apps/api/src/vaults/*`, `apps/api/src/grid/*`, plus direct execution-provider close helpers.

## Classification

| Class | Rule |
| --- | --- |
| `must_fail` | Continuing would change capital movement, fee settlement, provider selection, or persisted identity semantics. |
| `recoverable_track` | The request may continue, but the degraded path must log or persist a resumable/pending status. |
| `okay_to_swallow` | The read is response decoration, parse-only, public fallback probing, cleanup close, or lock progress where failing the main flow would be worse. |

## Audit List

| Area | Classification | Decision |
| --- | --- | --- |
| Reusable BotVault balance read during grid instance create | `must_fail` | DB/read failure now fails instead of assuming no refill is needed. |
| Existing BotVault execution provider lookup | `must_fail` | Sticky provider lookup errors now propagate instead of falling back to defaults. |
| Onchain factory address reads (`masterVaultOf`, `vaultOfBot`) | `must_fail` | RPC/ABI failures now throw; `null` only means zero/no registered vault. |
| Treasury recipient/fee-rate contract reads | `must_fail` | Onchain-mode failures no longer fall back to legacy treasury semantics. |
| Fee-event existence and BotVault fee metadata reads | `must_fail` | Fee settlement and affiliate accrual paths now fail on DB read errors. |
| Bot template resolution and HyperCore accounting fee reads | `must_fail` | Missing records are still handled, but DB failures no longer become empty defaults. |
| Claim-profit Hyperliquid balance/state reads | `must_fail` | Quote/claim logic now fails on unavailable live balances instead of treating them as zero. |
| Margin-add pre-transfer Core spot read | `must_fail` | Funding decisions no longer use a synthetic zero when HyperCore balance is unreadable. |
| Agent-wallet secret/version and active BotVault propagation reads/writes | `must_fail` | Wallet setup now fails on inconsistent propagation/version reads. |
| Trading reconciliation PnL aggregate read | `must_fail` | Aggregate read errors now abort reconciliation instead of rebuilding from null. |
| Grid stale-provisioning cleanup, rollback cleanup, and margin action state marking | `recoverable_track` | Best-effort behavior remains, with structured warnings. |
| Grid pilot-access decoration on instance list/detail | `recoverable_track` | UI mapping can continue, but failed reads are logged. |
| Venue constraint cache reads | `recoverable_track` | Live/fallback path can continue; cache read failures emit warnings and response warning codes. |
| BotVault reconcile cursor reads, funding-action reads, onchain snapshot reads, and post-resync reads | `recoverable_track` | Reconcile may continue with degraded evidence; failures are logged and existing pending/recovery states remain explicit. |
| Agent/payout balance cache and withdrawal metadata persistence | `recoverable_track` | Transactions already completed or summaries can continue; failed cache persistence is logged. |
| Pending BotVault payload lookups on grid end/create conflict responses | `okay_to_swallow` | Response enrichment only; the primary error response remains correct. |
| JSON/text body parsing for HTTP error/fallback payloads | `okay_to_swallow` | Parse failure is not semantically distinct from no parseable body. |
| Public fallback mark-price probe | `okay_to_swallow` | It is a last-chance fallback; the resolver still fails if no usable mark price exists. |
| Adapter `close()` failures | `okay_to_swallow` | Cleanup must not mask the primary operation result. Existing close swallows are intentionally kept. |
| Controller nonce-lock previous holder failure | `okay_to_swallow` | The queue must progress after a previous transaction failed; the original caller already receives its error. |
| Affiliate payout balance summary reads | `okay_to_swallow` | They only refresh displayed balances; stale cached summary is safer than failing wallet pages. |
| Admin email lookup for pilot settings | `okay_to_swallow` | Failure is safe-deny for admin access and the later settings read still controls explicit access. |

## Remaining Intentional Soft Catches

The remaining `catch(() => undefined/null)` occurrences in this area are intentional only for:

- adapter/resource close cleanup,
- response-only BotVault enrichment,
- JSON parse/body fallback,
- public market-data fallback probing,
- nonce-lock progress,
- non-authoritative wallet balance summaries.

New soft catches in BotVault/Grid code should be added only with one of the classifications above and, for `recoverable_track`, a log event or persisted pending/recovery state.
