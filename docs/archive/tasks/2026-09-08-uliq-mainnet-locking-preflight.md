# ULIQ Mainnet locking — configuration and preflight evidence

Date: 2026-09-08. Scope: local step 1 of the [active rollout](../../../packages/contracts/ULIQ_MAINNET_LOCKING_ROLLOUT.md).

## Implemented

- Independent Mainnet configuration and a read-only CLI for deployment receipt, finality, token, term and solvency reconciliation using two RPCs.
- Regression coverage for unsafe configuration, namespace separation, wrong chain, RPC disagreement, unfinalized deployment, wrong/reverted receipts, missing code, wrong token/decimals/terms and insufficient backing.
- A configuration template and an active rollout plan linked from the documentation index.

The existing Sepolia configuration and routes are unchanged. No new service is registered in API bootstrap or indexing jobs; browser and billing integration remain pending.

## Verification

| Check | Result |
| --- | --- |
| `node node_modules/tsx/dist/cli.mjs --test apps/api/src/uliq/mainnetLocking.test.ts apps/api/src/uliq/config.test.ts apps/api/src/uliq/rpc.test.ts` | 16 passed, 0 failed |
| `npm -w apps/api run typecheck` | Passed, including after new tests were added |
| `forge test --match-contract ULIQMainnetLockerTest -vv` from `packages/contracts` | 4 passed, 0 failed |
| Mainnet deployment script simulation | Passed without broadcast or wallet configuration |
| `git diff --check` | Passed |

Node: v20.20.2. Mainnet RPC `finalized` observation: block `503048564`, hash `0x8f9f33fb9f3ba158d585b1ff62be1cfcc37c5894791d327a6bd43fb3aa209cf3` via `https://arb1.arbitrum.io/rpc`. Simulation command from `packages/contracts`:

```bash
forge script script/uliq/mainnet/DeployULIQMainnetLocker.s.sol:DeployULIQMainnetLocker \
  --rpc-url https://arb1.arbitrum.io/rpc \
  --fork-block-number 503048564 --non-interactive
```

Forge reported `Script ran successfully` and `SIMULATION COMPLETE`. The result is local fork evidence only; its simulated address must not be configured as a Mainnet deployment. The estimated gas was 788615 including the script's estimate allowance; this is not a paid fee or a final execution quote.

Existing Forge source-parser, cache and external source-lookup warnings did not fail the simulation. The repository post-edit hook reported missing `/hooks/validate-schema.py`; edits were present and independently checked with TypeScript, tests and diff inspection.

## Remaining evidence

The new post-deployment CLI has fixture-based validation only because no actual Mainnet locker deployment address/receipt was supplied. Source verification, real two-provider reconciliation, API/indexer/UI integration, application release and activation remain open in the active rollout. No real transaction, token approval, lock, deployment, environment switch, database migration, commit or push occurred in this step.
