// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {BotVaultV3} from "./BotVaultV3.sol";

contract BotVaultFactoryV3 {
  address public immutable usdc;
  address public owner;

  mapping(bytes32 => address) public vaultOfBot;

  event BotVaultV3Created(bytes32 indexed botId, address indexed beneficiary, address indexed vaultAddress);
  event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);

  modifier onlyOwner() {
    require(msg.sender == owner, "only_owner");
    _;
  }

  constructor(address usdc_) {
    require(usdc_ != address(0), "usdc_required");
    usdc = usdc_;
    owner = msg.sender;
  }

  function transferOwnership(address nextOwner) external onlyOwner {
    require(nextOwner != address(0), "owner_required");
    address previousOwner = owner;
    owner = nextOwner;
    emit OwnershipTransferred(previousOwner, nextOwner);
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
    BotVaultV3 vault = new BotVaultV3(usdc, beneficiary, controller, agentWallet, templateId, botId);
    vaultAddress = address(vault);
    vaultOfBot[botId] = vaultAddress;
    emit BotVaultV3Created(botId, beneficiary, vaultAddress);
  }
}
