# Phase 4 Private Bitget Certification Deferral

Date: 2026-09-10

## Owner decision

Mario confirmed that the Bitget account currently connected to uLiquid Desk is a live account and that he cannot complete the Bitget demo setup and test at this time. The private Hummingbot certification is therefore intentionally deferred until a separate Bitget Demo API Key and a bounded test window are available.

The connected live account is not authorized for Hummingbot order, cancellation, leverage, margin, close, recovery or disruption tests. The read-only uLiquid connection check observed private account synchronization, balances and positions, but this is native uLiquid-to-Bitget evidence and does not certify the isolated Hummingbot provider path.

## Deferred acceptance scope

The later Phase 4 reassessment must use Bitget demo trading with virtual funds and a separate Demo API Key. The test configuration must add Bitget's required `paptrading: 1` REST header and keep credentials outside repository files, documentation, command output and chat.

The reassessment remains responsible for:

- private authentication, balances and positions;
- leverage and margin-mode behavior;
- bounded market and limit order lifecycles, cancellation, fills and close/reduce;
- disconnect-after-submit, restart, unknown-submission and reconciliation behavior;
- zero duplicate orders, zero lost orders after recovery and zero unexplained position drift;
- credential lifecycle, tenant isolation, network egress restrictions and empirical multi-account scaling;
- explicit allowed operations, virtual exposure limits, timeouts and abort conditions before the run.

## Roadmap effect

Phase 4 remains `COMPLETE — PARTIAL`, and the Decision Gate remains `CLOSED — PARTIAL`. Phase 5 production adoption, provider routing, credentials, execution, TWAP/DCA and additional Hummingbot connectors remain gated.

Phase 5 preparation may proceed only as documentation, architecture review, interface mapping, certification design, observability planning and rollback planning. Preparation must not load credentials, add production routing, enable a provider, place orders, change exchange settings, run a migration or deploy a Hummingbot runtime.
