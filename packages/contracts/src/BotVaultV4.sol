// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "./interfaces/IERC20.sol";
import {HyperCoreActionEncoder} from "./HyperCoreActionEncoder.sol";
import {IHyperCoreWriter} from "./interfaces/IHyperCoreWriter.sol";

interface IBotVaultFactoryV4 {
  function treasuryRecipient() external view returns (address);
  function coreDepositWallet() external view returns (address);
}

interface IHyperCoreDepositWalletV4 {
  function deposit(uint256 amount, uint32 destinationDex) external;
}

contract BotVaultV4 {
  address internal constant HYPERCORE_WRITER = 0x3333333333333333333333333333333333333333;

  enum Status {
    DEPLOYED,
    FUNDED,
    ACTIVE,
    PAUSED,
    CLOSE_ONLY,
    CLOSED
  }

  IBotVaultFactoryV4 public immutable factory;
  IERC20 public immutable usdc;
  address public immutable beneficiary;
  address public immutable affiliateRecipient;
  address public controller;
  address public agentWallet;
  bytes32 public immutable templateId;
  bytes32 public immutable botId;
  uint256 public immutable profitShareFeeRatePct;
  uint256 public immutable platformFeeRatePct;
  uint256 public immutable affiliateFeeRatePct;

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
  event TreasuryFeePaid(
    address indexed botVault,
    address indexed recipient,
    uint256 feeAmount,
    uint256 grossReturned,
    uint256 netReturned,
    uint256 highWaterMarkAfter
  );
  event AffiliateFeePaid(
    address indexed botVault,
    address indexed recipient,
    uint256 feeAmount,
    uint256 grossReturned,
    uint256 netReturned,
    uint256 highWaterMarkAfter
  );
  event StatusChanged(Status indexed previousStatus, Status indexed nextStatus);
  event HyperCoreActionForwarded(uint24 indexed actionId, bytes data);
  event ClosedRecoveryApplied(
    uint256 principalRecovered,
    uint256 grossAmount,
    uint256 feeAmount,
    uint256 netAmount
  );
  event HyperCoreUsdcDepositRequested(
    address indexed botVault,
    address indexed depositWallet,
    uint256 amount,
    uint32 destinationDex
  );

  modifier onlyController() {
    require(msg.sender == controller, "only_controller");
    _;
  }

  modifier onlyControllerOrAgent() {
    require(msg.sender == controller || msg.sender == agentWallet, "only_controller_or_agent");
    _;
  }

  constructor(
    address factory_,
    address usdc_,
    address beneficiary_,
    address controller_,
    address agentWallet_,
    bytes32 templateId_,
    bytes32 botId_,
    uint256 platformFeeRatePct_,
    uint256 affiliateFeeRatePct_,
    address affiliateRecipient_
  ) {
    require(factory_ != address(0), "factory_required");
    require(usdc_ != address(0), "usdc_required");
    require(beneficiary_ != address(0), "beneficiary_required");
    require(controller_ != address(0), "controller_required");
    require(platformFeeRatePct_ <= 100, "invalid_platform_fee_rate");
    require(affiliateFeeRatePct_ <= 100, "invalid_affiliate_fee_rate");
    require(platformFeeRatePct_ + affiliateFeeRatePct_ <= 100, "invalid_profit_share_fee_rate");
    require(affiliateFeeRatePct_ == 0 || affiliateRecipient_ != address(0), "affiliate_recipient_required");
    factory = IBotVaultFactoryV4(factory_);
    usdc = IERC20(usdc_);
    beneficiary = beneficiary_;
    affiliateRecipient = affiliateRecipient_;
    controller = controller_;
    agentWallet = agentWallet_;
    templateId = templateId_;
    botId = botId_;
    platformFeeRatePct = platformFeeRatePct_;
    affiliateFeeRatePct = affiliateFeeRatePct_;
    profitShareFeeRatePct = platformFeeRatePct_ + affiliateFeeRatePct_;
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
    require(principalPortion <= grossAmount, "principal_exceeds_gross");
    uint256 availableBalance = usdc.balanceOf(address(this));
    require(grossAmount <= availableBalance, "insufficient_usdc");
    uint256 principalOutstanding = principalDeposited > principalReturned ? principalDeposited - principalReturned : 0;
    require(principalPortion <= principalOutstanding, "principal_exceeds_outstanding");
    uint256 profitComponent = grossAmount > principalPortion ? grossAmount - principalPortion : 0;
    require(feeAmount <= profitComponent, "fee_exceeds_profit");
    require(feeAmount == _computeProfitShareFee(profitComponent), "invalid_fee_policy");
    feePaidTotal += feeAmount;
    if (principalPortion > 0) {
      principalReturned += principalPortion;
    }
    realizedPnlNet += int256(profitComponent) - int256(feeAmount);
    if (profitComponent > highWaterMarkProfit) {
      highWaterMarkProfit = profitComponent;
    }
    uint256 netAmount = _payoutProfitShare(grossAmount, feeAmount);
    emit ProfitClaimed(grossAmount, feeAmount, netAmount);
  }

  function closeVault(uint256 principalToReturn, uint256 grossAmount, uint256 feeAmount) external onlyController {
    require(status == Status.CLOSE_ONLY, "invalid_transition");
    require(grossAmount >= feeAmount, "fee_exceeds_gross");
    require(principalToReturn <= grossAmount, "principal_exceeds_gross");
    uint256 availableBalance = usdc.balanceOf(address(this));
    require(grossAmount <= availableBalance, "insufficient_usdc");
    uint256 principalOutstanding = principalDeposited > principalReturned ? principalDeposited - principalReturned : 0;
    require(principalToReturn <= principalOutstanding, "principal_exceeds_outstanding");
    uint256 profitComponent = grossAmount > principalToReturn ? grossAmount - principalToReturn : 0;
    require(feeAmount <= profitComponent, "fee_exceeds_profit");
    require(feeAmount == _computeProfitShareFee(profitComponent), "invalid_fee_policy");
    principalReturned += principalToReturn;
    feePaidTotal += feeAmount;
    realizedPnlNet += int256(profitComponent) - int256(feeAmount);
    if (profitComponent > highWaterMarkProfit) {
      highWaterMarkProfit = profitComponent;
    }
    _payoutProfitShare(grossAmount, feeAmount);
    emit VaultClosed(principalReturned, feePaidTotal);
  }

  function recoverClosedFunds(uint256 principalToReturn, uint256 grossAmount, uint256 feeAmount) external onlyController {
    require(status == Status.CLOSE_ONLY || status == Status.CLOSED, "recovery_not_allowed");
    require(grossAmount > 0, "amount_required");
    require(grossAmount >= feeAmount, "fee_exceeds_gross");
    require(principalToReturn <= grossAmount, "principal_exceeds_gross");
    uint256 availableBalance = usdc.balanceOf(address(this));
    require(grossAmount <= availableBalance, "insufficient_usdc");
    uint256 principalOutstanding = principalDeposited > principalReturned ? principalDeposited - principalReturned : 0;
    require(principalToReturn <= principalOutstanding, "principal_exceeds_outstanding");
    uint256 profitComponent = grossAmount > principalToReturn ? grossAmount - principalToReturn : 0;
    require(feeAmount <= profitComponent, "fee_exceeds_profit");
    require(feeAmount == _computeProfitShareFee(profitComponent), "invalid_fee_policy");
    principalReturned += principalToReturn;
    feePaidTotal += feeAmount;
    realizedPnlNet += int256(profitComponent) - int256(feeAmount);
    if (profitComponent > highWaterMarkProfit) {
      highWaterMarkProfit = profitComponent;
    }
    uint256 netAmount = _payoutProfitShare(grossAmount, feeAmount);
    emit ClosedRecoveryApplied(principalToReturn, grossAmount, feeAmount, netAmount);
  }

  function sendUsdClassTransfer(uint64 ntl, bool toPerp) external onlyControllerOrAgent {
    _requireTransferAllowed(toPerp);
    require(ntl > 0, "amount_required");
    bytes memory data = HyperCoreActionEncoder.encodeUsdClassTransfer(ntl, toPerp);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_USD_CLASS_TRANSFER, data);
  }

  function sendHyperCoreSpot(address destination, uint64 token, uint64 weiAmount) external onlyControllerOrAgent {
    require(status != Status.DEPLOYED, "spot_send_not_allowed");
    require(destination != address(0), "destination_required");
    require(weiAmount > 0, "amount_required");
    bytes memory data = HyperCoreActionEncoder.encodeSpotSend(destination, token, weiAmount);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_SPOT_SEND, data);
  }

  function depositUsdcToHyperCore(uint256 amount) external onlyControllerOrAgent {
    require(status == Status.ACTIVE || status == Status.FUNDED, "transfer_not_allowed");
    require(amount > 0, "amount_required");
    address depositWallet = factory.coreDepositWallet();
    require(depositWallet != address(0), "deposit_wallet_required");
    require(usdc.approve(depositWallet, 0), "deposit_approve_reset_failed");
    require(usdc.approve(depositWallet, amount), "deposit_approve_failed");
    IHyperCoreDepositWalletV4(depositWallet).deposit(amount, type(uint32).max);
    require(usdc.approve(depositWallet, 0), "deposit_approve_cleanup_failed");
    emit HyperCoreUsdcDepositRequested(address(this), depositWallet, amount, type(uint32).max);
  }

  function placeHyperCoreLimitOrder(
    uint32 asset,
    bool isBuy,
    uint64 limitPx,
    uint64 sz,
    bool reduceOnly,
    uint8 tif,
    uint128 cloid
  ) external onlyControllerOrAgent {
    _requireOrderPlacementAllowed(reduceOnly);
    require(limitPx > 0, "price_required");
    require(sz > 0, "size_required");
    require(tif <= 2, "invalid_tif");
    bytes memory data = HyperCoreActionEncoder.encodeLimitOrder(asset, isBuy, limitPx, sz, reduceOnly, tif, cloid);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_LIMIT_ORDER, data);
  }

  function cancelHyperCoreOrderByOid(uint32 asset, uint64 oid) external onlyControllerOrAgent {
    bytes memory data = HyperCoreActionEncoder.encodeCancelByOid(asset, oid);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_CANCEL_BY_OID, data);
  }

  function cancelHyperCoreOrderByCloid(uint32 asset, uint128 cloid) external onlyControllerOrAgent {
    bytes memory data = HyperCoreActionEncoder.encodeCancelByCloid(asset, cloid);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_CANCEL_BY_CLOID, data);
  }

  function _requireTransferAllowed(bool toPerp) private view {
    if (status == Status.ACTIVE) return;
    if (!toPerp && (status == Status.FUNDED || status == Status.PAUSED || status == Status.CLOSE_ONLY || status == Status.CLOSED)) {
      return;
    }
    revert("transfer_not_allowed");
  }

  function _requireOrderPlacementAllowed(bool reduceOnly) private view {
    if (status == Status.ACTIVE) return;
    if (status == Status.PAUSED || status == Status.CLOSE_ONLY) {
      require(reduceOnly, "order_not_allowed");
      return;
    }
    revert("order_not_allowed");
  }

  function _computeProfitShareFee(uint256 profitAmount) private view returns (uint256) {
    if (profitAmount == 0) return 0;
    return (profitAmount * profitShareFeeRatePct) / 100;
  }

  function _payoutProfitShare(uint256 grossAmount, uint256 feeAmount) private returns (uint256 netAmount) {
    address treasuryRecipient = factory.treasuryRecipient();
    uint256 platformFeeAmount = feeAmount > 0 ? (feeAmount * platformFeeRatePct) / profitShareFeeRatePct : 0;
    uint256 affiliateFeeAmount = feeAmount - platformFeeAmount;
    netAmount = grossAmount - feeAmount;

    if (platformFeeAmount > 0) {
      require(treasuryRecipient != address(0), "treasury_recipient_required");
      require(usdc.transfer(treasuryRecipient, platformFeeAmount), "treasury_fee_transfer_failed");
      emit TreasuryFeePaid(address(this), treasuryRecipient, platformFeeAmount, grossAmount, netAmount, highWaterMarkProfit);
    }
    if (affiliateFeeAmount > 0) {
      require(affiliateRecipient != address(0), "affiliate_recipient_required");
      require(usdc.transfer(affiliateRecipient, affiliateFeeAmount), "affiliate_fee_transfer_failed");
      emit AffiliateFeePaid(address(this), affiliateRecipient, affiliateFeeAmount, grossAmount, netAmount, highWaterMarkProfit);
    }
    require(usdc.transfer(beneficiary, netAmount), "beneficiary_transfer_failed");
  }
}
