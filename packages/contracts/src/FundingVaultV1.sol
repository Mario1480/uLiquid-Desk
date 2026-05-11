// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "./interfaces/IERC20.sol";
import {BotVaultFactoryV4} from "./BotVaultFactoryV4.sol";
import {BotVaultV4} from "./BotVaultV4.sol";

contract FundingVaultV1 {
  IERC20 public immutable usdc;
  BotVaultFactoryV4 public immutable botVaultFactory;
  address public immutable owner;
  address public operator;
  bool public operatorPaused;

  mapping(bytes32 => bool) public usedActionIds;

  struct LaunchParams {
    address controller;
    address agentWallet;
    bytes32 templateId;
    bytes32 botId;
    uint256 amount;
    uint256 platformFeeRatePct;
    uint256 affiliateFeeRatePct;
    address affiliateRecipient;
  }

  event Deposited(address indexed sender, uint256 amount, uint256 balanceAfter);
  event OwnerWithdrawn(address indexed owner, uint256 amount, uint256 balanceAfter);
  event OperatorWithdrawnToOwner(address indexed operator, bytes32 indexed actionId, uint256 amount, uint256 balanceAfter);
  event OperatorUpdated(address indexed previousOperator, address indexed nextOperator);
  event OperatorPauseUpdated(bool paused);
  event BotVaultLaunched(
    address indexed operator,
    bytes32 indexed actionId,
    bytes32 indexed botId,
    address botVault,
    uint256 amount
  );
  event BotVaultFunded(address indexed operator, bytes32 indexed actionId, address indexed botVault, uint256 amount);

  modifier onlyOwner() {
    require(msg.sender == owner, "only_owner");
    _;
  }

  modifier onlyOperatorActive() {
    require(msg.sender == operator, "only_operator");
    require(!operatorPaused, "operator_paused");
    _;
  }

  constructor(address usdc_, address owner_, address operator_, address botVaultFactory_) {
    require(usdc_ != address(0), "usdc_required");
    require(owner_ != address(0), "owner_required");
    require(operator_ != address(0), "operator_required");
    require(botVaultFactory_ != address(0), "bot_vault_factory_required");
    usdc = IERC20(usdc_);
    owner = owner_;
    operator = operator_;
    botVaultFactory = BotVaultFactoryV4(botVaultFactory_);
  }

  function balance() external view returns (uint256) {
    return usdc.balanceOf(address(this));
  }

  function deposit(uint256 amount) external {
    require(amount > 0, "amount_required");
    require(usdc.transferFrom(msg.sender, address(this), amount), "deposit_transfer_failed");
    emit Deposited(msg.sender, amount, usdc.balanceOf(address(this)));
  }

  function ownerWithdraw(uint256 amount) external onlyOwner {
    _withdrawToOwner(amount);
    emit OwnerWithdrawn(owner, amount, usdc.balanceOf(address(this)));
  }

  function operatorWithdrawToOwner(uint256 amount, bytes32 actionId) external onlyOperatorActive {
    _consumeActionId(actionId);
    _withdrawToOwner(amount);
    emit OperatorWithdrawnToOwner(msg.sender, actionId, amount, usdc.balanceOf(address(this)));
  }

  function setOperator(address nextOperator) external onlyOwner {
    require(nextOperator != address(0), "operator_required");
    address previousOperator = operator;
    operator = nextOperator;
    emit OperatorUpdated(previousOperator, nextOperator);
  }

  function setOperatorPaused(bool paused) external onlyOwner {
    operatorPaused = paused;
    emit OperatorPauseUpdated(paused);
  }

  function launchBotVault(LaunchParams calldata params, bytes32 actionId)
    external
    onlyOperatorActive
    returns (address botVault)
  {
    _consumeActionId(actionId);
    require(params.amount > 0, "amount_required");
    require(params.controller != address(0), "controller_required");
    require(params.agentWallet != address(0), "agent_wallet_required");
    require(params.platformFeeRatePct + params.affiliateFeeRatePct <= 100, "invalid_profit_share_fee_rate");

    botVault = botVaultFactory.createBotVault(
      address(this),
      params.controller,
      params.agentWallet,
      params.templateId,
      params.botId,
      params.platformFeeRatePct,
      params.affiliateFeeRatePct,
      params.affiliateRecipient
    );
    _fundBotVault(botVault, params.amount);
    emit BotVaultLaunched(msg.sender, actionId, params.botId, botVault, params.amount);
  }

  function fundExistingBotVault(address botVault, uint256 amount, bytes32 actionId) external onlyOperatorActive {
    _consumeActionId(actionId);
    _fundBotVault(botVault, amount);
    emit BotVaultFunded(msg.sender, actionId, botVault, amount);
  }

  function _withdrawToOwner(uint256 amount) private {
    require(amount > 0, "amount_required");
    require(usdc.transfer(owner, amount), "withdraw_transfer_failed");
  }

  function _fundBotVault(address botVault, uint256 amount) private {
    require(botVault != address(0), "bot_vault_required");
    require(amount > 0, "amount_required");
    require(usdc.approve(botVault, 0), "approve_reset_failed");
    require(usdc.approve(botVault, amount), "approve_failed");
    BotVaultV4(botVault).fund(amount);
    require(usdc.approve(botVault, 0), "approve_cleanup_failed");
  }

  function _consumeActionId(bytes32 actionId) private {
    require(actionId != bytes32(0), "action_id_required");
    require(!usedActionIds[actionId], "action_id_used");
    usedActionIds[actionId] = true;
  }
}
