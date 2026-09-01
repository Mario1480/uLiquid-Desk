// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IULIQPaymentCustody} from "../../../../src/uliq/shared/interfaces/IULIQPaymentCustody.sol";

/// @notice Test-only custody double for the ULIQ two-round suite. It is not a production custody implementation.
contract ULIQPresaleMockCustody is IULIQPaymentCustody {
    using SafeERC20 for IERC20;

    enum PaymentState {
        NONE,
        COLLECTED,
        REFUNDED,
        RELEASED
    }

    struct Payment {
        address buyer;
        uint256 amount;
        PaymentState state;
    }

    IERC20 public immutable usdc;
    address public override treasury;
    address public presale;
    uint256 public totalCollected;
    uint256 public totalRefunded;
    uint256 public totalReleased;
    mapping(uint256 purchaseId => Payment payment) public payments;

    error InvalidConfiguration();
    error PresaleAlreadySet();
    error UnauthorizedPresale();
    error InvalidPayment(uint256 purchaseId);

    modifier onlyPresale() {
        if (msg.sender != presale) revert UnauthorizedPresale();
        _;
    }

    constructor(address usdc_, address treasury_) {
        if (usdc_ == address(0) || treasury_ == address(0)) revert InvalidConfiguration();
        usdc = IERC20(usdc_);
        treasury = treasury_;
    }

    function paymentToken() external view returns (address) {
        return address(usdc);
    }

    function setPresale(address presale_) external {
        if (presale_ == address(0)) revert InvalidConfiguration();
        if (presale != address(0)) revert PresaleAlreadySet();
        presale = presale_;
    }

    function collectFrom(uint256 purchaseId, address buyer, uint256 amount) external onlyPresale {
        Payment storage payment = payments[purchaseId];
        if (buyer == address(0) || amount == 0 || payment.state != PaymentState.NONE) {
            revert InvalidPayment(purchaseId);
        }
        payment.buyer = buyer;
        payment.amount = amount;
        payment.state = PaymentState.COLLECTED;
        totalCollected += amount;
        usdc.safeTransferFrom(buyer, address(this), amount);
    }

    function refundTo(uint256 purchaseId, address buyer, uint256 amount) external onlyPresale {
        Payment storage payment = _requireCollectedPayment(purchaseId, buyer, amount);
        payment.state = PaymentState.REFUNDED;
        totalRefunded += amount;
        usdc.safeTransfer(buyer, amount);
    }

    function releaseToTreasury(uint256 purchaseId, address buyer, uint256 amount) external onlyPresale {
        Payment storage payment = _requireCollectedPayment(purchaseId, buyer, amount);
        payment.state = PaymentState.RELEASED;
        totalReleased += amount;
        usdc.safeTransfer(treasury, amount);
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function _requireCollectedPayment(uint256 purchaseId, address buyer, uint256 amount)
        private
        view
        returns (Payment storage payment)
    {
        payment = payments[purchaseId];
        if (payment.state != PaymentState.COLLECTED || payment.buyer != buyer || payment.amount != amount) {
            revert InvalidPayment(purchaseId);
        }
    }
}
