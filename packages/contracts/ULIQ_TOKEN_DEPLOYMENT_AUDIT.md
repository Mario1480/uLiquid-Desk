# ULIQ Token Deployment Audit

Review date: 2026-09-05. Reviewer: Codex, technical agent review.

Status: review completed for the token implementation; **Mainnet deployment remains NO-GO**. This is not an independent professional audit, a certification, or transaction authorization.

## Executive conclusion

No exploitable Critical, High, Medium, or Low implementation vulnerability was confirmed in the reviewed `ULIQToken` and its reachable dependency code. The token implements a fixed **initial** supply, standard transfers and allowances, holder/allowance-based burns, and EIP-2612 permits. There is no runtime mint authority, owner, proxy, tax, pause, blacklist, or administrative balance override.

Validation: 24 token unit/fuzz tests and 2 stateful invariants passed. The broader ULIQ regression suite passed 81 tests, with the optional fork test skipped locally; that fork test passed separately on a pinned Arbitrum One fork. Static analysis produced 55 raw alerts, all dispositioned below; raw scanner severity is not a confirmed token vulnerability count.

The most consequential remaining risk is deployment configuration: the entire initial supply goes to one constructor address, without token-level vesting or recovery. Following the review, Mario confirmed the initial mint recipient on 2026-09-05 as Treasury Safe `0x9C96F9AE59e30786fD325EFD969884FC1f751739` on Arbitrum One. The recipient choice is settled; downstream lockup implementation, the reproducible Mainnet procedure, external review, and the existing project Legal gate remain open. This decision did not change the token or constitute deployment authorization.

## 1. Pinned scope and build identity

| Item | Reviewed value |
| --- | --- |
| Source baseline | Commit `56e5938c66910d59f9fba36b1a3dc1950f8ed268` |
| Token | [`src/uliq/shared/ULIQToken.sol`](./src/uliq/shared/ULIQToken.sol), lines 1–24 |
| Dependency closure | 20 OpenZeppelin source files, plus the token; derived from fresh compiler metadata |
| Solidity | `0.8.30+commit.73712a01`; source pragma remains `^0.8.24` |
| Build | Optimizer enabled, 200 runs; `viaIR = true`; EVM `paris`; IPFS metadata hash |
| Dependency | Exact `@openzeppelin/contracts` `5.4.0`, root `package-lock.json` |
| Foundry | `forge 1.5.1-stable`, commit `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2` |
| Runtime / creation size | 3,518 / 5,708 bytes; creation size excludes the 32-byte constructor argument |
| Supply | `1_000_000_000 ether` = `10^27` base units; 18 decimals |
| Metadata | Name `uLiquid Token`; symbol `ULIQ`; EIP-712 version `1` |
| Candidate network | Arbitrum One, chain ID `42161`; not enforced by the token itself |
| Confirmed initial mint recipient | `0x9C96F9AE59e30786fD325EFD969884FC1f751739`; Mario's post-review confirmation on 2026-09-05, not a new onchain verification |

SHA-256 fingerprints:

```text
Token source:  7878dd7c45a5105d80eafd124ff31421d7af71cf63ba54325b55cfe5ec928431
foundry.toml:  ca4d1a8798b7efd22eefb9316c7824b9c39ddca19f88bbf02bfe9b61fb37257d
Root lockfile: d83a9d191c62defd32347db019b9f48c5bc704f41982524b982c9a9d2121d25c
Creation code: dafe51f74b7d7e7fc7ba995ad054b0b3e85146e0d0bd7f4a83b820b3fa1fe829
```

The creation-code fingerprint hashes decoded bytecode bytes, without constructor arguments. It is not a deployed runtime hash: EIP-712 immutables depend on the deployment address and chain. A fresh isolated build and the regression build produced identical creation bytecode and metadata. The token, compiler settings, and dependency declarations were not modified during this review. The new test/report files are an additional working-tree review bundle until committed.

The locked OpenZeppelin tarball was fetched and its SHA-512 integrity verified. All 20 installed source files in the compiler import closure matched its contents byte-for-byte:

```text
sha512-eCYgWnLg6WO+X52I16TZt8uEjbtdkgLC0SUX/xnAksjjrQI4Xfn4iBRoI5j55dmlOhDv1Y7BoR3cU7e3WWhC6A==
```

The scope includes constructor allocation, ERC-20 accounting, burn authorization, permits/nonces/domain separation, reachable cryptographic helpers, compiler configuration, and candidate recipient compatibility. Presale, custody, listing, vesting contracts, frontend/API/indexer behavior, Safe implementation security, signer-device security, liquidity, bridges, and legal compliance are **not independently audited here**. Passing their existing ULIQ regression tests does not expand this audit scope. No deployed Mainnet ULIQ address was supplied for bytecode verification.

