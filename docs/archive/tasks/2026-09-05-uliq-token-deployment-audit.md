# ULIQ Token Deployment Audit Evidence — 2026-09-05

Completed evidence collection for the [active token audit and release gates](../../../packages/contracts/ULIQ_TOKEN_DEPLOYMENT_AUDIT.md). Baseline commit: `56e5938c66910d59f9fba36b1a3dc1950f8ed268`. This records a local agent review and public read-only checks, not an independent audit or Mainnet release.

## Public Arbitrum One observations

At `2026-09-05T10:05:25.914Z`, the primary RPC returned chain ID `42161` and finalized-tag block `501962233`, hash `0x7f759e74e0cb39c3dc1d4bd66a4063a8cba150ecc62cf9ef648e889ee5c34d6d`, timestamp `1788601542`. All reads in the following table used that exact block. Primary: `https://arb1.arbitrum.io/rpc`. Secondary: `https://arbitrum-one.publicnode.com`; the same block number returned the same hash. Only the header hash, not every storage read, was independently cross-checked.

| Field | Treasury Safe | Admin/Governance Safe |
| --- | --- | --- |
| Address | `0x9C96F9AE59e30786fD325EFD969884FC1f751739` | `0xf6EB22eC94be977A668967f44F89eB1e056FF70f` |
| Code length | 171 bytes | 171 bytes |
| `VERSION()` | `1.4.1` | `1.4.1` |
| Owners / threshold | 2 / 2 | 2 / 2 |
| Safe nonce | 4 | 0 |
| ETH balance, wei | `2024713502783903` | `0` |
| Enabled modules | Empty; pagination ended at sentinel `0x0000000000000000000000000000000000000001` | Same |
| Transaction guard slot | Zero | Zero |

Both owner sets contained exactly:

- `0x45878083B2267B0846D6626F716484420c03DeEB`
- `0xDDF7AA0f21D2118afE40DDa0B3a441C98Bb5bF5d`

Neither includes deployment wallet `0x89473caAb2d0d5aC4B0fcCd45B0348E65307810E`. The singleton pointer in storage slot zero was `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` for both Safes. Both fallback-handler slots contained `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`. These are observed pointers, not a new independent audit or code-hash attestation of either implementation.

Storage slots were derived from, and checked against, the Safe v1.4.1 sources:

- Transaction guard: `0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8`, from `keccak256("guard_manager.guard.address")`; [GuardManager source](https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/contracts/base/GuardManager.sol).
- Fallback handler: `0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5`, from `keccak256("fallback_manager.handler.address")`; [FallbackManager source](https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/contracts/base/FallbackManager.sol).

### Deployer: latest and finalized snapshots differ

At the above finalized-tag block, the deployer had no code, zero ETH, and account nonce 0. That block precedes its funding/test transactions; it does not contradict the subsequent funded balance.

At `2026-09-05T10:06:23.932Z`, latest-tag block `501967125`, hash `0x3cbf53754c71ffc35c4be9f1eeee3faded8364816117c57095f006ae9364219a`, the deployer had no code, balance `2989575341632000` wei (`0.002989575341632 ETH`), and nonce 1. Receipts:

