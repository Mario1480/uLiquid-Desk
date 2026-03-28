// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MasterVault} from "../src/MasterVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract VaultOwnerActor {
  function approveAndDeposit(address token, address masterVault, uint256 amount) external {
    bool approved = MockUSDC(token).approve(masterVault, amount);
    require(approved, "approve_failed");
    MasterVault(masterVault).deposit(token, amount);
  }

  function pause(address masterVault) external {
    MasterVault(masterVault).pause();
  }

  function unpause(address masterVault) external {
    MasterVault(masterVault).unpause();
  }

  function withdraw(address masterVault, uint256 amount) external {
    MasterVault(masterVault).withdraw(amount);
  }

  function tryPause(address masterVault) external returns (bool ok) {
    (ok,) = masterVault.call(abi.encodeWithSelector(MasterVault.pause.selector));
  }

  function tryUnpause(address masterVault) external returns (bool ok) {
    (ok,) = masterVault.call(abi.encodeWithSelector(MasterVault.unpause.selector));
  }

  function tryCreateBotVault(address masterVault, bytes32 templateId, bytes32 botId, uint256 allocation)
    external
    returns (bool ok)
  {
    (ok,) = masterVault.call(
      abi.encodeWithSignature(
        "createBotVault(bytes32,bytes32,uint256)",
        templateId,
        botId,
        allocation
      )
    );
  }
}

contract MasterVaultSafetyTest {
  function _setupForExternalVaultOwner()
    private
    returns (MockUSDC usdc, MasterVaultFactory factory, MasterVault masterVault, VaultOwnerActor vaultOwner)
  {
    vaultOwner = new VaultOwnerActor();
    usdc = new MockUSDC();
    factory = new MasterVaultFactory(address(this), address(usdc), address(0xBEEF), 30);
    address masterVaultAddress = factory.createMasterVault(address(vaultOwner));
    masterVault = MasterVault(masterVaultAddress);

    usdc.mint(address(vaultOwner), 1_000_000_000);
    vaultOwner.approveAndDeposit(address(usdc), address(masterVault), 500_000_000);
  }

  function testFactoryOwnerCannotOperateVaultOwnedByDifferentUser() public {
    (, MasterVaultFactory factory, MasterVault masterVault,) = _setupForExternalVaultOwner();

    require(factory.owner() == address(this), "factory_owner_wrong");
    require(masterVault.owner() != address(this), "vault_owner_should_differ");

    (bool withdrawOk,) = address(masterVault).call(
      abi.encodeWithSelector(MasterVault.withdraw.selector, 50_000_000)
    );
    require(!withdrawOk, "factory_owner_should_not_withdraw");

    (bool pauseOk,) = address(masterVault).call(abi.encodeWithSelector(MasterVault.pause.selector));
    require(!pauseOk, "factory_owner_should_not_pause");

    (bool createOk,) = address(masterVault).call(
      abi.encodeWithSignature(
        "createBotVault(bytes32,bytes32,uint256)",
        bytes32("futures_grid"),
        bytes32("bot_factory"),
        50_000_000
      )
    );
    require(!createOk, "factory_owner_should_not_create_bot_vault");
  }

  function testPausedVaultAllowsOwnerManualLiquidityActions() public {
    (MockUSDC usdc,, MasterVault masterVault, VaultOwnerActor vaultOwner) = _setupForExternalVaultOwner();

    vaultOwner.pause(address(masterVault));
    require(masterVault.paused(), "pause_failed");

    usdc.mint(address(vaultOwner), 100_000_000);
    vaultOwner.approveAndDeposit(address(usdc), address(masterVault), 100_000_000);
    require(masterVault.freeBalance() == 600_000_000, "deposit_while_paused_failed");

    vaultOwner.withdraw(address(masterVault), 150_000_000);
    require(masterVault.freeBalance() == 450_000_000, "withdraw_while_paused_failed");
  }

  function testPauseAndUnpauseRemainOwnerControlledAndGuarded() public {
    (, , MasterVault masterVault, VaultOwnerActor vaultOwner) = _setupForExternalVaultOwner();

    bool firstPauseOk = vaultOwner.tryPause(address(masterVault));
    require(firstPauseOk, "owner_pause_should_work");
    require(masterVault.paused(), "paused_flag_not_set");

    bool secondPauseOk = vaultOwner.tryPause(address(masterVault));
    require(!secondPauseOk, "duplicate_pause_should_revert");

    bool createWhilePausedOk =
      vaultOwner.tryCreateBotVault(address(masterVault), bytes32("futures_grid"), bytes32("bot_paused"), 25_000_000);
    require(!createWhilePausedOk, "create_while_paused_should_revert");

    (bool unauthorizedUnpauseOk,) = address(masterVault).call(
      abi.encodeWithSelector(MasterVault.unpause.selector)
    );
    require(!unauthorizedUnpauseOk, "non_owner_unpause_should_revert");

    bool ownerUnpauseOk = vaultOwner.tryUnpause(address(masterVault));
    require(ownerUnpauseOk, "owner_unpause_should_work");
    require(!masterVault.paused(), "unpause_failed");

    bool secondUnpauseOk = vaultOwner.tryUnpause(address(masterVault));
    require(!secondUnpauseOk, "duplicate_unpause_should_revert");
  }
}
