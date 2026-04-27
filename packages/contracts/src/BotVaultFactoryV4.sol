// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {BotVaultV4} from "./BotVaultV4.sol";

contract BotVaultFactoryV4 {
  address public immutable usdc;
  address public immutable coreDepositWallet;
  address public owner;
  address public treasuryRecipient;

  mapping(bytes32 => address) public vaultOfBot;

  // Keep the legacy event name so existing indexers can process V4 factory deployments without an ABI migration.
  event BotVaultV3Created(bytes32 indexed botId, address indexed beneficiary, address indexed vaultAddress);
  event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
  event TreasuryRecipientUpdated(address indexed previousRecipient, address indexed nextRecipient);

  modifier onlyOwner() {
    require(msg.sender == owner, "only_owner");
    _;
  }

  constructor(address usdc_, address coreDepositWallet_, address treasuryRecipient_) {
    require(usdc_ != address(0), "usdc_required");
    require(coreDepositWallet_ != address(0), "core_deposit_wallet_required");
    require(treasuryRecipient_ != address(0), "treasury_recipient_required");
    usdc = usdc_;
    coreDepositWallet = coreDepositWallet_;
    owner = msg.sender;
    treasuryRecipient = treasuryRecipient_;
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

  function createBotVault(
    address beneficiary,
    address controller,
    address agentWallet,
    bytes32 templateId,
    bytes32 botId,
    uint256 platformFeeRatePct,
    uint256 affiliateFeeRatePct,
    address affiliateRecipient
  ) external returns (address vaultAddress) {
    require(beneficiary != address(0), "beneficiary_required");
    require(msg.sender == beneficiary || msg.sender == owner, "beneficiary_or_owner_only");
    require(controller != address(0), "controller_required");
    require(vaultOfBot[botId] == address(0), "bot_vault_exists");
    BotVaultV4 vault = new BotVaultV4(
      address(this),
      usdc,
      beneficiary,
      controller,
      agentWallet,
      templateId,
      botId,
      platformFeeRatePct,
      affiliateFeeRatePct,
      affiliateRecipient
    );
    vaultAddress = address(vault);
    vaultOfBot[botId] = vaultAddress;
    emit BotVaultV3Created(botId, beneficiary, vaultAddress);
  }
}
