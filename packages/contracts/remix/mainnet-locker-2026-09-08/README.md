# ULIQ Mainnet locker deployment package

Deployed through Remix and Mario's MetaMask wallet on Arbitrum One on 2026-09-08.

- Contract: `ULIQMainnetLocker`
- Address: `0x1ADDA264ee63Ca0Be4400277c9dfA9896a897BC9`
- Creation transaction: `0xf7092a13358a930c20ad74def4b74ea7e6ac13b8f945ad3a4a918c905300de00`
- Creation block: `503067324`
- Deployer: `0x89473caAb2d0d5aC4B0fcCd45B0348E65307810E`, nonce `9`
- Compiler: Solidity `0.8.30+commit.73712a01`, optimizer enabled with 200 runs, via IR, EVM Paris, IPFS metadata
- Constructor arguments: none; transaction value: zero
- Runtime code hash: `0xecb33880f0a1c4e15b2a806dee87461e01a4ef6b2d67869ee3f79cd52e5f2047`

`ULIQMainnetLocker.sol` is the flattened source uploaded to Remix. `standard-input.json` and `compiled-locker.json` retain the exact local compiler input/output. `preparation.json` is the historical pre-deployment check; the actual deployment is recorded separately in `mainnet-deployment.json`.

The creation transaction input exactly matched the locally compiled creation bytecode. The deployed runtime exactly matched the compiled runtime after inserting the immutable ULIQ token address. Both comparisons include metadata. The local ABI and executable runtime excluding metadata also matched the repository build. The four Mainnet locker contract tests passed before deployment.

At the recorded observation, the official Arbitrum RPC and Blast RPC agreed on the receipt, runtime code hash, token, chain, durations and zero locked/token balances. The deployment block was not yet finalized: finalized block `503063924`, safe block `503065206`. Receipt success and source verification do not satisfy the separate finalized runtime preflight.

Remix reported successful verification on [Sourcify](https://repo.sourcify.dev/42161/0x1ADDA264ee63Ca0Be4400277c9dfA9896a897BC9/) and [Blockscout](https://arbitrum.blockscout.com/address/0x1ADDA264ee63Ca0Be4400277c9dfA9896a897BC9?tab=contract). Etherscan verification was skipped because no API key was supplied.

`deployment.env.example` contains the public deployment identity with all application gates disabled. Supply suitable RPC URLs privately and run the read-only preflight after finalization. No runtime environment, app deployment, indexing, token approval, lock or extension was activated by this deployment.
