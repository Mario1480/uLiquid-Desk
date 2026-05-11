// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {FundingVaultV1} from "./FundingVaultV1.sol";

contract FundingVaultFactoryV1 {
  address public immutable usdc;
  address public immutable botVaultFactory;

  mapping(address => address) public fundingVaultOf;

  event FundingVaultCreated(address indexed owner, address indexed operator, address indexed fundingVault);

  constructor(address usdc_, address botVaultFactory_) {
    require(usdc_ != address(0), "usdc_required");
    require(botVaultFactory_ != address(0), "bot_vault_factory_required");
    usdc = usdc_;
    botVaultFactory = botVaultFactory_;
  }

  function createFundingVault(address operator) external returns (address fundingVault) {
    require(operator != address(0), "operator_required");
    require(fundingVaultOf[msg.sender] == address(0), "funding_vault_exists");
    FundingVaultV1 vault = new FundingVaultV1(usdc, msg.sender, operator, botVaultFactory);
    fundingVault = address(vault);
    fundingVaultOf[msg.sender] = fundingVault;
    emit FundingVaultCreated(msg.sender, operator, fundingVault);
  }
}
