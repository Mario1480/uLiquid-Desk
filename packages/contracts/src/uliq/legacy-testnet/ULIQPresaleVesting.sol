// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ULIQ Legacy Testnet Presale Vesting
/// @notice Aggregates finalized presale allocations under one immutable global launch schedule.
contract ULIQPresaleVesting is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint64 public immutable vestingDurationSeconds;
    address public presale;
    uint64 public vestingStart;
    uint256 public totalAllocated;
    uint256 public totalReleased;

    mapping(address => uint256) private _allocated;
    mapping(address => uint256) private _released;

    error ZeroAddress();
    error InvalidDuration();
    error PresaleAlreadySet();
    error UnauthorizedPresale();
    error VestingAlreadyStarted();
    error InvalidStart();
    error ZeroAllocation();
    error InsufficientInventory();
    error NothingToClaim();

    event PresaleConfigured(address indexed presale);
    event VestingStartSet(uint64 indexed vestingStart, uint64 indexed vestingEnd);
    event AllocationCreated(address indexed beneficiary, uint256 amount, uint256 allocatedTotal);
    event TokensReleased(address indexed beneficiary, uint256 amount, uint256 releasedTotal);

    modifier onlyPresale() {
        if (msg.sender != presale) revert UnauthorizedPresale();
        _;
    }

    constructor(address token_, address admin, uint64 vestingDurationSeconds_) Ownable(admin) {
        if (token_ == address(0) || admin == address(0)) revert ZeroAddress();
        if (vestingDurationSeconds_ == 0) revert InvalidDuration();
        token = IERC20(token_);
        vestingDurationSeconds = vestingDurationSeconds_;
    }

    function setPresale(address presale_) external onlyOwner {
        if (presale_ == address(0)) revert ZeroAddress();
        if (presale != address(0)) revert PresaleAlreadySet();
        presale = presale_;
        emit PresaleConfigured(presale_);
    }

    function allocate(address beneficiary, uint256 amount) external onlyPresale {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAllocation();
        if (vestingStart != 0) revert VestingAlreadyStarted();

        uint256 nextAllocated = totalAllocated + amount;
        if (token.balanceOf(address(this)) + totalReleased < nextAllocated) revert InsufficientInventory();

        totalAllocated = nextAllocated;
        _allocated[beneficiary] += amount;
        emit AllocationCreated(beneficiary, amount, _allocated[beneficiary]);
    }

    function setVestingStart(uint64 vestingStart_) external onlyPresale {
        if (vestingStart != 0) revert VestingAlreadyStarted();
        if (vestingStart_ < block.timestamp) revert InvalidStart();
        vestingStart = vestingStart_;
        emit VestingStartSet(vestingStart_, vestingEnd());
    }

    function claim() external nonReentrant returns (uint256 amount) {
        amount = claimable(msg.sender);
        if (amount == 0) revert NothingToClaim();

        _released[msg.sender] += amount;
        totalReleased += amount;
        token.safeTransfer(msg.sender, amount);
        emit TokensReleased(msg.sender, amount, _released[msg.sender]);
    }

    function allocated(address beneficiary) external view returns (uint256) {
        return _allocated[beneficiary];
    }

    function released(address beneficiary) external view returns (uint256) {
        return _released[beneficiary];
    }

    function unreleased(address beneficiary) public view returns (uint256) {
        return _allocated[beneficiary] - _released[beneficiary];
    }

    function vested(address beneficiary) public view returns (uint256) {
        uint64 start = vestingStart;
        if (start == 0 || block.timestamp <= start) return 0;

        uint256 allocation = _allocated[beneficiary];
        uint256 elapsed = block.timestamp - start;
        if (elapsed >= vestingDurationSeconds) return allocation;
        return allocation * elapsed / vestingDurationSeconds;
    }

    function claimable(address beneficiary) public view returns (uint256) {
        return vested(beneficiary) - _released[beneficiary];
    }

    function vestingEnd() public view returns (uint64) {
        uint64 start = vestingStart;
        if (start == 0) return 0;
        return start + vestingDurationSeconds;
    }
}
