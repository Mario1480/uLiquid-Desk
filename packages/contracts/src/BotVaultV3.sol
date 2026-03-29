// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "./interfaces/IERC20.sol";
import {HyperCoreActionEncoder} from "./HyperCoreActionEncoder.sol";
import {IHyperCoreWriter} from "./interfaces/IHyperCoreWriter.sol";

contract BotVaultV3 {
  address internal constant HYPERCORE_WRITER = 0x3333333333333333333333333333333333333333;

  enum Status {
    DEPLOYED,
    FUNDED,
    ACTIVE,
    PAUSED,
    CLOSE_ONLY,
    CLOSED
  }

  IERC20 public immutable usdc;
  address public immutable beneficiary;
  address public controller;
  address public agentWallet;
  bytes32 public immutable templateId;
  bytes32 public immutable botId;

  Status public status;
  uint256 public principalDeposited;
  uint256 public principalReturned;
  int256 public realizedPnlNet;
  uint256 public feePaidTotal;
  uint256 public highWaterMarkProfit;

  event ControllerUpdated(address indexed previousController, address indexed nextController);
  event AgentWalletUpdated(address indexed previousAgentWallet, address indexed nextAgentWallet);
  event Funded(address indexed from, uint256 amount, uint256 principalDepositedAfter);
  event ProfitClaimed(uint256 grossAmount, uint256 feeAmount, uint256 netAmount);
  event VaultClosed(uint256 principalReturnedTotal, uint256 feePaidTotalAfter);
  event StatusChanged(Status indexed previousStatus, Status indexed nextStatus);
  event HyperCoreActionForwarded(uint24 indexed actionId, bytes data);

  modifier onlyController() {
    require(msg.sender == controller, "only_controller");
    _;
  }

  modifier onlyControllerOrAgent() {
    require(msg.sender == controller || msg.sender == agentWallet, "only_controller_or_agent");
    _;
  }

  constructor(
    address usdc_,
    address beneficiary_,
    address controller_,
    address agentWallet_,
    bytes32 templateId_,
    bytes32 botId_
  ) {
    require(usdc_ != address(0), "usdc_required");
    require(beneficiary_ != address(0), "beneficiary_required");
    require(controller_ != address(0), "controller_required");
    usdc = IERC20(usdc_);
    beneficiary = beneficiary_;
    controller = controller_;
    agentWallet = agentWallet_;
    templateId = templateId_;
    botId = botId_;
    status = Status.DEPLOYED;
  }

  function setController(address nextController) external onlyController {
    require(nextController != address(0), "controller_required");
    address previousController = controller;
    controller = nextController;
    emit ControllerUpdated(previousController, nextController);
  }

  function setAgentWallet(address nextAgentWallet) external onlyController {
    address previousAgentWallet = agentWallet;
    agentWallet = nextAgentWallet;
    emit AgentWalletUpdated(previousAgentWallet, nextAgentWallet);
  }

  function fund(uint256 amount) external {
    require(status != Status.CLOSED, "vault_closed");
    require(amount > 0, "amount_required");
    require(usdc.transferFrom(msg.sender, address(this), amount), "fund_transfer_failed");
    principalDeposited += amount;
    if (status == Status.DEPLOYED) {
      status = Status.FUNDED;
      emit StatusChanged(Status.DEPLOYED, Status.FUNDED);
    }
    emit Funded(msg.sender, amount, principalDeposited);
  }

  function activate() external onlyController {
    require(status == Status.FUNDED || status == Status.PAUSED, "invalid_transition");
    Status previous = status;
    status = Status.ACTIVE;
    emit StatusChanged(previous, Status.ACTIVE);
  }

  function pause() external onlyController {
    require(status == Status.ACTIVE, "invalid_transition");
    status = Status.PAUSED;
    emit StatusChanged(Status.ACTIVE, Status.PAUSED);
  }

  function setCloseOnly() external onlyController {
    require(status == Status.ACTIVE || status == Status.PAUSED || status == Status.FUNDED, "invalid_transition");
    Status previous = status;
    status = Status.CLOSE_ONLY;
    emit StatusChanged(previous, Status.CLOSE_ONLY);
  }

  function claimProfit(uint256 grossAmount, uint256 feeAmount, uint256 principalPortion) external onlyController {
    require(status != Status.CLOSED, "vault_closed");
    require(grossAmount > 0, "amount_required");
    require(grossAmount >= feeAmount, "fee_exceeds_gross");
    uint256 availableBalance = usdc.balanceOf(address(this));
    require(grossAmount <= availableBalance, "insufficient_usdc");
    uint256 profitComponent = grossAmount > principalPortion ? grossAmount - principalPortion : 0;
    require(feeAmount <= profitComponent, "fee_exceeds_profit");
    feePaidTotal += feeAmount;
    if (principalPortion > 0) {
      principalReturned += principalPortion;
    }
    realizedPnlNet += int256(profitComponent) - int256(feeAmount);
    if (profitComponent > highWaterMarkProfit) {
      highWaterMarkProfit = profitComponent;
    }
    require(usdc.transfer(beneficiary, grossAmount - feeAmount), "claim_transfer_failed");
    emit ProfitClaimed(grossAmount, feeAmount, grossAmount - feeAmount);
  }

  function closeVault(uint256 principalToReturn, uint256 grossAmount, uint256 feeAmount) external onlyController {
    require(status == Status.CLOSE_ONLY, "invalid_transition");
    require(grossAmount >= feeAmount, "fee_exceeds_gross");
    uint256 availableBalance = usdc.balanceOf(address(this));
    require(grossAmount <= availableBalance, "insufficient_usdc");
    uint256 profitComponent = grossAmount > principalToReturn ? grossAmount - principalToReturn : 0;
    require(feeAmount <= profitComponent, "fee_exceeds_profit");
    principalReturned += principalToReturn;
    feePaidTotal += feeAmount;
    realizedPnlNet += int256(profitComponent) - int256(feeAmount);
    require(usdc.transfer(beneficiary, grossAmount - feeAmount), "close_transfer_failed");
    status = Status.CLOSED;
    emit StatusChanged(Status.CLOSE_ONLY, Status.CLOSED);
    emit VaultClosed(principalReturned, feePaidTotal);
  }

  function sendUsdClassTransfer(uint64 ntl, bool toPerp) external onlyControllerOrAgent {
    require(status != Status.CLOSED, "vault_closed");
    bytes memory data = HyperCoreActionEncoder.encodeUsdClassTransfer(ntl, toPerp);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_USD_CLASS_TRANSFER, data);
  }

  function placeHyperCoreLimitOrder(
    uint32 asset,
    bool isBuy,
    uint64 limitPx,
    uint64 sz,
    bool reduceOnly,
    uint8 encodedTif,
    uint128 cloid
  ) external onlyControllerOrAgent {
    require(status != Status.CLOSED, "vault_closed");
    bytes memory data = HyperCoreActionEncoder.encodeLimitOrder(
      asset, isBuy, limitPx, sz, reduceOnly, encodedTif, cloid
    );
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_LIMIT_ORDER, data);
  }

  function cancelHyperCoreOrderByCloid(uint32 asset, uint128 cloid) external onlyControllerOrAgent {
    require(status != Status.CLOSED, "vault_closed");
    bytes memory data = HyperCoreActionEncoder.encodeCancelByCloid(asset, cloid);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_CANCEL_BY_CLOID, data);
  }
}
