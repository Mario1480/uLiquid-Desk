// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {BotVault} from "./BotVault.sol";

contract MasterVault {
  address public immutable owner;
  address public immutable usdc;
  address public immutable factory;

  uint256 public freeBalance;
  uint256 public reservedBalance;
  uint256 public totalDeposited;
  uint256 public totalWithdrawn;

  mapping(address => bool) public isBotVault;

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

  modifier onlyOwner() {
    require(msg.sender == owner, "only_owner");
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

  function createBotVault(bytes32 templateId, bytes32 botId, uint256 allocation) external onlyOwner returns (address botVault) {
    require(allocation > 0, "amount_required");
    require(freeBalance >= allocation, "insufficient_free_balance");
    botVault = _createBotVault(templateId, botId, address(0));
    _allocateToBotVault(botVault, allocation);
    emit BotVaultProvisioned(botVault, templateId, botId, allocation);
  }

  // Legacy-compatible create without immediate allocation.
  function createBotVault(bytes32 templateId, address agentWallet) external onlyOwner returns (address botVault) {
    botVault = _createBotVault(templateId, bytes32(0), agentWallet);
    emit BotVaultProvisioned(botVault, templateId, bytes32(0), 0);
  }

  function allocateToBotVault(address botVault, uint256 amount) external onlyOwner {
    _allocateToBotVault(botVault, amount);
  }

  // Legacy wrapper.
  function reserveForBotVault(address botVault, uint256 amount) external onlyOwner {
    _allocateToBotVault(botVault, amount);
  }

  function claimFromBotVault(address botVault, uint256 releasedReserved, uint256 returnedToFree) external onlyOwner {
    BotVault.Status botStatus = BotVault(botVault).status();
    require(_isClaimableStatus(botStatus), "claim_not_allowed");
    _claimFromBotVault(botVault, releasedReserved, returnedToFree);
  }

  // Legacy wrapper.
  function releaseFromBotVault(address botVault, uint256 releasedReserved, uint256 returnedToFree) external onlyOwner {
    BotVault.Status botStatus = BotVault(botVault).status();
    require(_isClaimableStatus(botStatus), "claim_not_allowed");
    _claimFromBotVault(botVault, releasedReserved, returnedToFree);
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

  function closeBotVault(address botVault, uint256 releasedReserved, uint256 returnedToFree) external onlyOwner {
    require(isBotVault[botVault], "unknown_bot_vault");
    require(BotVault(botVault).status() == BotVault.Status.CLOSE_ONLY, "invalid_transition");
    _claimFromBotVault(botVault, releasedReserved, returnedToFree);
    BotVault(botVault).close();
    emit BotVaultClosed(botVault, releasedReserved, returnedToFree);
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

  function _claimFromBotVault(address botVault, uint256 releasedReserved, uint256 returnedToFree) private {
    require(isBotVault[botVault], "unknown_bot_vault");
    require(releasedReserved > 0 || returnedToFree > 0, "amount_required");
    require(reservedBalance >= releasedReserved, "insufficient_reserved_balance");
    require(releasedReserved <= principalOutstanding(botVault), "released_exceeds_outstanding");
    require(returnedToFree <= releasedReserved + tokenSurplus(), "returned_exceeds_limit");
    reservedBalance -= releasedReserved;
    freeBalance += returnedToFree;
    BotVault(botVault).recordRelease(releasedReserved, returnedToFree);
    emit ReleasedFromBotVault(botVault, releasedReserved, returnedToFree, freeBalance, reservedBalance);
    emit BotVaultClaimed(botVault, releasedReserved, returnedToFree, freeBalance, reservedBalance);
  }

  function pauseBotVault(address botVault) external onlyOwner {
    require(isBotVault[botVault], "unknown_bot_vault");
    BotVault(botVault).pause();
  }

  function activateBotVault(address botVault) external onlyOwner {
    require(isBotVault[botVault], "unknown_bot_vault");
    BotVault(botVault).activate();
  }

  function setBotVaultCloseOnly(address botVault) external onlyOwner {
    require(isBotVault[botVault], "unknown_bot_vault");
    BotVault(botVault).setCloseOnly();
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
