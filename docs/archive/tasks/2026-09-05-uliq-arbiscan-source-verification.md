# ULIQ Arbiscan source verification

Date: 2026-09-05. Scope: user-authorized source publication through Chrome; no onchain transaction or wallet signature performed.

- Network: Arbitrum One, chain ID `42161`.
- Token: `0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd`.
- Creation transaction: `0xf5aa71e7973adf3f5f35ba4f8689f94dc7d0f853f65e80cb2a42dcc671671c7a`.
- Constructor recipient: `0x9C96F9AE59e30786fD325EFD969884FC1f751739`.
- Compiler: `v0.8.30+commit.73712a01`; optimizer enabled, 200 runs; via IR; Paris EVM; IPFS metadata; MIT license.
- Submitted Standard JSON Input contains 21 literal-content sources, with `contracts/ULIQToken.sol` and explicitly versioned `@openzeppelin/contracts@5.4.0/` dependency paths matching Remix.
- A local recompilation of the submission matched the onchain creation bytecode exactly, including metadata, excluding only the separately ABI-encoded constructor argument.
- Arbiscan submission returned: "Successfully generated matching Bytecode and ABI for Contract Address".
- The resulting [contract page](https://arbiscan.io/address/0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd#code) displayed "Source Code Verified" and "Exact Match".
- Remix additionally reported successful Sourcify and Blockscout verification; these messages were observed, not separately reverified in this task.

## Remaining work

Arbiscan account login, creator-address ownership verification, and logo/token-profile submission remain pending. The login page was opened for Mario. Source verification establishes source/bytecode correspondence, not an independent security audit or presale release approval. No presale, funding, custody, or trading gate was changed.
