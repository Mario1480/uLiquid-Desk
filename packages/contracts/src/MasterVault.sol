// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {BotVault} from "./BotVault.sol";

interface IMasterVaultFactory {
  function treasuryRecipient() external view returns (address);
}

contract MasterVault {
  uint256 public constant PROFIT_SHARE_FEE_RATE_PCT = 30;
  address public immutable owner;
  address public immutable usdc;
  address public immutable factory;
  bool public paused;

  uint256 public freeBalance;
  uint256 public reservedBalance;
  uint256 public totalDeposited;
  uint256 public totalWithdrawn;

  mapping(address => bool) public isBotVault;

  struct SettlementAmounts {
    uint256 feeAmount;
    uint256 netReturned;
    uint256 highWaterMarkAfter;
  }

  event Deposited(address indexed sender, address indexed token, uint256 amount, uint256 freeBalanceAfter);
  event WithdrawRequested(address indexed requester, uint256 amount, uint256 freeBalanceAtRequest);
  event Withdrawn(address indexed owner, uint256 amount, uint256 freeBalanceAfter);
  event BotVaultCreated(address indexed botVault, bytes32 indexed templateId, address indexed agentWallet);
  event BotVaultProvisioned(address indexed botVault, bytes32 indexed templateId, bytes32 indexed botId, uint256 allocation);
  event ReservedForBotVault(address indexed botVault, uint256 amount, uint256 freeBalanceAfter, uint256 reservedBalanceAfter);
  event BotVaultClaimed(
    address indexed botVault,
    uint256 releasedReserved,
    uint256 returnedToFree,
    uint256 freeBalanceAfter,
    uint256 reservedBalanceAfter
  );
  event BotVaultClosed(address indexed botVault, uint256 releasedReserved, uint256 returnedToFree);
  event ReleasedFromBotVault(
    address indexed botVault,
    uint256 releasedReserved,
    uint256 returnedToFree,
    uint256 freeBalanceAfter,
    uint256 reservedBalanceAfter
  );
  event TreasuryFeePaid(
    address indexed botVault,
    address indexed recipient,
    uint256 feeAmount,
    uint256 grossReturned,
    uint256 netReturned,
    uint256 highWaterMarkAfter
  );
  event Paused(address indexed owner);
  event Unpaused(address indexed owner);

  modifier onlyOwner() {
    require(msg.sender == owner, "only_owner");
    _;
  }

  modifier whenNotPaused() {
    require(!paused, "vault_paused");
    _;
  }

  constructor(address owner_, address usdc_, address factory_) {
    require(owner_ != address(0), "owner_required");
    require(usdc_ != address(0), "usdc_required");
    require(factory_ != address(0), "factory_required");
    owner = owner_;
    usdc = usdc_;
    factory = factory_;
  }

  function deposit(address token, uint256 amount) external onlyOwner {
    require(token == usdc, "unsupported_token");
    require(amount > 0, "amount_required");
    bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
    require(ok, "transfer_from_failed");
    freeBalance += amount;
    totalDeposited += amount;
    emit Deposited(msg.sender, token, amount, freeBalance);
  }

  function requestWithdraw(uint256 amount) external onlyOwner {
    require(amount > 0, "amount_required");
    require(freeBalance >= amount, "insufficient_free_balance");
    emit WithdrawRequested(msg.sender, amount, freeBalance);
  }

  function withdraw(uint256 amount) external onlyOwner {
    require(amount > 0, "amount_required");
    require(freeBalance >= amount, "insufficient_free_balance");
    freeBalance -= amount;
    totalWithdrawn += amount;
    bool ok = IERC20(usdc).transfer(owner, amount);
    require(ok, "transfer_failed");
    emit Withdrawn(owner, amount, freeBalance);
  }

  function createBotVault(bytes32 templateId, bytes32 botId, uint256 allocation) external onlyOwner whenNotPaused returns (address botVault) {
    require(allocation > 0, "amount_required");
    require(freeBalance >= allocation, "insufficient_free_balance");
    botVault = _createBotVault(templateId, botId, address(0));
    _allocateToBotVault(botVault, allocation);
    emit BotVaultProvisioned(botVault, templateId, botId, allocation);
  }

  // Legacy-compatible create without immediate allocation.
  function createBotVault(bytes32 templateId, address agentWallet) external onlyOwner whenNotPaused returns (address botVault) {
    botVault = _createBotVault(templateId, bytes32(0), agentWallet);
    emit BotVaultProvisioned(botVault, templateId, bytes32(0), 0);
  }

  function allocateToBotVault(address botVault, uint256 amount) external onlyOwner whenNotPaused {
    _allocateToBotVault(botVault, amount);
  }

  // Legacy wrapper.
  function reserveForBotVault(address botVault, uint256 amount) external onlyOwner whenNotPaused {
    _allocateToBotVault(botVault, amount);
  }

  function treasuryRecipient() public view returns (address) {
    return IMasterVaultFactory(factory).treasuryRecipient();
  }

  function claimFromBotVault(address botVault, uint256 releasedReserved, uint256 grossReturned) external onlyOwner {
    BotVault.Status botStatus = BotVault(botVault).status();
    require(_isClaimableStatus(botStatus), "claim_not_allowed");
    _claimFromBotVault(botVault, releasedReserved, grossReturned);
  }

  // Legacy wrapper.
  function releaseFromBotVault(address botVault, uint256 releasedReserved, uint256 grossReturned) external onlyOwner {
    BotVault.Status botStatus = BotVault(botVault).status();
    require(_isClaimableStatus(botStatus), "claim_not_allowed");
    _claimFromBotVault(botVault, releasedReserved, grossReturned);
  }

  function tokenSurplus() public view returns (uint256) {
    uint256 tokenBalance = IERC20(usdc).balanceOf(address(this));
    uint256 accountedBalance = freeBalance + reservedBalance;
    return tokenBalance > accountedBalance ? tokenBalance - accountedBalance : 0;
  }

  function principalOutstanding(address botVault) public view returns (uint256) {
    uint256 allocated = BotVault(botVault).principalAllocated();
    uint256 returned = BotVault(botVault).principalReturned();
    return allocated > returned ? allocated - returned : 0;
  }

  function closeBotVault(address botVault, uint256 releasedReserved, uint256 grossReturned) external onlyOwner {
    require(isBotVault[botVault], "unknown_bot_vault");
    require(BotVault(botVault).status() == BotVault.Status.CLOSE_ONLY, "invalid_transition");
    _claimFromBotVault(botVault, releasedReserved, grossReturned);
    BotVault(botVault).close();
    emit BotVaultClosed(botVault, releasedReserved, grossReturned);
  }

  // Legacy close without settlement values.
  function closeBotVault(address botVault) external onlyOwner {
    require(isBotVault[botVault], "unknown_bot_vault");
    require(BotVault(botVault).status() == BotVault.Status.CLOSE_ONLY, "invalid_transition");
    BotVault(botVault).close();
    emit BotVaultClosed(botVault, 0, 0);
  }

  function _allocateToBotVault(address botVault, uint256 amount) private {
    require(isBotVault[botVault], "unknown_bot_vault");
    require(amount > 0, "amount_required");
    require(freeBalance >= amount, "insufficient_free_balance");
    freeBalance -= amount;
    reservedBalance += amount;
    BotVault(botVault).topUp(amount);
    emit ReservedForBotVault(botVault, amount, freeBalance, reservedBalance);
  }

  function _claimFromBotVault(address botVault, uint256 releasedReserved, uint256 grossReturned) private {
    require(isBotVault[botVault], "unknown_bot_vault");
    require(releasedReserved > 0 || grossReturned > 0, "amount_required");
    require(reservedBalance >= releasedReserved, "insufficient_reserved_balance");
    require(releasedReserved <= principalOutstanding(botVault), "released_exceeds_outstanding");
    require(grossReturned <= releasedReserved + tokenSurplus(), "returned_exceeds_limit");
    address recipient = treasuryRecipient();
    require(recipient != address(0), "treasury_recipient_required");

    BotVault vault = BotVault(botVault);
    SettlementAmounts memory settlement = _calculateSettlement(vault, releasedReserved, grossReturned);

    reservedBalance -= releasedReserved;
    freeBalance += settlement.netReturned;
    vault.recordRelease(releasedReserved, grossReturned);
    if (settlement.feeAmount > 0) {
      vault.recordFeePaid(settlement.feeAmount, settlement.highWaterMarkAfter);
      bool ok = IERC20(usdc).transfer(recipient, settlement.feeAmount);
      require(ok, "treasury_transfer_failed");
      emit TreasuryFeePaid(
        botVault,
        recipient,
        settlement.feeAmount,
        grossReturned,
        settlement.netReturned,
        settlement.highWaterMarkAfter
      );
    }
    emit ReleasedFromBotVault(botVault, releasedReserved, settlement.netReturned, freeBalance, reservedBalance);
    emit BotVaultClaimed(botVault, releasedReserved, settlement.netReturned, freeBalance, reservedBalance);
  }

  function _calculateSettlement(BotVault vault, uint256 releasedReserved, uint256 grossReturned)
    private
    view
    returns (SettlementAmounts memory settlement)
  {
    uint256 highWaterMarkBefore = vault.highWaterMark();
    int256 realizedPnlAfter = vault.realizedPnlNet() + int256(grossReturned) - int256(releasedReserved);
    uint256 realizedPnlAfterPositive = realizedPnlAfter > 0 ? uint256(realizedPnlAfter) : 0;
    uint256 profitComponent = grossReturned > releasedReserved ? grossReturned - releasedReserved : 0;
    uint256 feeableProfitCapacity = realizedPnlAfterPositive > highWaterMarkBefore
      ? realizedPnlAfterPositive - highWaterMarkBefore
      : 0;
    uint256 feeBase = profitComponent < feeableProfitCapacity ? profitComponent : feeableProfitCapacity;
    settlement.feeAmount = (feeBase * PROFIT_SHARE_FEE_RATE_PCT) / 100;
    settlement.netReturned = grossReturned - settlement.feeAmount;
    settlement.highWaterMarkAfter = highWaterMarkBefore + feeBase;
  }

  function pauseBotVault(address botVault) external onlyOwner {
    require(isBotVault[botVault], "unknown_bot_vault");
    BotVault(botVault).pause();
  }

  function activateBotVault(address botVault) external onlyOwner whenNotPaused {
    require(isBotVault[botVault], "unknown_bot_vault");
    BotVault(botVault).activate();
  }

  function setBotVaultCloseOnly(address botVault) external onlyOwner {
    require(isBotVault[botVault], "unknown_bot_vault");
    BotVault(botVault).setCloseOnly();
  }

  function pause() external onlyOwner {
    require(!paused, "vault_paused");
    paused = true;
    emit Paused(msg.sender);
  }

  function unpause() external onlyOwner {
    require(paused, "vault_not_paused");
    paused = false;
    emit Unpaused(msg.sender);
  }

  function _createBotVault(bytes32 templateId, bytes32 botId, address agentWallet) private returns (address botVault) {
    BotVault vault = new BotVault(address(this), owner, templateId, botId, agentWallet);
    botVault = address(vault);
    isBotVault[botVault] = true;
    emit BotVaultCreated(botVault, templateId, agentWallet);
  }

  function _isClaimableStatus(BotVault.Status status) private pure returns (bool) {
    return status == BotVault.Status.ACTIVE || status == BotVault.Status.PAUSED || status == BotVault.Status.CLOSE_ONLY;
  }
}
