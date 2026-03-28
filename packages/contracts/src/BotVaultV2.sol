// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {HyperCoreActionEncoder} from "./HyperCoreActionEncoder.sol";
import {IHyperCoreWriter} from "./interfaces/IHyperCoreWriter.sol";

contract BotVaultV2 {
  address internal constant HYPERCORE_WRITER = 0x3333333333333333333333333333333333333333;

  enum Status {
    ACTIVE,
    PAUSED,
    CLOSE_ONLY,
    CLOSED
  }

  address public immutable masterVault;
  address public immutable owner;
  bytes32 public immutable templateId;
  bytes32 public immutable botId;
  address public agentWallet;

  Status public status;
  uint256 public principalAllocated;
  uint256 public principalReturned;
  int256 public realizedPnlNet;
  uint256 public feePaidTotal;
  uint256 public highWaterMark;

  event StatusChanged(Status indexed fromStatus, Status indexed toStatus);
  event BotInitialized(bytes32 indexed templateId, bytes32 indexed botId, address indexed agentWallet);
  event BotToppedUp(uint256 amount, uint256 principalAllocatedAfter);
  event BotReleased(uint256 releasedReserved, uint256 grossReturned, int256 pnlDelta, int256 realizedPnlNetAfter);
  event ClosedRecoveryApplied(
    uint256 releasedReserved,
    uint256 grossReturned,
    int256 pnlDelta,
    int256 realizedPnlNetAfter
  );
  event FeePaidRecorded(uint256 feeAmount, uint256 feePaidTotalAfter);
  event AgentWalletUpdated(address indexed previousAgentWallet, address indexed nextAgentWallet);
  event HyperCoreActionForwarded(uint24 indexed actionId, bytes data);

  modifier onlyMasterVault() {
    require(msg.sender == masterVault, "only_master_vault");
    _;
  }

  modifier onlyOwnerOrAgent() {
    require(msg.sender == owner || msg.sender == agentWallet, "only_owner_or_agent");
    _;
  }

  constructor(address masterVault_, address owner_, bytes32 templateId_, bytes32 botId_, address agentWallet_) {
    require(masterVault_ != address(0), "master_vault_required");
    require(owner_ != address(0), "owner_required");
    masterVault = masterVault_;
    owner = owner_;
    templateId = templateId_;
    botId = botId_;
    agentWallet = agentWallet_;
    status = Status.ACTIVE;
    emit BotInitialized(templateId_, botId_, agentWallet_);
  }

  function topUp(uint256 amount) external onlyMasterVault {
    require(status != Status.CLOSED, "bot_closed");
    require(amount > 0, "amount_required");
    principalAllocated += amount;
    emit BotToppedUp(amount, principalAllocated);
  }

  function recordRelease(uint256 releasedReserved, uint256 grossReturned) external onlyMasterVault {
    require(status != Status.CLOSED, "bot_closed");
    _applyRelease(releasedReserved, grossReturned);
    emit BotReleased(releasedReserved, grossReturned, int256(grossReturned) - int256(releasedReserved), realizedPnlNet);
  }

  function recordClosedRecoveryRelease(uint256 releasedReserved, uint256 grossReturned) external onlyMasterVault {
    require(status == Status.CLOSED, "bot_not_closed");
    _applyRelease(releasedReserved, grossReturned);
    emit ClosedRecoveryApplied(
      releasedReserved,
      grossReturned,
      int256(grossReturned) - int256(releasedReserved),
      realizedPnlNet
    );
  }

  function recordFeePaid(uint256 feeAmount, uint256 highWaterMarkAfter) external onlyMasterVault {
    require(feeAmount > 0, "fee_required");
    require(highWaterMarkAfter >= highWaterMark, "high_water_mark_rewind");
    feePaidTotal += feeAmount;
    highWaterMark = highWaterMarkAfter;
    emit FeePaidRecorded(feeAmount, feePaidTotal);
  }

  function setAgentWallet(address nextAgentWallet) external onlyMasterVault {
    address previousAgentWallet = agentWallet;
    agentWallet = nextAgentWallet;
    emit AgentWalletUpdated(previousAgentWallet, nextAgentWallet);
  }

  function pause() external onlyMasterVault {
    _transition(Status.PAUSED);
  }

  function activate() external onlyMasterVault {
    _transition(Status.ACTIVE);
  }

  function setCloseOnly() external onlyMasterVault {
    _transition(Status.CLOSE_ONLY);
  }

  function close() external onlyMasterVault {
    _transition(Status.CLOSED);
  }

  function sendUsdClassTransfer(uint64 ntl, bool toPerp) external onlyOwnerOrAgent {
    require(status != Status.CLOSED, "bot_closed");
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
  ) external onlyOwnerOrAgent {
    require(status != Status.CLOSED, "bot_closed");
    require(limitPx > 0, "price_required");
    require(sz > 0, "size_required");
    require(encodedTif >= 1 && encodedTif <= 3, "invalid_tif");
    if (status == Status.PAUSED || status == Status.CLOSE_ONLY) {
      require(reduceOnly, "reduce_only_required");
    }
    bytes memory data = HyperCoreActionEncoder.encodeLimitOrder(
      asset, isBuy, limitPx, sz, reduceOnly, encodedTif, cloid
    );
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_LIMIT_ORDER, data);
  }

  function cancelHyperCoreOrderByOid(uint32 asset, uint64 oid) external onlyOwnerOrAgent {
    require(status != Status.CLOSED, "bot_closed");
    require(oid > 0, "oid_required");
    bytes memory data = HyperCoreActionEncoder.encodeCancelByOid(asset, oid);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_CANCEL_BY_OID, data);
  }

  function cancelHyperCoreOrderByCloid(uint32 asset, uint128 cloid) external onlyOwnerOrAgent {
    require(status != Status.CLOSED, "bot_closed");
    require(cloid > 0, "cloid_required");
    bytes memory data = HyperCoreActionEncoder.encodeCancelByCloid(asset, cloid);
    IHyperCoreWriter(HYPERCORE_WRITER).sendRawAction(data);
    emit HyperCoreActionForwarded(HyperCoreActionEncoder.ACTION_CANCEL_BY_CLOID, data);
  }

  function _applyRelease(uint256 releasedReserved, uint256 grossReturned) private {
    principalReturned += releasedReserved;
    realizedPnlNet += int256(grossReturned) - int256(releasedReserved);
  }

  function _transition(Status nextStatus) private {
    Status current = status;
    if (nextStatus == Status.PAUSED) {
      require(current == Status.ACTIVE, "invalid_transition");
    } else if (nextStatus == Status.ACTIVE) {
      require(current == Status.PAUSED, "invalid_transition");
    } else if (nextStatus == Status.CLOSE_ONLY) {
      require(current == Status.ACTIVE || current == Status.PAUSED, "invalid_transition");
    } else if (nextStatus == Status.CLOSED) {
      require(current == Status.CLOSE_ONLY, "invalid_transition");
    } else {
      revert("invalid_transition");
    }

    status = nextStatus;
    emit StatusChanged(current, nextStatus);
  }
}