## 2. Threat model and reviewed invariants

Assets are the full initial supply, holder balances, spending allowances, and permit authorization. Actors are the deployment operator, allocation-controller signers, ordinary holders, approved spenders, and untrusted permit relayers. The deployment inputs/build system, Safe signer quorum, holder keys, and approved spenders are distinct trust boundaries.

Worst-case losses are the entire initial supply from an incorrect/uncontrolled mint recipient, and a holder's approved balance from a compromised spender or signing key. There is no privileged token recovery mechanism.

| Invariant / abuse case | Review and test result |
| --- | --- |
| Mint exactly once, only to the nonzero constructor recipient | Constructor, mint event, initial balances, and zero-recipient revert checked. No externally reachable mint path after construction. |
| Transfers conserve supply and cannot spend another holder's balance without allowance | Zero/self/full transfers, insufficient balance, delegated spending, and revert rollback checked. |
| Only burns reduce supply | `totalSupply + cumulativeBurned == MAX_SUPPLY` and sum of tracked balances equals supply throughout stateful sequences. Full-supply burn is supported. |
| Finite allowance is consumed; infinite allowance intentionally persists | Both `transferFrom` and `burnFrom` tested, including unauthorized attempts and atomic rollback on failure. |
| Permit is bound to owner, spender, amount, nonce, deadline, token, and chain | Replay, wrong signer/nonce, altered fields, cross-token/chain use, deadline equality/expiry, invalid `v`, high-`s`, and zero addresses tested. Failed permits do not consume nonces. |
| No reentrant value-transfer callback | Transfer, approve, and burn contain no external recipient calls. Permit uses the fixed `ecrecover` precompile, not arbitrary wallet callbacks. |

Manual tracing covered the constructor and all 16 ABI functions, including metadata/domain views. The reachable internal/library call graph contained no recursion and did not reach `Math.mulDiv` or `Math.invMod`. State consists of balances, allowances, supply, fixed metadata strings, EIP-712 fallback strings, and nonces; there is no user-controlled storage-layout base or transient storage.

## 3. Operational and integration observations

These are release/integration risks or expected ERC-20 behavior, not newly confirmed permissionless implementation exploits.

### D-01 — Initial recipient confirmed; downstream allocation and lockup mapping remain open

Priority: deployment blocker; impact can be the entire supply. `ULIQToken.sol:15–22` checks only that `allocationController` is nonzero. It does not verify Safe ownership, chain, contract identity, or tokenomics, and does not enforce vesting.

Mario confirmed Treasury Safe `0x9C96F9AE59e30786fD325EFD969884FC1f751739` as the initial mint recipient on 2026-09-05. This closes the recipient-selection sub-item of D-01. Minting all 1 billion ULIQ there gives its quorum immediate control over all tokens. That does not itself implement the separate buckets and release schedules in [ADR-002](../../docs/ULIQ_Codex_Implementation_Plan/ADR_002_TOKEN_ALLOCATION_VESTING.md), as revised by [ADR-009](../../docs/ULIQ_Codex_Implementation_Plan/ADR_009_TWO_ROUND_PRESALE_TOKENOMICS.md). The updated [role matrix](./ULIQ_PRESALE_V2_MAINNET_ROLES.md) records this limited confirmation, not approval of the complete downstream allocation architecture.

Remaining closure: approve the downstream allocation/vesting deployment sequence; independently validate the confirmed address and chain immediately before signing; reconcile constructor event, recipient balance, total supply, and final code identity after deployment. Keep approval of deployment separate from subsequent distributions or presale activation. There is no general requirement to change this constructor's generic nonzero check; verification belongs in the approved deployment procedure.

### D-02 — Two-of-two custody has no spare signing key

Priority: operational decision before valuable minting. Both candidate Safes had the same two owners and threshold 2 in the observed snapshot. The deployer was not an owner. Two keys controlled by one person are not organizational separation, and either key becoming unavailable can prevent execution; sharing owners also correlates the two Safes' compromise risk.

Required closure: document independently secured key/back-up arrangements, recovery limitations, and acceptance of 2-of-2 or a separately approved 2-of-3 arrangement. No owner or threshold changes were performed. The fork smoke impersonates the Safe and does not prove actual signer control or recovery readiness.

### I-01 — Burns and approvals must be represented accurately

