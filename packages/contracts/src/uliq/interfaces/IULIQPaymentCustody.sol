// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Replaceable custody boundary for the legally unresolved presale safeguarding model.
interface IULIQPaymentCustody {
    function paymentToken() external view returns (address);
    function collectFrom(uint256 purchaseId, address buyer, uint256 amount) external;
    function refundTo(uint256 purchaseId, address buyer, uint256 amount) external;
    function releaseToTreasury(uint256 purchaseId, address buyer, uint256 amount) external;
    function balance() external view returns (uint256);
}
