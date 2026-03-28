// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract UnauthorizedTreasuryUpdater {
  function trySetTreasuryRecipient(address factory, address nextRecipient) external returns (bool ok) {
    (ok,) = factory.call(abi.encodeWithSelector(MasterVaultFactory.setTreasuryRecipient.selector, nextRecipient));
  }

  function trySetProfitShareFeeRatePct(address factory, uint256 nextRatePct) external returns (bool ok) {
    (ok,) = factory.call(abi.encodeWithSelector(MasterVaultFactory.setProfitShareFeeRatePct.selector, nextRatePct));
  }
}

contract FactoryTest {
  function testCreateMasterVaultOnlyOncePerOwner() public {
    MockUSDC usdc = new MockUSDC();
    address treasury = address(0xBEEF);
    MasterVaultFactory factory = new MasterVaultFactory(address(this), address(usdc), treasury, 30);

    address masterVault = factory.createMasterVault(address(this));
    require(masterVault != address(0), "vault_not_created");
    require(factory.masterVaultOf(address(this)) == masterVault, "mapping_not_set");
    require(factory.usdc() == address(usdc), "factory_usdc_not_set");
    require(factory.owner() == address(this), "factory_owner_not_set");
    require(factory.treasuryRecipient() == treasury, "treasury_not_set");
    require(factory.profitShareFeeRatePct() == 30, "fee_rate_not_set");

    (bool ok,) = address(factory).call(abi.encodeWithSelector(MasterVaultFactory.createMasterVault.selector, address(this)));
    require(!ok, "second_vault_should_revert");
  }

  function testOnlyOwnerCanUpdateTreasuryRecipient() public {
    MockUSDC usdc = new MockUSDC();
    MasterVaultFactory factory = new MasterVaultFactory(address(this), address(usdc), address(0xBEEF), 30);
    UnauthorizedTreasuryUpdater unauthorized = new UnauthorizedTreasuryUpdater();

    factory.setTreasuryRecipient(address(0xCAFE));
    require(factory.treasuryRecipient() == address(0xCAFE), "treasury_not_updated");

    bool ok = unauthorized.trySetTreasuryRecipient(address(factory), address(0xF00D));
    require(!ok, "non_owner_call_should_revert");
  }

  function testOnlyOwnerCanUpdateProfitShareFeeRate() public {
    MockUSDC usdc = new MockUSDC();
    MasterVaultFactory factory = new MasterVaultFactory(address(this), address(usdc), address(0xBEEF), 30);
    UnauthorizedTreasuryUpdater unauthorized = new UnauthorizedTreasuryUpdater();

    factory.setProfitShareFeeRatePct(20);
    require(factory.profitShareFeeRatePct() == 20, "fee_rate_not_updated");

    bool ok = unauthorized.trySetProfitShareFeeRatePct(address(factory), 10);
    require(!ok, "non_owner_fee_rate_call_should_revert");
  }

  function testRejectsInvalidProfitShareFeeRate() public {
    MockUSDC usdc = new MockUSDC();

    (bool constructorOk,) =
      address(this).call(abi.encodeWithSignature("deployFactory(address)", address(usdc)));
    require(!constructorOk, "constructor_should_revert_for_invalid_rate");

    MasterVaultFactory factory = new MasterVaultFactory(address(this), address(usdc), address(0xBEEF), 30);
    (bool updateOk,) = address(factory).call(
      abi.encodeWithSelector(MasterVaultFactory.setProfitShareFeeRatePct.selector, 101)
    );
    require(!updateOk, "invalid_fee_rate_update_should_revert");
  }

  function deployFactory(address usdc) external returns (MasterVaultFactory) {
    return new MasterVaultFactory(address(this), usdc, address(0xBEEF), 101);
  }
}
