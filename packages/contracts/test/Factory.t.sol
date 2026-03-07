// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract FactoryTest {
  function testCreateMasterVaultOnlyOncePerOwner() public {
    MockUSDC usdc = new MockUSDC();
    MasterVaultFactory factory = new MasterVaultFactory(address(usdc));

    address masterVault = factory.createMasterVault(address(this));
    require(masterVault != address(0), "vault_not_created");
    require(factory.masterVaultOf(address(this)) == masterVault, "mapping_not_set");
    require(factory.usdc() == address(usdc), "factory_usdc_not_set");

    (bool ok,) = address(factory).call(abi.encodeWithSelector(MasterVaultFactory.createMasterVault.selector, address(this)));
    require(!ok, "second_vault_should_revert");
  }
}
