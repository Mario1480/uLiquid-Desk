// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ULIQ Utility Locker
/// @notice Locks wallet-held ULIQ for fixed product-benefit periods without rewards or yield.
contract ULIQLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant THIRTY_DAYS = 30 days;
    uint64 public constant NINETY_DAYS = 90 days;
    uint64 public constant ONE_HUNDRED_EIGHTY_DAYS = 180 days;

    struct LockPosition {
        address owner;
        uint256 amount;
        uint64 startedAt;
        uint64 unlockAt;
        bool withdrawn;
    }

    IERC20 public immutable token;
    uint256 public nextLockId = 1;
    uint256 public totalLocked;
    mapping(uint256 => LockPosition) public locks;
    mapping(address => uint256) public lockedBalanceOf;

    error ZeroAddress();
    error ZeroAmount();
    error UnsupportedDuration();
    error LockNotFound();
    error NotLockOwner();
    error LockStillActive();
    error AlreadyWithdrawn();

    event TokensLocked(
        uint256 indexed lockId,
        address indexed owner,
        uint256 amount,
        uint64 durationSeconds,
        uint64 unlockAt
    );
    event TokensUnlocked(uint256 indexed lockId, address indexed owner, uint256 amount);

    constructor(address token_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
    }

    function lock(uint256 amount, uint64 durationSeconds) external nonReentrant returns (uint256 lockId) {
        if (amount == 0) revert ZeroAmount();
        if (!_isSupportedDuration(durationSeconds)) revert UnsupportedDuration();

        lockId = nextLockId++;
        uint64 startedAt = uint64(block.timestamp);
        uint64 unlockAt = startedAt + durationSeconds;
        locks[lockId] = LockPosition({
            owner: msg.sender,
            amount: amount,
            startedAt: startedAt,
            unlockAt: unlockAt,
            withdrawn: false
        });
        lockedBalanceOf[msg.sender] += amount;
        totalLocked += amount;

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit TokensLocked(lockId, msg.sender, amount, durationSeconds, unlockAt);
    }

    function unlock(uint256 lockId) external nonReentrant returns (uint256 amount) {
        LockPosition storage position = locks[lockId];
        if (position.owner == address(0)) revert LockNotFound();
        if (position.owner != msg.sender) revert NotLockOwner();
        if (position.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < position.unlockAt) revert LockStillActive();

        amount = position.amount;
        position.withdrawn = true;
        lockedBalanceOf[msg.sender] -= amount;
        totalLocked -= amount;

        token.safeTransfer(msg.sender, amount);
        emit TokensUnlocked(lockId, msg.sender, amount);
    }

    function isSupportedDuration(uint64 durationSeconds) external pure returns (bool) {
        return _isSupportedDuration(durationSeconds);
    }

    function _isSupportedDuration(uint64 durationSeconds) private pure returns (bool) {
        return durationSeconds == THIRTY_DAYS || durationSeconds == NINETY_DAYS
            || durationSeconds == ONE_HUNDRED_EIGHTY_DAYS;
    }
}
