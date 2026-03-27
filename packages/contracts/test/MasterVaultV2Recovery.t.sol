// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MasterVaultFactoryV2} from "../src/MasterVaultFactoryV2.sol";
import {MasterVaultV2} from "../src/MasterVaultV2.sol";
import {BotVaultV2} from "../src/BotVaultV2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract V2UnauthorizedCaller {
  function tryRecover(address masterVault, address botVault, uint256 releasedReserved, uint256 grossReturned)
    external
    returns (bool ok)
  {
    (ok,) = masterVault.call(
      abi.encodeWithSelector(
        MasterVaultV2.recoverClosedBotVault.selector, botVault, releasedReserved, grossReturned
      )
    );
  }
}

contract MasterVaultV2RecoveryTest {
  function _setup(uint256 depositAmount)
    private
    returns (MockUSDC usdc, MasterVaultFactoryV2 factory, MasterVaultV2 masterVault, address treasuryRecipient)
  {
    usdc = new MockUSDC();
    treasuryRecipient = address(0xBEEF);
    factory = new MasterVaultFactoryV2(address(this), address(usdc), treasuryRecipient, 30);
    address masterVaultAddress = factory.createMasterVault(address(this));
    masterVault = MasterVaultV2(masterVaultAddress);

    usdc.mint(address(this), 1_000_000_000);
    bool approved = usdc.approve(address(masterVault), depositAmount);
    require(approved, "approve_failed");
    masterVault.deposit(address(usdc), depositAmount);
  }

  function _closeWithPartialSettlement(MasterVaultV2 masterVault, address botVault, uint256 releasedReserved, uint256 grossReturned)
    private
  {
    masterVault.setBotVaultCloseOnly(botVault);
    masterVault.closeBotVault(botVault, releasedReserved, grossReturned);
    require(BotVaultV2(botVault).status() == BotVaultV2.Status.CLOSED, "bot_not_closed");
  }

  function testRecoverClosedBotVaultOutstandingPrincipalOnly() public {
    (, , MasterVaultV2 masterVault,) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    _closeWithPartialSettlement(masterVault, botVault, 150_000_000, 150_000_000);
    require(masterVault.freeBalance() == 450_000_000, "free_after_close");
    require(masterVault.reservedBalance() == 50_000_000, "reserved_after_close");
    require(masterVault.principalOutstanding(botVault) == 50_000_000, "outstanding_after_close");

    masterVault.recoverClosedBotVault(botVault, 50_000_000, 50_000_000);

    require(BotVaultV2(botVault).status() == BotVaultV2.Status.CLOSED, "status_should_remain_closed");
    require(BotVaultV2(botVault).principalReturned() == 200_000_000, "principal_returned_after_recovery");
    require(masterVault.principalOutstanding(botVault) == 0, "outstanding_should_clear");
    require(masterVault.freeBalance() == 500_000_000, "free_after_recovery");
    require(masterVault.reservedBalance() == 0, "reserved_after_recovery");
  }

  function testRecoverClosedBotVaultWithSurplusProfitAndFee() public {
    (MockUSDC usdc,, MasterVaultV2 masterVault, address treasuryRecipient) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    _closeWithPartialSettlement(masterVault, botVault, 150_000_000, 150_000_000);
    require(masterVault.tokenSurplus() == 0, "baseline_surplus_missing");
    usdc.mint(address(masterVault), 20_000_000);
    require(masterVault.tokenSurplus() == 20_000_000, "surplus_missing");

    masterVault.recoverClosedBotVault(botVault, 50_000_000, 60_000_000);

    require(BotVaultV2(botVault).status() == BotVaultV2.Status.CLOSED, "status_should_remain_closed");
    require(BotVaultV2(botVault).principalReturned() == 200_000_000, "principal_returned_after_profit_recovery");
    require(BotVaultV2(botVault).realizedPnlNet() == 10_000_000, "realized_pnl_after_profit_recovery");
    require(BotVaultV2(botVault).highWaterMark() == 10_000_000, "high_water_mark_after_profit_recovery");
    require(BotVaultV2(botVault).feePaidTotal() == 3_000_000, "fee_paid_after_profit_recovery");
    require(usdc.balanceOf(treasuryRecipient) == 3_000_000, "treasury_fee_after_profit_recovery");
    require(masterVault.freeBalance() == 507_000_000, "free_after_profit_recovery");
    require(masterVault.reservedBalance() == 0, "reserved_after_profit_recovery");
  }

  function testRecoverClosedBotVaultRevertsWhenReleasedExceedsOutstanding() public {
    (, , MasterVaultV2 masterVault,) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    _closeWithPartialSettlement(masterVault, botVault, 150_000_000, 150_000_000);

    (bool ok,) = address(masterVault).call(
      abi.encodeWithSelector(MasterVaultV2.recoverClosedBotVault.selector, botVault, 60_000_000, 60_000_000)
    );
    require(!ok, "released_exceeds_outstanding_should_revert");
  }

  function testRecoverClosedBotVaultRevertsWhenGrossReturnedExceedsReleasedPlusSurplus() public {
    (, , MasterVaultV2 masterVault,) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    _closeWithPartialSettlement(masterVault, botVault, 150_000_000, 150_000_000);

    (bool ok,) = address(masterVault).call(
      abi.encodeWithSelector(MasterVaultV2.recoverClosedBotVault.selector, botVault, 50_000_000, 60_000_000)
    );
    require(!ok, "gross_return_without_surplus_should_revert");
  }

  function testRecoverClosedBotVaultRevertsForNonOwner() public {
    (, , MasterVaultV2 masterVault,) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);
    _closeWithPartialSettlement(masterVault, botVault, 150_000_000, 150_000_000);

    V2UnauthorizedCaller caller = new V2UnauthorizedCaller();
    bool ok = caller.tryRecover(address(masterVault), botVault, 50_000_000, 50_000_000);
    require(!ok, "non_owner_should_not_recover");
  }

  function testRecoverClosedBotVaultRevertsWhenStatusIsNotClosed() public {
    (, , MasterVaultV2 masterVault,) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    (bool ok,) = address(masterVault).call(
      abi.encodeWithSelector(MasterVaultV2.recoverClosedBotVault.selector, botVault, 50_000_000, 50_000_000)
    );
    require(!ok, "non_closed_recovery_should_revert");
  }
}
