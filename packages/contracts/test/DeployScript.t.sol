// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Deploy} from "../script/Deploy.s.sol";
import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MasterVault} from "../src/MasterVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract DeployScriptTest {
  function testRunLocalDeploysMockUsdcAndWiresOwnership() public {
    Deploy deployScript = new Deploy();
    address designatedOwner = address(0xA11CE);

    (address usdc, address factory, address masterVault) = deployScript.runLocal(designatedOwner);

    require(usdc != address(0), "local_usdc_missing");
    require(factory != address(0), "factory_missing");
    require(masterVault != address(0), "master_vault_missing");
    require(MockUSDC(usdc).balanceOf(designatedOwner) == 1_000_000_000_000, "owner_not_prefunded");

    MasterVaultFactory deployedFactory = MasterVaultFactory(factory);
    MasterVault deployedVault = MasterVault(masterVault);

    require(deployedFactory.owner() == designatedOwner, "factory_owner_wrong");
    require(deployedFactory.usdc() == usdc, "factory_usdc_wrong");
    require(deployedFactory.treasuryRecipient() == designatedOwner, "treasury_wrong");
    require(deployedFactory.masterVaultOf(designatedOwner) == masterVault, "factory_mapping_wrong");
    require(deployedVault.owner() == designatedOwner, "master_owner_wrong");
    require(deployedVault.usdc() == usdc, "master_usdc_wrong");
    require(deployedVault.factory() == factory, "master_factory_wrong");
  }

  function testRunDevnetRejectsZeroUsdc() public {
    Deploy deployScript = new Deploy();
    (bool ok,) = address(deployScript).call(
      abi.encodeWithSelector(Deploy.runDevnet.selector, address(0xBEEF), address(0))
    );
    require(!ok, "zero_usdc_should_revert");
  }

  function testRunDevnetRejectsNonContractUsdc() public {
    Deploy deployScript = new Deploy();
    (bool ok,) = address(deployScript).call(
      abi.encodeWithSelector(Deploy.runDevnet.selector, address(0xBEEF), address(0x1234))
    );
    require(!ok, "eoa_usdc_should_revert");
  }

  function testRunDevnetUsesProvidedUsdcWithoutMockMint() public {
    Deploy deployScript = new Deploy();
    MockUSDC usdc = new MockUSDC();
    address designatedOwner = address(0xCAFE);

    (address factory, address masterVault) = deployScript.runDevnet(designatedOwner, address(usdc));

    MasterVaultFactory deployedFactory = MasterVaultFactory(factory);
    MasterVault deployedVault = MasterVault(masterVault);

    require(deployedFactory.usdc() == address(usdc), "factory_usdc_wrong");
    require(deployedFactory.treasuryRecipient() == designatedOwner, "treasury_wrong");
    require(deployedFactory.masterVaultOf(designatedOwner) == masterVault, "factory_mapping_wrong");
    require(deployedVault.owner() == designatedOwner, "master_owner_wrong");
    require(deployedVault.usdc() == address(usdc), "master_usdc_wrong");
    require(usdc.totalSupply() == 0, "devnet_should_not_mint_mock_liquidity");
  }
}
