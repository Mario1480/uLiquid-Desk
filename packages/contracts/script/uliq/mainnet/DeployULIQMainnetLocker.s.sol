// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScriptBase} from "../../ScriptBase.sol";
import {ULIQMainnetLocker} from "../../../src/uliq/mainnet/ULIQMainnetLocker.sol";

/// @notice Deploys only the ULIQ Mainnet locker; does not fund, approve, configure or activate an application.
contract DeployULIQMainnetLocker is ScriptBase {
    event MainnetLockerDeployed(address indexed locker, address indexed token);

    function run() external returns (address lockerAddress) {
        // Constructor enforces Arbitrum One and the existing token before deployment can succeed.
        vm.startBroadcast();
        ULIQMainnetLocker locker = new ULIQMainnetLocker();
        vm.stopBroadcast();
        lockerAddress = address(locker);
        emit MainnetLockerDeployed(lockerAddress, address(locker.token()));
    }
}
