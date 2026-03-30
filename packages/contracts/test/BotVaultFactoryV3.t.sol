// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {BotVaultFactoryV3} from "../src/BotVaultFactoryV3.sol";
import {BotVaultV3} from "../src/BotVaultV3.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface Vm {
  function prank(address msgSender) external;
  function etch(address target, bytes calldata code) external;
  function expectRevert(bytes calldata) external;
}

contract MockHyperCoreDepositWallet {
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

contract MockHyperCoreWriter {
  bytes public lastData;
  uint256 public calls;

  function sendRawAction(bytes calldata data) external payable {
    lastData = data;
    calls += 1;
  }
}

contract UnauthorizedBotVaultFactoryV3Updater {
  function trySetTreasuryRecipient(address factory, address nextRecipient) external returns (bool ok) {
    (ok,) = factory.call(abi.encodeWithSelector(BotVaultFactoryV3.setTreasuryRecipient.selector, nextRecipient));
  }

  function trySetProfitShareFeeRatePct(address factory, uint256 nextRatePct) external returns (bool ok) {
    (ok,) = factory.call(abi.encodeWithSelector(BotVaultFactoryV3.setProfitShareFeeRatePct.selector, nextRatePct));
  }

  function tryCreateBotVault(
    address factory,
    address beneficiary,
    address controller,
    address agentWallet,
    bytes32 templateId,
    bytes32 botId
  ) external returns (bool ok) {
    (ok,) = factory.call(
      abi.encodeWithSelector(
        BotVaultFactoryV3.createBotVault.selector,
        beneficiary,
        controller,
        agentWallet,
        templateId,
        botId
      )
    );
  }
}

contract BotVaultFactoryV3Test {
  Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
  address internal constant HYPERCORE_WRITER = 0x3333333333333333333333333333333333333333;
  address internal constant AGENT = address(0xA9137);

  function _setupTradingVault()
    private
    returns (MockUSDC usdc, BotVaultFactoryV3 factory, BotVaultV3 vault, MockHyperCoreWriter writer)
  {
    MockHyperCoreWriter deployedWriter = new MockHyperCoreWriter();
    vm.etch(HYPERCORE_WRITER, address(deployedWriter).code);
    writer = MockHyperCoreWriter(HYPERCORE_WRITER);

    usdc = new MockUSDC();
    MockHyperCoreDepositWallet depositWallet = new MockHyperCoreDepositWallet(address(usdc));
    factory = new BotVaultFactoryV3(address(usdc), address(depositWallet), address(0xBEEF), 30);
    address vaultAddress = factory.createBotVault(
      address(0xCAFE),
      address(this),
      AGENT,
      bytes32("template"),
      bytes32("bot")
    );
    vault = BotVaultV3(vaultAddress);
    usdc.mint(address(this), 1_000_000_000);
    usdc.approve(address(vault), type(uint256).max);
  }

  function testFactoryStoresTreasuryConfigAndCreatesVault() public {
    MockUSDC usdc = new MockUSDC();
    MockHyperCoreDepositWallet depositWallet = new MockHyperCoreDepositWallet(address(usdc));
    BotVaultFactoryV3 factory = new BotVaultFactoryV3(address(usdc), address(depositWallet), address(0xBEEF), 30);

    address vaultAddress = factory.createBotVault(
      address(0xCAFE),
      address(this),
      address(0xABCD),
      bytes32("template"),
      bytes32("bot")
    );

    require(factory.treasuryRecipient() == address(0xBEEF), "treasury_not_set");
    require(factory.profitShareFeeRatePct() == 30, "fee_rate_not_set");
    require(factory.coreDepositWallet() == address(depositWallet), "core_deposit_wallet_not_set");
    require(factory.vaultOfBot(bytes32("bot")) == vaultAddress, "vault_mapping_not_set");
    require(BotVaultV3(vaultAddress).beneficiary() == address(0xCAFE), "beneficiary_not_set");
    require(address(BotVaultV3(vaultAddress).factory()) == address(factory), "factory_not_set_on_vault");
  }

  function testBeneficiaryCanCreateVaultDirectly() public {
    MockUSDC usdc = new MockUSDC();
    MockHyperCoreDepositWallet depositWallet = new MockHyperCoreDepositWallet(address(usdc));
    BotVaultFactoryV3 factory = new BotVaultFactoryV3(address(usdc), address(depositWallet), address(0xBEEF), 30);
    address beneficiary = address(0xCAFE);

    vm.prank(beneficiary);
    address vaultAddress = factory.createBotVault(
      beneficiary,
      address(this),
      address(0xABCD),
      bytes32("template"),
      bytes32("bot_direct")
    );

    require(BotVaultV3(vaultAddress).beneficiary() == beneficiary, "beneficiary_not_set");
  }

  function testClaimProfitPaysTreasury() public {
    MockUSDC usdc = new MockUSDC();
    MockHyperCoreDepositWallet depositWallet = new MockHyperCoreDepositWallet(address(usdc));
    address treasury = address(0xBEEF);
    address beneficiary = address(0xCAFE);
    BotVaultFactoryV3 factory = new BotVaultFactoryV3(address(usdc), address(depositWallet), treasury, 30);
    address vaultAddress = factory.createBotVault(
      beneficiary,
      address(this),
      address(0),
      bytes32("template"),
      bytes32("bot")
    );
    BotVaultV3 vault = BotVaultV3(vaultAddress);

    usdc.mint(address(this), 1_000_000_000);
    usdc.transfer(vaultAddress, 100_000_000);
    vault.claimProfit(10_000_000, 3_000_000, 0);

    require(usdc.balanceOf(treasury) == 3_000_000, "treasury_fee_missing");
    require(usdc.balanceOf(beneficiary) == 7_000_000, "beneficiary_net_missing");
    require(vault.feePaidTotal() == 3_000_000, "fee_paid_total_wrong");
  }

  function testOnlyOwnerCanUpdateTreasurySettings() public {
    MockUSDC usdc = new MockUSDC();
    MockHyperCoreDepositWallet depositWallet = new MockHyperCoreDepositWallet(address(usdc));
    BotVaultFactoryV3 factory = new BotVaultFactoryV3(address(usdc), address(depositWallet), address(0xBEEF), 30);
    UnauthorizedBotVaultFactoryV3Updater unauthorized = new UnauthorizedBotVaultFactoryV3Updater();

    factory.setTreasuryRecipient(address(0xCAFE));
    factory.setProfitShareFeeRatePct(20);
    require(factory.treasuryRecipient() == address(0xCAFE), "treasury_not_updated");
    require(factory.profitShareFeeRatePct() == 20, "fee_rate_not_updated");

    bool treasuryOk = unauthorized.trySetTreasuryRecipient(address(factory), address(0xF00D));
    bool feeRateOk = unauthorized.trySetProfitShareFeeRatePct(address(factory), 10);
    bool createOk = unauthorized.tryCreateBotVault(
      address(factory),
      address(0xCAFE),
      address(this),
      address(0xABCD),
      bytes32("template"),
      bytes32("bot_unauthorized")
    );
    require(!treasuryOk, "non_owner_treasury_call_should_revert");
    require(!feeRateOk, "non_owner_fee_rate_call_should_revert");
    require(!createOk, "non_beneficiary_create_should_revert");
  }

  function testAgentCanDepositVaultUsdcToHyperCore() public {
    MockUSDC usdc = new MockUSDC();
    MockHyperCoreDepositWallet depositWallet = new MockHyperCoreDepositWallet(address(usdc));
    BotVaultFactoryV3 factory = new BotVaultFactoryV3(address(usdc), address(depositWallet), address(0xBEEF), 30);
    address vaultAddress = factory.createBotVault(
      address(0xCAFE),
      address(this),
      address(0xABCD),
      bytes32("template"),
      bytes32("bot")
    );
    BotVaultV3 vault = BotVaultV3(vaultAddress);

    usdc.mint(vaultAddress, 25_000_000);
    vault.depositUsdcToHyperCore(12_500_000);

    require(usdc.balanceOf(vaultAddress) == 12_500_000, "vault_balance_not_decremented");
    require(usdc.balanceOf(address(depositWallet)) == 12_500_000, "deposit_wallet_not_credited");
    require(depositWallet.lastAmount() == 12_500_000, "deposit_amount_not_recorded");
    require(depositWallet.lastDestinationDex() == type(uint32).max, "destination_dex_not_spot");
  }

  function testCloseOnlyBlocksFurtherCoreDeposits() public {
    (, , BotVaultV3 vault,) = _setupTradingVault();

    vault.fund(1);
    vault.activate();
    vault.setCloseOnly();

    vm.prank(AGENT);
    (bool ok,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV3.depositUsdcToHyperCore.selector, uint256(1))
    );
    require(!ok, "close_only_deposit_should_revert");
  }

  function testPausedBlocksNewExposureIncreasingActions() public {
    (, , BotVaultV3 vault, MockHyperCoreWriter writer) = _setupTradingVault();

    vault.fund(1);
    vault.activate();
    vault.pause();

    vm.prank(AGENT);
    (bool transferOk,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV3.sendUsdClassTransfer.selector, uint64(1_000_000), true)
    );
    require(!transferOk, "paused_to_perp_transfer_should_revert");

    vm.prank(AGENT);
    (bool orderOk,) = address(vault).call(
      abi.encodeWithSelector(
        BotVaultV3.placeHyperCoreLimitOrder.selector,
        uint32(7),
        true,
        uint64(6_600_000_000),
        uint64(100_000_000),
        false,
        uint8(2),
        uint128(1)
      )
    );
    require(!orderOk, "paused_non_reduce_order_should_revert");

    vm.prank(AGENT);
    vault.placeHyperCoreLimitOrder(7, false, 6_500_000_000, 100_000_000, true, 2, 1);
    require(writer.calls() == 1, "reduce_only_order_should_forward");
  }

  function testClosedVaultCanRecoverFundsAfterLateCoreSettlement() public {
    MockUSDC usdc = new MockUSDC();
    MockHyperCoreDepositWallet depositWallet = new MockHyperCoreDepositWallet(address(usdc));
    address treasury = address(0xBEEF);
    address beneficiary = address(0xCAFE);
    BotVaultFactoryV3 factory = new BotVaultFactoryV3(address(usdc), address(depositWallet), treasury, 30);
    address vaultAddress = factory.createBotVault(
      beneficiary,
      address(this),
      AGENT,
      bytes32("template"),
      bytes32("bot_recover")
    );
    BotVaultV3 vault = BotVaultV3(vaultAddress);

    usdc.mint(address(this), 100_000_000);
    usdc.approve(vaultAddress, type(uint256).max);
    vault.fund(73_000_000);
    vault.activate();
    vault.setCloseOnly();
    vault.closeVault(73_000_000, 73_000_000, 0);

    usdc.mint(vaultAddress, 72_000_000);
    vault.recoverClosedFunds(72_000_000, 72_000_000, 0);

    require(usdc.balanceOf(beneficiary) == 145_000_000, "beneficiary_recovery_missing");
    require(vault.principalReturned() == 145_000_000, "principal_returned_after_recovery");
  }

  function testClosedVaultCanTransferUsdBackToSpotForRecovery() public {
    (, , BotVaultV3 vault, MockHyperCoreWriter writer) = _setupTradingVault();

    vault.fund(1);
    vault.activate();
    vault.setCloseOnly();
    vault.closeVault(1, 1, 0);

    vm.prank(AGENT);
    vault.sendUsdClassTransfer(1_000_000, false);

    require(writer.calls() == 1, "closed_recovery_transfer_not_forwarded");
  }

  function testClosedVaultStillBlocksTransferToPerp() public {
    (, , BotVaultV3 vault, ) = _setupTradingVault();

    vault.fund(1);
    vault.activate();
    vault.setCloseOnly();
    vault.closeVault(1, 1, 0);

    vm.prank(AGENT);
    (bool ok,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV3.sendUsdClassTransfer.selector, uint64(1_000_000), true)
    );
    require(!ok, "closed_to_perp_transfer_should_revert");
  }

  function testDeployedBlocksNewOrders() public {
    (, , BotVaultV3 vault,) = _setupTradingVault();

    vm.prank(AGENT);
    (bool ok,) = address(vault).call(
      abi.encodeWithSelector(
        BotVaultV3.placeHyperCoreLimitOrder.selector,
        uint32(7),
        true,
        uint64(6_600_000_000),
        uint64(100_000_000),
        false,
        uint8(2),
        uint128(1)
      )
    );
    require(!ok, "deployed_order_should_revert");
  }

  function testFundedBlocksNewOrdersUntilActive() public {
    (, , BotVaultV3 vault,) = _setupTradingVault();
    vault.fund(1);

    vm.prank(AGENT);
    (bool ok,) = address(vault).call(
      abi.encodeWithSelector(
        BotVaultV3.placeHyperCoreLimitOrder.selector,
        uint32(7),
        true,
        uint64(6_600_000_000),
        uint64(100_000_000),
        false,
        uint8(2),
        uint128(1)
      )
    );
    require(!ok, "funded_order_should_revert");
  }

  function testActiveAllowsNormalOrders() public {
    (, , BotVaultV3 vault, MockHyperCoreWriter writer) = _setupTradingVault();
    vault.fund(1);
    vault.activate();

    vm.prank(AGENT);
    vault.placeHyperCoreLimitOrder(7, true, 6_600_000_000, 100_000_000, false, 2, 1);
    require(writer.calls() == 1, "active_order_should_forward");
  }

  function testCloseOnlyAllowsOnlyReduceOnlyOrdersAndPerpReduction() public {
    (, , BotVaultV3 vault, MockHyperCoreWriter writer) = _setupTradingVault();

    vault.fund(1);
    vault.activate();
    vault.setCloseOnly();

    vm.prank(AGENT);
    (bool orderOk,) = address(vault).call(
      abi.encodeWithSelector(
        BotVaultV3.placeHyperCoreLimitOrder.selector,
        uint32(7),
        true,
        uint64(6_600_000_000),
        uint64(100_000_000),
        false,
        uint8(2),
        uint128(1)
      )
    );
    require(!orderOk, "close_only_non_reduce_order_should_revert");

    vm.prank(AGENT);
    (bool transferOk,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV3.sendUsdClassTransfer.selector, uint64(1_000_000), true)
    );
    require(!transferOk, "close_only_to_perp_transfer_should_revert");

    vm.prank(AGENT);
    vault.sendUsdClassTransfer(1_000_000, false);
    require(writer.calls() == 1, "close_only_perp_reduction_should_forward");
  }

  function testCancelByOidIsExposed() public {
    (, , BotVaultV3 vault, MockHyperCoreWriter writer) = _setupTradingVault();

    vm.prank(AGENT);
    vault.cancelHyperCoreOrderByOid(7, 42);

    require(writer.calls() == 1, "writer_not_called");
    bytes memory expected = abi.encodePacked(
      bytes1(uint8(1)),
      bytes3(uint24(10)),
      abi.encode(uint32(7), uint64(42))
    );
    require(keccak256(writer.lastData()) == keccak256(expected), "encoded_cancel_oid_mismatch");
  }

  function testLimitOrderRejectsInvalidInputs() public {
    (, , BotVaultV3 vault,) = _setupTradingVault();

    vm.prank(AGENT);
    (bool priceOk,) = address(vault).call(
      abi.encodeWithSelector(
        BotVaultV3.placeHyperCoreLimitOrder.selector,
        uint32(7),
        true,
        uint64(0),
        uint64(100_000_000),
        false,
        uint8(2),
        uint128(1)
      )
    );
    require(!priceOk, "zero_price_should_revert");

    vm.prank(AGENT);
    (bool sizeOk,) = address(vault).call(
      abi.encodeWithSelector(
        BotVaultV3.placeHyperCoreLimitOrder.selector,
        uint32(7),
        true,
        uint64(6_600_000_000),
        uint64(0),
        false,
        uint8(2),
        uint128(1)
      )
    );
    require(!sizeOk, "zero_size_should_revert");

    vm.prank(AGENT);
    (bool tifOk,) = address(vault).call(
      abi.encodeWithSelector(
        BotVaultV3.placeHyperCoreLimitOrder.selector,
        uint32(7),
        true,
        uint64(6_600_000_000),
        uint64(100_000_000),
        false,
        uint8(4),
        uint128(1)
      )
    );
    require(!tifOk, "invalid_tif_should_revert");
  }

  function testClaimProfitEnforcesFactoryFeePolicy() public {
    (MockUSDC usdc, BotVaultFactoryV3 factory, BotVaultV3 vault,) = _setupTradingVault();
    require(factory.profitShareFeeRatePct() == 30, "fee_rate_not_set");

    usdc.mint(address(this), 1_000_000_000);
    usdc.transfer(address(vault), 100_000_000);

    (bool badOk,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV3.claimProfit.selector, 10_000_000, 1_000_000, 0)
    );
    require(!badOk, "invalid_fee_policy_should_revert");

    vault.claimProfit(10_000_000, 3_000_000, 0);
  }

  function testCloseVaultRejectsPrincipalGreaterThanGross() public {
    (MockUSDC usdc, , BotVaultV3 vault,) = _setupTradingVault();

    usdc.mint(address(this), 100_000_000);
    usdc.approve(address(vault), type(uint256).max);
    vault.fund(73_000_000);
    vault.activate();
    vault.setCloseOnly();

    (bool ok,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV3.closeVault.selector, 73_000_000, 0, 0)
    );
    require(!ok, "principal_exceeds_gross_should_revert");
  }

  function testClaimProfitRejectsPrincipalGreaterThanOutstanding() public {
    (MockUSDC usdc, , BotVaultV3 vault,) = _setupTradingVault();

    usdc.mint(address(this), 100_000_000);
    usdc.approve(address(vault), type(uint256).max);
    vault.fund(10_000_000);
    usdc.transfer(address(vault), 10_000_000);
    vault.claimProfit(10_000_000, 0, 10_000_000);

    usdc.transfer(address(vault), 1_000_000);
    (bool ok,) = address(vault).call(
      abi.encodeWithSelector(BotVaultV3.claimProfit.selector, 1_000_000, 0, 1)
    );
    require(!ok, "principal_exceeds_outstanding_should_revert");
  }
}
