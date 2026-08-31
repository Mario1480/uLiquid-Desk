// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal lifecycle boundary used by the listing controller and successor rounds.
interface IULIQPresaleRoundLifecycle {
    function isRoundEnded() external view returns (bool);
    function isListingReady() external view returns (bool);
}
