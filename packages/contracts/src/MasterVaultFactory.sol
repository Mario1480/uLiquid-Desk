// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MasterVault} from "./MasterVault.sol";

contract MasterVaultFactory {
  address public immutable usdc;
  mapping(address => address) public masterVaultOf;

  event MasterVaultCreated(address indexed owner, address indexed masterVault);

  constructor(address usdc_) {
    require(usdc_ != address(0), "usdc_required");
    usdc = usdc_;
  }

  function createMasterVault(address owner) external returns (address masterVault) {
    require(owner != address(0), "owner_required");
    require(masterVaultOf[owner] == address(0), "master_vault_exists");
    MasterVault vault = new MasterVault(owner, usdc, address(this));
    masterVault = address(vault);
    masterVaultOf[owner] = masterVault;
    emit MasterVaultCreated(owner, masterVault);
  }
}
