// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract UnauthorizedTreasuryUpdater {
  function trySetTreasuryRecipient(address factory, address nextRecipient) external returns (bool ok) {
    (ok,) = factory.call(abi.encodeWithSelector(MasterVaultFactory.setTreasuryRecipient.selector, nextRecipient));
  }
}

contract FactoryTest {
  function testCreateMasterVaultOnlyOncePerOwner() public {
    MockUSDC usdc = new MockUSDC();
    address treasury = address(0xBEEF);
    MasterVaultFactory factory = new MasterVaultFactory(address(this), address(usdc), treasury);

    address masterVault = factory.createMasterVault(address(this));
    require(masterVault != address(0), "vault_not_created");
    require(factory.masterVaultOf(address(this)) == masterVault, "mapping_not_set");
    require(factory.usdc() == address(usdc), "factory_usdc_not_set");
    require(factory.owner() == address(this), "factory_owner_not_set");
    require(factory.treasuryRecipient() == treasury, "treasury_not_set");

    (bool ok,) = address(factory).call(abi.encodeWithSelector(MasterVaultFactory.createMasterVault.selector, address(this)));
    require(!ok, "second_vault_should_revert");
  }

  function testOnlyOwnerCanUpdateTreasuryRecipient() public {
    MockUSDC usdc = new MockUSDC();
    MasterVaultFactory factory = new MasterVaultFactory(address(this), address(usdc), address(0xBEEF));
    UnauthorizedTreasuryUpdater unauthorized = new UnauthorizedTreasuryUpdater();

    factory.setTreasuryRecipient(address(0xCAFE));
    require(factory.treasuryRecipient() == address(0xCAFE), "treasury_not_updated");

    bool ok = unauthorized.trySetTreasuryRecipient(address(factory), address(0xF00D));
    require(!ok, "non_owner_call_should_revert");
  }
}