`ERC20Burnable.burnFrom` uses the same allowance as `transferFrom`. An approved spender can burn the authorized tokens; infinite approval also permits future burns up to the holder's available balance. `MAX_SUPPLY` is the initial ceiling, not a promise that circulating or total supply always stays at 1 billion.

Replacing a nonzero allowance has the usual ERC-20 ordering risk: a spender can consume the old allowance before the replacement, then consume the new allowance. The regression test demonstrates this ordering. For sensitive Treasury operations, use exact allowances, minimize standing approvals, and reconcile outstanding spending before replacing/revoking them; a revoke cannot undo an already executed spend. Burning is irreversible. The supplied QuickScan claims of no burn support and protection from the approval race do not match this implementation.

### I-02 — Permit is optional and not Safe/EIP-1271 compatible

`ERC20Permit.permit` validates an ECDSA signature for the token owner, not an EIP-1271 contract signature. Safe-held tokens therefore need a regular Safe-executed `approve`; an individual Safe owner's EOA signature is not a permit for the Safe. The negative test uses an EIP-1271 wallet stub to confirm that no contract-signature callback is honored. Integrations must retain a non-permit path. Anyone may relay a valid permit, so a submitted permit is not proof of a purchase intent and can be consumed before an integration transaction. See the [OpenZeppelin permit integration guidance](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#ERC20Permit).

### I-03 — Transfers to unsuitable destinations are not recoverable

The token rejects the zero address but accepts other nonzero recipients, including the token contract itself or contracts without withdrawal logic. There is no rescue function, payable receive/fallback, or administrator who can reverse a mistaken token transfer. Use destination checks and explicit user confirmation in deployment/distribution tooling; do not send tokens or ETH to the token contract as a funding mechanism.

## 4. Compiler and dependency advisory review

