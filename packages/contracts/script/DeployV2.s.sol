// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScriptBase} from "./ScriptBase.sol";
import {MasterVaultFactoryV2} from "../src/MasterVaultFactoryV2.sol";
import {MasterVaultV2} from "../src/MasterVaultV2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract DeployV2 is ScriptBase {
  uint256 internal constant DEFAULT_PROFIT_SHARE_FEE_RATE_PCT = 30;

  event DeploymentV2Completed(
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

    MasterVaultFactoryV2 deployedFactory =
      new MasterVaultFactoryV2(resolvedOwner, resolvedUsdc, resolvedOwner, DEFAULT_PROFIT_SHARE_FEE_RATE_PCT);
    address deployedMasterVault = deployedFactory.createMasterVault(resolvedOwner);
    require(deployedFactory.owner() == resolvedOwner, "factory_owner_mismatch");
    require(deployedFactory.usdc() == resolvedUsdc, "factory_usdc_mismatch");
    require(deployedFactory.treasuryRecipient() == resolvedOwner, "treasury_recipient_mismatch");
    require(
      deployedFactory.profitShareFeeRatePct() == DEFAULT_PROFIT_SHARE_FEE_RATE_PCT,
      "factory_fee_rate_mismatch"
    );
    require(keccak256(bytes(deployedFactory.factoryVersion())) == keccak256(bytes("v2")), "factory_version_mismatch");
    require(
      deployedFactory.masterVaultOf(resolvedOwner) == deployedMasterVault,
      "master_vault_mapping_mismatch"
    );

    MasterVaultV2 deployedVault = MasterVaultV2(deployedMasterVault);
    require(deployedVault.owner() == resolvedOwner, "master_owner_mismatch");
    require(deployedVault.usdc() == resolvedUsdc, "master_usdc_mismatch");
    require(deployedVault.factory() == address(deployedFactory), "master_factory_mismatch");
    vm.stopBroadcast();

    emit DeploymentV2Completed(
      resolvedOwner,
      resolvedUsdc,
      address(deployedFactory),
      deployedMasterVault,
      deployMockUsdc
    );
    return (resolvedUsdc, address(deployedFactory), deployedMasterVault);
  }
}
