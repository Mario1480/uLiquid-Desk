# ULIQ Presale V2 Remix deployment packet

Prepared from revision `a3dfbd7648887ae027a628988d256644a3bb4097` on 2026-09-07 at Mario's explicit request to deploy through Remix on Arbitrum One, without funding or sale activation.

## Status

**ALL SEVEN CONTRACTS DEPLOYED AND BOUND; UNFUNDED AND NOT ACTIVATED.** Confirmed production deployments and receipts are recorded separately in `mainnet-deployment.json`. All 71 parameter and graph getter checks passed after Safe execution at block `502736316`. Addresses in `deployment-plan.json` remain historical local-fork predictions. The source compiled in Remix using the inspected, matching `remix.config.json` settings. Total deployment gas cost was `0.000198136793052 ETH`.

The initial listing deployment succeeded onchain despite a Remix `_context7.t3.error.indexOf` error. Its successful receipt, constructor parameters, bytecode and Safe owner were checked independently before continuing; it must not be deployed again. All seven contracts passed these checks and Remix reported successful Sourcify verification for each, including a separate listing verification. Etherscan verification requires an API key; Blockscout reported rate limiting or indexing timeouts.

`admin-safe-bindings.json` contains the five calls constructed from actual receipt-backed addresses. Every call passed a read-only Mainnet simulation from the Admin Safe. The batch was imported into Safe Transaction Builder and all five target addresses, zero values and calldata were compared with the prepared file. Safe nonce 0 executed with 2/2 signatures in transaction `0xac47da2610a7bf28b09f695863e7eeae20aaa91f43f0508d370b85418ebfd0eb`, block `502735846`. Its successful receipt and Safe `ExecutionSuccess` event were verified independently, followed by all 71 graph/parameter readbacks. Both rounds remain DRAFT with zero sale dates and the listing timestamp remains zero.

## Files and compiler

- `ULIQPresaleV2.sol`: Forge-flattened source including the four contract types and pinned local dependencies. No business logic edits.
- `compiler-config.json`: Remix compiler settings. Select Solidity `0.8.30+commit.73712a01`, optimizer enabled with 200 runs, via IR enabled, EVM `paris`.
- `standard-input.json`: complete standard JSON source/configuration for independent compilation and source verification. Source path affects metadata; regenerate from the exact Remix compilation input if Remix uses a different path.
- `deployment-plan.json`: constructor inputs, expected deployment order, nonce-dependent predicted addresses and subsequent Admin Safe binding calldata.

## Execution

1. Recheck chain 42161, deployment wallet `0x89473caAb2d0d5aC4B0fcCd45B0348E65307810E`, latest and pending nonce, gas budget, compiler and source hash. Recorded starting nonce is 2. If the nonce or sequence changes, recompute predictions and constructor references before proceeding.
2. Deploy in manifest order: listing, Round 1 vesting, Round 1 custody, Round 1 presale, Round 2 vesting, Round 2 custody, Round 2 presale. Use receipt-confirmed addresses for subsequent constructors. ETH value is zero. Ownership goes directly to the approved Admin Safe.
3. Reconcile every receipt, address, owner, immutable parameter and bytecode. Verify sources before funding.
4. The five binding calls must be executed by the 2-of-2 Admin Safe; the deployment EOA cannot execute them. Do not switch initial ownership to the EOA to bypass this requirement.
5. Do not fund inventory, configure sale dates, mark READY, activate purchases or schedule listing as part of this unfunded deployment stage. The owner plans to configure dates later.
6. Record actual deployed addresses separately from predictions, then configure the application after reconciliation. This packet contains no locker deployment or new ULIQ token deployment.

## Validation

- Existing ULIQ tests passed using Forge (exit 0).
- Both deployed-token fork tests passed at finalized Arbitrum block `502723179`, hash `0xaff98a86dcf4f6a36dbbc4066e1eba56b18a81734b628ad6b6a61d4024276e1e`.
- Flattened source compiled with the pinned settings. All four ABIs and runtime bytecodes excluding compiler metadata matched the existing repository artifacts exactly.
- Seven sequential deployments and five Admin Safe binding calls passed on a local Anvil fork. Both rounds remained unfunded DRAFT with zero sale timestamps. Fixture-only impersonation and ETH balance top-ups were used; these do not prove signer control or live gas sufficiency.
- Read-only production checks confirmed ULIQ decimals 18, native USDC decimals 6, and both approved Safes with the expected two owners and threshold 2. Observed deployment-wallet balance was `0.002970637048440000 ETH`; this is a snapshot, not a fixed gas budget.

Reference: [Remix compiler documentation](https://remix-ide.readthedocs.io/en/latest/compile.html).
