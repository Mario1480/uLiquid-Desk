// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MasterVault} from "../src/MasterVault.sol";
import {BotVault} from "../src/BotVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract UnauthorizedBotVaultCaller {
  function tryPause(address botVault) external returns (bool ok) {
    (ok,) = botVault.call(abi.encodeWithSelector(BotVault.pause.selector));
  }

  function tryActivate(address botVault) external returns (bool ok) {
    (ok,) = botVault.call(abi.encodeWithSelector(BotVault.activate.selector));
  }

  function tryClose(address botVault) external returns (bool ok) {
    (ok,) = botVault.call(abi.encodeWithSelector(BotVault.close.selector));
  }
}

contract BotVaultLifecycleTest {
  function _deploy() private returns (MasterVault masterVault, BotVault botVault) {
    MockUSDC usdc = new MockUSDC();
    MasterVaultFactory factory = new MasterVaultFactory(address(this), address(usdc), address(0xBEEF), 30);
    address masterVaultAddress = factory.createMasterVault(address(this));
    masterVault = MasterVault(masterVaultAddress);

    uint256 minted = 1_000_000_000;
    uint256 depositAmount = 500_000_000;
    usdc.mint(address(this), minted);
    bool approved = usdc.approve(address(masterVault), depositAmount);
    require(approved, "approve_failed");
    masterVault.deposit(address(usdc), depositAmount);

    address botVaultAddress = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);
    botVault = BotVault(botVaultAddress);
  }

  function testLifecycleTransitions() public {
    (MasterVault masterVault, BotVault botVault) = _deploy();
    require(botVault.status() == BotVault.Status.ACTIVE, "initial_status_not_active");
    require(masterVault.treasuryRecipient() == address(0xBEEF), "treasury_not_linked_from_factory");

    masterVault.pauseBotVault(address(botVault));
    require(botVault.status() == BotVault.Status.PAUSED, "pause_failed");

    masterVault.activateBotVault(address(botVault));
    require(botVault.status() == BotVault.Status.ACTIVE, "activate_failed");

    masterVault.setBotVaultCloseOnly(address(botVault));
    require(botVault.status() == BotVault.Status.CLOSE_ONLY, "close_only_failed");

    masterVault.closeBotVault(address(botVault), 50_000_000, 50_000_000);
    require(botVault.status() == BotVault.Status.CLOSED, "close_failed");
  }

  function testClosedIsTerminal() public {
    (MasterVault masterVault, BotVault botVault) = _deploy();
    masterVault.setBotVaultCloseOnly(address(botVault));
    masterVault.closeBotVault(address(botVault), 200_000_000, 200_000_000);
    require(botVault.status() == BotVault.Status.CLOSED, "close_failed");

    (bool activateOk,) =
      address(masterVault).call(abi.encodeWithSelector(MasterVault.activateBotVault.selector, address(botVault)));
    require(!activateOk, "closed_should_not_activate");

    (bool pauseOk,) = address(masterVault).call(abi.encodeWithSelector(MasterVault.pauseBotVault.selector, address(botVault)));
    require(!pauseOk, "closed_should_not_pause");
  }

  function testInvalidTransitionsRevert() public {
    (MasterVault masterVault, BotVault botVault) = _deploy();

    bytes4 closeWithSettlementSelector = bytes4(keccak256("closeBotVault(address,uint256,uint256)"));
    (bool closeDirectOk,) = address(masterVault).call(abi.encodeWithSelector(closeWithSettlementSelector, address(botVault), 1, 1));
    require(!closeDirectOk, "active_to_closed_should_revert");

    masterVault.pauseBotVault(address(botVault));
    (bool pauseAgainOk,) = address(masterVault).call(abi.encodeWithSelector(MasterVault.pauseBotVault.selector, address(botVault)));
    require(!pauseAgainOk, "pause_to_pause_should_revert");
  }

  function testOnlyMasterVaultCanCallBotVaultLifecycle() public {
    (, BotVault botVault) = _deploy();
    UnauthorizedBotVaultCaller unauthorizedCaller = new UnauthorizedBotVaultCaller();

    bool pauseOk = unauthorizedCaller.tryPause(address(botVault));
    bool activateOk = unauthorizedCaller.tryActivate(address(botVault));
    bool closeOk = unauthorizedCaller.tryClose(address(botVault));

    require(!pauseOk, "non_master_pause_should_revert");
    require(!activateOk, "non_master_activate_should_revert");
    require(!closeOk, "non_master_close_should_revert");
  }
}
