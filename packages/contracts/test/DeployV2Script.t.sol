// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployV2} from "../script/DeployV2.s.sol";
import {MasterVaultFactoryV2} from "../src/MasterVaultFactoryV2.sol";
import {MasterVaultV2} from "../src/MasterVaultV2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract DeployV2ScriptTest {
  function testRunLocalDeploysMockUsdcAndWiresOwnership() public {
    DeployV2 deployScript = new DeployV2();
    address designatedOwner = address(0xA11CE);

    (address usdc, address factory, address masterVault) = deployScript.runLocal(designatedOwner);

    require(usdc != address(0), "local_usdc_missing");
    require(factory != address(0), "factory_missing");
    require(masterVault != address(0), "master_vault_missing");
    require(MockUSDC(usdc).balanceOf(designatedOwner) == 1_000_000_000_000, "owner_not_prefunded");

    MasterVaultFactoryV2 deployedFactory = MasterVaultFactoryV2(factory);
    MasterVaultV2 deployedVault = MasterVaultV2(masterVault);

    require(deployedFactory.owner() == designatedOwner, "factory_owner_wrong");
    require(deployedFactory.usdc() == usdc, "factory_usdc_wrong");
    require(deployedFactory.treasuryRecipient() == designatedOwner, "treasury_wrong");
    require(keccak256(bytes(deployedFactory.factoryVersion())) == keccak256(bytes("v2")), "factory_version_wrong");
    require(deployedFactory.masterVaultOf(designatedOwner) == masterVault, "factory_mapping_wrong");
    require(deployedVault.owner() == designatedOwner, "master_owner_wrong");
    require(deployedVault.usdc() == usdc, "master_usdc_wrong");
    require(deployedVault.factory() == factory, "master_factory_wrong");
  }

  function testRunDevnetRejectsZeroUsdc() public {
    DeployV2 deployScript = new DeployV2();
    (bool ok,) = address(deployScript).call(
      abi.encodeWithSelector(DeployV2.runDevnet.selector, address(0xBEEF), address(0))
    );
    require(!ok, "zero_usdc_should_revert");
  }

  function testRunDevnetRejectsNonContractUsdc() public {
    DeployV2 deployScript = new DeployV2();
    (bool ok,) = address(deployScript).call(
      abi.encodeWithSelector(DeployV2.runDevnet.selector, address(0xBEEF), address(0x1234))
    );
    require(!ok, "eoa_usdc_should_revert");
  }

  function testRunDevnetUsesProvidedUsdcWithoutMockMint() public {
    DeployV2 deployScript = new DeployV2();
    MockUSDC usdc = new MockUSDC();
    address designatedOwner = address(0xCAFE);

    (address factory, address masterVault) = deployScript.runDevnet(designatedOwner, address(usdc));

    MasterVaultFactoryV2 deployedFactory = MasterVaultFactoryV2(factory);
    MasterVaultV2 deployedVault = MasterVaultV2(masterVault);

    require(deployedFactory.usdc() == address(usdc), "factory_usdc_wrong");
    require(deployedFactory.treasuryRecipient() == designatedOwner, "treasury_wrong");
    require(deployedFactory.masterVaultOf(designatedOwner) == masterVault, "factory_mapping_wrong");
    require(keccak256(bytes(deployedFactory.factoryVersion())) == keccak256(bytes("v2")), "factory_version_wrong");
    require(deployedVault.owner() == designatedOwner, "master_owner_wrong");
    require(deployedVault.usdc() == address(usdc), "master_usdc_wrong");
    require(usdc.totalSupply() == 0, "devnet_should_not_mint_mock_liquidity");
  }
}
