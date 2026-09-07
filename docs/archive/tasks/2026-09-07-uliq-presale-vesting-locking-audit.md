# ULIQ presale, vesting and locking audit evidence

Date: 2026-09-07. User-authorized scope: internal smart-contract audit and entry of the verified ULIQ address. No deployment, broadcast, live configuration, migration or activation was performed.

- Reviewed contract revision: `f51e0c1309c0bdbdf36c5938e345d586bf325efb` on `codex/einui-desk-integration`; clean initial worktree.
- Current conclusions and open remediation: [ULIQ Presale, Vesting and Locking Review](../../../packages/contracts/ULIQ_PRESALE_VESTING_LOCKING_REVIEW.md).
- Contract source remained unchanged. New tests and documents are local, uncommitted additions at completion.
- Baseline ULIQ suite: 81 passed, 0 failed, 1 optional fork test skipped.
- `forge test --match-contract ULIQAuditRegressionTest -vv`: 7 passed. The expired-READY regression deliberately confirms the existing defect, not a fix.
- Final `npm -w packages/contracts run test:uliq`: 88 passed, 0 failed, 2 optional fork tests skipped, 90 total across 11 suites.
- `forge test --match-contract ULIQDeployedTokenForkAuditTest --fork-url https://arb1.arbitrum.io/rpc --fork-block-number 502625136 -vv`: 1 passed. This test uses actual deployed ULIQ, candidate contracts in local fork state, mock USDC and Treasury Safe impersonation. No signature or transaction was submitted.
- The first fork harness run failed because a getter consumed a one-call impersonation before approval. The harness now reads the amount before impersonation; the fresh fork run passed. This was a test-fixture correction, not a deployed-token defect.
- `npm -w packages/contracts run build`: exit 0, existing Forge lint warnings remain.
- `git diff --check`: exit 0; both added Solidity files formatted with `forge fmt`.
- Native USDC address checked against Circle's documentation; `decimals()` returned 6 at the same read-only block. Full native-USDC transfer behavior and its proxy/issuer implementation were not audited.
- ULIQ read-only evidence at finalized Arbitrum One block `502625136`: address `0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd`, 18 decimals, one-billion total supply and same Treasury Safe balance. Creation receipt succeeded at block `501976598`. Runtime Keccak-256: `0x91e14e66bf769f2f0b89d8a7ef547f5c8c5b68fe43f7063c7f289b2030b46732`.
- Public ULIQ token metadata already existed in `.env.example` and the web deployment constant. Added it to `.env.prod.example` and current contract handoff/role documentation. All enablement flags and the Sepolia namespace remain unchanged.
- Security scan ID: `91fc3376-3351-4570-82c9-9c9a997bf067`; independent source baseline, architecture mapping and focused custody/vesting review were completed. No adversarial theft or privilege-gain finding was confirmed. R-01 remains a confirmed medium operational defect and release blocker. Generated scan artifacts retain this distinction and partial package coverage.
- Security preflight was ready with the available three worker slots. Automatic config discovery initially encountered the repository's existing empty `.codex` file; explicitly selecting the existing user config resolved discovery without editing configuration. The TAC advisory connector was unavailable and did not gate source review. Slither was unavailable; no scanner-clean or measured-token-usage claim is made.
- The repository post-edit hook referenced missing `/hooks/validate-schema.py`. Edits were present and independently checked using file/diff inspection, formatting, Foundry execution and `git diff --check`; hook errors were not interpreted as absent edits.

This evidence does not close ADR-001, cancellation/safeguarding, Mainnet locker, Team/manual vesting, final graph/Safe configuration, independent audit or release gates. No commit, push or deployment was performed.
