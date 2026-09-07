# ULIQ Presale V2 Mainnet Role Matrix
## Owner approval of items 1–3 — 2026-09-07

Mario explicitly approved the presented Safe addresses, parameters and admin rights, sale timing, and final contract wiring/deployment configuration ("alles richtig und gebe es hiermit frei"). This closes the requested owner review; do not request the same approval again. The approved Admin Safe is `0xf6EB22eC94be977A668967f44F89eB1e056FF70f`; the approved inventory source and USDC treasury Safe is `0x9C96F9AE59e30786fD325EFD969884FC1f751739`. Existing contract rights are approved as presented; disabling ownership renunciation was a recommendation and is not silently implemented by this record.

Approval and supplied execution inputs are separate: the reviewed timing table still contains no actual start/end dates for either round, and no final deployed-address manifest is present. Mario's message supplies no timestamps or new deployment addresses. Record those missing values before execution; never invent them or describe an unperformed onchain verification as completed. Requesting the four missing dates is a data clarification, not a repeat approval request. Independent audit and runtime/deployment evidence remain separate. No transaction was performed when recording this approval.


Status: owner policy approval recorded on 2026-09-07; exact roles and contract powers prepared for Mario's review. Historical Safe observations below are unchanged; no deployment or live activation performed.

Current review: [ULIQ Mainnet contract inputs and authority](./ULIQ_MAINNET_CONTRACT_APPROVAL.md). Mario selected Safe-based treasury custody and manual exceptional handling. Proposed USDC treasury: existing Treasury Safe `0x9C96F9AE59e30786fD325EFD969884FC1f751739`, subject to the requested item-3 address approval. Pending USDC is held in each custody contract and reaches this recipient only on finalization. Native Arbitrum USDC is `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` for both rounds and both custodies.

This document records Arbitrum One role addresses for the ULIQ Presale V2 deployment graph. The initial ULIQ mint recipient is confirmed by Mario as recorded below; other candidate mappings remain proposals. Every address, owner set, threshold, balance, nonce, implementation, module, guard, constructor input, and transaction must be reverified against the finalized deployment revision immediately before any separately authorized action.

## Existing token reference — 2026-09-07

ULIQ is already deployed on Arbitrum One (`42161`) at `0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd`. Its creation transaction is `0xf5aa71e7973adf3f5f35ba4f8689f94dc7d0f853f65e80cb2a42dcc671671c7a`. Read-only verification at finalized block `502625136` returned symbol `ULIQ`, 18 decimals, supply `1000000000000000000000000000` raw and that same balance at the Treasury Safe. This refresh does not reverify Safe signers, roles or the proposed USDC treasury recipient.

| Future contract input | Existing token value |
| --- | --- |
| Both `ULIQPresaleRound.uliq_` inputs | `0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd` |
| Both `ULIQPresaleRoundVesting.token_` inputs | `0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd` |
| Future Mainnet locking `token_` input | Pinned by `ULIQMainnetLocker`; local adapter implemented, deployment and runtime integration pending |

The initial-mint decision below is historical context, not an instruction to deploy or mint another token. See the [current internal review and open actions](./ULIQ_PRESALE_VESTING_LOCKING_REVIEW.md) and the [recorded source verification](../../docs/archive/tasks/2026-09-05-uliq-arbiscan-source-verification.md).

## Confirmed initial mint recipient — 2026-09-05

Mario explicitly confirmed `ULIQToken.allocationController` as `0x9C96F9AE59e30786fD325EFD969884FC1f751739`, the Treasury Safe on Arbitrum One (`42161`). With the reviewed constructor, this Safe receives the entire initial supply of 1,000,000,000 ULIQ once at deployment; the deployment EOA receives no token allocation.

This confirmation settles the initial recipient choice only. It does not approve deployment, downstream transfers, vesting implementation, presale inventory sources, USDC custody destinations, or the complete release manifest. Remaining controls and gates are tracked in the [token deployment audit](./ULIQ_TOKEN_DEPLOYMENT_AUDIT.md). No new onchain verification or transaction was performed when recording this decision; the observations below retain their original timestamps.

## Evidence snapshot

- Observed at: `2026-09-05T09:51:06Z`
- Arbitrum One chain ID: `42161`
- Observed Arbitrum One block: `501963506`
- Verification sources: public Arbitrum One RPC and Safe Transaction Service
- Safe implementation: released SafeL2 `1.4.1+L2`
- Safe singleton: `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`
- Safe compatibility fallback handler: `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`

This is a point-in-time observation, not a monitoring result or a future-state guarantee.

## Role matrix and confirmation status

| Role | Address | Intended use / decision status | Snapshot evidence | Required before use |
| --- | --- | --- | --- | --- |
| Deployment EOA | `0x89473caAb2d0d5aC4B0fcCd45B0348E65307810E` | Gas-only deployment signer; no durable ownership or token allocation | No contract code, nonce `1`, successful inbound/outbound control test | Freeze the exact deployment script and revision, complete the dry-run, estimate gas, fund only the approved gas budget, and obtain explicit deployment authorization |
| Treasury / inventory-source Safe | `0x9C96F9AE59e30786fD325EFD969884FC1f751739` | Confirmed initial `ULIQToken` mint recipient; still a candidate immutable inventory source for both rounds | Deployed SafeL2, two owners, threshold `2`, no modules or guard, successful two-signature transfer test | Resolve downstream allocation/distribution architecture, independently reverify all Safe state, complete remaining technical release checks, and approve the exact funding/reconciliation sequence |
| Admin / governance Safe | `0xf6EB22eC94be977A668967f44F89eB1e056FF70f` | Candidate owner for listing, rounds, vesting, and custody contracts | Deployed SafeL2, two owners, threshold `2`, no modules or guard, nonce `0` | Complete a two-signature execution test, independently reverify all Safe state, freeze the role map, and approve each configuration action separately |
| Production USDC custody treasury | Proposed: `0x9C96F9AE59e30786fD325EFD969884FC1f751739` | Safe selected by owner; exact recipient is part of item-3 review | Historical Treasury Safe snapshot only | Approve exact address, reverify Safe, audit and reconcile constructor/settlement |

