// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IULIQGlobalListing} from "./interfaces/IULIQGlobalListing.sol";

/// @title ULIQ Presale Round Vesting
/// @notice Holds one round's finalized allocations under the shared listing timestamp.
/// @dev The initial unlock is claimable at listing. The remainder starts linear vesting after the cliff.
contract ULIQPresaleRoundVesting is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable token;
    IULIQGlobalListing public immutable globalListing;
    uint16 public immutable initialUnlockBps;
    uint64 public immutable cliffSeconds;
    uint64 public immutable linearVestingDurationSeconds;

    address public presale;
    uint256 public totalAllocated;
    uint256 public totalReleased;

    mapping(address beneficiary => uint256 amount) private _allocated;
    mapping(address beneficiary => uint256 amount) private _released;

    error ZeroAddress();
    error InvalidSchedule();
    error PresaleAlreadySet();
    error UnauthorizedPresale();
    error ListingAlreadyScheduled();
    error ZeroAllocation();
    error InsufficientInventory(uint256 available, uint256 required);
    error NothingToClaim();

    event PresaleConfigured(address indexed presale);
    event AllocationCreated(address indexed beneficiary, uint256 amount, uint256 allocatedTotal);
    event TokensReleased(address indexed beneficiary, uint256 amount, uint256 releasedTotal);

    modifier onlyPresale() {
        _requirePresale();
        _;
    }

    constructor(
        address token_,
        address globalListing_,
        address admin,
        uint16 initialUnlockBps_,
        uint64 cliffSeconds_,
        uint64 linearVestingDurationSeconds_
    ) Ownable(admin) {
        if (token_ == address(0) || globalListing_ == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        if (
            initialUnlockBps_ > BPS_DENOMINATOR
                || (initialUnlockBps_ < BPS_DENOMINATOR && linearVestingDurationSeconds_ == 0)
        ) revert InvalidSchedule();

        token = IERC20(token_);
        globalListing = IULIQGlobalListing(globalListing_);
        initialUnlockBps = initialUnlockBps_;
        cliffSeconds = cliffSeconds_;
        linearVestingDurationSeconds = linearVestingDurationSeconds_;
    }

    function setPresale(address presale_) external onlyOwner {
        if (presale_ == address(0)) revert ZeroAddress();
        if (presale_.code.length == 0) revert UnauthorizedPresale();
        if (presale != address(0)) revert PresaleAlreadySet();
        if (globalListing.listingTimestamp() != 0) revert ListingAlreadyScheduled();
        presale = presale_;
        emit PresaleConfigured(presale_);
    }

    /// @notice Records a finalized allocation. The presale must pre-fund this contract atomically.
    function allocate(address beneficiary, uint256 amount) external onlyPresale {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAllocation();
        if (globalListing.listingTimestamp() != 0) revert ListingAlreadyScheduled();

        uint256 nextAllocated = totalAllocated + amount;
        uint256 funded = token.balanceOf(address(this)) + totalReleased;
        if (funded < nextAllocated) revert InsufficientInventory(funded, nextAllocated);

        totalAllocated = nextAllocated;
        _allocated[beneficiary] += amount;
        emit AllocationCreated(beneficiary, amount, _allocated[beneficiary]);
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
        uint64 launch = globalListing.listingTimestamp();
        if (launch == 0 || block.timestamp < launch) return 0;

        uint256 allocation = _allocated[beneficiary];
        uint256 initialAmount = Math.mulDiv(allocation, initialUnlockBps, BPS_DENOMINATOR);
        uint256 remaining = allocation - initialAmount;
        if (remaining == 0) return allocation;

        uint256 linearStart = uint256(launch) + cliffSeconds;
        if (block.timestamp <= linearStart) return initialAmount;

        uint256 elapsed = block.timestamp - linearStart;
        if (elapsed >= linearVestingDurationSeconds) return allocation;
        return initialAmount + Math.mulDiv(remaining, elapsed, linearVestingDurationSeconds);
    }

    function claimable(address beneficiary) public view returns (uint256) {
        return vested(beneficiary) - _released[beneficiary];
    }

    function linearVestingStart() external view returns (uint64) {
        uint64 launch = globalListing.listingTimestamp();
        if (launch == 0) return 0;
        return launch + cliffSeconds;
    }

    function vestingEnd() external view returns (uint64) {
        uint64 launch = globalListing.listingTimestamp();
        if (launch == 0) return 0;
        return launch + cliffSeconds + linearVestingDurationSeconds;
    }

    function _requirePresale() private view {
        if (msg.sender != presale) revert UnauthorizedPresale();
    }
}
