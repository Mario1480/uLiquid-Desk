// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScriptBase} from "../ScriptBase.sol";
import {ULIQLocker} from "../../src/uliq/ULIQLocker.sol";

/// @notice Deploys only the ADR-008 locker while preserving the existing ULIQ testnet suite.
contract DeployULIQLockerTestnet is ScriptBase {
    uint256 public constant ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;
    uint256 public constant LOCAL_CHAIN_ID = 31_337;

    error UnsupportedChain(uint256 chainId);
    error InvalidToken(address token);

    event ULIQLockerTestnetDeploymentCompleted(
        uint256 indexed chainId, address indexed token, address indexed locker
    );

    function run(address tokenAddress) external returns (address lockerAddress) {
        if (block.chainid != ARBITRUM_SEPOLIA_CHAIN_ID && block.chainid != LOCAL_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        if (tokenAddress == address(0) || tokenAddress.code.length == 0) {
            revert InvalidToken(tokenAddress);
        }

        vm.startBroadcast();
        ULIQLocker locker = new ULIQLocker(tokenAddress);
        vm.stopBroadcast();

        lockerAddress = address(locker);
        emit ULIQLockerTestnetDeploymentCompleted(block.chainid, tokenAddress, lockerAddress);
    }
}
