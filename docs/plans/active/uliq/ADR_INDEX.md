# ULIQ ADR Index

Dieser Index verweist auf die verbindlichen Entscheidungen im bestehenden
ULIQ-Plan. Bei Konflikten gilt die neuere ausdrücklich supersedierende ADR. Der
aktuelle Release- und Evidence-Stand wird im
[ULIQ Release Status](../../../status/uliq-release-status.md) gepflegt.

| ADR | Thema | Status |
| --- | --- | --- |
| [ADR-001](ADR_001_LEGAL_PRESALE_MODEL.md) | Legal Presale Model | `ACCEPTED BY CURRENT OWNER CONFIRMATION`; supporting legal artifacts are not stored in this repository |
| [ADR-002](ADR_002_TOKEN_ALLOCATION_VESTING.md) | Token Allocation & Vesting | `ACCEPTED` |
| [ADR-003](ADR_003_PLATFORM_FEE_DISCOUNT.md) | Platform Fee Discount | `ACCEPTED FOR MVP SCOPE`; Discount bleibt 0 |
| [ADR-004](ADR_004_ENTITLEMENT_ANTI_REUSE.md) | Entitlement Anti-Reuse | `ACCEPTED / SUPERSEDED IN PART BY ADR-008` |
| [ADR-005](ADR_005_TIER_PRICE_REFERENCE.md) | Tier Price Reference | `ACCEPTED`; Deployment-Parameter offen |
| [ADR-006](ADR_006_PRESALE_VESTING_STATE_MACHINE.md) | Presale & Vesting State Machine | `ACCEPTED`; prior legal questions closed by the 2026-09-12 owner confirmation |
| [ADR-007](ADR_007_ONCHAIN_DATA_INDEXER.md) | Onchain Data & Indexer | `ACCEPTED`; current production background-job evidence refresh required |
| [ADR-008](ADR_008_MANDATORY_LOCKING_SUBSCRIPTION_GATING.md) | Mandatory Locking & Subscription-Term Gating | `ACCEPTED`; Mainnet reads active, deposits and extensions remain separately gated |
| [ADR-009](ADR_009_TWO_ROUND_PRESALE_TOKENOMICS.md) | Two-Round Presale & Revised Token Allocation | `ACCEPTED / DEPLOYED GRAPH`; independent audit in progress |

Implementation boundary: [Public Two-Round Presale Access](12_PUBLIC_PRESALE_ACCESS.md)
has live Mainnet reads, a configured and funded Round 1, an unscheduled and
unfunded Round 2, and disabled purchases. Onchain readiness, sale activation,
and DEX listing remain separately authorized operations.
