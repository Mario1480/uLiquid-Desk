// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {BotVaultFactoryV4} from "../src/BotVaultFactoryV4.sol";
import {BotVaultV4} from "../src/BotVaultV4.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface Vm {
  function prank(address msgSender) external;
  function etch(address target, bytes calldata code) external;
}

contract MockHyperCoreDepositWalletV4 {
  address public immutable usdc;
  uint256 public lastAmount;
  uint32 public lastDestinationDex;

  constructor(address usdc_) {
    usdc = usdc_;
  }

  function deposit(uint256 amount, uint32 destinationDex) external {
    lastAmount = amount;
    lastDestinationDex = destinationDex;
    MockUSDC(usdc).transferFrom(msg.sender, address(this), amount);
  }
}

contract MockHyperCoreWriterV4 {
  bytes public lastData;
  uint256 public calls;

  function sendRawAction(bytes calldata data) external payable {
    lastData = data;
    calls += 1;
  }
}

contract BotVaultFactoryV4Test {
  Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
  address internal constant HYPERCORE_WRITER = 0x3333333333333333333333333333333333333333;
  address internal constant AGENT = address(0xA9137);

  function _setupTradingVault(uint256 platformFeeRatePct, uint256 affiliateFeeRatePct, address affiliateRecipient)
    private
    returns (MockUSDC usdc, BotVaultFactoryV4 factory, BotVaultV4 vault, MockHyperCoreWriterV4 writer)
  {
    MockHyperCoreWriterV4 deployedWriter = new MockHyperCoreWriterV4();
    vm.etch(HYPERCORE_WRITER, address(deployedWriter).code);
    writer = MockHyperCoreWriterV4(HYPERCORE_WRITER);

    usdc = new MockUSDC();
    MockHyperCoreDepositWalletV4 depositWallet = new MockHyperCoreDepositWalletV4(address(usdc));
    factory = new BotVaultFactoryV4(address(usdc), address(depositWallet), address(0xBEEF));
    address vaultAddress = factory.createBotVault(
      address(0xCAFE),
      address(this),
      AGENT,
      bytes32("template"),
      bytes32("bot"),
      platformFeeRatePct,
      affiliateFeeRatePct,
      affiliateRecipient
    );
    vault = BotVaultV4(vaultAddress);
    usdc.mint(address(this), 1_000_000_000);
    usdc.approve(address(vault), type(uint256).max);
  }

  function testFactoryCreatesVaultWithStoredFeeRate() public {
    MockUSDC usdc = new MockUSDC();
    MockHyperCoreDepositWalletV4 depositWallet = new MockHyperCoreDepositWalletV4(address(usdc));
    BotVaultFactoryV4 factory = new BotVaultFactoryV4(address(usdc), address(depositWallet), address(0xBEEF));

    address vaultAddress = factory.createBotVault(
      address(0xCAFE),
      address(this),
      address(0xABCD),
      bytes32("template"),
      bytes32("bot"),
      5,
      10,
      address(0xAFFE)
    );

    require(factory.treasuryRecipient() == address(0xBEEF), "treasury_not_set");
    require(factory.coreDepositWallet() == address(depositWallet), "core_deposit_wallet_not_set");
    require(factory.vaultOfBot(bytes32("bot")) == vaultAddress, "vault_mapping_not_set");
    require(BotVaultV4(vaultAddress).beneficiary() == address(0xCAFE), "beneficiary_not_set");
    require(address(BotVaultV4(vaultAddress).factory()) == address(factory), "factory_not_set_on_vault");
    require(BotVaultV4(vaultAddress).platformFeeRatePct() == 5, "platform_fee_not_set");
    require(BotVaultV4(vaultAddress).affiliateFeeRatePct() == 10, "affiliate_fee_not_set");
    require(BotVaultV4(vaultAddress).affiliateRecipient() == address(0xAFFE), "affiliate_recipient_not_set");
    require(BotVaultV4(vaultAddress).profitShareFeeRatePct() == 15, "vault_fee_rate_not_set");
  }

  function testClaimProfitUsesVaultSpecificFeePolicy() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    usdc.transfer(address(vault), 100_000_000);

    (bool badOk,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV4.claimProfit.selector, 10_000_000, 3_000_000, 0, int256(10_000_000))
    );
    require(!badOk, "invalid_fee_policy_should_revert");

    vault.claimProfit(10_000_000, 1_500_000, 0, int256(10_000_000));
    require(vault.feePaidTotal() == 1_500_000, "fee_paid_total_wrong");
    require(vault.highWaterMarkProfit() == 10_000_000, "hwm_wrong");
    require(vault.realizedPnlNet() == int256(10_000_000), "realized_pnl_wrong");
  }

  function testClaimProfitSplitsTreasuryAffiliateAndBeneficiary() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    usdc.transfer(address(vault), 100_000_000);
    vault.claimProfit(10_000_000, 1_500_000, 0, int256(10_000_000));

    require(usdc.balanceOf(address(0xBEEF)) == 500_000, "treasury_fee_wrong");
    require(usdc.balanceOf(address(0xAFFE)) == 1_000_000, "affiliate_fee_wrong");
    require(usdc.balanceOf(address(0xCAFE)) == 8_500_000, "beneficiary_amount_wrong");
  }

  function testProfitShareCannotDoubleChargeSameRealizedClosedPnl() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    usdc.transfer(address(vault), 30_000_000);
    vault.claimProfit(10_000_000, 1_500_000, 0, int256(10_000_000));

    (bool badOk,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV4.claimProfit.selector, 10_000_000, 1_500_000, 0, int256(10_000_000))
    );
    require(!badOk, "duplicate_fee_should_revert");
    require(vault.feePaidTotal() == 1_500_000, "duplicate_fee_recorded");
    require(vault.highWaterMarkProfit() == 10_000_000, "duplicate_hwm_changed");
  }

  function testProfitShareSupportsMultiplePartialClaims() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    usdc.transfer(address(vault), 50_000_000);
    vault.claimProfit(10_000_000, 1_500_000, 0, int256(30_000_000));
    vault.claimProfit(10_000_000, 1_500_000, 0, int256(30_000_000));

    require(vault.feePaidTotal() == 3_000_000, "partial_fee_total_wrong");
    require(vault.highWaterMarkProfit() == 20_000_000, "partial_hwm_wrong");
    require(usdc.balanceOf(address(0xBEEF)) == 1_000_000, "partial_treasury_wrong");
    require(usdc.balanceOf(address(0xAFFE)) == 2_000_000, "partial_affiliate_wrong");
  }

  function testProfitShareLossReducesFutureFeeCapacity() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    usdc.transfer(address(vault), 60_000_000);
    vault.claimProfit(20_000_000, 3_000_000, 0, int256(20_000_000));
    vault.claimProfit(5_000_000, 0, 0, int256(15_000_000));
    vault.claimProfit(10_000_000, 1_500_000, 0, int256(30_000_000));

    require(vault.feePaidTotal() == 4_500_000, "loss_recovery_fee_wrong");
    require(vault.highWaterMarkProfit() == 30_000_000, "loss_recovery_hwm_wrong");
    require(vault.realizedPnlNet() == int256(30_000_000), "loss_recovery_realized_wrong");
  }

  function testCloseOnlyChargesOnlyUnsettledProfitAfterPriorClaim() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    vault.fund(100_000_000);
    usdc.transfer(address(vault), 50_000_000);
    vault.claimProfit(20_000_000, 3_000_000, 0, int256(20_000_000));
    vault.setCloseOnly();
    vault.closeVault(100_000_000, 130_000_000, 1_500_000, int256(30_000_000));

    require(vault.feePaidTotal() == 4_500_000, "close_fee_total_wrong");
    require(vault.highWaterMarkProfit() == 30_000_000, "close_hwm_wrong");
    require(vault.principalReturned() == 100_000_000, "close_principal_wrong");
    require(usdc.balanceOf(address(0xBEEF)) == 1_500_000, "close_treasury_wrong");
    require(usdc.balanceOf(address(0xAFFE)) == 3_000_000, "close_affiliate_wrong");
  }

  function testNetLossPaysNoProfitShare() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    vault.fund(100_000_000);
    vault.claimProfit(20_000_000, 0, 20_000_000, -20_000_000);
    vault.setCloseOnly();
    vault.closeVault(80_000_000, 80_000_000, 0, -20_000_000);

    require(vault.feePaidTotal() == 0, "loss_fee_wrong");
    require(vault.highWaterMarkProfit() == 0, "loss_hwm_wrong");
    require(vault.realizedPnlNet() == -20_000_000, "loss_realized_wrong");
    require(usdc.balanceOf(address(0xBEEF)) == 0, "loss_treasury_wrong");
    require(usdc.balanceOf(address(0xAFFE)) == 0, "loss_affiliate_wrong");
  }

  function testSettledCloseOnlyVaultCanBeReFundedForReuse() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    vault.fund(10_000_000);
    vault.activate();
    vault.setCloseOnly();
    vault.closeVault(10_000_000, 10_000_000, 0, 0);

    require(uint256(vault.status()) == uint256(BotVaultV4.Status.CLOSE_ONLY), "close_should_stay_reusable_close_only");

    vault.fund(20_000_000);
    require(uint256(vault.status()) == uint256(BotVaultV4.Status.FUNDED), "reuse_fund_should_set_funded");

    vault.activate();
    require(uint256(vault.status()) == uint256(BotVaultV4.Status.ACTIVE), "reuse_activate_should_set_active");
    require(usdc.balanceOf(address(vault)) == 20_000_000, "reuse_balance_wrong");
  }

  function testDifferentVaultsCanUseDifferentFeePolicies() public {
    MockUSDC usdc = new MockUSDC();
    MockHyperCoreDepositWalletV4 depositWallet = new MockHyperCoreDepositWalletV4(address(usdc));
    BotVaultFactoryV4 factory = new BotVaultFactoryV4(address(usdc), address(depositWallet), address(0xBEEF));

    address lowFeeVault = factory.createBotVault(
      address(0xCAFE),
      address(this),
      AGENT,
      bytes32("template"),
      bytes32("bot_low"),
      3,
      2,
      address(0xAAA1)
    );
    address highFeeVault = factory.createBotVault(
      address(0xCAFE),
      address(this),
      AGENT,
      bytes32("template"),
      bytes32("bot_high"),
      10,
      5,
      address(0xAAA2)
    );

    require(BotVaultV4(lowFeeVault).profitShareFeeRatePct() == 5, "low_fee_wrong");
    require(BotVaultV4(highFeeVault).profitShareFeeRatePct() == 15, "high_fee_wrong");
  }

  function testActiveAllowsSpotSendForProfitClaimSettlement() public {
    (, , BotVaultV4 vault, MockHyperCoreWriterV4 writer) = _setupTradingVault(5, 10, address(0xAFFE));

    vault.fund(1);
    vault.activate();

    address destination = address(0x2000000000000000000000000000000000000000);
    uint64 token = 0;
    uint64 weiAmount = 1_000_000;
    bytes memory expected = abi.encodePacked(bytes1(uint8(1)), bytes3(uint24(6)), abi.encode(destination, token, weiAmount));

    vm.prank(AGENT);
    vault.sendHyperCoreSpot(destination, token, weiAmount);

    require(writer.calls() == 1, "active_spot_send_not_forwarded");
    require(keccak256(writer.lastData()) == keccak256(expected), "active_spot_send_payload_wrong");
  }

  function testDeployedBlocksTransferUsdBackToSpot() public {
    (, , BotVaultV4 vault, ) = _setupTradingVault(5, 10, address(0xAFFE));

    vm.prank(AGENT);
    (bool ok,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV4.sendUsdClassTransfer.selector, uint64(1_000_000), false)
    );
    require(!ok, "deployed_perp_reduction_should_revert");
  }

  function testFuzzClaimProfitAccountingNeverOverpays(
    uint8 platformRaw,
    uint8 affiliateRaw,
    uint96 grossRaw,
    uint96 realizedRaw
  ) public {
    uint256 platformFeeRatePct = uint256(platformRaw) % 51;
    uint256 affiliateFeeRatePct = uint256(affiliateRaw) % (101 - platformFeeRatePct);
    uint256 totalFeeRatePct = platformFeeRatePct + affiliateFeeRatePct;
    uint256 grossAmount = 1 + (uint256(grossRaw) % 1_000_000_000);
    uint256 realizedProfit = 1 + (uint256(realizedRaw) % 1_000_000_000);
    uint256 feeBase = grossAmount < realizedProfit ? grossAmount : realizedProfit;
    uint256 feeAmount = totalFeeRatePct == 0 ? 0 : (feeBase * totalFeeRatePct) / 100;

    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(
      platformFeeRatePct,
      affiliateFeeRatePct,
      address(0xAFFE)
    );

    usdc.transfer(address(vault), grossAmount);
    vault.claimProfit(grossAmount, feeAmount, 0, int256(realizedProfit));

    uint256 platformFeeAmount = feeAmount == 0 ? 0 : (feeAmount * platformFeeRatePct) / totalFeeRatePct;
    uint256 affiliateFeeAmount = feeAmount - platformFeeAmount;
    require(vault.feePaidTotal() == feeAmount, "fuzz_fee_total_wrong");
    require(vault.highWaterMarkProfit() == feeBase, "fuzz_hwm_wrong");
    require(vault.realizedPnlNet() == int256(realizedProfit), "fuzz_realized_wrong");
    require(usdc.balanceOf(address(0xBEEF)) == platformFeeAmount, "fuzz_treasury_wrong");
    require(usdc.balanceOf(address(0xAFFE)) == affiliateFeeAmount, "fuzz_affiliate_wrong");
    require(usdc.balanceOf(address(0xCAFE)) == grossAmount - feeAmount, "fuzz_beneficiary_wrong");
    require(usdc.balanceOf(address(vault)) == 0, "fuzz_vault_balance_wrong");
  }

  function testFuzzCloseReturnsPrincipalAndProfitWithinPolicy(
    uint8 platformRaw,
    uint8 affiliateRaw,
    uint96 principalRaw,
    uint96 profitRaw,
    uint96 realizedRaw
  ) public {
    uint256 platformFeeRatePct = uint256(platformRaw) % 51;
    uint256 affiliateFeeRatePct = uint256(affiliateRaw) % (101 - platformFeeRatePct);
    uint256 totalFeeRatePct = platformFeeRatePct + affiliateFeeRatePct;
    uint256 principalAmount = 1 + (uint256(principalRaw) % 500_000_000);
    uint256 profitAmount = uint256(profitRaw) % 500_000_000;
    uint256 realizedProfit = uint256(realizedRaw) % 1_000_000_000;
    uint256 feeBase = profitAmount < realizedProfit ? profitAmount : realizedProfit;
    uint256 feeAmount = totalFeeRatePct == 0 ? 0 : (feeBase * totalFeeRatePct) / 100;
    uint256 grossAmount = principalAmount + profitAmount;

    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(
      platformFeeRatePct,
      affiliateFeeRatePct,
      address(0xAFFE)
    );

    vault.fund(principalAmount);
    if (profitAmount > 0) {
      usdc.transfer(address(vault), profitAmount);
    }
    vault.setCloseOnly();
    vault.closeVault(principalAmount, grossAmount, feeAmount, int256(realizedProfit));

    uint256 platformFeeAmount = feeAmount == 0 ? 0 : (feeAmount * platformFeeRatePct) / totalFeeRatePct;
    uint256 affiliateFeeAmount = feeAmount - platformFeeAmount;
    require(vault.principalDeposited() == principalAmount, "fuzz_principal_deposited_wrong");
    require(vault.principalReturned() == principalAmount, "fuzz_principal_returned_wrong");
    require(vault.feePaidTotal() == feeAmount, "fuzz_close_fee_total_wrong");
    require(vault.highWaterMarkProfit() == feeBase, "fuzz_close_hwm_wrong");
    require(usdc.balanceOf(address(0xBEEF)) == platformFeeAmount, "fuzz_close_treasury_wrong");
    require(usdc.balanceOf(address(0xAFFE)) == affiliateFeeAmount, "fuzz_close_affiliate_wrong");
    require(usdc.balanceOf(address(0xCAFE)) == grossAmount - feeAmount, "fuzz_close_beneficiary_wrong");
    require(usdc.balanceOf(address(vault)) == 0, "fuzz_close_vault_balance_wrong");
  }
}
