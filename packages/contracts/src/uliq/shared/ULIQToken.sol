// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title uLiquid Token
/// @notice Network-neutral fixed-supply utility token for ULIQ.
/// @dev Shared by the legacy testnet MVP and the two-round presale review package. The complete supply is minted once.
/// This contract has no mint authority or proxy hooks.
contract ULIQToken is ERC20, ERC20Burnable, ERC20Permit {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    error ZeroAllocationController();

    constructor(address allocationController)
        ERC20("uLiquid Token", "ULIQ")
        ERC20Permit("uLiquid Token")
    {
        if (allocationController == address(0)) revert ZeroAllocationController();
        _mint(allocationController, MAX_SUPPLY);
    }
}