- [Funding transaction](https://arbiscan.io/tx/0x7eb4cb2c562a1022dbf7674d44e3ee322c37c6ed166c6070f9b8cfcc3537b129): success at block `501962526`.
- [Outgoing test transaction](https://arbiscan.io/tx/0xae0b572dd4efa27d0e266154d07a1c44d6de2efc4e8cae9efdf7f7431c73947c): success at block `501962767`.

One incoming and one outgoing transaction are consistent with account nonce 1. These receipts were beyond the earlier observed finalized-tag block and are not labeled finalized by this evidence. Funding sufficiency for a future release transaction was not estimated. RPC tags are provider-reported evidence, not an independent verification of the L1 finality mechanism.

## Executed local validation

Working directory for the following commands: `packages/contracts`. The source/build fingerprints are in the active audit report. Temporary audit outputs were kept under `/tmp/uliq-token-audit.Cq1cyU`; these are disposable local artifacts, not the durable source of deployment authority.

Fresh token-only build:

```bash
forge build src/uliq/shared/ULIQToken.sol \
  --out /tmp/uliq-token-audit.Cq1cyU/out \
  --cache-path /tmp/uliq-token-audit.Cq1cyU/cache --sizes
```

Result: exit 0; 21 source files freshly compiled with Solidity 0.8.30. Token runtime 3,518 bytes, creation bytecode 5,708 bytes. The separate broad `forge build --sizes` returned exit 1 because of an oversized legacy deployment script, not the token. No broad green size-check claim is made.

Token-only tests with reverting handler calls treated as failures:

```bash
FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=128 \
FOUNDRY_INVARIANT_FAIL_ON_REVERT=true \
forge test --match-path 'test/uliq/shared/*.sol' \
  --fuzz-runs 1024 --fuzz-seed 0x20260905 -vv
```

Result: exit 0; 26 passed, 0 failed, 1 intentional local fork-test skip. Each of the two invariant runs executed 32,768 handler calls with zero reverts. The handler exercised transfers, approvals, delegated transfers, burns, and delegated burns across three tracked addresses.

Full ULIQ regression:

```bash
FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=128 \
forge test --match-path 'test/uliq/**/*.sol' \
  --fuzz-runs 1024 --fuzz-seed 0x20260905 --json
```

Result: exit 0; 81 passed, 0 failed, 1 skipped. The 55 existing ULIQ tests passed along with 26 token audit tests. Optional-target-getter warnings preceded JSON output; the actual test-result object was parsed separately. No frontend/API/indexer checks were performed for this token-only review.

### Pinned local fork smoke

```bash
forge test --match-contract ULIQTokenForkAuditTest \
  --fork-url https://arb1.arbitrum.io/rpc \
  --fork-block-number 501967125 -vv
```

Result: exit 0; 1 passed, 0 failed, 0 skipped. A token was created **only in the local fork**, with the deployment-wallet address impersonated as creator and the candidate Treasury Safe as recipient. Both Safes' 2-of-2 configuration and deployer exclusion were checked. The Treasury received exactly `10^27` base units; deployer/Admin received zero. A local impersonated Treasury approval followed by a one-token delegated transfer left the expected recipient/Treasury balances, unchanged supply, and zero residual allowance.

This test does not invoke Safe signature verification, exercise actual signer devices, verify a Mainnet release script, estimate Arbitrum deployment fees, or establish the production token address. No RPC write/broadcast method was used. It establishes basic candidate-address/ERC-20 compatibility only.

### Static analysis and dependency evidence

Slither `0.11.6` was installed in a disposable virtual environment, without changing repository dependencies. The explicit compiler run used the verified `0.8.30` executable (`ULIQ_AUDIT_SOLC` below), installed OpenZeppelin `5.4.0`, and these arguments:

```bash
slither src/uliq/shared/ULIQToken.sol \
  --compile-force-framework solc --solc "$ULIQ_AUDIT_SOLC" \
  --solc-remaps '@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/' \
  --solc-args '--via-ir --optimize --optimize-runs 200 --evm-version paris' \
  --json /tmp/uliq-token-audit.Cq1cyU/slither-explicit.json
```

Result: analysis success, exit `255`, 55 alerts across 102 detectors and 23 declarations. Raw impact totals: 1 High, 9 Medium, 2 Low, 43 Informational. No path or detector exclusions. The active audit contains the complete category-level disposition; none was confirmed as an exploitable token implementation defect. A separate reachable-call traversal found no recursion and no reachable `Math.mulDiv` / `Math.invMod` from token entry points or construction.

Fresh compiler metadata enumerated 20 dependency sources. The downloaded locked npm tarball matched the root lockfile's SHA-512 integrity, and all 20 installed sources matched the tarball byte-for-byte. Isolated and regression builds had identical creation bytecode and metadata. Current Solidity bug data and the 20 published OpenZeppelin advisories were reviewed as described in the active report.

## Boundaries preserved

Only regression-test and documentation files were added/updated. No token, dependency, compiler configuration, Safe configuration, production environment, allocation, or deployment was changed. No production transaction, signature, commit, or push was made. The active audit's unresolved gates remain active; archiving this evidence does not close them.
