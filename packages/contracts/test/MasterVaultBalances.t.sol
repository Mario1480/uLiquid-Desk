// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MasterVaultFactory} from "../src/MasterVaultFactory.sol";
import {MasterVault} from "../src/MasterVault.sol";
import {BotVault} from "../src/BotVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

struct Log {
  bytes32[] topics;
  bytes data;
  address emitter;
}

interface Vm {
  function recordLogs() external;
  function getRecordedLogs() external returns (Log[] memory);
}

contract MasterVaultBalancesTest {
  Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

  function _setup(uint256 depositAmount)
    private
    returns (MockUSDC usdc, MasterVaultFactory factory, MasterVault masterVault, address treasuryRecipient)
  {
    usdc = new MockUSDC();
    treasuryRecipient = address(0xBEEF);
    factory = new MasterVaultFactory(address(this), address(usdc), treasuryRecipient);
    address masterVaultAddress = factory.createMasterVault(address(this));
    masterVault = MasterVault(masterVaultAddress);

    usdc.mint(address(this), 1_000_000_000);
    bool approved = usdc.approve(address(masterVault), depositAmount);
    require(approved, "approve_failed");
    masterVault.deposit(address(usdc), depositAmount);
  }

  function testCreateTwoBotVaultsWithSeparatedAllocations() public {
    (, , MasterVault masterVault,) = _setup(600_000_000);

    address botVaultA = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);
    address botVaultB = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_b"), 100_000_000);

    require(botVaultA != botVaultB, "bot_vaults_not_unique");
    require(masterVault.freeBalance() == 300_000_000, "free_after_dual_allocate");
    require(masterVault.reservedBalance() == 300_000_000, "reserved_after_dual_allocate");

    require(BotVault(botVaultA).principalAllocated() == 200_000_000, "bot_a_alloc");
    require(BotVault(botVaultB).principalAllocated() == 100_000_000, "bot_b_alloc");
    require(BotVault(botVaultA).botId() == bytes32("bot_a"), "bot_a_id");
    require(BotVault(botVaultB).botId() == bytes32("bot_b"), "bot_b_id");
  }

  function testWithdrawBlockedWhenFundsReserved() public {
    (, , MasterVault masterVault,) = _setup(500_000_000);
    masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 400_000_000);
    require(masterVault.freeBalance() == 100_000_000, "free_after_allocate");
    require(masterVault.reservedBalance() == 400_000_000, "reserved_after_allocate");

    (bool ok,) = address(masterVault).call(abi.encodeWithSelector(MasterVault.withdraw.selector, 150_000_000));
    require(!ok, "withdraw_should_fail_when_free_too_low");
  }

  function testClaimAndCloseFlow() public {
    (MockUSDC usdc,, MasterVault masterVault, address treasuryRecipient) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    vm.recordLogs();
    masterVault.requestWithdraw(100_000_000);
    Log[] memory logs = vm.getRecordedLogs();
    require(logs.length == 1, "withdraw_request_event_missing");
    require(logs[0].topics[0] == keccak256("WithdrawRequested(address,uint256,uint256)"), "withdraw_request_wrong_topic");

    // Simulate externally realized profit that increases actual token balance.
    usdc.mint(address(masterVault), 20_000_000);
    masterVault.claimFromBotVault(botVault, 80_000_000, 90_000_000);
    require(masterVault.freeBalance() == 387_000_000, "free_after_claim");
    require(masterVault.reservedBalance() == 120_000_000, "reserved_after_claim");
    require(BotVault(botVault).principalReturned() == 80_000_000, "principal_returned_after_claim");
    require(BotVault(botVault).realizedPnlNet() == 10_000_000, "realized_after_claim");
    require(BotVault(botVault).highWaterMark() == 10_000_000, "hwm_after_claim");
    require(BotVault(botVault).feePaidTotal() == 3_000_000, "fee_paid_after_claim");
    require(usdc.balanceOf(treasuryRecipient) == 3_000_000, "treasury_balance_after_claim");

    masterVault.setBotVaultCloseOnly(botVault);
    masterVault.closeBotVault(botVault, 120_000_000, 100_000_000);

    require(BotVault(botVault).status() == BotVault.Status.CLOSED, "status_after_close");
    require(masterVault.freeBalance() == 487_000_000, "free_after_close");
    require(masterVault.reservedBalance() == 0, "reserved_after_close");
    require(BotVault(botVault).principalReturned() == 200_000_000, "principal_returned_after_close");
    require(BotVault(botVault).realizedPnlNet() == -10_000_000, "realized_after_close");
    require(BotVault(botVault).highWaterMark() == 10_000_000, "hwm_after_close");
    require(usdc.balanceOf(treasuryRecipient) == 3_000_000, "treasury_balance_after_close");

    (bool claimClosedOk,) =
      address(masterVault).call(abi.encodeWithSelector(MasterVault.claimFromBotVault.selector, botVault, 1, 1));
    require(!claimClosedOk, "claim_from_closed_should_revert");

    uint256 ownerBalanceBeforeWithdraw = usdc.balanceOf(address(this));
    masterVault.withdraw(100_000_000);
    require(usdc.balanceOf(address(this)) == ownerBalanceBeforeWithdraw + 100_000_000, "owner_withdraw_after_close");
  }

  function testClaimGuardrailsWithAndWithoutSurplus() public {
    (MockUSDC usdc,, MasterVault masterVault, address treasuryRecipient) = _setup(300_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    (bool tooHighReturnOk,) =
      address(masterVault).call(abi.encodeWithSelector(MasterVault.claimFromBotVault.selector, botVault, 50_000_000, 60_000_000));
    require(!tooHighReturnOk, "claim_without_surplus_should_fail");

    usdc.mint(address(masterVault), 20_000_000);
    require(masterVault.tokenSurplus() == 20_000_000, "surplus_not_detected");
    masterVault.claimFromBotVault(botVault, 50_000_000, 60_000_000);
    require(masterVault.freeBalance() == 157_000_000, "free_after_surplus_claim");
    require(masterVault.reservedBalance() == 150_000_000, "reserved_after_surplus_claim");
    require(usdc.balanceOf(treasuryRecipient) == 3_000_000, "treasury_balance_after_surplus_claim");
  }

  function testDepositRejectsUnsupportedToken() public {
    (, , MasterVault masterVault,) = _setup(100_000_000);
    MockUSDC wrongToken = new MockUSDC();
    wrongToken.mint(address(this), 1_000_000);
    bool approved = wrongToken.approve(address(masterVault), 1_000_000);
    require(approved, "approve_failed");

    (bool ok,) = address(masterVault).call(
      abi.encodeWithSelector(MasterVault.deposit.selector, address(wrongToken), 1_000_000)
    );
    require(!ok, "unsupported_token_should_revert");
  }

  function testPauseBlocksRiskIncreasingActionsButAllowsUnwind() public {
    (MockUSDC usdc,, MasterVault masterVault,) = _setup(400_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    masterVault.pause();
    require(masterVault.paused(), "paused_flag_not_set");

    (bool createOk,) = address(masterVault).call(
      abi.encodeWithSignature(
        "createBotVault(bytes32,bytes32,uint256)",
        bytes32("futures_grid"),
        bytes32("bot_b"),
        10_000_000
      )
    );
    require(!createOk, "create_should_fail_when_paused");

    (bool allocateOk,) = address(masterVault).call(
      abi.encodeWithSelector(MasterVault.allocateToBotVault.selector, botVault, 10_000_000)
    );
    require(!allocateOk, "allocate_should_fail_when_paused");

    masterVault.pauseBotVault(botVault);
    masterVault.setBotVaultCloseOnly(botVault);
    usdc.mint(address(masterVault), 5_000_000);
    masterVault.closeBotVault(botVault, 200_000_000, 205_000_000);

    require(BotVault(botVault).status() == BotVault.Status.CLOSED, "close_should_still_work_while_paused");
  }

  function testHighWaterMarkPreventsDoubleFeeOnRecoveredPnL() public {
    (MockUSDC usdc,, MasterVault masterVault, address treasuryRecipient) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    usdc.mint(address(masterVault), 50_000_000);
    masterVault.claimFromBotVault(botVault, 0, 30_000_000);
    require(BotVault(botVault).feePaidTotal() == 9_000_000, "initial_fee_paid");
    require(BotVault(botVault).highWaterMark() == 30_000_000, "initial_hwm");
    require(usdc.balanceOf(treasuryRecipient) == 9_000_000, "initial_treasury_fee");

    masterVault.claimFromBotVault(botVault, 50_000_000, 40_000_000);
    require(BotVault(botVault).feePaidTotal() == 9_000_000, "loss_should_not_charge_fee");
    require(BotVault(botVault).highWaterMark() == 30_000_000, "hwm_should_hold_after_loss");

    masterVault.claimFromBotVault(botVault, 0, 5_000_000);
    require(BotVault(botVault).feePaidTotal() == 9_000_000, "recovery_below_hwm_should_not_fee");
    require(BotVault(botVault).highWaterMark() == 30_000_000, "hwm_should_hold_below_peak");

    masterVault.claimFromBotVault(botVault, 0, 10_000_000);
    require(BotVault(botVault).feePaidTotal() == 10_500_000, "only_incremental_profit_feeable");
    require(BotVault(botVault).highWaterMark() == 35_000_000, "hwm_should_move_to_new_peak");
    require(usdc.balanceOf(treasuryRecipient) == 10_500_000, "treasury_collects_incremental_fee");
  }

  function testTreasuryRecipientUpdatesApplyToNewSettlements() public {
    (MockUSDC usdc, MasterVaultFactory factory, MasterVault masterVault, address initialTreasuryRecipient) = _setup(500_000_000);
    address botVault = masterVault.createBotVault(bytes32("futures_grid"), bytes32("bot_a"), 200_000_000);

    usdc.mint(address(masterVault), 20_000_000);
    masterVault.claimFromBotVault(botVault, 0, 10_000_000);
    require(usdc.balanceOf(initialTreasuryRecipient) == 3_000_000, "initial_treasury_fee_missing");

    address nextTreasuryRecipient = address(0xCAFE);
    factory.setTreasuryRecipient(nextTreasuryRecipient);

    masterVault.claimFromBotVault(botVault, 0, 10_000_000);
    require(usdc.balanceOf(initialTreasuryRecipient) == 3_000_000, "old_treasury_should_not_receive_new_fee");
    require(usdc.balanceOf(nextTreasuryRecipient) == 3_000_000, "new_treasury_should_receive_fee");
  }
}
