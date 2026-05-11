// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {FundingVaultFactoryV1} from "../src/FundingVaultFactoryV1.sol";
import {FundingVaultV1} from "../src/FundingVaultV1.sol";
import {BotVaultFactoryV4} from "../src/BotVaultFactoryV4.sol";
import {BotVaultV4} from "../src/BotVaultV4.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface VmFundingVault {
  function prank(address msgSender) external;
  function expectRevert(bytes calldata revertData) external;
}

contract MockHyperCoreDepositWalletFundingVault {
  function deposit(uint256, uint32) external {}
}

contract FundingVaultV1Test {
  VmFundingVault internal constant vm = VmFundingVault(address(uint160(uint256(keccak256("hevm cheat code")))));
  address internal constant OWNER = address(0xCAFE);
  address internal constant OPERATOR = address(0xA9137);
  address internal constant NEXT_OPERATOR = address(0xA9138);
  address internal constant CONTROLLER = address(0xC0117);
  address internal constant AGENT = address(0xA6E17);
  address internal constant TREASURY = address(0xBEEF);
  address internal constant AFFILIATE = address(0xAFFE);

  function _setup() private returns (
    MockUSDC usdc,
    BotVaultFactoryV4 botFactory,
    FundingVaultFactoryV1 fundingFactory,
    FundingVaultV1 fundingVault
  ) {
    usdc = new MockUSDC();
    MockHyperCoreDepositWalletFundingVault depositWallet = new MockHyperCoreDepositWalletFundingVault();
    botFactory = new BotVaultFactoryV4(address(usdc), address(depositWallet), TREASURY);
    fundingFactory = new FundingVaultFactoryV1(address(usdc), address(botFactory));

    vm.prank(OWNER);
    address vaultAddress = fundingFactory.createFundingVault(OPERATOR);
    fundingVault = FundingVaultV1(vaultAddress);
    usdc.mint(OWNER, 1_000_000_000);
    vm.prank(OWNER);
    usdc.approve(address(fundingVault), type(uint256).max);
  }

  function _fundVault(MockUSDC usdc, FundingVaultV1 fundingVault, uint256 amount) private {
    vm.prank(OWNER);
    fundingVault.deposit(amount);
    require(usdc.balanceOf(address(fundingVault)) == amount, "funding_balance_wrong");
  }

  function _launchParams(uint256 amount) private pure returns (FundingVaultV1.LaunchParams memory) {
    return FundingVaultV1.LaunchParams({
      controller: CONTROLLER,
      agentWallet: AGENT,
      templateId: bytes32("template"),
      botId: bytes32("bot"),
      amount: amount,
      platformFeeRatePct: 5,
      affiliateFeeRatePct: 10,
      affiliateRecipient: AFFILIATE
    });
  }

  function testFactoryCreatesOneFundingVaultPerOwner() public {
    (, , FundingVaultFactoryV1 fundingFactory, FundingVaultV1 fundingVault) = _setup();

    require(fundingFactory.fundingVaultOf(OWNER) == address(fundingVault), "funding_vault_mapping_wrong");
    require(fundingVault.owner() == OWNER, "owner_wrong");
    require(fundingVault.operator() == OPERATOR, "operator_wrong");

    vm.prank(OWNER);
    vm.expectRevert(bytes("funding_vault_exists"));
    fundingFactory.createFundingVault(OPERATOR);
  }

  function testDepositAndOwnerWithdraw() public {
    (MockUSDC usdc, , , FundingVaultV1 fundingVault) = _setup();
    _fundVault(usdc, fundingVault, 100_000_000);

    vm.prank(OWNER);
    fundingVault.ownerWithdraw(40_000_000);

    require(usdc.balanceOf(address(fundingVault)) == 60_000_000, "vault_balance_wrong");
    require(usdc.balanceOf(OWNER) == 940_000_000, "owner_balance_wrong");
  }

  function testOperatorWithdrawOnlyGoesToOwner() public {
    (MockUSDC usdc, , , FundingVaultV1 fundingVault) = _setup();
    _fundVault(usdc, fundingVault, 100_000_000);

    bytes32 actionId = bytes32("withdraw-1");
    vm.prank(OPERATOR);
    fundingVault.operatorWithdrawToOwner(25_000_000, actionId);

    require(usdc.balanceOf(address(fundingVault)) == 75_000_000, "vault_balance_wrong");
    require(usdc.balanceOf(OWNER) == 925_000_000, "owner_balance_wrong");

    vm.prank(OPERATOR);
    vm.expectRevert(bytes("action_id_used"));
    fundingVault.operatorWithdrawToOwner(1, actionId);
  }

  function testOperatorCanLaunchBotVaultAndFundIt() public {
    (MockUSDC usdc, BotVaultFactoryV4 botFactory, , FundingVaultV1 fundingVault) = _setup();
    _fundVault(usdc, fundingVault, 100_000_000);

    bytes32 botId = bytes32("bot");
    vm.prank(OPERATOR);
    address botVaultAddress = fundingVault.launchBotVault(_launchParams(70_000_000), bytes32("launch-1"));
    BotVaultV4 botVault = BotVaultV4(botVaultAddress);

    require(botFactory.vaultOfBot(botId) == botVaultAddress, "bot_vault_mapping_wrong");
    require(botVault.beneficiary() == address(fundingVault), "beneficiary_wrong");
    require(botVault.agentWallet() == AGENT, "agent_wrong");
    require(botVault.platformFeeRatePct() == 5, "platform_fee_wrong");
    require(botVault.affiliateFeeRatePct() == 10, "affiliate_fee_wrong");
    require(botVault.principalDeposited() == 70_000_000, "principal_wrong");
    require(usdc.balanceOf(address(fundingVault)) == 30_000_000, "funding_balance_wrong");
    require(usdc.balanceOf(botVaultAddress) == 70_000_000, "bot_vault_balance_wrong");
  }

  function testLaunchReplayReverts() public {
    (, , , FundingVaultV1 fundingVault) = _setup();
    bytes32 actionId = bytes32("launch-1");
    _fundVault(MockUSDC(address(fundingVault.usdc())), fundingVault, 100_000_000);

    vm.prank(OPERATOR);
    fundingVault.launchBotVault(_launchParams(10_000_000), actionId);

    FundingVaultV1.LaunchParams memory params = _launchParams(10_000_000);
    params.botId = bytes32("bot-2");
    vm.prank(OPERATOR);
    vm.expectRevert(bytes("action_id_used"));
    fundingVault.launchBotVault(params, actionId);
  }

  function testPausedOperatorCannotLaunchOrWithdrawButOwnerCanWithdraw() public {
    (MockUSDC usdc, , , FundingVaultV1 fundingVault) = _setup();
    _fundVault(usdc, fundingVault, 100_000_000);

    vm.prank(OWNER);
    fundingVault.setOperatorPaused(true);

    vm.prank(OPERATOR);
    vm.expectRevert(bytes("operator_paused"));
    fundingVault.operatorWithdrawToOwner(1, bytes32("withdraw-1"));

    vm.prank(OPERATOR);
    vm.expectRevert(bytes("operator_paused"));
    fundingVault.launchBotVault(_launchParams(1), bytes32("launch-1"));

    vm.prank(OWNER);
    fundingVault.ownerWithdraw(10_000_000);
    require(usdc.balanceOf(address(fundingVault)) == 90_000_000, "owner_withdraw_blocked");
  }

  function testOwnerCanRotateOperator() public {
    (, , , FundingVaultV1 fundingVault) = _setup();
    vm.prank(OWNER);
    fundingVault.setOperator(NEXT_OPERATOR);
    require(fundingVault.operator() == NEXT_OPERATOR, "operator_not_rotated");
  }

  function testFundExistingBotVault() public {
    (MockUSDC usdc, , , FundingVaultV1 fundingVault) = _setup();
    _fundVault(usdc, fundingVault, 120_000_000);

    vm.prank(OPERATOR);
    address botVaultAddress = fundingVault.launchBotVault(_launchParams(50_000_000), bytes32("launch-1"));
    vm.prank(OPERATOR);
    fundingVault.fundExistingBotVault(botVaultAddress, 25_000_000, bytes32("fund-1"));

    require(BotVaultV4(botVaultAddress).principalDeposited() == 75_000_000, "principal_wrong");
    require(usdc.balanceOf(address(fundingVault)) == 45_000_000, "funding_balance_wrong");
  }

  function testClaimAndCloseReturnToFundingVaultBeneficiary() public {
    (MockUSDC usdc, , , FundingVaultV1 fundingVault) = _setup();
    _fundVault(usdc, fundingVault, 100_000_000);

    vm.prank(OPERATOR);
    address botVaultAddress = fundingVault.launchBotVault(_launchParams(80_000_000), bytes32("launch-1"));
    BotVaultV4 botVault = BotVaultV4(botVaultAddress);

    usdc.mint(botVaultAddress, 20_000_000);
    vm.prank(CONTROLLER);
    botVault.claimProfit(10_000_000, 1_500_000, 0, int256(10_000_000));

    require(usdc.balanceOf(address(fundingVault)) == 28_500_000, "claim_not_returned");

    vm.prank(CONTROLLER);
    botVault.activate();
    vm.prank(CONTROLLER);
    botVault.setCloseOnly();
    vm.prank(CONTROLLER);
    botVault.closeVault(80_000_000, 80_000_000, 0, int256(10_000_000));

    require(usdc.balanceOf(address(fundingVault)) == 108_500_000, "close_not_returned");
  }
}
