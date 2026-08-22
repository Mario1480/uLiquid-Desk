// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Faucet-style six-decimal USDC mock for local and Arbitrum Sepolia ULIQ testing only.
contract ULIQMockUSDC is ERC20 {
    constructor() ERC20("ULIQ Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}
