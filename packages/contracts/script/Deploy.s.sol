// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ScriptBase} from "./ScriptBase.sol";
import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MasterVault} from "../src/MasterVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract Deploy is ScriptBase {
  uint256 internal constant DEFAULT_PROFIT_SHARE_FEE_RATE_PCT = 30;
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
      require(usdc.code.length > 0, "usdc_not_contract");
      resolvedUsdc = usdc;
    }

    MasterVaultFactory deployedFactory =
      new MasterVaultFactory(resolvedOwner, resolvedUsdc, resolvedOwner, DEFAULT_PROFIT_SHARE_FEE_RATE_PCT);
    address deployedMasterVault = deployedFactory.createMasterVault(resolvedOwner);
    require(deployedFactory.owner() == resolvedOwner, "factory_owner_mismatch");
    require(deployedFactory.usdc() == resolvedUsdc, "factory_usdc_mismatch");
    require(deployedFactory.treasuryRecipient() == resolvedOwner, "treasury_recipient_mismatch");
    require(
      deployedFactory.profitShareFeeRatePct() == DEFAULT_PROFIT_SHARE_FEE_RATE_PCT,
      "factory_fee_rate_mismatch"
    );
    require(
      deployedFactory.masterVaultOf(resolvedOwner) == deployedMasterVault,
      "master_vault_mapping_mismatch"
    );

    MasterVault deployedVault = MasterVault(deployedMasterVault);
    require(deployedVault.owner() == resolvedOwner, "master_owner_mismatch");
    require(deployedVault.usdc() == resolvedUsdc, "master_usdc_mismatch");
    require(deployedVault.factory() == address(deployedFactory), "master_factory_mismatch");
    vm.stopBroadcast();

    emit DeploymentCompleted(resolvedOwner, resolvedUsdc, address(deployedFactory), deployedMasterVault, deployMockUsdc);
    return (resolvedUsdc, address(deployedFactory), deployedMasterVault);
  }
}
