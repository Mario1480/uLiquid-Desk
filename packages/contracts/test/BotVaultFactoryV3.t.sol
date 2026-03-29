// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {BotVaultFactoryV3} from "../src/BotVaultFactoryV3.sol";
import {BotVaultV3} from "../src/BotVaultV3.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

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

contract UnauthorizedBotVaultFactoryV3Updater {
  function trySetTreasuryRecipient(address factory, address nextRecipient) external returns (bool ok) {
    (ok,) = factory.call(abi.encodeWithSelector(BotVaultFactoryV3.setTreasuryRecipient.selector, nextRecipient));
  }

  function trySetProfitShareFeeRatePct(address factory, uint256 nextRatePct) external returns (bool ok) {
    (ok,) = factory.call(abi.encodeWithSelector(BotVaultFactoryV3.setProfitShareFeeRatePct.selector, nextRatePct));
  }
}

contract BotVaultFactoryV3Test {
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
    require(!treasuryOk, "non_owner_treasury_call_should_revert");
    require(!feeRateOk, "non_owner_fee_rate_call_should_revert");
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
}
