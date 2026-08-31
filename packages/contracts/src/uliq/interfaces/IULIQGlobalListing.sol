// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read-only boundary for the shared ULIQ listing timestamp.
interface IULIQGlobalListing {
    function listingTimestamp() external view returns (uint64);
}
