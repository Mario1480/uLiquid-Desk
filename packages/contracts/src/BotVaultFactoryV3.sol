// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {BotVaultV3} from "./BotVaultV3.sol";

contract BotVaultFactoryV3 {
  address public immutable usdc;
  address public immutable coreDepositWallet;
  address public owner;
  address public treasuryRecipient;
  uint256 public profitShareFeeRatePct;

  mapping(bytes32 => address) public vaultOfBot;

  event BotVaultV3Created(bytes32 indexed botId, address indexed beneficiary, address indexed vaultAddress);
  event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
  event TreasuryRecipientUpdated(address indexed previousRecipient, address indexed nextRecipient);
  event ProfitShareFeeRateUpdated(uint256 previousRatePct, uint256 nextRatePct);

  modifier onlyOwner() {
    require(msg.sender == owner, "only_owner");
    _;
  }

  constructor(address usdc_, address coreDepositWallet_, address treasuryRecipient_, uint256 profitShareFeeRatePct_) {
    require(usdc_ != address(0), "usdc_required");
    require(coreDepositWallet_ != address(0), "core_deposit_wallet_required");
    require(treasuryRecipient_ != address(0), "treasury_recipient_required");
    require(profitShareFeeRatePct_ <= 100, "invalid_profit_share_fee_rate");
    usdc = usdc_;
    coreDepositWallet = coreDepositWallet_;
    owner = msg.sender;
    treasuryRecipient = treasuryRecipient_;
    profitShareFeeRatePct = profitShareFeeRatePct_;
  }

  function transferOwnership(address nextOwner) external onlyOwner {
    require(nextOwner != address(0), "owner_required");
    address previousOwner = owner;
    owner = nextOwner;
    emit OwnershipTransferred(previousOwner, nextOwner);
  }

  function setTreasuryRecipient(address nextRecipient) external onlyOwner {
    require(nextRecipient != address(0), "treasury_recipient_required");
    address previousRecipient = treasuryRecipient;
    treasuryRecipient = nextRecipient;
    emit TreasuryRecipientUpdated(previousRecipient, nextRecipient);
  }

  function setProfitShareFeeRatePct(uint256 nextRatePct) external onlyOwner {
    require(nextRatePct <= 100, "invalid_profit_share_fee_rate");
    uint256 previousRatePct = profitShareFeeRatePct;
    profitShareFeeRatePct = nextRatePct;
    emit ProfitShareFeeRateUpdated(previousRatePct, nextRatePct);
  }

  function createBotVault(
    address beneficiary,
    address controller,
    address agentWallet,
    bytes32 templateId,
    bytes32 botId
  ) external onlyOwner returns (address vaultAddress) {
    require(beneficiary != address(0), "beneficiary_required");
    require(controller != address(0), "controller_required");
    require(vaultOfBot[botId] == address(0), "bot_vault_exists");
    BotVaultV3 vault = new BotVaultV3(address(this), usdc, beneficiary, controller, agentWallet, templateId, botId);
    vaultAddress = address(vault);
    vaultOfBot[botId] = vaultAddress;
    emit BotVaultV3Created(botId, beneficiary, vaultAddress);
  }
}
