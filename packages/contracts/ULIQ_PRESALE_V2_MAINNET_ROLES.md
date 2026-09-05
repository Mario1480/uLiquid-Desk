# ULIQ Presale V2 Mainnet Role Matrix

Status: planning and read-only address evidence only; not audited, not deployment-ready, and not authorization to fund, sign, broadcast, deploy, configure, or activate contracts.

This document records Arbitrum One role addresses for the ULIQ Presale V2 deployment graph. The initial ULIQ mint recipient is confirmed by Mario as recorded below; other candidate mappings remain proposals. Every address, owner set, threshold, balance, nonce, implementation, module, guard, constructor input, and transaction must be reverified against the finalized deployment revision immediately before any separately authorized action.

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
| Treasury / inventory-source Safe | `0x9C96F9AE59e30786fD325EFD969884FC1f751739` | Confirmed initial `ULIQToken` mint recipient; still a candidate immutable inventory source for both rounds | Deployed SafeL2, two owners, threshold `2`, no modules or guard, successful two-signature transfer test | Resolve downstream allocation/distribution architecture, independently reverify all Safe state, complete audit and Legal gates, and approve the exact funding/reconciliation sequence |
| Admin / governance Safe | `0xf6EB22eC94be977A668967f44F89eB1e056FF70f` | Candidate owner for listing, rounds, vesting, and custody contracts | Deployed SafeL2, two owners, threshold `2`, no modules or guard, nonce `0` | Complete a two-signature execution test, independently reverify all Safe state, freeze the role map, and approve each configuration action separately |
| Production USDC custody treasury | Unresolved | Recipient or safeguarding destination used by the final production custody model | No address accepted | Legal approval, final custody design, independent audit, and exact constructor/reconciliation review |

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
| `ULIQPaymentCustody.admin` for both instances | Admin / governance Safe | Production use remains blocked by the Legal and safeguarding decision. |
| `ULIQPaymentCustody.treasury_` for both instances | Unresolved | Must not be inferred from the ULIQ Treasury Safe without explicit Legal, custody, and audit approval. |
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
- Resolve ADR-001 Legal, access-control, withdrawal, cancellation, refund, and USDC safeguarding decisions.
- Freeze canonical Arbitrum One USDC, sale timestamps, duration conversions, Safe addresses, owner sets, thresholds, and the ownership sequence.
- Produce a chain-guarded Mainnet deployment script and a separately staged configuration plan.
- Rehearse the complete graph on a local Arbitrum fork or Arbitrum Sepolia, including wrong-network, repeat-run, partial-failure, and reconciliation cases.
- Predict and reconcile deployed addresses, runtime bytecode, constructor inputs, ownership, balances, events, and source verification.
- Complete the Admin/governance Safe two-signature execution test.
- Define signer recovery, hardware-wallet, incident, and key-loss procedures.
- Calculate the deployment gas budget and fund the deployment EOA only after approval.
- Obtain explicit human authorization immediately before each Mainnet deployment, funding, configuration, readiness, and activation stage.

## Explicit exclusions

This record does not authorize or evidence:

- ULIQ token deployment or minting on Arbitrum One;
- Presale, vesting, listing, custody, locking, allocation, or distribution contract deployment;
- Safe ownership, module, guard, or threshold changes;
- ULIQ or USDC funding, approvals, transfers, custody settlement, or inventory funding;
- `configureRounds()`, `setPresale()`, `fundInventory()`, `markReady()`, sale activation, listing scheduling, or DEX operations;
- environment, database, API, indexer, web, production, migration, or feature-flag changes;
- Legal approval, independent audit completion, or Mainnet readiness.
