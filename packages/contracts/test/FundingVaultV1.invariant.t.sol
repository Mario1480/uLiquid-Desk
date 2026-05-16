// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {FundingVaultFactoryV1} from "../src/FundingVaultFactoryV1.sol";
import {FundingVaultV1} from "../src/FundingVaultV1.sol";
import {BotVaultFactoryV4} from "../src/BotVaultFactoryV4.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface VmFundingVaultInvariant {
  function prank(address msgSender) external;
}

contract MockHyperCoreDepositWalletFundingVaultInvariant {
  function deposit(uint256, uint32) external {}
}

contract FundingVaultV1InvariantTest {
  VmFundingVaultInvariant internal constant vm = VmFundingVaultInvariant(address(uint160(uint256(keccak256("hevm cheat code")))));
  address internal constant OWNER = address(0xCAFE);
  address internal constant OPERATOR = address(0xA9137);
  address internal constant TREASURY = address(0xBEEF);
  uint256 internal constant OWNER_STARTING_BALANCE = 1_000_000_000_000_000_000;

  MockUSDC internal usdc;
  FundingVaultV1 internal fundingVault;

  function setUp() public {
    usdc = new MockUSDC();
    MockHyperCoreDepositWalletFundingVaultInvariant depositWallet = new MockHyperCoreDepositWalletFundingVaultInvariant();
    BotVaultFactoryV4 botFactory = new BotVaultFactoryV4(address(usdc), address(depositWallet), TREASURY);
    FundingVaultFactoryV1 fundingFactory = new FundingVaultFactoryV1(address(usdc), address(botFactory));

    vm.prank(OWNER);
    fundingVault = FundingVaultV1(fundingFactory.createFundingVault(OPERATOR));
    usdc.mint(OWNER, OWNER_STARTING_BALANCE);
    vm.prank(OWNER);
    usdc.approve(address(fundingVault), type(uint256).max);
  }

  function testFuzzFundingVaultBalanceInvariantAcrossOwnerFlow(
    uint96 firstDepositRaw,
    uint96 firstWithdrawRaw,
    uint96 secondDepositRaw,
    uint96 secondWithdrawRaw,
    bool paused
  ) public {
    uint256 expectedVaultBalance = 0;

    expectedVaultBalance = _depositAndAssert(firstDepositRaw, expectedVaultBalance);
    expectedVaultBalance = _ownerWithdrawAndAssert(firstWithdrawRaw, expectedVaultBalance);

    vm.prank(OWNER);
    fundingVault.setOperatorPaused(paused);
    require(fundingVault.operatorPaused() == paused, "pause_state_wrong");
    require(usdc.balanceOf(address(fundingVault)) == expectedVaultBalance, "pause_changed_balance");

    expectedVaultBalance = _depositAndAssert(secondDepositRaw, expectedVaultBalance);
    expectedVaultBalance = _ownerWithdrawAndAssert(secondWithdrawRaw, expectedVaultBalance);

    require(usdc.balanceOf(address(fundingVault)) == expectedVaultBalance, "final_vault_balance_wrong");
    require(usdc.balanceOf(OWNER) + expectedVaultBalance == OWNER_STARTING_BALANCE, "owner_plus_vault_invariant");
    require(usdc.balanceOf(OPERATOR) == 0, "operator_received_funds");
  }

  function _depositAndAssert(uint96 rawAmount, uint256 expectedBefore) private returns (uint256 expectedAfter) {
    uint256 amount = 1 + (uint256(rawAmount) % 1_000_000_000);
    vm.prank(OWNER);
    fundingVault.deposit(amount);
    expectedAfter = expectedBefore + amount;
    require(usdc.balanceOf(address(fundingVault)) == expectedAfter, "deposit_balance_invariant");
  }

  function _ownerWithdrawAndAssert(uint96 rawAmount, uint256 expectedBefore) private returns (uint256 expectedAfter) {
    if (expectedBefore == 0) return 0;
    uint256 amount = 1 + (uint256(rawAmount) % expectedBefore);
    vm.prank(OWNER);
    fundingVault.ownerWithdraw(amount);
    expectedAfter = expectedBefore - amount;
    require(usdc.balanceOf(address(fundingVault)) == expectedAfter, "withdraw_balance_invariant");
  }
}