The broad source pragma is not the actual build version. The reviewed Foundry build is pinned to `0.8.30`. However, pinning alone does not prove compiler safety: the current [Solidity known-bug list](https://docs.soliditylang.org/en/latest/bugs.html) and [version mapping](https://github.com/ethereum/solidity/blob/develop/docs/bugs_by_version.json) list four issues for that version.

| Bug | Fixed in | Applicability to this build |
| --- | --- | --- |
| `SOL-2026-3` — inheritance reversal on storage-end warning | 0.8.36 | No custom layout near storage end and no corresponding compiler warning. Trigger absent. |
| `SOL-2026-2` — unsound spill in mutual recursion | 0.8.36 | IR is enabled, but reviewed constructor/runtime call paths contain no recursion. Trigger absent. |
| `SOL-2026-1` — transient-storage clearing helper collision | 0.8.34 | Requires Cancun-or-later and transient clearing; this build targets Paris and uses no transient storage. Trigger absent. |
| `SOL-2025-1` — lost storage-array write on slot overflow | 0.8.32 | No storage-boundary array layout or attacker-growable array; fixed short metadata strings only. No trigger identified. |

No applicable trigger was found in this token; this is a source-specific disposition, not a blanket endorsement of `0.8.30`. Recheck advisories and explicitly approve the compiler choice at release freeze. A compiler upgrade is a separate change requiring rebuild, bytecode re-freeze, and regression tests; no upgrade was silently applied.

The [OpenZeppelin security advisory inventory](https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories) returned 20 public advisories on review. None identified an unresolved issue applicable to the installed `5.4.0` token closure. The `Bytes.lastIndexOf` advisory `GHSA-9rcw-c2f9-2j55` identifies `5.4.0` as patched; `Bytes` is also absent from this import closure. This check cannot detect unpublished vulnerabilities.

## 5. Static-analysis disposition

Slither `0.11.6`, 102 detectors, 23 analyzed contract/interface/library declarations. The explicit-solc run retained dependencies and used no detector/path exclusions. It completed successfully with **55 alerts** and exit code `255` because findings were emitted; it was not a zero-alert or exit-zero scan. An earlier auto-selected Foundry run emitted 52 alerts; the explicit-solc run additionally reported 3 unused inherited helpers.

| Detector | Raw severity / count | Disposition |
| --- | --- | --- |
| `incorrect-exp` | High / 1 | `Math.mulDiv` intentionally uses XOR as a modular-inverse seed; function is unreachable from token entry points and construction. Not an exploitable token issue. |
| `divide-before-multiply` | Medium / 9 | Modular arithmetic in `Math.mulDiv` / `Math.invMod`; neither function is reachable in the token call graph. |
| `shadowing-local` | Low / 1 | `ERC20Permit` constructor parameter `name` shadows the metadata method name; initialization resolves correctly. |
| `timestamp` | Low / 1 | Expected permit deadline comparison. Boundary and expiration tests pass; no price, randomness, or lockup calculation uses it. |
| `assembly` | Informational / 29 | Includes unused imported helpers. Reachable short-string packing, storage-pointer plumbing, and typed-data hashing were reviewed; no arbitrary target/storage input is exposed. |
| `pragma` / `solc-version` | Informational / 1 + 4 | Mixed compatible dependency pragmas; actual compiler pinned and separately assessed above. Do not confuse Slither's bundled bug knowledge with a current advisory check. |
| `dead-code` | Informational / 3 | Unused `Context._msgData`, `_contextSuffixLength`, and `Nonces._useCheckedNonce`; no need to modify the pinned dependency. |
| `naming-convention` / `too-many-digits` | Informational / 4 + 2 | Standard API names and dependency constants. No security remediation identified. |

## 6. Validation and evidence

- [`ULIQToken.t.sol`](./test/uliq/shared/ULIQToken.t.sol): 24 passing tests, including 2 fuzz tests with 1,024 cases each.
- [`ULIQToken.invariant.t.sol`](./test/uliq/shared/ULIQToken.invariant.t.sol): 2 passing invariants, each 256 runs × 128 calls = 32,768 calls; zero handler reverts. Actors are a bounded set of three addresses. Permits are covered by unit tests, not this handler.
- [`ULIQToken.fork.t.sol`](./test/uliq/shared/ULIQToken.fork.t.sol): 1 passing test on Arbitrum One fork block `501967125`; skipped intentionally on the default local chain.
- Full ULIQ regression: **81 passed, 0 failed, 1 intentional fork-test skip**, using 1,024 fuzz cases and 256 × 128 invariant settings. Seed: `0x20260905`.
- Fresh token-only size build passed and matched the subsequent build. A workspace-wide `forge build --sizes` returned exit 1 because the legacy `DeployULIQTestnet` script is 29,237 runtime bytes; the token is 3,518 bytes. This does not fail the token size check, but the workspace-wide size command must not be described as green.
- Initial audit-harness failures were corrected: Foundry reserves the `testFail*` name prefix, and the artificial chain-switch test must retain the original chain using `vm.getChainId()` rather than an optimizer-assumed transaction-constant `block.chainid`. Trace inspection showed the old test restored the wrong chain; the token correctly rejected cross-chain replay. See [Foundry's getter guidance](https://foundry-rs.github.io/foundry/foundry_cheatcodes_spec/Vm/struct.getChainIdCall.html).
- No coverage percentage, formal proof, independent audit, deployed-token match, or complete release-script rehearsal is claimed. Foundry warnings about absent optional invariant-target getters are consistent with the repository's minimal harnesses; actual handler dispatch/call counts and test results were checked.

Commands, public role snapshots, and fork limitations are preserved in the [dated audit evidence](../../docs/archive/tasks/2026-09-05-uliq-token-deployment-audit.md).

## 7. Release gates still open

1. Finalize the downstream allocation/vesting architecture and temporary custody controls for the confirmed initial recipient, Treasury Safe `0x9C96F9AE59e30786fD325EFD969884FC1f751739`. The recipient choice itself was confirmed by Mario on 2026-09-05; it is no longer an unresolved decision.
2. Record signer custody/recovery acceptance, fresh Safe configuration and actual execution evidence, and deployer separation. Admin Safe compatibility reads do not establish a successful Admin Safe execution.
3. Complete the required independent review for the chosen token and applicable allocation/presale/custody scope. This agent report is supplementary evidence.
4. Preserve the existing [ADR-001 Mainnet NO-GO](../../docs/ULIQ_Codex_Implementation_Plan/ADR_001_LEGAL_PRESALE_MODEL.md) until its responsible owners explicitly close it. This is a repository release gate, not a new legal determination by this review.
5. Add and review an explicitly authorized, chain-guarded Mainnet deployment procedure. Freeze source commit, compiler/settings, dependencies, complete creation payload, constructor arguments, deployer, expected address/nonce, funding/gas margin, and restart/partial-deployment reconciliation. Existing ULIQ scripts remain testnet/local-only.
6. After a separately authorized deployment, verify explorer/source/constructor/runtime identity, mint event, exact recipient balance and supply, EIP-712 domain, and documented receipt/finality state. Do not automatically fund presales, distribute inventory, approve spenders, or activate sales.

Any change to source, dependency, compiler, optimizer, target chain, or allocation architecture requires checking this review's applicability again. No production transaction, deployment, Safe configuration change, commit, or push was performed for this audit.
