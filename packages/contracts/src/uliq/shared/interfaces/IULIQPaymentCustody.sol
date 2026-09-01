// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared custody boundary for ULIQ presale payment collection, refund, and settlement.
/// @dev The interface does not select or approve a production custody implementation.
interface IULIQPaymentCustody {
    function paymentToken() external view returns (address);
    function treasury() external view returns (address);
    function collectFrom(uint256 purchaseId, address buyer, uint256 amount) external;
    function refundTo(uint256 purchaseId, address buyer, uint256 amount) external;
    function releaseToTreasury(uint256 purchaseId, address buyer, uint256 amount) external;
    function balance() external view returns (uint256);
}
