// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IULIQPresaleRoundLifecycle} from "./interfaces/IULIQPresaleRoundLifecycle.sol";

/// @title ULIQ Global Listing Controller
/// @notice Stores the single listing timestamp shared by both ULIQ presale rounds.
/// @dev Review draft only. Production use remains blocked by ADR-001 and an independent audit.
contract ULIQGlobalListing is Ownable2Step {
    address public roundOne;
    address public roundTwo;
    uint64 public listingTimestamp;

    error ZeroAddress();
    error InvalidRoundConfiguration();
    error RoundsAlreadyConfigured();
    error RoundsNotConfigured();
    error ListingAlreadyScheduled();
    error InvalidListingTimestamp();
    error RoundNotReady(address round);

    event RoundsConfigured(address indexed roundOne, address indexed roundTwo);
    event ListingScheduled(uint64 indexed listingTimestamp);

    constructor(address admin) Ownable(admin) {
        if (admin == address(0)) revert ZeroAddress();
    }

    /// @notice Binds the two immutable presale deployments to this controller exactly once.
    function configureRounds(address roundOne_, address roundTwo_) external onlyOwner {
        if (roundOne != address(0) || roundTwo != address(0)) revert RoundsAlreadyConfigured();
        if (roundOne_ == address(0) || roundTwo_ == address(0)) revert ZeroAddress();
        if (roundOne_ == roundTwo_ || roundOne_.code.length == 0 || roundTwo_.code.length == 0) {
            revert InvalidRoundConfiguration();
        }

        roundOne = roundOne_;
        roundTwo = roundTwo_;
        emit RoundsConfigured(roundOne_, roundTwo_);
    }

    /// @notice Schedules the shared listing only after both rounds have no pending purchases.
    function scheduleListing(uint64 listingTimestamp_) external onlyOwner {
        address firstRound = roundOne;
        address secondRound = roundTwo;
        if (firstRound == address(0) || secondRound == address(0)) revert RoundsNotConfigured();
        if (listingTimestamp != 0) revert ListingAlreadyScheduled();
        if (listingTimestamp_ <= block.timestamp) revert InvalidListingTimestamp();
        if (!IULIQPresaleRoundLifecycle(firstRound).isListingReady()) revert RoundNotReady(firstRound);
        if (!IULIQPresaleRoundLifecycle(secondRound).isListingReady()) revert RoundNotReady(secondRound);

        listingTimestamp = listingTimestamp_;
        emit ListingScheduled(listingTimestamp_);
    }
}
