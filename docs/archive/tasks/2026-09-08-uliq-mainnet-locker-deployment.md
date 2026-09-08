# ULIQ Mainnet locker deployment evidence

Date: 2026-09-08. Scope: the explicitly authorized Remix/MetaMask contract deployment. Application release and activation are separate.

The deployment succeeded at Arbitrum One block `503067324`, transaction `0xf7092a13358a930c20ad74def4b74ea7e6ac13b8f945ad3a4a918c905300de00`. The actual locker address is `0x1ADDA264ee63Ca0Be4400277c9dfA9896a897BC9`.

See the [frozen package and verification details](../../../packages/contracts/remix/mainnet-locker-2026-09-08/README.md), [machine-readable observations](../../../packages/contracts/remix/mainnet-locker-2026-09-08/mainnet-deployment.json) and [disabled deployment configuration](../../../packages/contracts/remix/mainnet-locker-2026-09-08/deployment.env.example).

## Verified

- Local Mainnet locker contract tests passed. Solidity 0.8.30, optimizer 200, via IR and Paris were checked in Remix's compiler configuration before deployment.
- MetaMask showed the Deployment Wallet, Arbitrum and a contract creation request with no token transfer. Mario completed the wallet confirmation; the agent did not click the final wallet confirmation.
- Successful direct creation receipt from the expected deployer at nonce 9, value zero, gas used 590158. Official Arbitrum and Blast RPCs agree on the creation block/hash/address and runtime identity.
- Creation input and deployed runtime exactly match the local flattened compiler output, including metadata and the immutable token address.
- Both RPCs report chain 42161, the expected ULIQ token, 18 decimals, terms of 32/185/367 days, totalLocked zero and locker token balance zero at the creation block.
- Remix reports successful source verification on Sourcify and Blockscout. Etherscan was skipped without an API key.

## Initial pending state and operational observations

- At 15:41:20 UTC, both RPCs reported finalized block 503063924 and safe block 503065206, below the creation block. Finalized preflight remains pending; this is not a failed deployment and must not trigger another deployment.
- The read-only `npm -w apps/api run uliq:mainnet-locking:preflight` was executed with the actual deployment values and official/Blast RPC pair. It correctly stopped with `uliq_mainnet_locking_deployment_not_finalized`. Deployment artifact consistency checks and `git diff --check` passed.
- PublicNode rejected the new receipt request as requiring authenticated archive access. dRPC returned the matching receipt but a later backend request reached a provider usage limit. Blast completed the full second-provider comparison. Select runtime RPCs that can serve the required historical blocks and logs.
- Public identity values are saved in a disabled configuration artifact. Production environment files, app deployment, API/indexer gates, public locking, approvals, locks, extensions and discount eligibility were not changed.
- No commit or push was performed in this step. The repository still contains the local integration work from steps 1 and 2.

## Finalized reconciliation and authorized production configuration

The finalized preflight subsequently passed and was repeated successfully when recording production configuration on 2026-09-08. Both official Arbitrum and Blast RPCs agreed on finalized block `503069869`, hash `0x25197df077c80a42e3a4f2284b45166e1fa2cd3894e22a0f6eaaa6cf277f7ceb`. Result: `deployment_reconciled`. Runtime code hash matched the independently verified deployment package; locked principal and token balance remained zero. The earlier deployment manifest retains its historical pending observation.

At Mario's explicit request, five public identity values (chain, locker address, creation hash, creation block and runtime code hash) and five disabled Mainnet locking flags were appended to `/opt/uliquid-desk/.env.prod` at 16:08:33 UTC. All ten values were read back and verified, and the complete pre-existing file content was preserved byte for byte. The prior environment was backed up under `/root/uliquid-config-backups/` with directory mode 0700 and file mode 0600; no environment secrets were printed or copied into the repository.

This is stored production configuration only. No container was recreated, no application code was released, and no locking feature was activated. The independent runtime RPC URLs remain unset and must be configured before application release. Existing presale and legacy locking namespaces were not modified. No commit or push was performed.