The deployment EOA is not an owner of either Safe. The Treasury/inventory and Admin/governance Safes currently use the same two owners:

- `0x45878083B2267B0846D6626F716484420c03DeEB`
- `0xDDF7AA0f21D2118afE40DDa0B3a441C98Bb5bF5d`

Separate Safe addresses provide role and accounting isolation, but the shared owner set does not provide an independent signer-compromise domain. The current `2-of-2` configuration prevents unilateral execution but creates a lockout risk if either signer becomes unavailable. A separately secured recovery-owner and `2-of-3` decision remains a pre-value risk review item.

## Planned constructor mapping

The initial token recipient below is confirmed; the remaining mappings are candidate inputs. This is not an accepted deployment manifest or authorization to execute any constructor.

| Contract input | Value | Notes / decision status |
| --- | --- | --- |
| `ULIQToken.allocationController` | `0x9C96F9AE59e30786fD325EFD969884FC1f751739` | Initial recipient confirmed by Mario on 2026-09-05. The full initial supply is minted once. Final downstream bucket destinations and controls remain open before deployment. |
| `ULIQGlobalListing.admin` | Admin / governance Safe | Controls one-time round binding and listing scheduling. |
| `ULIQPresaleRoundVesting.admin` for both instances | Admin / governance Safe | Controls one-time Presale binding. |
| `ULIQPaymentCustody.admin` for both instances | Admin / governance Safe | Owner policy approval recorded; exact authority/address review pending. |
| `ULIQPaymentCustody.treasury_` for both instances | Proposed Treasury Safe above | Exact address awaits item-3 approval; Safe brand selection alone does not establish the recipient. |
| `ULIQPresaleRound.inventorySource_` for both instances | Treasury / inventory-source Safe | The same Safe may fund both isolated rounds, but each immutable input and funding action must be verified independently. |
| `ULIQPresaleRound.admin` for both instances | Admin / governance Safe | Controls draft configuration and lifecycle operations defined by the reviewed contract. |

The confirmed initial mint recipient does not replace the separately specified Ecosystem, Marketing, Liquidity, Team-vesting, or other final allocation destinations. The complete one-billion-ULIQ downstream distribution and control model must be reconciled before the deployment manifest is approved.

## Public transaction evidence

### Treasury / inventory-source Safe

- Initial ETH test funding: `0xc820007a9d6312820419e569e554734d5236e8439bcf8e71203f0a4487a827b6`
- Successful two-signature outbound test: `0x0eddefd250f4a863f8b2bf012bcc3d62bb2d9ab1bfcd0f813b12be7a52d67739`
- Outbound test value: `0.00005 ETH`
- Observed nonce: `4`
- Observed balance: `0.002024713502783903 ETH`

### Admin / governance Safe

- Observed nonce: `0`
- Observed balance: `0 ETH`
- Two-signature execution test: pending

### Deployment EOA

- Successful inbound test: `0x7eb4cb2c562a1022dbf7674d44e3ee322c37c6ed166c6070f9b8cfcc3537b129`
- Successful outbound control test: `0xae0b572dd4efa27d0e266154d07a1c44d6de2efc4e8cae9efdf7f7431c73947c`
- Outbound test value: `0.00001 ETH`
- Observed nonce: `1`
- Observed balance: `0.002989575341632 ETH`

Transaction success proves only the recorded action. It does not prove future signer availability, sufficient deployment funding, correct constructor inputs, contract safety, source verification, finality of later actions, or downstream reconciliation.

## Required pre-deployment checks

- Freeze a tagged or committed source revision, Solidity `0.8.30`, optimizer settings, IR pipeline, EVM target, and exact dependency lockfile.
- Complete the independent audit and resolve all accepted findings.
- Preserve the dated ADR-001 owner approval and complete the separately requested exact input/authority review.
- Freeze canonical Arbitrum One USDC, sale timestamps, duration conversions, Safe addresses, owner sets, thresholds, and the ownership sequence.
- Produce a chain-guarded Mainnet deployment script and a separately staged configuration plan.
- Rehearse the complete graph on a local Arbitrum fork or Arbitrum Sepolia, including wrong-network, repeat-run, partial-failure, and reconciliation cases.
- Predict and reconcile deployed addresses, runtime bytecode, constructor inputs, ownership, balances, events, and source verification.
- Complete the Admin/governance Safe two-signature execution test.
- Define signer recovery, hardware-wallet, incident, and key-loss procedures.
- Calculate the deployment gas budget and fund the deployment EOA only after approval.
- Obtain explicit human authorization immediately before each Mainnet deployment, funding, configuration, readiness, and activation stage.

## Explicit exclusions

This record does not authorize new actions or establish readiness for the following. The token-only read-only evidence above is separate from these approvals:

- another ULIQ token deployment or minting on Arbitrum One;
- Presale, vesting, listing, custody, locking, allocation, or distribution contract deployment;
- Safe ownership, module, guard, or threshold changes;
- ULIQ or USDC funding, approvals, transfers, custody settlement, or inventory funding;
- `configureRounds()`, `setPresale()`, `fundInventory()`, `markReady()`, sale activation, listing scheduling, or DEX operations;
- environment, database, API, indexer, web, production, migration, or feature-flag changes;
- external legal opinion, independent audit completion, or Mainnet readiness.
