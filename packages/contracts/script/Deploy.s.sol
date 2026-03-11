// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScriptBase} from "./ScriptBase.sol";
import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract Deploy is ScriptBase {
  event DeploymentCompleted(
    address indexed owner,
    address indexed usdc,
    address indexed factory,
    address masterVault,
    bool deployedMockUsdc
  );

  function runLocal(address owner) external returns (address usdc, address factory, address masterVault) {
    return _run(owner, address(0), true);
  }

  function runDevnet(address owner, address usdc) external returns (address factory, address masterVault) {
    (, address deployedFactory, address deployedMasterVault) = _run(owner, usdc, false);
    return (deployedFactory, deployedMasterVault);
  }

  function _run(address owner, address usdc, bool deployMockUsdc)
    private
    returns (address resolvedUsdc, address factory, address masterVault)
  {
    vm.startBroadcast();
    address resolvedOwner = owner == address(0) ? msg.sender : owner;
    if (deployMockUsdc) {
      MockUSDC mock = new MockUSDC();
      resolvedUsdc = address(mock);
      mock.mint(resolvedOwner, 1_000_000_000_000);
    } else {
      require(usdc != address(0), "usdc_required");
      resolvedUsdc = usdc;
    }

    MasterVaultFactory deployedFactory = new MasterVaultFactory(resolvedOwner, resolvedUsdc, resolvedOwner);
    address deployedMasterVault = deployedFactory.createMasterVault(resolvedOwner);
    vm.stopBroadcast();

    emit DeploymentCompleted(resolvedOwner, resolvedUsdc, address(deployedFactory), deployedMasterVault, deployMockUsdc);
    return (resolvedUsdc, address(deployedFactory), deployedMasterVault);
  }
}
