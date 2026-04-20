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
      abi.encodeWithSelector(BotVaultV4.claimProfit.selector, 10_000_000, 3_000_000, 0)
    );
    require(!badOk, "invalid_fee_policy_should_revert");

    vault.claimProfit(10_000_000, 1_500_000, 0);
    require(vault.feePaidTotal() == 1_500_000, "fee_paid_total_wrong");
  }

  function testClaimProfitSplitsTreasuryAffiliateAndBeneficiary() public {
    (MockUSDC usdc, , BotVaultV4 vault,) = _setupTradingVault(5, 10, address(0xAFFE));

    usdc.transfer(address(vault), 100_000_000);
    vault.claimProfit(10_000_000, 1_500_000, 0);

    require(usdc.balanceOf(address(0xBEEF)) == 500_000, "treasury_fee_wrong");
    require(usdc.balanceOf(address(0xAFFE)) == 1_000_000, "affiliate_fee_wrong");
    require(usdc.balanceOf(address(0xCAFE)) == 8_500_000, "beneficiary_amount_wrong");
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
}
