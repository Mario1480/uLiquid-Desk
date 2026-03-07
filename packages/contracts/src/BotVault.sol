// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BotVault {
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
  event BotReleased(uint256 releasedReserved, uint256 returnedToFree, int256 pnlDelta, int256 realizedPnlNetAfter);
  event FeePaidRecorded(uint256 feeAmount, uint256 feePaidTotalAfter);

  modifier onlyMasterVault() {
    require(msg.sender == masterVault, "only_master_vault");
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

  function recordRelease(uint256 releasedReserved, uint256 returnedToFree) external onlyMasterVault {
    require(status != Status.CLOSED, "bot_closed");
    principalReturned += releasedReserved;
    int256 pnlDelta = int256(returnedToFree) - int256(releasedReserved);
    realizedPnlNet += pnlDelta;
    if (realizedPnlNet > 0 && uint256(realizedPnlNet) > highWaterMark) {
      highWaterMark = uint256(realizedPnlNet);
    }
    emit BotReleased(releasedReserved, returnedToFree, pnlDelta, realizedPnlNet);
  }

  function recordFeePaid(uint256 feeAmount) external onlyMasterVault {
    require(feeAmount > 0, "fee_required");
    feePaidTotal += feeAmount;
    emit FeePaidRecorded(feeAmount, feePaidTotal);
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
