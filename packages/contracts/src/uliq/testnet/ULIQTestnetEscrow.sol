// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IULIQPaymentCustody} from "../interfaces/IULIQPaymentCustody.sol";

/// @title ULIQ Testnet Escrow
/// @notice TESTNET / PROVISIONAL custody adapter with purchase-bound refund or treasury settlement.
/// @dev This contract is not a production safeguarding decision while ADR-001 remains blocked.
contract ULIQTestnetEscrow is IULIQPaymentCustody, Ownable2Step, ReentrancyGuard {
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
    address public presale;
    address public treasury;
    address public pendingTreasury;
    uint256 public totalCollected;
    uint256 public totalRefunded;
    uint256 public totalReleased;
    mapping(uint256 purchaseId => Payment payment) public payments;

    error ZeroAddress();
    error ZeroAmount();
    error PresaleAlreadySet();
    error UnauthorizedPresale();
    error PaymentAlreadyExists(uint256 purchaseId);
    error PaymentNotCollected(uint256 purchaseId);
    error PaymentDetailsMismatch(uint256 purchaseId);
    error TreasuryUnchanged();
    error TreasuryTransferPending();
    error UnauthorizedTreasuryAcceptance();
    error NoPendingTreasury();
    error OwnershipRenunciationDisabled();

    event PresaleConfigured(address indexed presale);
    event PaymentCollected(uint256 indexed purchaseId, address indexed buyer, uint256 amount);
    event PaymentRefunded(uint256 indexed purchaseId, address indexed buyer, uint256 amount);
    event PaymentReleased(uint256 indexed purchaseId, address indexed buyer, address indexed treasury, uint256 amount);
    event TreasuryTransferStarted(address indexed previousTreasury, address indexed proposedTreasury);
    event TreasuryTransferCancelled(address indexed activeTreasury, address indexed cancelledTreasury);
    event TreasuryTransferred(address indexed previousTreasury, address indexed newTreasury);

    modifier onlyPresale() {
        if (msg.sender != presale) revert UnauthorizedPresale();
        _;
    }

    constructor(address usdc_, address admin, address treasury_) Ownable(admin) {
        if (usdc_ == address(0) || admin == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        treasury = treasury_;
    }

    function paymentToken() external view returns (address) {
        return address(usdc);
    }

    function setPresale(address presale_) external onlyOwner {
        if (presale_ == address(0)) revert ZeroAddress();
        if (presale != address(0)) revert PresaleAlreadySet();
        presale = presale_;
        emit PresaleConfigured(presale_);
    }

    function collectFrom(uint256 purchaseId, address buyer, uint256 amount) external onlyPresale nonReentrant {
        if (buyer == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        Payment storage payment = payments[purchaseId];
        if (payment.state != PaymentState.NONE) revert PaymentAlreadyExists(purchaseId);
        payment.buyer = buyer;
        payment.amount = amount;
        payment.state = PaymentState.COLLECTED;
        totalCollected += amount;
        usdc.safeTransferFrom(buyer, address(this), amount);
        emit PaymentCollected(purchaseId, buyer, amount);
    }

    function refundTo(uint256 purchaseId, address buyer, uint256 amount) external onlyPresale nonReentrant {
        Payment storage payment = _requireCollectedPayment(purchaseId, buyer, amount);
        payment.state = PaymentState.REFUNDED;
        totalRefunded += amount;
        usdc.safeTransfer(buyer, amount);
        emit PaymentRefunded(purchaseId, buyer, amount);
    }

    function releaseToTreasury(uint256 purchaseId, address buyer, uint256 amount) external onlyPresale nonReentrant {
        Payment storage payment = _requireCollectedPayment(purchaseId, buyer, amount);
        payment.state = PaymentState.RELEASED;
        totalReleased += amount;
        address recipient = treasury;
        usdc.safeTransfer(recipient, amount);
        emit PaymentReleased(purchaseId, buyer, recipient, amount);
    }

    function proposeTreasury(address proposedTreasury) external onlyOwner {
        if (proposedTreasury == address(0)) revert ZeroAddress();
        if (proposedTreasury == treasury) revert TreasuryUnchanged();
        if (pendingTreasury != address(0)) revert TreasuryTransferPending();
        pendingTreasury = proposedTreasury;
        emit TreasuryTransferStarted(treasury, proposedTreasury);
    }

    function acceptTreasury() external {
        address proposedTreasury = pendingTreasury;
        if (proposedTreasury == address(0)) revert NoPendingTreasury();
        if (msg.sender != proposedTreasury) revert UnauthorizedTreasuryAcceptance();
        address previousTreasury = treasury;
        treasury = proposedTreasury;
        pendingTreasury = address(0);
        emit TreasuryTransferred(previousTreasury, proposedTreasury);
    }

    function cancelTreasuryTransfer() external onlyOwner {
        address proposedTreasury = pendingTreasury;
        if (proposedTreasury == address(0)) revert NoPendingTreasury();
        pendingTreasury = address(0);
        emit TreasuryTransferCancelled(treasury, proposedTreasury);
    }

    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenunciationDisabled();
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
        if (payment.state != PaymentState.COLLECTED) revert PaymentNotCollected(purchaseId);
        if (payment.buyer != buyer || payment.amount != amount) revert PaymentDetailsMismatch(purchaseId);
    }
}
