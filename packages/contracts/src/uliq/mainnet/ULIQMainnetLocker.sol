// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ULIQLocker} from "../legacy-testnet/ULIQLocker.sol";

/// @title ULIQ Arbitrum One Utility Locker
/// @notice Pins the reviewed, network-neutral locking logic to the existing Mainnet ULIQ token.
/// @dev Reuses the legacy implementation without changing lock accounting or beneficiary rights.
contract ULIQMainnetLocker is ULIQLocker {
    uint256 public constant CHAIN_ID = 42161;
    address public constant ULIQ_TOKEN = 0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd;

    error UnsupportedChain(uint256 chainId);
    error InvalidMainnetToken();

    constructor() ULIQLocker(ULIQ_TOKEN) {
        if (block.chainid != CHAIN_ID) revert UnsupportedChain(block.chainid);
        if (ULIQ_TOKEN.code.length == 0) revert InvalidMainnetToken();
        if (IERC20Metadata(ULIQ_TOKEN).decimals() != 18) revert InvalidMainnetToken();
    }
}
